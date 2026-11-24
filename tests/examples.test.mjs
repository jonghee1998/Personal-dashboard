import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseIngestV2} from '../lib/ingest-v2.ts';
import {payload} from '../lib/ingest-service.ts';
import {validateProductionRecord} from '../lib/ingest-integrity.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const v2=JSON.parse(read('../examples/pickle-payload.json'));
const v1=JSON.parse(read('../examples/pickle-payload-v1.json'));

test('v2 example equals docs/INGEST_V2.md example:success', () => {
  const m=/<!-- example:success -->\s*```json\n([\s\S]*?)\n```/.exec(read('../docs/INGEST_V2.md'));
  assert.ok(m,'example:success block missing');
  assert.deepEqual(v2,JSON.parse(m[1]));
});

test('v2 example passes parseIngestV2', () => {
  const r=parseIngestV2(v2,Date.parse(v2.run.collected_at)+60_000);
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.deepEqual(r.itemViolations,[]);
  assert.equal(r.items.length,v2.items.length);
});

test('v1 example passes v1 payload schema', () => {
  const r=payload.safeParse(v1);
  assert.equal(r.success,true,JSON.stringify(r.error?.flatten()));
  assert.equal(r.data.validate_only,false);
  assert.equal(r.data.items.length,2);
});

test('v1 example items pass validateProductionRecord', () => {
  const items=payload.parse(v1).items;
  for(const [index,item] of items.entries()){
    const now=Date.parse(item.metadata.verified_at)+60_000;
    assert.deepEqual(validateProductionRecord(item,now),[],'item '+index);
  }
});

test('v1 example has no duplicate kind:external_id in batch', () => {
  const keys=v1.items.map(x=>x.kind+':'+x.external_id);
  assert.equal(new Set(keys).size,keys.length);
});

test('v1 example uses obviously synthetic values', () => {
  for(const item of v1.items){
    assert.equal(item.kind,'transaction');
    assert.match(item.title,/^합성가맹점[A-Z]$/);
    assert.equal(item.metadata.source_system,'samsungcard');
    assert.equal(item.metadata.verification_source,'card_approval_ledger');
    assert.match(item.metadata.run_id,/^00000000-0000-4000-8000-\d{12}$/);
    assert.ok(Date.parse(item.metadata.as_of)<=Date.parse(item.metadata.verified_at));
  }
});
