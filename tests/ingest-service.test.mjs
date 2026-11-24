import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleIngest,buildRows,readAllPages,normalizeSourceId} from '../lib/ingest-service.ts';

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
 const candidates=ids=>{const set=new Set(ids.map(normalizeSourceId));return [...rows.values()].filter(r=>r.kind==='transaction'&&r.status!=='archived'&&typeof r.metadata?.source_record_id==='string'&&set.has(normalizeSourceId(r.metadata.source_record_id)));};
 const deps={
  async readExisting(userId,ids){calls.readExisting.push({userId,ids});return {data:clone([...rows.values()].filter(r=>ids.includes(r.external_id))),error:null};},
  async readCandidates(userId,ids){calls.readCandidates.push({userId,ids});return {data:clone(candidates(ids)),error:null};},
  async readRun(userId,key){calls.readRun.push({userId,key});return {data:null,error:null};},
  async commit(args){
   calls.commit.push(clone(args));
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
   return {data:{ok:true,idempotent:false,items,upserted:items.length,run:null},error:null};
  },
 };
 return {rows,calls,deps,put,stamp};
}
const run=(body,db)=>handleIngest(body,USER,NOW,db.deps);
const commits=db=>db.calls.commit.length;

test('v1 정상 2행 → 200 같은 모양, p_run null',async()=>{
 const db=fakeDb();
 const out=await run({items:[tx(1),tx(2)]},db);
 assert.equal(out.kind,'response');assert.equal(out.status,200);
 assert.deepEqual(Object.keys(out.body).sort(),['items','upserted','verification']);
 assert.equal(out.body.upserted,2);assert.equal(out.body.verification,'structural_provenance_only');
 assert.deepEqual(out.body.items.map(i=>Object.keys(i).sort()),[['external_id','id','kind'],['external_id','id','kind']]);
 assert.equal(commits(db),1);assert.equal(db.calls.commit[0].p_run,null);assert.equal(db.calls.commit[0].p_user,USER);
 assert.deepEqual(db.calls.commit[0].p_source_ids,[]);assert.deepEqual(db.calls.commit[0].p_known,[]);
 assert.equal(db.rows.get('transaction:txn-000001').title,'합성가맹점A');
});

test('v1 형식 오류 400 Invalid payload(details 포함)',async()=>{
 const db=fakeDb();
 for(const body of [{},{items:[]},{items:[{...tx(1),extra:1}]},null,'x']){
  const out=await run(body,db);
  assert.equal(out.status,400);assert.equal(out.body.error,'Invalid payload');assert.ok(out.body.details);
 }
 assert.equal(commits(db),0);
});

test('v1 규칙 위반 422, 배치 중복 422',async()=>{
 const db=fakeDb();
 const bad=await run({items:[{...tx(1),metadata:{...txMeta('apv-1'),environment:'demo'}}]},db);
 assert.equal(bad.status,422);assert.equal(bad.body.error,'Production integrity validation failed');
 assert.ok(bad.body.violations.some(v=>v.code==='ENVIRONMENT_REQUIRED'&&v.index===0));
 const dup=await run({items:[tx(1),tx(1)]},db);
 assert.equal(dup.status,422);assert.deepEqual(dup.body.violations,[{index:1,code:'DUPLICATE_BATCH_ID',field:'external_id'}]);
 assert.equal(db.calls.readExisting.length,0);
});

test('DELETE_TARGET_NOT_FOUND 409, commit 0회',async()=>{
 const db=fakeDb();
 const out=await run({items:[tx(1,{status:'archived',metadata:{...txMeta('apv-1'),deletion_reason:'사용자 확인'}})]},db);
 assert.equal(out.status,409);
 assert.deepEqual(out.body,{error:'Production integrity conflict',violations:[{index:0,code:'DELETE_TARGET_NOT_FOUND',field:'external_id'}]});
 assert.equal(commits(db),0);
});

test('STALE_REPLAY 409, commit 0회',async()=>{
 const db=fakeDb([{...tx(1),metadata:{...txMeta('apv-000001'),as_of:'2026-01-01T10:00:00+09:00'}}]);
 const out=await run({items:[tx(1)]},db);
 assert.equal(out.status,409);
 assert.deepEqual(out.body.violations,[{index:0,code:'STALE_REPLAY',field:'metadata.as_of'}]);
 assert.equal(commits(db),0);
});

test('DUPLICATE_SOURCE_TRANSACTION 409, commit 0회',async()=>{
 const db=fakeDb([{...tx(1),metadata:strongMeta('apv-9')}]);
 const out=await run({items:[tx(2,{metadata:strongMeta('apv-9')})]},db);
 assert.equal(out.status,409);
 assert.deepEqual(out.body,{error:'Duplicate source transaction',violations:[{index:0,code:'DUPLICATE_SOURCE_TRANSACTION',field:'metadata.source_record_id'}]});
 assert.equal(commits(db),0);
});

test('validate_only 200, commit 0회',async()=>{
 const db=fakeDb();
 const out=await run({items:[tx(1)],validate_only:true},db);
 assert.deepEqual(out,{kind:'response',status:200,body:{validated:1,upserted:0,verification:'structural_provenance_only'}});
 assert.equal(commits(db),0);
});

test('DB 실패는 단계별 failure',async()=>{
 const err={code:'PGRST301'};
 let db=fakeDb();db.deps.readExisting=async()=>({data:null,error:err});
 assert.deepEqual(await run({items:[tx(1)]},db),{kind:'failure',stage:'status_lookup',err});
 db=fakeDb();db.deps.readCandidates=async()=>({data:null,error:err});
 assert.deepEqual(await run({items:[tx(1,{metadata:strongMeta('apv-1')})]},db),{kind:'failure',stage:'duplicate_lookup',err});
 db=fakeDb();db.deps.commit=async()=>({data:null,error:err});
 assert.deepEqual(await run({items:[tx(1)]},db),{kind:'failure',stage:'write',err});
 db=fakeDb();db.deps.commit=async()=>({data:{ok:false,code:'RUN_ID_CONFLICT'},error:null});
 const odd=await run({items:[tx(1)]},db);
 assert.equal(odd.kind,'failure');assert.equal(odd.stage,'write');
});

test('commit 이 CONCURRENT_CHANGE → 409 code',async()=>{
 const db=fakeDb();db.deps.commit=async()=>({data:{ok:false,code:'CONCURRENT_CHANGE'},error:null});
 assert.deepEqual(await run({items:[tx(1)]},db),{kind:'response',status:409,body:{error:'Concurrent change; retry',code:'CONCURRENT_CHANGE'}});
});

test('읽기 → 다른 쓰기 → commit: CONCURRENT_CHANGE, 기존 값 보존',async()=>{
 const db=fakeDb([{...tx(1),metadata:{...txMeta('apv-000001'),memo:'기존 메모'}}]);
 const read=db.deps.readExisting;
 db.deps.readExisting=async(...a)=>{const r=await read(...a);const cur=db.rows.get('transaction:txn-000001');db.put({...cur,metadata:{...cur.metadata,memo:'사용자 새 메모'},updated_at:db.stamp()});return r;};
 const out=await run({items:[tx(1,{title:'합성가맹점C'})]},db);
 assert.equal(out.status,409);assert.equal(out.body.code,'CONCURRENT_CHANGE');
 const row=db.rows.get('transaction:txn-000001');
 assert.equal(row.title,'합성가맹점A');assert.equal(row.metadata.memo,'사용자 새 메모');
});

test('후보 읽기 → 다른 후보 변경 → commit: CONCURRENT_CHANGE',async()=>{
 const db=fakeDb([{...tx(1),metadata:strongMeta('apv-000001')}]);
 const read=db.deps.readCandidates;
 db.deps.readCandidates=async(...a)=>{const r=await read(...a);const cur=db.rows.get('transaction:txn-000001');db.put({...cur,updated_at:db.stamp()});return r;};
 const out=await run({items:[tx(1,{metadata:strongMeta('apv-000001')})]},db);
 assert.equal(out.body.code,'CONCURRENT_CHANGE');
});

test('p_expected 는 기존 행 updated_at·새 행 null, p_known 은 읽은 후보',async()=>{
 const db=fakeDb([{...tx(1),metadata:strongMeta('apv-000001')}]);
 const prior=db.rows.get('transaction:txn-000001');
 const out=await run({items:[tx(1,{metadata:strongMeta('apv-000001')}),tx(2,{metadata:strongMeta('apv-000002')})]},db);
 assert.equal(out.status,200);
 const c=db.calls.commit[0];
 assert.deepEqual(c.p_expected,[{kind:'transaction',external_id:'txn-000001',updated_at:prior.updated_at},{kind:'transaction',external_id:'txn-000002',updated_at:null}]);
 assert.deepEqual(c.p_known,[{id:prior.id,updated_at:prior.updated_at}]);
 assert.deepEqual(c.p_source_ids,['apv-000001','apv-000002']);
 assert.deepEqual(db.calls.readCandidates[0].ids,c.p_source_ids);
});

test('buildRows: 거래 메모 보존',()=>{
 const current=new Map([['transaction:txn-000001',{id:'x',kind:'transaction',external_id:'txn-000001',metadata:{memo:'기존 메모'}}]]);
 const [row]=buildRows([{...tx(1),currency:'KRW',status:'active',metadata:{...txMeta('a'),memo:'다른 메모'}}],current,USER);
 assert.equal(row.metadata.memo,'기존 메모');assert.equal(row.metadata.dashboard_deleted,false);assert.equal(row.user_id,USER);
});

test('buildRows: 정산 done 유지, 보관된 할 일 유지, 할 일 done 유지',()=>{
 const current=new Map([['settlement:settle-1',{status:'done',metadata:{}}],['task:task-1',{status:'archived',metadata:{}}],['task:task-2',{status:'done',metadata:{}}]]);
 const rows=buildRows([{...settlement(),currency:'KRW',status:'pending'},{...task(),currency:'KRW',status:'pending'},{...task({external_id:'task-2'}),currency:'KRW',status:'pending'}],current,USER);
 assert.deepEqual(rows.map(r=>r.status),['done','archived','done']);
});

test('buildRows: archived 요청은 기존 업무 필드 유지',()=>{
 const prior={id:'x',created_at:'c',updated_at:'u',user_id:USER,kind:'transaction',external_id:'txn-000001',title:'합성가맹점A',amount:1000,description:'기존 설명',metadata:{a:1}};
 const [row]=buildRows([{kind:'transaction',external_id:'txn-000001',title:'합성가맹점Z',amount:9,currency:'KRW',status:'deleted',metadata:{deletion_reason:'사용자 확인'}}],new Map([['transaction:txn-000001',prior]]),USER);
 assert.equal(row.title,'합성가맹점A');assert.equal(row.amount,1000);assert.equal(row.description,'기존 설명');assert.equal(row.status,'archived');
 assert.deepEqual(row.metadata,{a:1,deletion_reason:'사용자 확인',dashboard_deleted:true});
 assert.ok(!('id' in row)&&!('created_at' in row)&&!('updated_at' in row));
});

test('buildRows: 구독 중단 → active + subscription_status',()=>{
 const [row]=buildRows([{kind:'benefit',category:'ai_subscription',external_id:'sub-1',title:'합성구독A',currency:'KRW',status:'paused',metadata:{}}],new Map(),USER);
 assert.equal(row.status,'active');assert.equal(row.metadata.subscription_status,'paused');assert.equal(row.metadata.dashboard_deleted,false);
});

test('보관 요청 본문에 memo 가 있어도 기존 memo 유지',async()=>{
 const db=fakeDb([{...tx(1),metadata:{...txMeta('apv-000001'),memo:'기존 메모'}}]);
 const out=await run({items:[tx(1,{status:'archived',metadata:{...txMeta('apv-000001'),deletion_reason:'사용자 확인',memo:'다른 메모'}})]},db);
 assert.equal(out.status,200);
 const row=db.rows.get('transaction:txn-000001');
 assert.equal(row.metadata.memo,'기존 메모');assert.equal(row.status,'archived');
});

test('결정 A: 생략 → 키 없음, 명시적 null → null, 한 행만 description',async()=>{
 const [omit]=buildRows([{kind:'task',external_id:'t',title:'합성할일A',currency:'KRW',status:'pending',metadata:{}}],new Map(),USER);
 for(const f of ['description','amount','category','source','event_date','due_date','url'])assert.ok(!(f in omit),f);
 assert.equal(omit.currency,'KRW');assert.ok('metadata' in omit&&'status' in omit);
 const [explicit]=buildRows([{kind:'task',external_id:'t',title:'합성할일A',description:null,url:null,currency:'KRW',status:'pending',metadata:{}}],new Map(),USER);
 assert.equal(explicit.description,null);assert.ok('description' in explicit);assert.equal(explicit.url,null);
 const db=fakeDb([{...tx(2),description:'기존 설명'}]);
 const out=await run({items:[tx(1,{description:'새 설명'}),tx(2)]},db);
 assert.equal(out.status,200);
 const [a,b]=db.calls.commit[0].p_rows;
 assert.equal(a.description,'새 설명');assert.ok(!('description' in b));
 assert.equal(db.rows.get('transaction:txn-000002').description,'기존 설명');
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

test('지연 생성: deps 가 예외를 던져도 400·422 가 먼저(deps 호출 0회)',async()=>{
 let n=0;const boom=async()=>{n++;throw new Error('Missing server database secret');};
 const deps={readExisting:boom,readCandidates:boom,readRun:boom,commit:boom};
 assert.equal((await handleIngest({items:[]},USER,NOW,deps)).status,400);
 assert.equal((await handleIngest({items:[{...tx(1),metadata:{}}]},USER,NOW,deps)).status,422);
 assert.equal(n,0);
 await assert.rejects(handleIngest({items:[tx(1)]},USER,NOW,deps));
});

test('v2 본문(docs 예시)은 이 단계에서 400 Invalid payload',async()=>{
 const doc=readFileSync(new URL('../docs/INGEST_V2.md',import.meta.url),'utf8');
 const body=JSON.parse(/<!-- example:success -->\s*```json\n([\s\S]*?)\n```/.exec(doc)[1]);
 const db=fakeDb();
 const out=await run(body,db);
 assert.equal(out.status,400);assert.equal(out.body.error,'Invalid payload');
 assert.equal(db.calls.readExisting.length+commits(db),0);
});

test('양끝 탭·줄바꿈·NBSP source_record_id → 정규화 값으로 후보 조회·commit',async()=>{
 const db=fakeDb();const NBSP=String.fromCharCode(0xa0);
 const out=await run({items:[tx(1,{metadata:strongMeta('\t'+NBSP+' apv-7\n'+NBSP)})]},db);
 assert.equal(out.status,200);
 assert.deepEqual(db.calls.readCandidates[0].ids,['apv-7']);
 assert.deepEqual(db.calls.commit[0].p_source_ids,['apv-7']);
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

test('기존 행 \\tapv-9\\n 과 새 항목 apv-9 → DUPLICATE_SOURCE_TRANSACTION',async()=>{
 const db=fakeDb([{...tx(1),metadata:strongMeta('\tapv-9\n')}]);
 const out=await run({items:[tx(2,{metadata:strongMeta('apv-9')})]},db);
 assert.equal(out.status,409);assert.equal(out.body.violations[0].code,'DUPLICATE_SOURCE_TRANSACTION');
 assert.equal(commits(db),0);
});
