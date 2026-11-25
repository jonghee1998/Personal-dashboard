import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseIngestV2} from '../lib/ingest-v2.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const v2=JSON.parse(read('../examples/pickle-payload.json'));

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
