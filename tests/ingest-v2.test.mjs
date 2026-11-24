import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseIngestV2,ingestV2Codes,payloadDigestOf} from '../lib/ingest-v2.ts';

const doc=readFileSync(new URL('../docs/INGEST_V2.md',import.meta.url),'utf8');
const example=name=>{
  const m=new RegExp('<!-- example:'+name+' -->\\s*```json\\n([\\s\\S]*?)\\n```').exec(doc);
  assert.ok(m,'example block missing: '+name);
  return JSON.parse(m[1]);
};
const clone=v=>structuredClone(v);
const success=()=>clone(example('success'));
const nowFor=body=>Date.parse(body.run.collected_at)+60_000;
const codes=result=>result.ok?[]:result.violations.map(v=>v.code);

test('document has sections ①~⑩', () => {
  for(const mark of ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'])assert.match(doc,new RegExp('^## '+mark,'m'),mark);
});

test('document code table matches lib code list', () => {
  const table=/<!-- codes:start -->([\s\S]*?)<!-- codes:end -->/.exec(doc);
  assert.ok(table);
  const docCodes=[...table[1].matchAll(/^\| `([A-Z_]+)` \|/gm)].map(m=>m[1]);
  assert.deepEqual([...docCodes].sort(),[...ingestV2Codes].sort());
  assert.equal(ingestV2Codes.length,11);
});

test('document examples parse', () => {
  const ok=success();
  const r=parseIngestV2(ok,nowFor(ok));
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.deepEqual(r.itemViolations,[]);
  assert.equal(r.items.length,2);
  assert.match(r.payloadDigest,/^[0-9a-f]{64}$/);
  const failed=example('failed');
  const f=parseIngestV2(failed,nowFor(failed));
  assert.equal(f.ok,true,JSON.stringify(f));
  assert.equal(f.run.status,'failed');
  assert.deepEqual(f.itemViolations,[]);
  const conflict=example('conflict-response');
  assert.deepEqual(conflict,{error:'Run id conflict',code:'RUN_ID_CONFLICT'});
});

const failedBody=()=>clone(example('failed'));
const cases={
  INVALID_FORMAT:()=>{const b=success();b.extra=1;return b;},
  RUN_ID_MISMATCH:()=>{const b=success();b.items[0].metadata.run_id='00000000-0000-4000-8000-000000000099';return b;},
  SOURCE_SYSTEM_MISMATCH:()=>{const b=success();b.items[1].metadata.source_system='naverpay';return b;},
  KIND_DATASET_MISMATCH:()=>{const b=success();b.run.dataset='settlements';return b;},
  ITEM_COUNT_MISMATCH:()=>{const b=success();b.manifest.item_count=3;return b;},
  AMOUNT_TOTAL_MISMATCH:()=>{const b=success();b.manifest.amount_total=3500.01;return b;},
  RUN_TIME_ORDER:()=>{const b=success();b.run.source_as_of='2026-01-01T09:20:00+09:00';return b;},
  ERROR_CODE_REQUIRED:()=>{const b=failedBody();b.run.error_code=null;return b;},
  ITEMS_NOT_ALLOWED_FOR_FAILED:()=>{const b=success();b.run.status='failed';b.run.error_code='SOURCE_TIMEOUT';return b;},
  ITEMS_REQUIRED:()=>{const b=failedBody();b.run.status='success';b.run.error_code=null;return b;},
  DUPLICATE_BATCH_ID:()=>{const b=success();b.items[1].external_id=b.items[0].external_id;return b;},
};

test('each rule code is detected', () => {
  assert.deepEqual(Object.keys(cases).sort(),[...ingestV2Codes].sort());
  for(const [code,make] of Object.entries(cases)){
    const body=make();
    const r=parseIngestV2(body,nowFor(body));
    assert.equal(r.ok,false,code);
    assert.equal(r.status,422);
    assert.ok(codes(r).includes(code),code+' not in '+JSON.stringify(r.violations));
  }
});

test('collected_at more than 5 minutes in the future is RUN_TIME_ORDER', () => {
  const b=success();
  const r=parseIngestV2(b,Date.parse(b.run.collected_at)-6*60_000);
  assert.ok(codes(r).includes('RUN_TIME_ORDER'));
  assert.equal(parseIngestV2(b,Date.parse(b.run.collected_at)-4*60_000).ok,true);
});

test('rule violations are collected together with item index', () => {
  const b=success();b.manifest.item_count=5;b.items[1].metadata.run_id='00000000-0000-4000-8000-000000000099';
  const r=parseIngestV2(b,nowFor(b));
  assert.deepEqual(codes(r).sort(),['ITEM_COUNT_MISMATCH','RUN_ID_MISMATCH']);
  assert.equal(r.violations.find(v=>v.code==='RUN_ID_MISMATCH').index,1);
});

test('version missing or 1 and 501 items are INVALID_FORMAT', () => {
  const noVersion=success();delete noVersion.version;
  const v1=success();v1.version=1;
  for(const b of [noVersion,v1]){const r=parseIngestV2(b,nowFor(b));assert.deepEqual([...new Set(codes(r))],['INVALID_FORMAT']);}
  const big=success();
  big.items=Array.from({length:501},(_,i)=>({...clone(big.items[0]),external_id:'txn-'+String(i).padStart(6,'0')}));
  big.manifest={item_count:501,amount_total:null};
  const r=parseIngestV2(big,nowFor(big));
  assert.ok(codes(r).includes('INVALID_FORMAT'));
  assert.equal(r.violations[0].field,'items');
  const v1Body={items:success().items};
  assert.equal(parseIngestV2(v1Body,0).ok,false);
});

const applicationBody=category=>{
  const b=success();
  b.run.dataset='applications';b.run.source_system='application_receipt';
  b.items=[{kind:'benefit',external_id:'app-000001',title:'합성신청A',category,event_date:'2026-01-01',
    metadata:{...b.items[0].metadata,source_system:'application_receipt',verification_source:'official_receipt',receipt_id:'rcp-000001'}}];
  b.manifest={item_count:1,amount_total:null};
  return b;
};

test('applications dataset kind mapping', () => {
  const points=applicationBody('points');
  assert.ok(codes(parseIngestV2(points,nowFor(points))).includes('KIND_DATASET_MISMATCH'));
  const sub=applicationBody('ai_subscription');
  assert.ok(codes(parseIngestV2(sub,nowFor(sub))).includes('KIND_DATASET_MISMATCH'));
  const nul=applicationBody(null);
  const r=parseIngestV2(nul,nowFor(nul));
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.deepEqual(r.itemViolations,[]);
});

test('item violations from validateProductionRecord are returned with index', () => {
  const b=success();b.items[1].metadata.environment='staging';
  const r=parseIngestV2(b,nowFor(b));
  assert.equal(r.ok,true);
  assert.deepEqual(r.itemViolations,[{index:1,code:'ENVIRONMENT_REQUIRED',field:'metadata.environment'}]);
});

test('payload digest rules and raw item preservation', () => {
  const a=success();
  const base=parseIngestV2(a,nowFor(a));
  assert.match(base.payloadDigest,/^[0-9a-f]{64}$/);
  assert.equal(base.payloadDigest,payloadDigestOf(a.items));

  // 키 순서만 바꿈(항목·metadata 모두)
  const reordered=success();
  reordered.items=reordered.items.map(item=>{
    const meta=Object.fromEntries(Object.entries(item.metadata).reverse());
    return Object.fromEntries(Object.entries({...item,metadata:meta}).reverse());
  });
  assert.notDeepEqual(Object.keys(reordered.items[0]),Object.keys(a.items[0]));
  assert.equal(parseIngestV2(reordered,nowFor(reordered)).payloadDigest,base.payloadDigest);

  // currency 생략 vs 'KRW' 명시
  const explicit=success();explicit.items[0].currency='KRW';
  const e=parseIngestV2(explicit,nowFor(explicit));
  assert.notEqual(e.payloadDigest,base.payloadDigest);
  assert.equal('currency' in base.rawItems[0],false);
  assert.equal(base.items[0].currency,'KRW');
  assert.equal('status' in base.rawItems[0],false);
  assert.equal(base.items[0].status,'active');

  // description:null 은 null 로 남음
  const withNull=success();withNull.items[0].description=null;
  const n=parseIngestV2(withNull,nowFor(withNull));
  assert.equal(n.rawItems[0].description,null);
  assert.ok('description' in n.rawItems[0]);
  assert.notEqual(n.payloadDigest,base.payloadDigest);

  // amount 하나만 바뀜
  const changed=success();changed.items[1].amount=2501;changed.manifest.amount_total=3501;
  assert.notEqual(parseIngestV2(changed,nowFor(changed)).payloadDigest,base.payloadDigest);

  // rawItems 는 입력과 분리된 사본
  a.items[0].title='변경';
  assert.equal(base.rawItems[0].title,'합성가맹점A');
});

test('amount total uses rounded comparison', () => {
  const b=success();b.items[0].amount=0.1;b.items[1].amount=0.2;b.manifest.amount_total=0.3;
  const r=parseIngestV2(b,nowFor(b));
  assert.equal(r.ok,true,JSON.stringify(r));
  const nullTotal=success();nullTotal.manifest.amount_total=null;
  assert.equal(parseIngestV2(nullTotal,nowFor(nullTotal)).ok,true);
});
