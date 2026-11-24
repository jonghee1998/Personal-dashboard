import test from 'node:test';
import assert from 'node:assert/strict';
import {FAKE_TOKEN, FAKE_USER_ID, apiAuthCases, appOrigin, fakeAppEnv, judge, sessionCookie, startFakeSupabase} from '../scripts/screens/api-auth.mjs';

test('fake env uses only synthetic values and the fake server URL', () => {
  const env = fakeAppEnv('http://127.0.0.1:4555');
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:4555');
  assert.ok(env.PICKLE_INGEST_TOKEN.length >= 32);
  assert.match(env.DASHBOARD_USER_ID, /^[0-9a-f-]{36}$/);
  assert.equal(FAKE_TOKEN, env.PICKLE_INGEST_TOKEN);
  assert.equal(FAKE_USER_ID, env.DASHBOARD_USER_ID);
});

test('session cookie follows the @supabase/ssr storage key and base64 format', () => {
  const [name, value] = sessionCookie('http://127.0.0.1:4555').split('=');
  assert.equal(name, 'sb-127-auth-token');
  assert.ok(value.startsWith('base64-'));
  const session = JSON.parse(Buffer.from(value.slice(7), 'base64url').toString());
  for (const k of ['access_token', 'refresh_token', 'expires_at']) assert.ok(k in session);
  assert.ok(session.expires_at * 1000 > Date.now());
});

test('app origin is localhost on the same port (next start without -H)', () => {
  assert.equal(appOrigin('http://127.0.0.1:3100'), 'http://localhost:3100');
});

test('case list covers token, session and removed routes', () => {
  const cases = apiAuthCases('http://localhost:3100', 'c=1');
  const keys = new Set(cases.map(c => `${c.method} ${c.path}`));
  for (const k of ['POST /api/ingest', 'POST /api/sync-runs', 'GET /api/dashboard', 'PATCH /api/items', 'POST /api/items',
    'DELETE /api/items']) assert.ok(keys.has(k), k);
  const removed = cases.filter(c => c.method === 'GET' && c.path === '/api/sync-runs');
  assert.equal(removed.length, 2);
  assert.equal(removed.filter(c => c.headers.cookie === 'c=1').length, 1);
  assert.equal(removed.filter(c => !c.headers.cookie).length, 1);
  for (const c of removed) assert.deepEqual([c.expect, c.authUser], [405, 'zero']);
  // 6단계 ⑤에서 지운 일회성 API 4개: 경우 5개가 정확히 하나씩, 올바른 인증을 보내도 404·세션 확인 0건
  const gone = [
    ['POST', '/api/reconcile/transactions', 'token'], ['POST', '/api/backfill/preview', 'token'], ['POST', '/api/backfill/stage', 'token'],
    ['GET', '/api/backfill/control', 'session'], ['POST', '/api/backfill/control', 'session'],
  ];
  const gonePaths = new Set(gone.map(([, path]) => path));
  assert.equal(cases.filter(c => gonePaths.has(c.path)).length, gone.length);
  for (const [method, path, auth] of gone) {
    const hit = cases.filter(c => c.method === method && c.path === path);
    assert.equal(hit.length, 1, `${method} ${path}`);
    const [c] = hit;
    assert.deepEqual([c.expect, c.authUser], [404, 'zero'], `${method} ${path}`);
    if (auth === 'token') {
      assert.equal(c.headers.authorization, `Bearer ${FAKE_TOKEN}`, `${method} ${path}`);
      assert.equal(c.headers.cookie, undefined, `${method} ${path}`);
    } else {
      assert.equal(c.headers.cookie, 'c=1', `${method} ${path}`);
      assert.equal(c.headers.authorization, undefined, `${method} ${path}`);
    }
  }
});

test('judge flags wrong status, data requests and auth-user call counts', () => {
  const c = {expect: 401};
  assert.deepEqual(judge(c, 401, [{path: '/auth/v1/user'}]), []);
  assert.equal(judge(c, 200, []).length, 1);
  assert.match(judge(c, 401, [{path: '/rest/v1/dashboard_items'}])[0], /rest\/v1 1건/);
  assert.equal(judge({expect: 403, authUser: 'zero'}, 403, [{path: '/auth/v1/user'}]).length, 1);
  assert.match(judge({expect: 401, authUser: 'some'}, 401, [])[0], /가짜 Supabase 서버를 쓰지 않음/);
  assert.deepEqual(judge({expect: 401, authUser: 'some'}, 401, [{path: '/auth/v1/user'}]), []);
});

test('fake Supabase server records every request and rejects with 401', async () => {
  const fake = await startFakeSupabase();
  try {
    const a = await fetch(`${fake.url}/auth/v1/user`, {headers: {authorization: 'Bearer synthetic'}});
    const b = await fetch(`${fake.url}/rest/v1/dashboard_items?select=*`, {method: 'POST', body: '{}'});
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    await a.arrayBuffer(); await b.arrayBuffer();
    assert.deepEqual(fake.requests, [{method: 'GET', path: '/auth/v1/user'}, {method: 'POST', path: '/rest/v1/dashboard_items'}]);
  } finally { await fake.close(); }
});
