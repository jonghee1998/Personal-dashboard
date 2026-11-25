import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleIngest,buildRowsV2,readAllPages,normalizeSourceId} from '../lib/ingest-service.ts';
import {parseIngestV2} from '../lib/ingest-v2.ts';
import {strongTransactionKey} from '../lib/transaction-reconciliation.ts';

const doc=readFileSync(new URL('../docs/INGEST_V2.md',import.meta.url),'utf8');
const example=name=>JSON.parse(new RegExp('<!-- example:'+name+' -->\\s*```json\\n([\\s\\S]*?)\\n```').exec(doc)[1]);

const USER='00000000-0000-4000-8000-0000000000aa';
const RUN='00000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-01-02T00:00:00+09:00');
const clone=v=>structuredClone(v);

const baseMeta={environment:'production',is_synthetic:false,as_of:'2026-01-01T09:00:00+09:00',verified_at:'2026-01-01T09:05:00+09:00',run_id:RUN};
const txMeta=(id)=>({...baseMeta,source_system:'samsungcard',verification_source:'card_approval_ledger',source_record_id:id});
const strongMeta=(id)=>({...txMeta(id),account_key:'합성계좌A',billing_month:'2026-01',amount_basis:'purchase_approval',source_record_id_type:'provider'});
const tx=(n,extra={})=>({kind:'transaction',external_id:'txn-00000'+n,title:'합성가맹점'+'AB'[n-1],amount:1000*n,event_date:'2026-01-01',metadata:txMeta('apv-00000'+n),...extra});
const userMeta={...baseMeta,source_system:'user_confirmed',verification_source:'user_confirmed'};
const settlement=(extra={})=>({kind:'settlement',external_id:'settle-1',title:'친구A 정산',amount:5000,metadata:userMeta,...extra});
const task=(extra={})=>({kind:'task',external_id:'task-1',title:'합성할일A',metadata:{...baseMeta,source_system:'pickle_assistant_schedule',verification_source:'user_calendar'},...extra});

// 메모리 가짜 DB. commit 은 DB 함수 계약대로 expected·known 을 비교하고 행 JSON 에 있는 키만 갱신한다.
function fakeDb(initial=[]){
 let seq=0,clock=0;
 const stamp=()=>new Date(Date.UTC(2026,0,1,0,0,++clock)).toISOString();
 const rows=new Map();
 const put=r=>{const row={id:r.id??`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,user_id:USER,description:null,amount:null,currency:'KRW',status:'active',category:null,source:null,event_date:null,due_date:null,url:null,metadata:{},created_at:stamp(),...r,updated_at:r.updated_at??stamp()};rows.set(row.kind+':'+row.external_id,row);return row;};
 initial.forEach(put);
 const calls={readExisting:[],readCandidates:[],readRun:[],commit:[]};
 // 실행 기록(dashboard_sync_runs). 키: run_id|dataset|source_system
 const runs=new Map();
 const runKey=k=>k.run_id+'|'+k.dataset+'|'+k.source_system;
 const sameRun=(r,p)=>r.commit_source==='ingest_v2'&&r.status===p.status&&(r.error_code??null)===(p.error_code??null)&&r.expected_count===p.item_count&&r.payload_digest===p.payload_digest;
 const runSummary=r=>({run_id:r.run_id,dataset:r.dataset,source_system:r.source_system,status:r.status,accepted_count:r.accepted_count});
 const candidates=ids=>{const set=new Set(ids.map(normalizeSourceId));return [...rows.values()].filter(r=>r.kind==='transaction'&&r.status!=='archived'&&typeof r.metadata?.source_record_id==='string'&&set.has(normalizeSourceId(r.metadata.source_record_id)));};
 const deps={
  async readExisting(userId,ids){calls.readExisting.push({userId,ids});return {data:clone([...rows.values()].filter(r=>ids.includes(r.external_id))),error:null};},
  async readCandidates(userId,ids){calls.readCandidates.push({userId,ids});return {data:clone(candidates(ids)),error:null};},
  async readRun(userId,key){calls.readRun.push({userId,key});return {data:clone(runs.get(runKey(key))??null),error:null};},
  async commit(args){
   calls.commit.push(clone(args));
   // DB 함수 (c): 재전송 판정이 항목 상태 확인보다 먼저
   if(args.p_run){const r=runs.get(runKey(args.p_run));if(r)return {data:sameRun(r,args.p_run)?{ok:true,idempotent:true,items:[],upserted:0,run:runSummary(r)}:{ok:false,code:'RUN_ID_CONFLICT'},error:null};}
   for(const e of args.p_expected){const d=rows.get(e.kind+':'+e.external_id);if((d?.updated_at??null)!==e.updated_at)return {data:{ok:false,code:'CONCURRENT_CHANGE'},error:null};}
   if(args.p_source_ids.length){
    const now=candidates(args.p_source_ids).map(r=>r.id+'|'+r.updated_at).sort();
    const seen=args.p_known.map(k=>k.id+'|'+k.updated_at).sort();
    if(JSON.stringify(now)!==JSON.stringify(seen))return {data:{ok:false,code:'CONCURRENT_CHANGE'},error:null};
   }
   const items=args.p_rows.map(r=>{
    const prior=rows.get(r.kind+':'+r.external_id);
    const {id:_i,created_at:_c,updated_at:_u,user_id:_x,...fields}=r;
    const row=prior?put({...prior,...fields,updated_at:stamp()}):put(fields);
    return {id:row.id,kind:row.kind,external_id:row.external_id};
   });
   let run=null;
   if(args.p_run){const p=args.p_run;const r={user_id:USER,run_id:p.run_id,dataset:p.dataset,source_system:p.source_system,status:p.status,error_code:p.error_code,expected_count:p.item_count,payload_digest:p.payload_digest,commit_source:'ingest_v2',accepted_count:items.length};runs.set(runKey(p),r);run=runSummary(r);}
   return {data:{ok:true,idempotent:false,items,upserted:items.length,run},error:null};
  },
 };
 return {rows,calls,deps,put,stamp,runs,runKey};
}
const run=(body,db)=>handleIngest(body,USER,NOW,db.deps);
const commits=db=>db.calls.commit.length;

const V1_REMOVED={error:'v1 ingest removed',hint:'send version 2'};
// deps 의 모든 함수 호출을 세는 가짜(어떤 함수든 불리면 개수가 늘어난다).
function countingDeps(){
 const calls=[];
 const fn=name=>async(...args)=>{calls.push(name);return {data:null,error:null};};
 return {calls,deps:{readExisting:fn('readExisting'),readCandidates:fn('readCandidates'),readRun:fn('readRun'),commit:fn('commit')}};
}

test('version 없음(옛 v1 본문) → 410 v1 ingest removed, deps 호출 0회',async()=>{
 const {calls,deps}=countingDeps();
 const out=await handleIngest({items:[tx(1)]},USER,NOW,deps);
 assert.deepEqual(out,{kind:'response',status:410,body:V1_REMOVED,version:2});
 const withValidateOnly=await handleIngest({items:[tx(1)],validate_only:true},USER,NOW,deps);
 assert.equal(withValidateOnly.status,410);
 assert.deepEqual(calls,[]);
});

test('문자열 "2" → 410 v1 ingest removed, deps 호출 0회',async()=>{
 const {calls,deps}=countingDeps();
 const body=example('success');body.version='2';
 const out=await handleIngest(body,USER,NOW,deps);
 assert.deepEqual(out,{kind:'response',status:410,body:V1_REMOVED,version:2});
 assert.deepEqual(calls,[]);
});

test('숫자 2 가 아닌 version·배열·null·문자열 본문 → 410, deps 호출 0회',async()=>{
 const {calls,deps}=countingDeps();
 for(const body of [{version:1,items:[tx(1)]},{version:3},{version:null},[example('success')],null,'x',{}]){
  const out=await handleIngest(body,USER,NOW,deps);
  assert.equal(out.status,410,JSON.stringify(body));assert.deepEqual(out.body,V1_REMOVED);assert.equal(out.version,2);
 }
 assert.deepEqual(calls,[]);
});

test('readAllPages: next_after 로 500·500·200 을 이어 읽음',async()=>{
 const pages={null:{n:500,next:'a'},a:{n:500,next:'b'},b:{n:200,next:null}};const afters=[];
 const r=await readAllPages(async after=>{afters.push(after);const p=pages[String(after)];return {data:{rows:Array.from({length:p.n},(_,i)=>({id:String(after)+i})),next_after:p.next},error:null};});
 assert.equal(r.error,null);assert.equal(r.data.length,1200);assert.deepEqual(afters,[null,'a','b']);
});

test('readAllPages: 한 페이지 200개여도 next_after 가 있으면 계속',async()=>{
 let calls=0;
 const r=await readAllPages(async after=>{calls++;return {data:{rows:Array.from({length:200},()=>({})),next_after:after===null?'p1':null},error:null};});
 assert.equal(calls,2);assert.equal(r.data.length,400);
});

test('readAllPages: 같은 next_after 반복 → 오류, 중간 페이지 오류 → error',async()=>{
 let calls=0;
 const loop=await readAllPages(async()=>{calls++;return {data:{rows:[{}],next_after:'same'},error:null};});
 assert.equal(loop.data,null);assert.ok(loop.error);assert.ok(calls<=3);
 const err={code:'PGRST301'};
 const mid=await readAllPages(async after=>after===null?{data:{rows:[{}],next_after:'x'},error:null}:{data:null,error:err});
 assert.deepEqual(mid,{data:null,error:err});
});

test('normalizeSourceId: 결정 C 집합의 각 문자에서 trim() 과 같음',()=>{
 const set=[0x20,0x09,0x0a,0x0b,0x0c,0x0d,0xa0,0x1680,...Array.from({length:11},(_,i)=>0x2000+i),0x2028,0x2029,0x202f,0x205f,0x3000,0xfeff].map(c=>String.fromCharCode(c));
 assert.equal(set.length,25);
 for(const ch of set){
  const s=ch+ch+'apv'+ch+'9'+ch;
  assert.equal(normalizeSourceId(s),s.trim(),ch.charCodeAt(0).toString(16));
  assert.equal(normalizeSourceId(s),'apv'+ch+'9');
 }
 // U+200B(폭 없는 공백)은 집합 밖: trim() 처럼 지우지 않는다.
 const zw=String.fromCharCode(0x200b)+'apv'+String.fromCharCode(0x200b);
 assert.equal(normalizeSourceId(zw),zw);
 assert.equal(normalizeSourceId(zw),zw.trim());
});

// ---------------- v2 인수 테스트(docs/INGEST_V2.md ⑧) ----------------
const RUN2='00000000-0000-4000-8000-000000000003';
// items 로 v2 본문을 만든다. 항목 metadata.run_id 는 run.run_id 로 맞추고 manifest 는 다시 계산한다.
const v2=(items,over={})=>{
 const run={...example('success').run,...over};
 const its=items.map(x=>({...x,metadata:{...x.metadata,run_id:run.run_id}}));
 return {version:2,run,items:its,manifest:{item_count:its.length,amount_total:its.reduce((s,x)=>typeof x.amount==='number'?s+x.amount:s,0)}};
};
const later={...baseMeta,as_of:'2026-01-01T10:00:00+09:00',verified_at:'2026-01-01T10:05:00+09:00'};
const laterRun={run_id:RUN2,source_as_of:'2026-01-01T10:00:00+09:00',collected_at:'2026-01-01T10:10:00+09:00'};

test('v2 (가) docs success 예시 → 200, commit p_run·digest 가 parse 결과와 같음',async()=>{
 const db=fakeDb();const body=example('success');
 const parsed=parseIngestV2(clone(body),NOW);
 const out=await run(body,db);
 assert.equal(out.kind,'response');assert.equal(out.status,200);assert.equal(out.version,2);
 assert.deepEqual(Object.keys(out.body).sort(),['idempotent','items','run','upserted','version']);
 assert.equal(out.body.version,2);assert.equal(out.body.upserted,2);assert.equal(out.body.idempotent,false);assert.equal(out.body.items.length,2);
 assert.deepEqual(out.body.run,{run_id:body.run.run_id,dataset:'transactions',source_system:'samsungcard',status:'success',accepted_count:2});
 assert.equal(commits(db),1);
 const c=db.calls.commit[0];
 const r=parsed.run;
 assert.deepEqual(c.p_run,{run_id:r.run_id,dataset:r.dataset,source_system:r.source_system,status:r.status,error_code:r.error_code,item_count:parsed.manifest.item_count,payload_digest:parsed.payloadDigest,source_as_of:r.source_as_of,collected_at:r.collected_at});
 assert.match(c.p_run.payload_digest,/^[0-9a-f]{64}$/);
 assert.equal(c.p_user,USER);assert.equal(c.p_rows.length,2);
 assert.deepEqual(c.p_expected.map(e=>e.updated_at),[null,null]);
 // 기본값으로 채운 키(currency·status)는 행 JSON 에 넣지 않는다
 for(const row of c.p_rows){assert.ok(!('currency' in row));assert.ok(!('status' in row));assert.equal(row.user_id,USER);}
 assert.deepEqual(db.calls.readRun.map(x=>x.key),[{run_id:r.run_id,dataset:'transactions',source_system:'samsungcard'}]);
});

test('v2 failed 예시 → 200, commit p_rows [] (항목 검사 없음)',async()=>{
 const db=fakeDb();const body=example('failed');
 const out=await run(body,db);
 assert.equal(out.status,200);assert.equal(out.body.version,2);assert.equal(out.body.upserted,0);assert.deepEqual(out.body.items,[]);
 assert.equal(out.body.run.status,'failed');
 assert.equal(commits(db),1);
 const c=db.calls.commit[0];
 assert.deepEqual(c.p_rows,[]);assert.deepEqual(c.p_expected,[]);assert.deepEqual(c.p_source_ids,[]);
 assert.equal(c.p_run.status,'failed');assert.equal(c.p_run.error_code,'SOURCE_TIMEOUT');assert.equal(c.p_run.item_count,0);
 assert.equal(db.calls.readExisting.length+db.calls.readCandidates.length,0);
});

test('v2 규칙 위반 422(형식·항목), DB 호출 0회',async()=>{
 const db=fakeDb();
 const bad=example('success');bad.extra=1;
 const a=await run(bad,db);
 assert.equal(a.status,422);assert.equal(a.version,2);assert.equal(a.body.error,'Ingest v2 validation failed');
 assert.ok(a.body.violations.every(v=>v.code==='INVALID_FORMAT'));
 const item=example('success');item.items[0].metadata.environment='demo';
 const b=await run(item,db);
 assert.equal(b.status,422);assert.equal(b.body.error,'Ingest v2 validation failed');
 assert.ok(b.body.violations.some(v=>v.code==='ENVIRONMENT_REQUIRED'&&v.index===0));
 assert.equal(db.calls.readRun.length+db.calls.readExisting.length+commits(db),0);
});

test('v2 (마) 성공 → 뒤 실행이 같은 항목 변경 → 원본 재요청 → 200·items []·upserted 0·idempotent, commit 0회',async()=>{
 const db=fakeDb();const original=example('success');
 assert.equal((await run(clone(original),db)).status,200);
 const next=v2([tx(1,{title:'합성가맹점C',metadata:{...txMeta('apv-000001'),...later}})],laterRun);
 const second=await run(next,db);
 assert.equal(second.status,200,JSON.stringify(second.body));
 const row=db.rows.get('transaction:txn-000001');
 assert.equal(row.title,'합성가맹점C');assert.equal(row.metadata.as_of,later.as_of);
 const before=commits(db);
 const again=await run(clone(original),db);
 assert.equal(again.status,200);
 assert.deepEqual(again.body,{version:2,upserted:0,items:[],run:{run_id:original.run.run_id,dataset:'transactions',source_system:'samsungcard',status:'success',accepted_count:2},idempotent:true});
 assert.equal(commits(db),before);
 assert.equal(db.rows.get('transaction:txn-000001').title,'합성가맹점C');
});

test('v2 재전송: 다른 digest → 409 RUN_ID_CONFLICT, commit 0회',async()=>{
 const db=fakeDb();
 assert.equal((await run(example('success'),db)).status,200);
 const changed=example('success');changed.items[0].title='합성가맹점Z';
 const out=await run(changed,db);
 assert.deepEqual(out,{kind:'response',status:409,body:{error:'Run id conflict',code:'RUN_ID_CONFLICT'},version:2});
 assert.equal(commits(db),1);
});

test("v2 commit_source 'report' 기록과 키 겹침 → 409 RUN_ID_CONFLICT",async()=>{
 const db=fakeDb();const body=example('success');const parsed=parseIngestV2(clone(body),NOW);
 db.runs.set(db.runKey(body.run),{run_id:body.run.run_id,dataset:'transactions',source_system:'samsungcard',status:'success',error_code:null,expected_count:2,payload_digest:parsed.payloadDigest,commit_source:'report',accepted_count:2});
 const out=await run(body,db);
 assert.equal(out.status,409);assert.equal(out.body.code,'RUN_ID_CONFLICT');
 assert.equal(commits(db)+db.calls.readExisting.length,0);
});

test('v2 (사) 첫 readRun 없음 → STALE_REPLAY → 두 번째 readRun 에 같은 실행 기록 → 200 idempotent',async()=>{
 const body=example('success');const parsed=parseIngestV2(clone(body),NOW);
 const db=fakeDb([{...tx(1),metadata:{...txMeta('apv-000001'),...later}}]);
 const record={run_id:body.run.run_id,dataset:'transactions',source_system:'samsungcard',status:'success',error_code:null,expected_count:2,payload_digest:parsed.payloadDigest,commit_source:'ingest_v2',accepted_count:2};
 let n=0;db.deps.readRun=async()=>(++n===1?{data:null,error:null}:{data:record,error:null});
 const out=await run(body,db);
 assert.equal(n,2);
 assert.equal(out.status,200);assert.equal(out.body.idempotent,true);assert.deepEqual(out.body.items,[]);assert.equal(out.body.upserted,0);
 assert.equal(commits(db),0);
 // 두 번째 조회에도 기록이 없으면 항목 충돌 409 그대로
 const db2=fakeDb([{...tx(1),metadata:{...txMeta('apv-000001'),...later}}]);
 const out2=await run(example('success'),db2);
 assert.equal(out2.status,409);assert.equal(out2.version,2);
 assert.deepEqual(out2.body.violations,[{index:0,code:'STALE_REPLAY',field:'metadata.as_of'}]);
 assert.equal(db2.calls.readRun.length,2);assert.equal(commits(db2),0);
});

test('v2 (바) 기존 거래 메모 보존, status 생략 시 행 JSON 에 status 없음·기존 상태 유지',async()=>{
 const db=fakeDb([{...tx(1),status:'pending',metadata:{...txMeta('apv-000001'),memo:'기존 메모'}}]);
 const body=example('success');body.items[0].metadata.memo='다른 메모';
 const out=await run(body,db);
 assert.equal(out.status,200);
 const [row]=db.calls.commit[0].p_rows;
 assert.ok(!('status' in row));assert.equal(row.metadata.memo,'기존 메모');
 const stored=db.rows.get('transaction:txn-000001');
 assert.equal(stored.status,'pending');assert.equal(stored.metadata.memo,'기존 메모');
});

test('v2 (바) deleted 요청 → archived + 업무 필드 유지 + dashboard_deleted true, 요청에 없던 metadata 키·memo 유지',async()=>{
 const db=fakeDb([{...tx(1),description:'기존 설명',metadata:{...strongMeta('apv-000001'),memo:'기존 메모',dashboard_deleted:false}}]);
 const item={kind:'transaction',external_id:'txn-000001',title:'합성가맹점Z',amount:1,event_date:'2026-01-01',status:'deleted',metadata:{...txMeta('apv-000001'),deletion_reason:'사용자 확인'}};
 const out=await run(v2([item]),db);
 assert.equal(out.status,200,JSON.stringify(out.body));
 const [row]=db.calls.commit[0].p_rows;
 assert.equal(row.status,'archived');assert.equal(row.title,'합성가맹점A');assert.equal(row.amount,1000);assert.equal(row.description,'기존 설명');
 assert.ok(!('id' in row)&&!('created_at' in row)&&!('updated_at' in row));
 const stored=db.rows.get('transaction:txn-000001');
 assert.equal(stored.status,'archived');assert.equal(stored.title,'합성가맹점A');
 assert.equal(stored.metadata.account_key,'합성계좌A');assert.equal(stored.metadata.dashboard_deleted,true);
 assert.equal(stored.metadata.memo,'기존 메모');assert.equal(stored.metadata.deletion_reason,'사용자 확인');
});

test('v2 보관: 보관된 행에 status 생략·title 변경 → 행 JSON 에 status 없음, title 새 값, dashboard_deleted true 유지',async()=>{
 const db=fakeDb([{...tx(1),status:'archived',metadata:{...txMeta('apv-000001'),dashboard_deleted:true,deletion_reason:'사용자 확인'}}]);
 const out=await run(v2([tx(1,{title:'합성가맹점D'})]),db);
 assert.equal(out.status,200,JSON.stringify(out.body));
 const [row]=db.calls.commit[0].p_rows;
 assert.ok(!('status' in row));assert.equal(row.title,'합성가맹점D');assert.equal(row.metadata.dashboard_deleted,true);
 const stored=db.rows.get('transaction:txn-000001');
 assert.equal(stored.status,'archived');assert.equal(stored.title,'합성가맹점D');assert.equal(stored.metadata.dashboard_deleted,true);
});

test('v2 (바) 구독 중단(paused) → active + subscription_status, status 생략 갱신은 중단 표시 유지',async()=>{
 const subMeta={...baseMeta,source_system:'samsungcard',verification_source:'card_approval_ledger',source_record_id:'sub-apv-1'};
 const sub=(extra={})=>({kind:'benefit',category:'ai_subscription',external_id:'sub-1',title:'합성구독A',amount:100,event_date:'2026-01-01',metadata:subMeta,...extra});
 const db=fakeDb();
 const out=await run(v2([sub({status:'paused'})],{dataset:'subscriptions'}),db);
 assert.equal(out.status,200,JSON.stringify(out.body));
 const [row]=db.calls.commit[0].p_rows;
 assert.equal(row.status,'active');assert.equal(row.metadata.subscription_status,'paused');assert.equal(row.metadata.dashboard_deleted,false);
 const next=await run(v2([sub({title:'합성구독A 갱신',metadata:{...subMeta,...later}})],{...laterRun,dataset:'subscriptions'}),db);
 assert.equal(next.status,200,JSON.stringify(next.body));
 const [row2]=db.calls.commit[1].p_rows;
 assert.ok(!('status' in row2));assert.equal(row2.metadata.subscription_status,'paused');
 assert.equal(db.rows.get('benefit:sub-1').metadata.subscription_status,'paused');
});

test('v2 (아) 기존 USD 행에 currency 생략 → 유효 통화 USD 로 중복 판정, 행 JSON 에 currency 없음',async()=>{
 // 기존: txn-000001 KRW apv-9, txn-000002 USD apv-8. txn-000002 를 currency 없이 apv-9 로 갱신 → 유효 USD 키는 KRW 행과 다름 → 200
 const db=fakeDb([{...tx(1),metadata:strongMeta('apv-9')},{...tx(2),currency:'USD',metadata:strongMeta('apv-8')}]);
 const item=tx(2,{metadata:strongMeta('apv-9')});
 const out=await run(v2([item]),db);
 assert.equal(out.status,200,JSON.stringify(out.body));
 const [row]=db.calls.commit[0].p_rows;
 assert.ok(!('currency' in row));
 assert.equal(db.rows.get('transaction:txn-000002').currency,'USD');
 assert.equal(JSON.parse(strongTransactionKey({...item,currency:'USD'}))[4],'USD');
 // 기존: txn-000001 USD apv-9. txn-000002(USD) 를 currency 없이 apv-9 로 → 유효 USD 키가 겹침 → 409
 const db2=fakeDb([{...tx(1),currency:'USD',metadata:strongMeta('apv-9')},{...tx(2),currency:'USD',metadata:strongMeta('apv-8')}]);
 const dup=await run(v2([item]),db2);
 assert.equal(dup.status,409);assert.equal(dup.body.violations[0].code,'DUPLICATE_SOURCE_TRANSACTION');
 assert.equal(commits(db2),0);
});

test("v2 원천 중복 공백: 기존 'apv-9' 와 새 항목 ' apv-9 ' → DUPLICATE_SOURCE_TRANSACTION, p_source_ids 에 'apv-9'",async()=>{
 const db=fakeDb([{...tx(1),metadata:strongMeta('apv-9')}]);
 const out=await run(v2([tx(2,{metadata:strongMeta(' apv-9 ')})]),db);
 assert.equal(out.status,409);
 assert.deepEqual(out.body,{error:'Duplicate source transaction',violations:[{index:0,code:'DUPLICATE_SOURCE_TRANSACTION',field:'metadata.source_record_id'}]});
 assert.deepEqual(db.calls.readCandidates[0].ids,['apv-9']);assert.equal(commits(db),0);
 // 같은 행 갱신이면 충돌 없음: commit 의 p_source_ids 도 정규화 값
 const same=await run(v2([tx(1,{metadata:strongMeta(' apv-9 ')})]),db);
 assert.equal(same.status,200,JSON.stringify(same.body));
 assert.deepEqual(db.calls.commit[0].p_source_ids,['apv-9']);
});

test('v2 DB 실패 → v2failure(run_lookup 첫·재조회, status_lookup, duplicate_lookup, write), deps 예외 → unexpected',async()=>{
 const err={code:'PGRST301'};
 let db=fakeDb();db.deps.readRun=async()=>({data:null,error:err});
 assert.deepEqual(await run(example('success'),db),{kind:'v2failure',stage:'run_lookup',err});
 db=fakeDb([{...tx(1),metadata:{...txMeta('apv-000001'),...later}}]);
 let n=0;db.deps.readRun=async()=>(++n===1?{data:null,error:null}:{data:null,error:err});
 assert.deepEqual(await run(example('success'),db),{kind:'v2failure',stage:'run_lookup',err});
 assert.equal(n,2);
 db=fakeDb();db.deps.readExisting=async()=>({data:null,error:err});
 assert.deepEqual(await run(example('success'),db),{kind:'v2failure',stage:'status_lookup',err});
 db=fakeDb();db.deps.readCandidates=async()=>({data:null,error:err});
 assert.deepEqual(await run(v2([tx(1,{metadata:strongMeta('apv-1')})]),db),{kind:'v2failure',stage:'duplicate_lookup',err});
 db=fakeDb();db.deps.commit=async()=>({data:null,error:err});
 assert.deepEqual(await run(example('success'),db),{kind:'v2failure',stage:'write',err});
 // adminDb 생성 실패 흉내: deps 첫 호출이 예외 → handleIngest 가 잡아 unexpected
 const boom=new Error('Missing server database secret');
 const thrower=async()=>{throw boom;};
 const out=await handleIngest(example('success'),USER,NOW,{readExisting:thrower,readCandidates:thrower,readRun:thrower,commit:thrower});
 assert.deepEqual(out,{kind:'v2failure',stage:'unexpected',err:boom});
 // 형식 오류는 DB 설정과 상관없이 422 가 먼저
 const bad=example('success');bad.extra=1;
 assert.equal((await handleIngest(bad,USER,NOW,{readExisting:thrower,readCandidates:thrower,readRun:thrower,commit:thrower})).status,422);
});

test('v2 commit CONCURRENT_CHANGE → 409, 끼어든 쓰기도 409',async()=>{
 let db=fakeDb();db.deps.commit=async()=>({data:{ok:false,code:'CONCURRENT_CHANGE'},error:null});
 assert.deepEqual(await run(example('success'),db),{kind:'response',status:409,body:{error:'Concurrent change; retry',code:'CONCURRENT_CHANGE'},version:2});
 db=fakeDb([{...tx(1),metadata:{...txMeta('apv-000001'),memo:'기존 메모'}}]);
 const read=db.deps.readExisting;
 db.deps.readExisting=async(...a)=>{const r=await read(...a);const cur=db.rows.get('transaction:txn-000001');db.put({...cur,metadata:{...cur.metadata,memo:'사용자 새 메모'},updated_at:db.stamp()});return r;};
 const out=await run(example('success'),db);
 assert.equal(out.status,409);assert.equal(out.body.code,'CONCURRENT_CHANGE');
 assert.equal(db.rows.get('transaction:txn-000001').metadata.memo,'사용자 새 메모');assert.equal(db.runs.size,0);
});

test('buildRowsV2: rawItems 에 없는 키는 행 JSON 에 없음, 명시적 null 은 null',()=>{
 const raw=[{kind:'task',external_id:'task-1',title:'합성할일A',description:null,metadata:{a:1}}];
 const items=[{...raw[0],currency:'KRW',status:'active'}];
 const [row]=buildRowsV2(raw,items,new Map(),USER);
 assert.deepEqual(Object.keys(row).sort(),['description','external_id','kind','metadata','title','user_id']);
 assert.equal(row.description,null);assert.deepEqual(row.metadata,{a:1});
 // 할 일 완료 상태 유지(status 키가 있을 때 v1 규칙)
 const [done]=buildRowsV2([{...raw[0],status:'pending'}],[{...items[0],status:'pending'}],new Map([['task:task-1',{status:'done',metadata:{}}]]),USER);
 assert.equal(done.status,'done');
});

test('v2 category 생략 갱신은 기존 category 기준으로 규칙 검사(effectiveRecord, points 를 신청 메타로 덮어쓰기 차단)',async()=>{
 const pointsMeta={...baseMeta,source_system:'samsungcard',verification_source:'card_approval_ledger',source_record_id:'pt-000001',provider:'삼성카드'};
 const appMeta={...baseMeta,source_system:'application_receipt',verification_source:'official_receipt',receipt_id:'rcpt-000001',applied_at:'2026-01-01'};
 const appRun={dataset:'applications',source_system:'application_receipt'};
 const db=fakeDb([{kind:'benefit',external_id:'benefit-pt-1',title:'합성포인트A',category:'points',amount:100,event_date:'2026-01-01',metadata:pointsMeta}]);
 const before=clone(db.rows.get('benefit:benefit-pt-1'));
 const out=await run(v2([{kind:'benefit',external_id:'benefit-pt-1',title:'합성포인트A',metadata:appMeta}],appRun),db);
 assert.equal(out.status,422);assert.equal(out.version,2);assert.equal(out.body.error,'Ingest v2 validation failed');
 const codes=out.body.violations.map(v=>v.code);
 assert.ok(codes.includes('SOURCE_NOT_ALLOWED'));assert.ok(codes.includes('SOURCE_RECORD_ID_REQUIRED'));assert.ok(codes.includes('POINT_PROVIDER_NOT_ALLOWED'));
 assert.ok(out.body.violations.every(v=>v.index===0));
 assert.equal(commits(db),0);assert.deepEqual(db.rows.get('benefit:benefit-pt-1'),before);
 // 같은 본문이라도 새 행이면 신청 규칙으로 통과
 const fresh=fakeDb();
 const ok=await run(v2([{kind:'benefit',external_id:'benefit-app-1',title:'합성신청A',metadata:appMeta}],appRun),fresh);
 assert.equal(ok.status,200,JSON.stringify(ok.body));
 // 기존 신청 행에 category 를 생략한 갱신은 통과하고 category 는 유지
 const app=fakeDb([{kind:'benefit',external_id:'benefit-app-2',title:'합성신청B',category:'youth',metadata:appMeta}]);
 const upd=await run(v2([{kind:'benefit',external_id:'benefit-app-2',title:'합성신청B 갱신',metadata:appMeta}],appRun),app);
 assert.equal(upd.status,200,JSON.stringify(upd.body));assert.equal(app.rows.get('benefit:benefit-app-2').category,'youth');
});
