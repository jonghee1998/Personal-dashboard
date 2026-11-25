import test from 'node:test';
import assert from 'node:assert/strict';
import {apiLogCases, badManifestBody, countEvents, eventLines, judgeLogCase, waitQuiet} from '../scripts/screens/api-log.mjs';
import {
  FAKE_PGRST_DETAILS, FAKE_PGRST_MESSAGE, FAKE_TOKEN, FAKE_USER_ID, INGEST_RUN_COMMIT_FAIL, INGEST_RUN_REPLAY, LOG_REPLAY_PAYLOAD_DIGEST, LOG_REPLAY_RUN,
  fakeLogReplayRun, fakeSupabaseResponse, startFakeSupabase,
} from '../scripts/screens/api-auth.mjs';
import {apiIngestCases, v2Body} from '../scripts/screens/api-ingest.mjs';
import {parseIngestV2} from '../lib/ingest-v2.ts';
import {handleIngest, judgeRunRecord} from '../lib/ingest-service.ts';

const NOW = Date.parse('2026-01-02T00:00:00+09:00');
const cases = Object.fromEntries(apiLogCases().map(c => [c.id, c]));
const authLine = JSON.stringify({event: 'collector_auth_failed', route: '/api/ingest', reason: 'no_bearer'});
const readLine = JSON.stringify({event: 'api_failure', route: '/api/ingest', stage: 'write', code: 'PGRST002'});
const replayRun = fakeLogReplayRun();
const ok = {
  a: {status: 401, bodyText: '{"error":"Unauthorized"}', cacheControl: null, lines: ['  ▲ Next.js noise', authLine]},
  b: {status: 503, bodyText: JSON.stringify({error: 'Ingest unavailable'}), cacheControl: 'no-store', lines: [readLine]},
  c: {status: 422, bodyText: JSON.stringify({error: 'Ingest v2 validation failed', violations: [{code: 'ITEM_COUNT_MISMATCH', field: 'manifest.item_count'}]}), cacheControl: 'no-store', lines: []},
  d: {status: 200, bodyText: JSON.stringify({version: 2, upserted: 0, items: [], run: {run_id: LOG_REPLAY_RUN, dataset: replayRun.dataset, source_system: replayRun.source_system, status: 'success', accepted_count: 1}, idempotent: true}),
    cacheControl: 'no-store', lines: [],
    queries: [{method: 'GET', path: '/rest/v1/dashboard_sync_runs', query: `select=*&user_id=eq.${FAKE_USER_ID}&run_id=eq.${LOG_REPLAY_RUN}&dataset=eq.transactions&source_system=eq.samsungcard`}]},
};

test('four cases a-d in order; b-d send numeric version 2 bodies to /api/ingest', () => {
  assert.deepEqual(apiLogCases().map(c => c.id), ['a', 'b', 'c', 'd']);
  for (const id of ['b', 'c', 'd']) {
    assert.equal(cases[id].path, '/api/ingest', id);
    assert.equal(cases[id].headers.authorization, `Bearer ${FAKE_TOKEN}`, id);
    const body = JSON.parse(cases[id].body);
    assert.equal(body.version, 2, id);
    assert.equal(typeof body.version, 'number', id);
  }
  assert.equal(cases.b.expect.match.stage, 'write');
  assert.equal(cases.b.expect.match.route, '/api/ingest');
  // b 는 api-ingest 경우 c 와 같은 본문 모양(run f4)
  assert.deepEqual(JSON.parse(cases.b.body), v2Body(INGEST_RUN_COMMIT_FAIL));
  assert.deepEqual(JSON.parse(cases.b.body), apiIngestCases().find(c => c.id === 'c').body);
  assert.deepEqual(JSON.parse(cases.c.body), badManifestBody());
  assert.deepEqual(JSON.parse(cases.d.body), v2Body(LOG_REPLAY_RUN));
  // d 의 run_id 는 api-ingest 경우들이 쓰지 않는다(f6 상태를 미리 만들지 않음)
  assert.notEqual(LOG_REPLAY_RUN, INGEST_RUN_REPLAY);
  assert.ok(apiIngestCases().every(c => c.body?.run?.run_id !== LOG_REPLAY_RUN));
});

test('c body fails v2 rules with 422 before any DB call, d body is accepted by v2 parser', () => {
  const c = parseIngestV2(badManifestBody(), NOW);
  assert.equal(c.ok, false);
  assert.ok(c.violations.some(v => v.code === 'ITEM_COUNT_MISMATCH'));
  const d = parseIngestV2(JSON.parse(cases.d.body), NOW);
  assert.equal(d.ok, true);
  assert.deepEqual(d.itemViolations, []);
});

test('fake f9 run record matches the d body, so the app judges it an idempotent replay', () => {
  const parsed = parseIngestV2(JSON.parse(cases.d.body), NOW);
  assert.equal(parsed.payloadDigest, LOG_REPLAY_PAYLOAD_DIGEST);
  assert.equal(replayRun.dataset, parsed.run.dataset);
  assert.equal(replayRun.source_system, parsed.run.source_system);
  const out = judgeRunRecord(replayRun, parsed);
  assert.equal(out.status, 200);
  assert.equal(out.body.idempotent, true);
});

test('lib handling of b-d bodies with fake responses matches the expected status', async () => {
  let n = 0;
  const count = fn => async (...a) => { n++; return fn(...a); };
  const deps = {
    readRun: count(async (u, k) => {
      const q = `select=*&user_id=eq.${u}&run_id=eq.${k.run_id}&dataset=eq.${k.dataset}&source_system=eq.${k.source_system}`;
      const r = fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', q, 'application/vnd.pgrst.object+json');
      return {data: Array.isArray(r.body) ? (r.body[0] ?? null) : r.body, error: null};
    }),
    readExisting: count(async () => ({data: [], error: null})),
    readCandidates: count(async () => ({data: [], error: null})),
    commit: count(async args => { const r = fakeSupabaseResponse('POST', '/rest/v1/rpc/dashboard_ingest_commit', '', 'application/json', args); return r.status === 200 ? {data: r.body, error: null} : {data: null, error: r.body}; }),
  };
  const b = await handleIngest(JSON.parse(cases.b.body), FAKE_USER_ID, NOW, deps);
  assert.equal(b.kind, 'v2failure'); assert.equal(b.stage, 'write'); assert.equal(b.err.code, 'PGRST002');
  n = 0;
  const c = await handleIngest(JSON.parse(cases.c.body), FAKE_USER_ID, NOW, deps);
  assert.equal(c.status, 422); assert.equal(n, 0);
  const d = await handleIngest(JSON.parse(cases.d.body), FAKE_USER_ID, NOW, deps);
  assert.equal(d.status, 200); assert.equal(d.body.idempotent, true);
  assert.deepEqual(judgeLogCase(cases.d, {...ok.d, bodyText: JSON.stringify(d.body)}), []);
});

test('event line selection keeps only JSON objects with an event', () => {
  const lines = ['not json', '{"x":1}', '[1]', authLine, ` ${readLine} `, readLine];
  assert.equal(eventLines(lines).length, 3);
  assert.deepEqual(countEvents(lines), {collector_auth_failed: 1, api_failure: 2});
});

test('matching observations pass', () => {
  for (const id of ['a', 'b', 'c', 'd']) assert.deepEqual(judgeLogCase(cases[id], ok[id]), [], id);
});

test('zero or two failure lines fail', () => {
  assert.ok(judgeLogCase(cases.a, {...ok.a, lines: []}).length);
  assert.ok(judgeLogCase(cases.a, {...ok.a, lines: [authLine, authLine]}).length);
  assert.ok(judgeLogCase(cases.b, {...ok.b, lines: []}).length);
  assert.ok(judgeLogCase(cases.b, {...ok.b, lines: [readLine, readLine]}).length);
  assert.ok(judgeLogCase(cases.c, {...ok.c, lines: [readLine]}).length);
  assert.ok(judgeLogCase(cases.d, {...ok.d, lines: [authLine]}).length);
});

test('wrong code, stage, route or reason fails', () => {
  const wrong = fields => JSON.stringify({event: 'api_failure', route: '/api/ingest', stage: 'write', code: 'PGRST002', ...fields});
  assert.ok(judgeLogCase(cases.b, {...ok.b, lines: [wrong({code: 'unknown'})]}).length);
  assert.ok(judgeLogCase(cases.b, {...ok.b, lines: [wrong({stage: 'run_lookup'})]}).length);
  assert.ok(judgeLogCase(cases.b, {...ok.b, lines: [wrong({route: '/api/items'})]}).length);
  assert.ok(judgeLogCase(cases.b, {...ok.b, lines: [readLine, authLine]}).length, 'collector_auth_failed 1줄');
  assert.ok(judgeLogCase(cases.a, {...ok.a, lines: [JSON.stringify({event: 'collector_auth_failed', route: '/api/ingest', reason: 'mismatch'})]}).length);
});

test('sensitive strings anywhere in the window fail, without echoing them', () => {
  for (const s of [FAKE_PGRST_MESSAGE, FAKE_PGRST_DETAILS, FAKE_TOKEN]) {
    const errs = judgeLogCase(cases.b, {...ok.b, lines: [readLine, `some prefix ${s}`]});
    assert.equal(errs.length, 1);
    assert.ok(!errs[0].includes(s));
  }
});

test('response status, body, Cache-Control and fake query are checked', () => {
  assert.ok(judgeLogCase(cases.a, {...ok.a, status: 500}).length);
  assert.ok(judgeLogCase(cases.a, {...ok.a, bodyText: '{"error":"Unauthorized","x":1}'}).length);
  assert.ok(judgeLogCase(cases.b, {...ok.b, cacheControl: null}).length);
  assert.ok(judgeLogCase(cases.b, {...ok.b, bodyText: '{"error":"other"}'}).length);
  const dBody = JSON.parse(ok.d.bodyText);
  assert.ok(judgeLogCase(cases.d, {...ok.d, bodyText: JSON.stringify({...dBody, idempotent: false})}).length);
  assert.ok(judgeLogCase(cases.d, {...ok.d, bodyText: JSON.stringify({...dBody, version: '2'})}).length);
  assert.ok(judgeLogCase(cases.d, {...ok.d, bodyText: JSON.stringify({...dBody, upserted: 1})}).length);
  assert.ok(judgeLogCase(cases.d, {...ok.d, bodyText: JSON.stringify({...dBody, run: {...dBody.run, run_id: INGEST_RUN_REPLAY}})}).length);
  assert.ok(judgeLogCase(cases.d, {...ok.d, bodyText: JSON.stringify({recorded: true, idempotent: true, run: {run_id: LOG_REPLAY_RUN}})}).length);
  assert.ok(judgeLogCase(cases.d, {...ok.d, cacheControl: null}).length);
  assert.ok(judgeLogCase(cases.d, {...ok.d, queries: []}).length);
  assert.ok(judgeLogCase(cases.d, {...ok.d, bodyText: 'not json'}).length);
  assert.ok(judgeLogCase(cases.c, {...ok.c, status: 400}).length);
  assert.ok(judgeLogCase(cases.c, {...ok.c, cacheControl: null}).length);
});

test('waitQuiet returns after a quiet period and gives up when output never stops', async () => {
  const logs = [];
  assert.equal(await waitQuiet(logs, 200, 2000), true);
  const timer = setInterval(() => logs.push('noise'), 50);
  try { assert.equal(await waitQuiet(logs, 300, 600), false); } finally { clearInterval(timer); }
});

test('fake Supabase response: rest/v1 gets a PostgREST 401, f9 run lookup with four filters gets the ingest_v2 record', () => {
  const rest = fakeSupabaseResponse('GET', '/rest/v1/dashboard_items', 'select=*', 'application/json');
  assert.equal(rest.status, 401);
  assert.deepEqual(rest.body, {code: 'PGRST301', message: FAKE_PGRST_MESSAGE, details: FAKE_PGRST_DETAILS, hint: null});
  const auth = fakeSupabaseResponse('GET', '/auth/v1/user', '', '');
  assert.deepEqual(auth, {status: 401, body: {code: 401, error_code: 'bad_jwt', msg: 'synthetic server rejects everything'}});
  const q = ok.d.queries[0].query;
  const list = fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', q, 'application/json');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].run_id, LOG_REPLAY_RUN);
  assert.equal(list.body[0].commit_source, 'ingest_v2');
  const obj = fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', q, 'application/vnd.pgrst.object+json');
  assert.equal(obj.body.run_id, LOG_REPLAY_RUN);
  // dataset 필터가 빠지거나 다르면 기록을 돌려주지 않는다
  assert.deepEqual(fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', `select=*&user_id=eq.${FAKE_USER_ID}&run_id=eq.${LOG_REPLAY_RUN}&source_system=eq.samsungcard`, 'application/json'), {status: 200, body: []});
  assert.deepEqual(fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', q.replace('dataset=eq.transactions', 'dataset=eq.points'), 'application/json'), {status: 200, body: []});
  assert.equal(fakeSupabaseResponse('POST', '/rest/v1/dashboard_sync_runs', q, '').status, 401);
  assert.equal(fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', 'run_id=eq.00000000-0000-4000-8000-0000000000f1', '').status, 401);
});

test('fake server records query strings separately from judge paths', async () => {
  const fake = await startFakeSupabase();
  try {
    const q = ok.d.queries[0].query;
    const r = await fetch(`${fake.url}/rest/v1/dashboard_sync_runs?${q}`);
    assert.equal(r.status, 200); await r.arrayBuffer();
    assert.deepEqual(fake.requests, [{method: 'GET', path: '/rest/v1/dashboard_sync_runs'}]);
    assert.deepEqual(fake.queries, [{method: 'GET', path: '/rest/v1/dashboard_sync_runs', query: q}]);
    // f9 기록은 처음부터 있는 고정 기록이라 f6 상태(runs)를 만들지 않는다
    assert.equal(fake.runs.size, 0);
  } finally { await fake.close(); }
});
