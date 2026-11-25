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

/** 수신(/api/ingest) 검사(api-ingest.mjs)용 run_id: f3 정상, f4 커밋 RPC 가 503, f5 최대 배치·페이지, f6 재전송·실행 키 충돌,
 *  f7 별도 보고(report)가 먼저 기록된 실행, f8 실패 보고(run.status 'failed'·items []) */
export const INGEST_RUN_OK = '00000000-0000-4000-8000-0000000000f3';
export const INGEST_RUN_COMMIT_FAIL = '00000000-0000-4000-8000-0000000000f4';
export const INGEST_RUN_PAGED = '00000000-0000-4000-8000-0000000000f5';
export const INGEST_RUN_REPLAY = '00000000-0000-4000-8000-0000000000f6';
export const INGEST_RUN_REPORT = '00000000-0000-4000-8000-0000000000f7';
export const INGEST_RUN_FAILED = '00000000-0000-4000-8000-0000000000f8';
/** parseIngestV2(v2Body(INGEST_RUN_REPORT), NOW).payloadDigest 를 한 번 계산해 적은 값(이 파일은 lib 를 import 하지 않는다).
 *  tests/api-ingest-report.test.mjs 가 같은지 확인한다. */
export const REPORT_PAYLOAD_DIGEST = 'dbd9504e5ddaad475c923a7f8700cbfbe55c01fd114d2623df3675d2173b8504';
/** 로그 검사(api-log.mjs 경우 d) 전용 run_id: 가짜 서버가 처음부터 ingest_v2 실행 기록을 가진 것으로 돌려준다(멱등 재전송 → 200).
 *  api-ingest 경우들은 이 run_id 를 쓰지 않으므로 f6 등 그쪽 상태와 섞이지 않는다. */
export const LOG_REPLAY_RUN = '00000000-0000-4000-8000-0000000000f9';
/** parseIngestV2(v2Body(LOG_REPLAY_RUN), NOW).payloadDigest 를 한 번 계산해 적은 값. tests/api-log-screen.test.mjs 가 같은지 확인한다. */
export const LOG_REPLAY_PAYLOAD_DIGEST = '0fa48789a9ce9b90152612014c8cfd4d8fad258d42def751efc484b38996fb8c';
/** 이 접두사의 external_id 는 가짜 dashboard_ingest_existing 이 기존 행으로 돌려준다(한 페이지 FAKE_PAGE_ROWS 개). */
export const PAGED_EXTERNAL_PREFIX = 'txn-page-';
export const PAGED_UPDATED_AT = '2026-01-01T00:00:00+00:00';
export const FAKE_PAGE_ROWS = 200;

const fakeUuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** 가짜 dashboard_ingest_existing: PAGED_EXTERNAL_PREFIX 로 시작하는 p_external_ids 마다 updated_at 고정 행, id 순 키셋 페이지 */
export function fakeExistingPage(args) {
  const ids = Array.isArray(args?.p_external_ids) ? args.p_external_ids : [];
  const rows = ids.filter(id => typeof id === 'string' && id.startsWith(PAGED_EXTERNAL_PREFIX))
    .map(id => ({id: fakeUuid(Number(id.slice(PAGED_EXTERNAL_PREFIX.length)) || 0), user_id: FAKE_USER_ID, kind: 'transaction', external_id: id,
      title: '합성가맹점A', currency: 'KRW', status: 'active', metadata: {}, created_at: PAGED_UPDATED_AT, updated_at: PAGED_UPDATED_AT}))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter(r => args?.p_after == null || r.id > args.p_after);
  const page = rows.slice(0, FAKE_PAGE_ROWS);
  return {rows: page, next_after: rows.length > FAKE_PAGE_ROWS ? page[page.length - 1].id : null};
}

/** 가짜 dashboard_ingest_commit: f4 면 503 PostgREST 오류, 아니면 받은 행마다 item 을 돌려준다(p_run null 이면 run null). */
export function fakeCommitResponse(args) {
  const run = args?.p_run ?? null;
  if (run && run.run_id === INGEST_RUN_COMMIT_FAIL) {
    return {status: 503, body: {code: 'PGRST002', message: FAKE_PGRST_MESSAGE, details: FAKE_PGRST_DETAILS, hint: null}};
  }
  const rows = Array.isArray(args?.p_rows) ? args.p_rows : [];
  const items = rows.map((r, i) => ({id: fakeUuid(9000 + i), kind: r.kind, external_id: r.external_id}));
  return {status: 200, body: {ok: true, idempotent: false, items, upserted: items.length,
    run: run ? {run_id: run.run_id, dataset: run.dataset, source_system: run.source_system, status: run.status, accepted_count: items.length} : null}};
}

/** 유효한 합성 세션의 access_token. 가짜 서버는 이 토큰의 GET /auth/v1/user 에만 200 을 준다(api-items 검사). */
export const VALID_ACCESS_TOKEN = 'synthetic-valid-access-token';
export const FAKE_AUTH_USER = {id: FAKE_USER_ID, aud: 'authenticated', role: 'authenticated'};

/** /api/items 검사(api-items.mjs)용 메모리 행 id: c1 정산, c2 할 일, c3 뉴스, c4 할 일(삭제용) */
export const ITEM_SETTLEMENT = '00000000-0000-4000-8000-0000000000c1';
export const ITEM_TASK = '00000000-0000-4000-8000-0000000000c2';
export const ITEM_NEWS = '00000000-0000-4000-8000-0000000000c3';
export const ITEM_TASK_DELETE = '00000000-0000-4000-8000-0000000000c4';
export function fakeItemRows() {
  const row = (id, kind, title, status) => ({id, user_id: FAKE_USER_ID, kind, title, status, metadata: {}});
  return [
    row(ITEM_SETTLEMENT, 'settlement', '친구A 정산', 'pending'),
    row(ITEM_TASK, 'task', '합성할일A', 'pending'),
    row(ITEM_NEWS, 'news', '합성뉴스A', 'active'),
    row(ITEM_TASK_DELETE, 'task', '합성할일B', 'pending'),
  ];
}

/** PostgREST 필터 한 개(eq.·neq.·in.(…))를 파싱 → 값 검사 함수. 모르는 연산자면 null */
export function parseFilter(raw) {
  if (raw.startsWith('eq.')) { const v = raw.slice(3); return x => String(x) === v; }
  if (raw.startsWith('neq.')) { const v = raw.slice(4); return x => String(x) !== v; }
  const m = /^in\.\((.*)\)$/.exec(raw);
  if (m) { const vs = m[1].split(','); return x => vs.includes(String(x)); }
  return null;
}

/** 가짜 PATCH /rest/v1/dashboard_items: 쿼리 조건(select 제외)을 모두 만족하는 행만 본문 값으로 바꾼다(items 를 직접 바꿈).
 *  Accept 에 vnd.pgrst.object 가 있으면 정확히 1행일 때만 바꾸고 200 행 객체, 아니면 406 PGRST116. 배열 Accept 면 배열. */
export function fakePatchItems(items, query, accept, body) {
  const tests = [];
  for (const [k, v] of new URLSearchParams(query)) {
    if (k === 'select') continue;
    const f = parseFilter(v);
    if (!f) return {status: 400, body: {code: 'PGRST100', message: 'fake', details: null, hint: null}};
    tests.push(r => f(r[k]));
  }
  const hit = items.filter(r => tests.every(t => t(r)));
  const object = (accept || '').includes('vnd.pgrst.object');
  if (object && hit.length !== 1) return {status: 406, body: {code: 'PGRST116', message: 'fake', details: null, hint: null}};
  const patch = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  for (const r of hit) Object.assign(r, patch);
  const out = hit.map(r => ({...r}));
  return {status: 200, body: object ? out[0] : out};
}

/** 가짜 commit 이 f6 실행을 커밋하면 runs(Map, 키 run_id)에 남길 실행 기록. 이미 있으면 덮어쓰지 않는다. */
export function rememberReplayRun(runs, args, out) {
  const run = args?.p_run;
  if (!(runs instanceof Map) || !run || run.run_id !== INGEST_RUN_REPLAY || out.status !== 200 || runs.has(run.run_id)) return;
  runs.set(run.run_id, {
    user_id: args.p_user, run_id: run.run_id, dataset: run.dataset, source_system: run.source_system,
    status: run.status, error_code: run.error_code ?? null, expected_count: run.item_count, payload_digest: run.payload_digest,
    commit_source: 'ingest_v2', accepted_count: out.body.items.length,
    source_as_of: run.source_as_of ?? null, collected_at: run.collected_at ?? null,
  });
}

/** 가짜 GET dashboard_sync_runs(f6): select 를 뺀 모든 필터가 기록과 맞아야 반환. user_id·dataset·source_system 필터가 빠지면 []. */
export function fakeReplayRunLookup(runs, query, accept) {
  if (!(runs instanceof Map)) return {status: 200, body: []};
  return lookupRunRow(runs.get(INGEST_RUN_REPLAY), query, accept);
}

/** 실행 기록 조회 공통 규칙: user_id·dataset·source_system 필터가 빠지거나, row 가 없거나, select 를 뺀 필터가 하나라도
 *  기록과 맞지 않으면(모르는 연산자 포함) []. 모두 맞으면 object Accept 면 객체, 아니면 [객체]. */
function lookupRunRow(row, query, accept) {
  const params = new URLSearchParams(query);
  const empty = {status: 200, body: []};
  if (!['user_id', 'dataset', 'source_system'].every(k => params.has(k))) return empty;
  if (!row) return empty;
  for (const [k, v] of params) {
    if (k === 'select') continue;
    const f = parseFilter(v);
    if (!f || !f(row[k])) return empty;
  }
  return {status: 200, body: (accept || '').includes('vnd.pgrst.object') ? {...row} : [{...row}]};
}

/** 별도 보고(commit_source 'report')가 먼저 기록한 f7 실행. v2Body(INGEST_RUN_REPORT) 와 commit_source 만 다르다
 *  (키·status·error_code·expected_count·payload_digest 가 그 본문과 같으므로 앱 판정은 commit_source 때문에만 409). */
export function fakeReportRun() {
  return {
    user_id: FAKE_USER_ID, run_id: INGEST_RUN_REPORT, dataset: 'transactions', source_system: 'samsungcard',
    status: 'success', error_code: null, expected_count: 1, payload_digest: REPORT_PAYLOAD_DIGEST,
    commit_source: 'report', accepted_count: 1,
    source_as_of: '2026-01-01T09:00:00+09:00', collected_at: '2026-01-01T09:10:00+09:00',
  };
}

/** 가짜 GET dashboard_sync_runs(f7): fakeReplayRunLookup 과 같은 규칙으로 fakeReportRun() 을 조회한다(ctx 불필요, 순수). */
export function fakeReportRunLookup(query, accept) {
  return lookupRunRow(fakeReportRun(), query, accept);
}

/** 로그 검사용 f9 실행 기록(commit_source 'ingest_v2'). v2Body(LOG_REPLAY_RUN) 와 키·status·error_code·expected_count·payload_digest 가
 *  같으므로 앱은 그 본문을 멱등 재전송(200 idempotent)으로 판정한다. */
export function fakeLogReplayRun() {
  return {
    user_id: FAKE_USER_ID, run_id: LOG_REPLAY_RUN, dataset: 'transactions', source_system: 'samsungcard',
    status: 'success', error_code: null, expected_count: 1, payload_digest: LOG_REPLAY_PAYLOAD_DIGEST,
    commit_source: 'ingest_v2', accepted_count: 1,
    source_as_of: '2026-01-01T09:00:00+09:00', collected_at: '2026-01-01T09:10:00+09:00',
  };
}

/** 가짜 서버 응답 결정 → {status, body}. body: 요청 본문(JSON 이면 객체).
 *  ctx: {authorization: Authorization 헤더, items: 메모리 행(fakePatchItems 가 바꿈), runs: f6 실행 기록 Map(선택)}.
 *  ctx 없으면 순수 함수(f6 기록을 저장하지 않고 조회는 항상 []).
 *  f7 조회는 ctx 와 상관없이 commit_source 'report' 기록(fakeReportRunLookup). commit 은 f7 을 기억하지 않는다. */
export function fakeSupabaseResponse(method, path, query, accept, body, ctx = {}) {
  const validSession = ctx.authorization === `Bearer ${VALID_ACCESS_TOKEN}`;
  if (method === 'GET' && path === '/auth/v1/user' && validSession) return {status: 200, body: FAKE_AUTH_USER};
  if (method === 'PATCH' && path === '/rest/v1/dashboard_items' && validSession && Array.isArray(ctx.items)) {
    return fakePatchItems(ctx.items, query, accept, body);
  }
  if (method === 'GET' && path === '/rest/v1/dashboard_sync_runs' && new URLSearchParams(query).getAll('run_id').includes(`eq.${INGEST_RUN_REPLAY}`)) {
    return fakeReplayRunLookup(ctx.runs, query, accept);
  }
  if (method === 'GET' && path === '/rest/v1/dashboard_sync_runs' && new URLSearchParams(query).getAll('run_id').includes(`eq.${INGEST_RUN_REPORT}`)) {
    return fakeReportRunLookup(query, accept);
  }
  if (method === 'GET' && path === '/rest/v1/dashboard_sync_runs' && new URLSearchParams(query).getAll('run_id').includes(`eq.${LOG_REPLAY_RUN}`)) {
    return lookupRunRow(fakeLogReplayRun(), query, accept);
  }
  if (method === 'GET' && path === '/rest/v1/dashboard_sync_runs'
    && new URLSearchParams(query).getAll('run_id').some(v => [INGEST_RUN_OK, INGEST_RUN_COMMIT_FAIL, INGEST_RUN_PAGED, INGEST_RUN_FAILED].some(id => v === `eq.${id}`))) {
    return {status: 200, body: []};
  }
  if (method === 'POST' && path === '/rest/v1/rpc/dashboard_ingest_existing') return {status: 200, body: fakeExistingPage(body)};
  if (method === 'POST' && path === '/rest/v1/rpc/dashboard_ingest_candidates') return {status: 200, body: {rows: [], next_after: null}};
  if (method === 'POST' && path === '/rest/v1/rpc/dashboard_ingest_commit') {
    const out = fakeCommitResponse(body);
    rememberReplayRun(ctx.runs, body, out);
    return out;
  }
  if (path.startsWith('/rest/v1/')) {
    return {status: 401, body: {code: 'PGRST301', message: FAKE_PGRST_MESSAGE, details: FAKE_PGRST_DETAILS, hint: null}};
  }
  return {status: 401, body: {code: 401, error_code: 'bad_jwt', msg: 'synthetic server rejects everything'}};
}

/** 받은 요청을 기록하고, 데이터 요청(rest/v1)은 PostgREST 모양 401, 그 밖은 401 로 거부하는 가짜 Supabase 서버.
 *  예외: 로그 검사용 기존 실행(LOG_REPLAY_RUN) 조회는 200, 수신 검사용 경로(fakeSupabaseResponse 참고)는 200·503.
 *  requests 는 judge 용으로 경로만, queries 는 쿼리 문자열까지, calls 는 요청 본문(JSON)과 응답 상태까지 기록한다. */
export async function startFakeSupabase() {
  const requests = [], queries = [], calls = [], items = fakeItemRows(), runs = new Map();
  const server = createServer((req, res) => {
    const url = req.url || '';
    const q = url.indexOf('?');
    const path = q < 0 ? url : url.slice(0, q), query = q < 0 ? '' : url.slice(q + 1);
    requests.push({method: req.method, path});
    queries.push({method: req.method, path, query});
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let body;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; } catch { body = undefined; }
      const out = fakeSupabaseResponse(req.method, path, query, req.headers.accept, body, {authorization: req.headers.authorization, items, runs});
      calls.push({method: req.method, path, query, body, status: out.status});
      res.writeHead(out.status, {'content-type': 'application/json'});
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {url, requests, queries, calls, items, runs, resetItems: () => { items.splice(0, items.length, ...fakeItemRows()); }, close:() => new Promise(r => { server.close(() => r()); server.closeAllConnections(); })};
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
export function sessionCookie(fakeUrl, accessToken = 'synthetic-access-token') {
  const ref = new URL(fakeUrl).hostname.split('.')[0];
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: accessToken, refresh_token: 'synthetic-refresh-token',
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
    user: {id: FAKE_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'friend-a@example.invalid'},
  };
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

/** 가짜 서버가 받아 주는 '유효한 합성 세션' 쿠키(access_token VALID_ACCESS_TOKEN) */
export function validSessionCookie(fakeUrl) {
  return sessionCookie(fakeUrl, VALID_ACCESS_TOKEN);
}

const TOKEN_ROUTES = ['/api/ingest'];
/** 12단계에서 지운 실행 보고 API. 토큰·쿠키가 있어도 404 또는 405, 가짜 서버 호출(데이터·인증) 0건 */
export const REMOVED_SYNC_RUNS = '/api/sync-runs';
const SESSION_ROUTES = [
  ['GET', '/api/dashboard'], ['PATCH', '/api/items'], ['POST', '/api/items'], ['DELETE', '/api/items'],
];
/** 6단계 ⑤에서 지운 일회성 API. 올바른 인증을 보내도 404, 세션 확인·데이터 요청 없음 */
export const REMOVED_TOKEN_ROUTES = ['/api/reconcile/transactions', '/api/backfill/preview', '/api/backfill/stage'];
export const REMOVED_SESSION_ROUTES = [['GET', '/api/backfill/control'], ['POST', '/api/backfill/control']];

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
  // 없어진 경로: 일회성 API 4개는 6단계 ⑤에서 삭제 → 올바른 토큰·합성 세션이 있어도 404
  for (const path of REMOVED_TOKEN_ROUTES) {
    cases.push({name: `없어진 경로 올바른 토큰 POST ${path}`, method: 'POST', path, headers: {...json, authorization: `Bearer ${FAKE_TOKEN}`}, expect: 404, authUser: 'zero'});
  }
  for (const [method, path] of REMOVED_SESSION_ROUTES) {
    cases.push({name: `없어진 경로 합성 세션 ${method} ${path}`, method, path, headers: method === 'GET' ? {cookie} : {...json, cookie, origin}, expect: 404, authUser: 'zero'});
  }
  // 없어진 경로: /api/sync-runs 는 12단계에서 삭제(GET 은 6단계 ④) → 토큰·쿠키가 있어도 404 또는 405, 가짜 서버 호출 0건
  const removed = REMOVED_SYNC_RUNS;
  const token = {authorization: `Bearer ${FAKE_TOKEN}`};
  const gone = {expect: [404, 405], authUser: 'zero', noFakeCalls: true};
  cases.push({name: `없어진 경로 쿠키 없음 GET ${removed}`, method: 'GET', path: removed, headers: {}, ...gone});
  cases.push({name: `없어진 경로 합성 세션 GET ${removed}`, method: 'GET', path: removed, headers: {cookie}, ...gone});
  cases.push({name: `없어진 경로 올바른 토큰 GET ${removed}`, method: 'GET', path: removed, headers: token, ...gone});
  cases.push({name: `없어진 경로 올바른 토큰 POST ${removed}`, method: 'POST', path: removed, headers: {...json, ...token}, ...gone});
  cases.push({name: `없어진 경로 토큰·합성 세션 POST ${removed}`, method: 'POST', path: removed, headers: {...json, ...token, cookie, origin}, ...gone});
  return cases;
}

/** 한 검사 결과 판정. got: 응답 코드, seen: 그 요청 동안 가짜 서버가 받은 요청들 → 문제 문자열 목록 */
export function judge(c, got, seen) {
  const errs = [];
  const expect = Array.isArray(c.expect) ? c.expect : [c.expect];
  if (!expect.includes(got)) errs.push(`상태 ${got} (기대 ${expect.join(' 또는 ')})`);
  if (c.noFakeCalls && seen.length) errs.push(`가짜 Supabase 호출 ${seen.length}건 (기대 0)`);
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
      try { if ((await fetch(`${BASE}/login`)).status === 200) break; } catch {}
      if (Date.now() > end) throw new Error('/login 이 60초 안에 200 을 주지 않았습니다');
      await new Promise(r => setTimeout(r, 1000));
    }
    failed = (await checkApiAuth(BASE, fake)).problems.length > 0;
  } catch (e) { console.error(e.message); }
  finally { stop(); await fake.close(); }
  process.exit(failed ? 1 : 0);
}
