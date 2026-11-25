// 빌드된 앱(next start)의 서버 로그 검사. run.mjs 가 next start 의 stdout·stderr 를 줄 단위로 logs 배열에 모으고,
// checkApiAuth 뒤에 checkApiLogs 를 부른다. 수집기 API 실패가 값 없이 한 줄(JSON)로 남는지, 정상·검증 실패 응답에는
// 실패 로그가 남지 않는지, 응답 본문·상태·Cache-Control 이 그대로인지 확인한다. 값은 모두 가짜다.
// b~d 는 /api/ingest 에 숫자 version:2 본문을 보낸다: b 커밋 RPC 503(run f4, api-ingest 경우 c 와 같은 본문 모양),
// c manifest 가 틀린 본문(422), d 가짜 서버가 처음부터 ingest_v2 기록을 가진 run f9 의 멱등 재전송(200 idempotent).
// d 는 api-ingest 경우 f·g 가 쓰는 f6 상태를 만들지 않는다(run.mjs 에서 checkApiLogs 가 checkApiIngest 보다 먼저 돈다).
import {FAKE_PGRST_DETAILS, FAKE_PGRST_MESSAGE, FAKE_TOKEN, INGEST_RUN_COMMIT_FAIL, INGEST_RUN_OK, LOG_REPLAY_RUN} from './api-auth.mjs';
import {v2Body} from './api-ingest.mjs';

export const QUIET_MS = 1500;
export const QUIET_MAX_MS = 15_000;
export const WINDOW_MS = 3000;
export const FORBIDDEN = [FAKE_PGRST_MESSAGE, FAKE_PGRST_DETAILS, FAKE_TOKEN];
export const FAILURE_EVENTS = ['api_failure', 'collector_auth_failed'];

/** manifest.item_count 가 항목 수와 다른 v2 본문(형식은 맞고 규칙 검사에서 422 ITEM_COUNT_MISMATCH, DB 호출 전) */
export function badManifestBody(runId = INGEST_RUN_OK) {
  const body = v2Body(runId);
  body.manifest = {...body.manifest, item_count: body.items.length + 1};
  return body;
}

/** 검사 목록. expect.events: event 별 정확한 개수, expect.match: 그 event 줄(1개)이 가져야 할 필드 */
export function apiLogCases() {
  const json = {'content-type': 'application/json'};
  const auth = {...json, authorization: `Bearer ${FAKE_TOKEN}`};
  return [
    {id: 'a', name: 'POST /api/ingest 토큰 없음', path: '/api/ingest', headers: json, body: '{}',
      expect: {status: 401, body: {error: 'Unauthorized'}, events: {collector_auth_failed: 1, api_failure: 0},
        match: {event: 'collector_auth_failed', route: '/api/ingest', reason: 'no_bearer'}}},
    {id: 'b', name: `POST /api/ingest v2 run ${INGEST_RUN_COMMIT_FAIL.slice(-2)} 커밋 RPC 503`, path: '/api/ingest', headers: auth,
      body: JSON.stringify(v2Body(INGEST_RUN_COMMIT_FAIL)),
      expect: {status: 503, body: {error: 'Ingest unavailable'}, cacheControl: 'no-store',
        events: {api_failure: 1, collector_auth_failed: 0},
        match: {event: 'api_failure', route: '/api/ingest', stage: 'write', code: 'PGRST002'}}},
    {id: 'c', name: 'POST /api/ingest v2 manifest 오류', path: '/api/ingest', headers: auth, body: JSON.stringify(badManifestBody()),
      expect: {status: 422, cacheControl: 'no-store', events: {api_failure: 0, collector_auth_failed: 0}}},
    {id: 'd', name: `POST /api/ingest v2 run ${LOG_REPLAY_RUN.slice(-2)} 멱등 재전송`, path: '/api/ingest', headers: auth,
      body: JSON.stringify(v2Body(LOG_REPLAY_RUN)),
      expect: {status: 200, cacheControl: 'no-store', events: {api_failure: 0, collector_auth_failed: 0},
        bodyFields: {version: 2, idempotent: true, upserted: 0, run_id: LOG_REPLAY_RUN},
        fakeQuery: `run_id=eq.${LOG_REPLAY_RUN}`}},
  ];
}

/** 로그 줄 중 JSON 객체로 읽히고 event 문자열이 있는 것만 */
export function eventLines(lines) {
  const out = [];
  for (const line of lines) {
    try {
      const v = JSON.parse(String(line).trim());
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.event === 'string') out.push(v);
    } catch {}
  }
  return out;
}

export function countEvents(lines) {
  const counts = {};
  for (const v of eventLines(lines)) counts[v.event] = (counts[v.event] || 0) + 1;
  return counts;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 한 경우 판정(순수 함수). observed: {status, bodyText, cacheControl, lines, queries} → 문제 문자열 목록 */
export function judgeLogCase(c, observed) {
  const e = c.expect, errs = [];
  if (observed.status !== e.status) errs.push(`상태 ${observed.status} (기대 ${e.status})`);
  let body;
  try { body = JSON.parse(observed.bodyText); } catch { body = undefined; }
  if (e.body && !sameJson(body, e.body)) errs.push('응답 본문이 기대와 다름');
  if (e.bodyFields) {
    const f = e.bodyFields;
    if (!body || body.version !== f.version || body.idempotent !== f.idempotent || body.upserted !== f.upserted
      || !Array.isArray(body.items) || body.items.length !== 0 || body.run?.run_id !== f.run_id) errs.push('응답 본문 version·idempotent·upserted·items·run.run_id 불일치');
  }
  if (e.cacheControl !== undefined && observed.cacheControl !== e.cacheControl) errs.push(`Cache-Control ${observed.cacheControl} (기대 ${e.cacheControl})`);
  const lines = observed.lines || [];
  const counts = countEvents(lines);
  for (const [event, n] of Object.entries(e.events || {})) {
    if ((counts[event] || 0) !== n) errs.push(`${event} 로그 ${counts[event] || 0}줄 (기대 ${n})`);
  }
  if (e.match) {
    const hits = eventLines(lines).filter(v => v.event === e.match.event);
    if (hits.length === 1) {
      for (const [k, want] of Object.entries(e.match)) if (hits[0][k] !== want) errs.push(`${e.match.event}.${k} 가 기대와 다름 (기대 ${want})`);
    }
  }
  // 금지 문자열은 값 자체를 출력하지 않고 몇 번째 항목인지만 알린다.
  FORBIDDEN.forEach((s, i) => { if (lines.some(line => String(line).includes(s))) errs.push(`금지 문자열 #${i + 1} 이 로그에 있음`); });
  if (e.fakeQuery) {
    const n = (observed.queries || []).filter(q => q.method === 'GET' && q.path === '/rest/v1/dashboard_sync_runs' && q.query.includes(e.fakeQuery)).length;
    if (n < 1) errs.push('가짜 서버에 기존 실행 조회가 없음');
  }
  return errs;
}

/** logs 에 quietMs 동안 새 줄이 없을 때까지 기다린다. maxMs 를 넘으면 false */
export async function waitQuiet(logs, quietMs = QUIET_MS, maxMs = QUIET_MAX_MS) {
  const start = Date.now();
  let len = logs.length, changed = Date.now();
  for (;;) {
    if (logs.length !== len) { len = logs.length; changed = Date.now(); }
    if (Date.now() - changed >= quietMs) return true;
    if (Date.now() - start > maxMs) return false;
    await new Promise(r => setTimeout(r, 100));
  }
}

/** 네 경우를 차례로 실행 → {problems, results} */
export async function checkApiLogs(base, fake, logs) {
  const problems = [], results = [];
  if (!await waitQuiet(logs)) {
    problems.push('시작 전 서버 출력이 잠잠해지지 않음');
    console.log('FAIL api log 시작 전 서버 출력이 15초 안에 잠잠해지지 않음');
    return {problems, results};
  }
  for (const c of apiLogCases()) {
    let errs;
    if (!await waitQuiet(logs)) errs = ['요청 전 서버 출력이 15초 안에 잠잠해지지 않음'];
    else {
      const startLog = logs.length, startQuery = fake.queries.length;
      const observed = {status: undefined, bodyText: '', cacheControl: null};
      try {
        const res = await fetch(base + c.path, {method: 'POST', headers: c.headers, body: c.body, redirect: 'manual'});
        observed.status = res.status;
        observed.cacheControl = res.headers.get('cache-control');
        observed.bodyText = await res.text();
      } catch (e) { observed.status = `오류 ${e.message.split('\n')[0]}`; }
      await new Promise(r => setTimeout(r, WINDOW_MS));
      observed.lines = logs.slice(startLog);
      observed.queries = fake.queries.slice(startQuery);
      errs = judgeLogCase(c, observed);
    }
    results.push({id: c.id, errs});
    if (errs.length) { problems.push(`(${c.id}) ${errs.join('; ')}`); console.log(`FAIL api log (${c.id}) ${c.name}: ${errs.join('; ')}`); }
    else console.log(`PASS api log (${c.id}) ${c.name} → ${c.expect.status}`);
  }
  return {problems, results};
}

// 단독 실행(빌드 필요, chromium 불필요): 가짜 서버 → next start(가짜 env, 출력 수집) → checkApiAuth → checkApiLogs
if (import.meta.url === `file://${process.argv[1]}`) {
  const {spawn} = await import('node:child_process');
  const {createInterface} = await import('node:readline');
  const {checkApiAuth, fakeAppEnv, startFakeSupabase} = await import('./api-auth.mjs');
  const PORT = process.env.PORT || '3102';
  const BASE = `http://127.0.0.1:${PORT}`;
  const fake = await startFakeSupabase();
  const server = spawn('npx', ['next', 'start', '-p', PORT], {stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: {...process.env, ...fakeAppEnv(fake.url)}});
  const logs = [];
  for (const stream of [server.stdout, server.stderr]) createInterface({input: stream, crlfDelay: Infinity}).on('line', line => logs.push(line));
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
    const auth = await checkApiAuth(BASE, fake);
    const log = await checkApiLogs(BASE, fake, logs);
    failed = auth.problems.length > 0 || log.problems.length > 0;
  } catch (e) { console.error(e.message); }
  finally { stop(); await fake.close(); }
  process.exit(failed ? 1 : 0);
}
