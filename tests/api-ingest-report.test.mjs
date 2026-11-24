// 가짜 Supabase 서버의 f7 실행: 별도 보고(commit_source 'report')가 먼저 기록한 실행 키.
// 값은 모두 가짜다(FAKE_USER_ID, 00000000-0000-4000-8000-0000000000f7, 합성가맹점A).
import test from 'node:test';
import assert from 'node:assert/strict';
import {v2Body} from '../scripts/screens/api-ingest.mjs';
import {
  FAKE_USER_ID, INGEST_RUN_REPORT, INGEST_RUN_REPLAY, REPORT_PAYLOAD_DIGEST,
  fakeReportRun, fakeReportRunLookup, fakeReplayRunLookup, fakeSupabaseResponse, startFakeSupabase,
} from '../scripts/screens/api-auth.mjs';
import {parseIngestV2} from '../lib/ingest-v2.ts';
import {judgeRunRecord} from '../lib/ingest-service.ts';

const NOW = Date.parse('2026-01-02T00:00:00+09:00');
const RUNS = '/rest/v1/dashboard_sync_runs';
const OBJECT = 'application/vnd.pgrst.object+json';
const OTHER_USER = '00000000-0000-4000-8000-0000000000a2';
const body = () => v2Body(INGEST_RUN_REPORT);
const query = (over = {}, omit = []) => {
  const run = body().run;
  const keys = {user_id: FAKE_USER_ID, run_id: INGEST_RUN_REPORT, dataset: run.dataset, source_system: run.source_system, ...over};
  const p = new URLSearchParams({select: '*'});
  for (const [k, v] of Object.entries(keys)) if (!omit.includes(k)) p.set(k, `eq.${v}`);
  return p.toString();
};

test('(0) f7 본문은 parseIngestV2 통과, digest 상수와 기록 값이 본문과 같음', () => {
  const b = body();
  const r = parseIngestV2(structuredClone(b), NOW);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
  assert.deepEqual(r.itemViolations, []);
  assert.equal(r.payloadDigest, REPORT_PAYLOAD_DIGEST);
  assert.match(REPORT_PAYLOAD_DIGEST, /^[0-9a-f]{64}$/);
  const rec = fakeReportRun();
  assert.equal(rec.user_id, FAKE_USER_ID);
  assert.equal(rec.run_id, b.run.run_id);
  assert.equal(rec.dataset, b.run.dataset);
  assert.equal(rec.source_system, b.run.source_system);
  assert.equal(rec.status, b.run.status);
  assert.equal(rec.error_code, b.run.error_code ?? null);
  assert.equal(rec.expected_count, b.manifest.item_count);
  assert.equal(rec.source_as_of, b.run.source_as_of);
  assert.equal(rec.collected_at, b.run.collected_at);
  assert.equal(rec.commit_source, 'report');
  assert.equal(rec.accepted_count, 1);
  // 매번 새 객체
  assert.notEqual(fakeReportRun(), fakeReportRun());
});

test('(1) 네 키 조회는 report 기록 1개, object Accept 면 객체', () => {
  const arr = fakeSupabaseResponse('GET', RUNS, query(), 'application/json');
  assert.equal(arr.status, 200);
  assert.deepEqual(arr.body, [fakeReportRun()]);
  assert.equal(arr.body[0].commit_source, 'report');
  const obj = fakeSupabaseResponse('GET', RUNS, query(), OBJECT);
  assert.deepEqual(obj, {status: 200, body: fakeReportRun()});
  assert.deepEqual(fakeReportRunLookup(query(), OBJECT), obj);
  assert.deepEqual(fakeReportRunLookup(query(), 'application/json'), arr);
});

test('(2) 키가 다르거나 필터가 빠진 조회는 []', () => {
  const empty = {status: 200, body: []};
  for (const q of [
    query({user_id: OTHER_USER}), query({dataset: 'settlements'}), query({source_system: 'fake-source'}),
    query({}, ['user_id']), query({}, ['dataset']), query({}, ['source_system']),
    `${query()}&status=neq.success`, `${query()}&status=gt.x`,
  ]) {
    assert.deepEqual(fakeSupabaseResponse('GET', RUNS, q, OBJECT), empty, q);
    assert.deepEqual(fakeSupabaseResponse('GET', RUNS, q, 'application/json'), empty, q);
    assert.deepEqual(fakeReportRunLookup(q, OBJECT), empty, q);
  }
});

test('(3) f7 commit 은 runs 에 남지 않고 조회는 그대로 report 기록', () => {
  const runs = new Map();
  const b = body();
  const args = {p_user: FAKE_USER_ID, p_rows: [{kind: 'transaction', external_id: b.items[0].external_id}], p_expected: [], p_source_ids: [], p_known: [],
    p_run: {...b.run, item_count: 1, payload_digest: REPORT_PAYLOAD_DIGEST}};
  const out = fakeSupabaseResponse('POST', '/rest/v1/rpc/dashboard_ingest_commit', '', 'application/json', args, {runs});
  assert.equal(out.status, 200);
  assert.equal(runs.size, 0);
  assert.deepEqual(fakeSupabaseResponse('GET', RUNS, query(), 'application/json', undefined, {runs}).body, [fakeReportRun()]);
  // f6 조회 규칙은 그대로(runs 비어 있음 → [])
  assert.deepEqual(fakeReplayRunLookup(runs, query({run_id: INGEST_RUN_REPLAY}), OBJECT), {status: 200, body: []});
});

test('(4) startFakeSupabase HTTP GET 도 같은 기록', async () => {
  const fake = await startFakeSupabase();
  try {
    const r = await fetch(`${fake.url}${RUNS}?${query()}`, {headers: {accept: OBJECT}});
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), fakeReportRun());
    const a = await fetch(`${fake.url}${RUNS}?${query()}`, {headers: {accept: 'application/json'}});
    assert.deepEqual(await a.json(), [fakeReportRun()]);
    const e = await fetch(`${fake.url}${RUNS}?${query({user_id: OTHER_USER})}`, {headers: {accept: OBJECT}});
    assert.deepEqual(await e.json(), []);
    assert.equal(fake.runs.size, 0);
  } finally { await fake.close(); }
});

test('(5) judgeRunRecord: report 기록은 409, commit_source 만 ingest_v2 면 200 idempotent', () => {
  const parsed = parseIngestV2(structuredClone(body()), NOW);
  assert.equal(parsed.ok, true);
  assert.deepEqual(judgeRunRecord(fakeReportRun(), parsed),
    {kind: 'response', status: 409, body: {error: 'Run id conflict', code: 'RUN_ID_CONFLICT'}, version: 2});
  const same = judgeRunRecord({...fakeReportRun(), commit_source: 'ingest_v2'}, parsed);
  assert.equal(same.status, 200);
  assert.equal(same.body.idempotent, true);
  assert.equal(same.body.run.run_id, INGEST_RUN_REPORT);
  assert.equal(same.body.run.accepted_count, 1);
});
