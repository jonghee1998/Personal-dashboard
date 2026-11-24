import test from 'node:test';
import assert from 'node:assert/strict';
import {apiLogCases, countEvents, eventLines, judgeLogCase, waitQuiet} from '../scripts/screens/api-log.mjs';
import {FAKE_EXISTING_RUN_ID, FAKE_PGRST_DETAILS, FAKE_PGRST_MESSAGE, FAKE_TOKEN, FAKE_USER_ID, fakeSupabaseResponse, startFakeSupabase} from '../scripts/screens/api-auth.mjs';

const cases = Object.fromEntries(apiLogCases().map(c => [c.id, c]));
const authLine = JSON.stringify({event: 'collector_auth_failed', route: '/api/ingest', reason: 'no_bearer'});
const readLine = JSON.stringify({event: 'api_failure', route: '/api/sync-runs', stage: 'read', code: 'PGRST301'});
const ok = {
  a: {status: 401, bodyText: '{"error":"Unauthorized"}', cacheControl: null, lines: ['  ▲ Next.js noise', authLine]},
  b: {status: 503, bodyText: JSON.stringify({error: 'Sync audit unavailable; migration required or database unavailable'}), cacheControl: 'no-store', lines: [readLine]},
  c: {status: 422, bodyText: '{"error":"Invalid sync report"}', cacheControl: 'no-store', lines: []},
  d: {status: 200, bodyText: JSON.stringify({recorded: true, idempotent: true, run: {run_id: FAKE_EXISTING_RUN_ID}}), cacheControl: 'no-store', lines: [],
    queries: [{method: 'GET', path: '/rest/v1/dashboard_sync_runs', query: `select=*&run_id=eq.${FAKE_EXISTING_RUN_ID}`}]},
};

test('four cases a-d in order', () => {
  assert.deepEqual(apiLogCases().map(c => c.id), ['a', 'b', 'c', 'd']);
  assert.equal(cases.b.expect.match.stage, 'read');
  assert.equal(JSON.parse(cases.d.body).run_id, FAKE_EXISTING_RUN_ID);
  assert.equal(JSON.parse(cases.b.body).run_id.endsWith('f1'), true);
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
  const wrong = fields => JSON.stringify({event: 'api_failure', route: '/api/sync-runs', stage: 'read', code: 'PGRST301', ...fields});
  assert.ok(judgeLogCase(cases.b, {...ok.b, lines: [wrong({code: 'unknown'})]}).length);
  assert.ok(judgeLogCase(cases.b, {...ok.b, lines: [wrong({stage: 'write'})]}).length);
  assert.ok(judgeLogCase(cases.b, {...ok.b, lines: [wrong({route: '/api/ingest'})]}).length);
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
  assert.ok(judgeLogCase(cases.d, {...ok.d, bodyText: JSON.stringify({recorded: true, run: {run_id: FAKE_EXISTING_RUN_ID}})}).length);
  assert.ok(judgeLogCase(cases.d, {...ok.d, queries: []}).length);
  assert.ok(judgeLogCase(cases.d, {...ok.d, bodyText: 'not json'}).length);
});

test('waitQuiet returns after a quiet period and gives up when output never stops', async () => {
  const logs = [];
  assert.equal(await waitQuiet(logs, 200, 2000), true);
  const timer = setInterval(() => logs.push('noise'), 50);
  try { assert.equal(await waitQuiet(logs, 300, 600), false); } finally { clearInterval(timer); }
});

test('fake Supabase response: rest/v1 gets a PostgREST 401, existing run gets 200', () => {
  const rest = fakeSupabaseResponse('GET', '/rest/v1/dashboard_items', 'select=*', 'application/json');
  assert.equal(rest.status, 401);
  assert.deepEqual(rest.body, {code: 'PGRST301', message: FAKE_PGRST_MESSAGE, details: FAKE_PGRST_DETAILS, hint: null});
  const auth = fakeSupabaseResponse('GET', '/auth/v1/user', '', '');
  assert.deepEqual(auth, {status: 401, body: {code: 401, error_code: 'bad_jwt', msg: 'synthetic server rejects everything'}});
  const q = `select=*&user_id=eq.${FAKE_USER_ID}&run_id=eq.${FAKE_EXISTING_RUN_ID}`;
  const list = fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', q, 'application/json');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].run_id, FAKE_EXISTING_RUN_ID);
  assert.equal(list.body[0].error_code, 'FAKE_CHECK');
  const obj = fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', q, 'application/vnd.pgrst.object+json');
  assert.equal(obj.body.run_id, FAKE_EXISTING_RUN_ID);
  assert.equal(fakeSupabaseResponse('POST', '/rest/v1/dashboard_sync_runs', q, '').status, 401);
  assert.equal(fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', 'run_id=eq.00000000-0000-4000-8000-0000000000f1', '').status, 401);
});

test('fake server records query strings separately from judge paths', async () => {
  const fake = await startFakeSupabase();
  try {
    const r = await fetch(`${fake.url}/rest/v1/dashboard_sync_runs?select=*&run_id=eq.${FAKE_EXISTING_RUN_ID}`);
    assert.equal(r.status, 200); await r.arrayBuffer();
    assert.deepEqual(fake.requests, [{method: 'GET', path: '/rest/v1/dashboard_sync_runs'}]);
    assert.deepEqual(fake.queries, [{method: 'GET', path: '/rest/v1/dashboard_sync_runs', query: `select=*&run_id=eq.${FAKE_EXISTING_RUN_ID}`}]);
  } finally { await fake.close(); }
});
