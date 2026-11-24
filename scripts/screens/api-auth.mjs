// API 인증 실제 호출 검사. 빌드된 앱(next start)에 가짜 환경변수와 가짜 Supabase 서버를 붙여
// 인증 없는 요청이 거부되고, 거부될 때 데이터 요청(rest/v1)이 하나도 나가지 않는지 확인한다.
// 값은 전부 가짜다(운영 주소·키를 쓰지 않는다). run.mjs 가 next start 전에 startFakeSupabase/fakeAppEnv 로
// 준비하고, 앱이 뜬 뒤 checkApiAuth 를 부른다. 단독 실행: node scripts/screens/api-auth.mjs (빌드 필요, chromium 불필요)
import {createServer} from 'node:http';

export const FAKE_TOKEN = 'synthetic-ingest-token-for-api-auth-check-0001';
export const FAKE_USER_ID = '00000000-0000-4000-8000-0000000000a1';

/** 가짜 PostgREST 오류 본문. message·details 는 서버 로그에 나오면 안 되는 표시용 문자열이다. */
export const FAKE_PGRST_MESSAGE = 'fake-message-should-not-be-logged';
export const FAKE_PGRST_DETAILS = 'fake-details-should-not-be-logged';
/** 가짜 서버가 '이미 기록된 실행'으로 돌려주는 run_id (api-log 검사 (d)) */
export const FAKE_EXISTING_RUN_ID = '00000000-0000-4000-8000-0000000000f2';
export function fakeExistingRun() {
  return {
    user_id: FAKE_USER_ID, run_id: FAKE_EXISTING_RUN_ID, dataset: 'transactions', source_system: 'fake-source',
    status: 'failed', source_as_of: null, collected_at: null, expected_count: null,
    received_count: 0, rejected_count: 0, error_code: 'FAKE_CHECK', payload_digest: null,
  };
}

/** 가짜 서버 응답 결정(순수 함수) → {status, body} */
export function fakeSupabaseResponse(method, path, query, accept) {
  if (method === 'GET' && path === '/rest/v1/dashboard_sync_runs' && new URLSearchParams(query).getAll('run_id').includes(`eq.${FAKE_EXISTING_RUN_ID}`)) {
    const row = fakeExistingRun();
    return {status: 200, body: (accept || '').includes('vnd.pgrst.object') ? row : [row]};
  }
  if (path.startsWith('/rest/v1/')) {
    return {status: 401, body: {code: 'PGRST301', message: FAKE_PGRST_MESSAGE, details: FAKE_PGRST_DETAILS, hint: null}};
  }
  return {status: 401, body: {code: 401, error_code: 'bad_jwt', msg: 'synthetic server rejects everything'}};
}

/** 받은 요청을 기록하고, 데이터 요청(rest/v1)은 PostgREST 모양 401, 그 밖은 401 로 거부하는 가짜 Supabase 서버.
 *  예외: 기존 실행(FAKE_EXISTING_RUN_ID) 조회만 200. requests 는 judge 용으로 경로만, queries 는 쿼리 문자열까지 기록한다. */
export async function startFakeSupabase() {
  const requests = [], queries = [];
  const server = createServer((req, res) => {
    const url = req.url || '';
    const q = url.indexOf('?');
    const path = q < 0 ? url : url.slice(0, q), query = q < 0 ? '' : url.slice(q + 1);
    requests.push({method: req.method, path});
    queries.push({method: req.method, path, query});
    req.resume();
    const out = fakeSupabaseResponse(req.method, path, query, req.headers.accept);
    res.writeHead(out.status, {'content-type': 'application/json'});
    res.end(JSON.stringify(out.body));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {url, requests, queries, close:() => new Promise(r => { server.close(() => r()); server.closeAllConnections(); })};
}

/** next start 자식 프로세스에 넘길 가짜 환경변수 */
export function fakeAppEnv(fakeUrl) {
  return {
    PICKLE_INGEST_TOKEN: FAKE_TOKEN,
    DASHBOARD_USER_ID: FAKE_USER_ID,
    NEXT_PUBLIC_SUPABASE_URL: fakeUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
  };
}

/** @supabase/ssr 형식의 합성 세션 쿠키 (sb-<host 첫 마디>-auth-token=base64-<base64url JSON>) */
export function sessionCookie(fakeUrl) {
  const ref = new URL(fakeUrl).hostname.split('.')[0];
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token',
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
    user: {id: FAKE_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'friend-a@example.invalid'},
  };
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

const TOKEN_ROUTES = ['/api/ingest', '/api/sync-runs', '/api/reconcile/transactions', '/api/backfill/preview', '/api/backfill/stage'];
const SESSION_ROUTES = [
  ['GET', '/api/dashboard'], ['PATCH', '/api/items'], ['POST', '/api/items'], ['DELETE', '/api/items'],
  ['GET', '/api/sync-runs'], ['GET', '/api/backfill/control'],
];

/** 검사 목록. expect: 기대 상태 코드, maxData: rest/v1 허용 건수(항상 0), authUser: /auth/v1/user 조건 */
export function apiAuthCases(origin, cookie) {
  const json = {'content-type': 'application/json'};
  const wrongSameLength = 'x'.repeat(FAKE_TOKEN.length);
  const cases = [];
  for (const path of TOKEN_ROUTES) {
    cases.push({name: `토큰 없음 POST ${path}`, method: 'POST', path, headers: json, expect: 401});
    cases.push({name: `틀린 토큰 POST ${path}`, method: 'POST', path, headers: {...json, authorization: 'Bearer wrong-token'}, expect: 401});
    cases.push({name: `같은 길이 틀린 토큰 POST ${path}`, method: 'POST', path, headers: {...json, authorization: `Bearer ${wrongSameLength}`}, expect: 401});
  }
  for (const [method, path] of SESSION_ROUTES) {
    cases.push({name: `쿠키 없음 ${method} ${path}`, method, path, headers: method === 'GET' ? {} : {...json, origin}, expect: 401});
  }
  // 출처 경로: Origin 검사가 세션 확인보다 먼저인지(외부 Origin 이면 /auth/v1/user 도 부르지 않음)
  const control = '/api/backfill/control';
  cases.push({name: `쿠키 없음 같은 Origin POST ${control}`, method: 'POST', path: control, headers: {...json, origin}, expect: 401, authUser: 'zero'});
  cases.push({name: `쿠키 없음 Origin 없음 POST ${control}`, method: 'POST', path: control, headers: json, expect: 403, authUser: 'zero'});
  cases.push({name: `합성 세션 외부 Origin POST ${control}`, method: 'POST', path: control, headers: {...json, cookie, origin: 'https://attacker.example.invalid'}, expect: 403, authUser: 'zero'});
  cases.push({name: `합성 세션 같은 Origin POST ${control}`, method: 'POST', path: control, headers: {...json, cookie, origin}, expect: 401, authUser: 'some'});
  return cases;
}

/** 한 검사 결과 판정. got: 응답 코드, seen: 그 요청 동안 가짜 서버가 받은 요청들 → 문제 문자열 목록 */
export function judge(c, got, seen) {
  const errs = [];
  if (got !== c.expect) errs.push(`상태 ${got} (기대 ${c.expect})`);
  const data = seen.filter(r => r.path.startsWith('/rest/v1')).length;
  if (data) errs.push(`데이터 요청 rest/v1 ${data}건 (기대 0)`);
  const authUser = seen.filter(r => r.path === '/auth/v1/user').length;
  if (c.authUser === 'zero' && authUser) errs.push(`/auth/v1/user ${authUser}건 (기대 0)`);
  if (c.authUser === 'some' && !authUser) errs.push('/auth/v1/user 0건 — 앱이 가짜 Supabase 서버를 쓰지 않음');
  return errs;
}

/** 앱이 스스로 아는 출처. next start 를 -H 없이 띄우면 req.nextUrl 은 접속 주소와 상관없이 localhost 를 쓴다. */
export function appOrigin(base) {
  const u = new URL(base);
  return `${u.protocol}//localhost:${u.port}`;
}

/** 모든 검사를 순서대로 실행 → {problems, results}. origin: 같은 출처로 보낼 Origin 값 */
export async function checkApiAuth(base, fake, origin = appOrigin(base)) {
  const problems = [], results = [];
  for (const c of apiAuthCases(origin, sessionCookie(fake.url))) {
    const start = fake.requests.length;
    let got;
    try {
      const res = await fetch(base + c.path, {method: c.method, headers: c.headers, body: c.method === 'GET' ? undefined : '{}', redirect: 'manual'});
      got = res.status;
      await res.arrayBuffer();
    } catch (e) { got = `오류 ${e.message.split('\n')[0]}`; }
    const errs = judge(c, got, fake.requests.slice(start));
    results.push({name: c.name, status: got});
    if (errs.length) { problems.push(`${c.name}: ${errs.join('; ')}`); console.log(`FAIL api ${c.name} ${errs.join('; ')}`); }
    else console.log(`PASS api ${c.name} → ${got}`);
  }
  return {problems, results};
}

// 단독 실행: 가짜 서버 → next start(가짜 env) → 검사
if (import.meta.url === `file://${process.argv[1]}`) {
  const {spawn} = await import('node:child_process');
  const PORT = process.env.PORT || '3101';
  const BASE = `http://127.0.0.1:${PORT}`;
  const fake = await startFakeSupabase();
  const server = spawn('npx', ['next', 'start', '-p', PORT], {stdio: 'ignore', detached: true, env: {...process.env, ...fakeAppEnv(fake.url)}});
  const stop = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch {} };
  process.on('exit', stop);
  let failed = true;
  try {
    const end = Date.now() + 60_000;
    for (;;) {
      try { if ((await fetch(`${BASE}/demo`)).status === 200) break; } catch {}
      if (Date.now() > end) throw new Error('/demo 가 60초 안에 200 을 주지 않았습니다');
      await new Promise(r => setTimeout(r, 1000));
    }
    failed = (await checkApiAuth(BASE, fake)).problems.length > 0;
  } catch (e) { console.error(e.message); }
  finally { stop(); await fake.close(); }
  process.exit(failed ? 1 : 0);
}
