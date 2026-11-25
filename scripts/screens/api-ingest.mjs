// 빌드된 앱(next start)의 수신(/api/ingest) 검사. run.mjs 가 checkApiLogs 뒤에 checkApiIngest 를 부른다.
// 가짜 Supabase 서버(api-auth.mjs)의 RPC·실행 조회 경로를 써서 v2 응답과 DB 함수 호출 본문을 확인한다.
// (12단계에서 v1 수신을 지웠다: 옛 경우 a(v1 → 200)는 없다.) ⓑ v2 → 200 ⓒ v2 커밋 RPC 503 → 503 Ingest unavailable ⓓ 토큰 없는 v2 → 401 ⓔ 500건·키셋 페이지 3회
// ⓕ v2 run f6 최초 → 200 ⓖ f6 동일 재전송 → 200 idempotent ⓗ f6 같은 run_id 다른 본문 → 409 RUN_ID_CONFLICT
// ⓘ v2 run f7 별도 보고(commit_source 'report')가 먼저 기록 → 409 RUN_ID_CONFLICT
// ⓙ v2 run f8 실패 보고(run.status 'failed'·items []) → 200 upserted 0.
// ⓚ v2 모양·version "2"(문자열) → 410 {error:'v1 ingest removed', hint:'send version 2'}·Cache-Control no-store·Supabase 데이터 호출 0건.
// ⓛ version 없는 옛 v1 본문({items}) → ⓚ 와 같은 기대. ⓜ 인증된 깨진 JSON(끝이 잘린 문자열 원본) → 400 {error:'Invalid JSON'}·데이터 호출 0건.
// 값은 모두 가짜다. 이 파일은 lib/*.ts 를 import 하지 않는다(node 로 바로 실행). 본문이 v2 규칙을 통과하는지는
// tests/api-ingest-screen.test.mjs 가 parseIngestV2 로 확인한다.
import {readFileSync} from 'node:fs';
import {
  FAKE_TOKEN, FAKE_USER_ID, INGEST_RUN_OK, INGEST_RUN_COMMIT_FAIL, INGEST_RUN_PAGED, INGEST_RUN_REPLAY, INGEST_RUN_REPORT, INGEST_RUN_FAILED,
  PAGED_EXTERNAL_PREFIX, PAGED_UPDATED_AT, FAKE_PAGE_ROWS,
} from './api-auth.mjs';

export const PAGED_ITEMS = 500;
const EXISTING_RPC = '/rest/v1/rpc/dashboard_ingest_existing';
const COMMIT_RPC = '/rest/v1/rpc/dashboard_ingest_commit';
const CANDIDATES_RPC = '/rest/v1/rpc/dashboard_ingest_candidates';
const RUNS_PATH = '/rest/v1/dashboard_sync_runs';

/** docs/INGEST_V2.md 의 success 예시 */
export function successExample() {
  const doc = readFileSync(new URL('../../docs/INGEST_V2.md', import.meta.url), 'utf8');
  const m = /<!-- example:success -->\s*```json\n([\s\S]*?)\n```/.exec(doc);
  if (!m) throw new Error('docs/INGEST_V2.md success 예시 없음');
  return JSON.parse(m[1]);
}

/** docs/INGEST_V2.md 의 conflict-response 예시(같은 run_id 다른 본문 → 409) */
export function conflictExample() {
  const doc = readFileSync(new URL('../../docs/INGEST_V2.md', import.meta.url), 'utf8');
  const m = /<!-- example:conflict-response -->\s*```json\n([\s\S]*?)\n```/.exec(doc);
  if (!m) throw new Error('docs/INGEST_V2.md conflict-response 예시 없음');
  return JSON.parse(m[1]);
}

/** docs/INGEST_V2.md 의 failed 예시(실패 보고, 항목 없음) */
export function failedExample() {
  const doc = readFileSync(new URL('../../docs/INGEST_V2.md', import.meta.url), 'utf8');
  const m = /<!-- example:failed -->\s*```json\n([\s\S]*?)\n```/.exec(doc);
  if (!m) throw new Error('docs/INGEST_V2.md failed 예시 없음');
  return JSON.parse(m[1]);
}

/** failed 예시에서 run.run_id 만 runId 로 바꾼 본문(items []·manifest {item_count:0, amount_total:null} 은 예시 그대로) */
export function failedBody(runId = INGEST_RUN_FAILED) {
  const body = failedExample();
  body.run.run_id = runId;
  return body;
}

const amountTotal = items => Math.round(items.reduce((s, x) => typeof x.amount === 'number' ? s + x.amount : s, 0) * 100) / 100;

/** success 예시를 items 로 바꾸고 run_id 를 run 과 각 항목 metadata 에 넣은 뒤 manifest 를 다시 계산한다. */
function withItems(runId, items) {
  const body = successExample();
  body.run.run_id = runId;
  body.items = items.map(x => ({...x, metadata: {...x.metadata, run_id: runId}}));
  body.manifest = {item_count: body.items.length, amount_total: amountTotal(body.items)};
  return body;
}

/** success 예시를 1항목으로 줄인 v2 본문 */
export function v2Body(runId) {
  return withItems(runId, [successExample().items[0]]);
}

export function stringVersionBody(runId = INGEST_RUN_OK) {
  return {...v2Body(runId), version: '2'};
}

/** v2Body(runId) 와 같은 1항목이되 title 만 '합성가맹점B' 로 바꾼 본문(manifest 다시 계산 → payload_digest 가 다름) */
export function v2ConflictBody(runId = INGEST_RUN_REPLAY) {
  return withItems(runId, [{...successExample().items[0], title: '합성가맹점B'}]);
}

/** version 키가 없는 옛 v1 모양 본문({items}). 12단계부터 410 으로 거부된다. */
export function noVersionBody(runId = INGEST_RUN_OK) {
  return {items: v2Body(runId).items};
}

/** 끝이 잘린 JSON 문자열(JSON.parse 실패). 경우 m 은 이 문자열을 그대로 보낸다. */
export function truncatedJsonBody(runId = INGEST_RUN_OK) {
  const text = JSON.stringify(v2Body(runId));
  return text.slice(0, Math.floor(text.length / 2));
}

/** 410 거부 본문(lib/ingest-service.ts handleIngest) */
export const V1_REMOVED_BODY = {error: 'v1 ingest removed', hint: 'send version 2'};

/** 최대 배치: external_id·source_record_id 를 번호로 다르게 만든 가짜 거래 500건 */
export function pagedBody(runId = INGEST_RUN_PAGED, n = PAGED_ITEMS) {
  const base = successExample().items[0];
  const items = Array.from({length: n}, (_, i) => {
    const no = String(i + 1).padStart(4, '0');
    return {...base, external_id: `${PAGED_EXTERNAL_PREFIX}${no}`, amount: 1000 + i, metadata: {...base.metadata, source_record_id: `apv-page-${no}`}};
  });
  return withItems(runId, items);
}

/** 검사 목록 */
export function apiIngestCases() {
  const json = {'content-type': 'application/json'};
  const auth = {...json, authorization: `Bearer ${FAKE_TOKEN}`};
  return [
    {id: 'b', name: `v2 run ${INGEST_RUN_OK.slice(-2)} → 200`, headers: auth, body: v2Body(INGEST_RUN_OK)},
    {id: 'c', name: `v2 run ${INGEST_RUN_COMMIT_FAIL.slice(-2)} 커밋 RPC 503 → 503`, headers: auth, body: v2Body(INGEST_RUN_COMMIT_FAIL)},
    {id: 'd', name: '토큰 없는 v2 → 401', headers: json, body: v2Body(INGEST_RUN_OK)},
    {id: 'e', name: `v2 ${PAGED_ITEMS}건·existing 페이지 → 200`, headers: auth, body: pagedBody()},
    // f·g·h 는 순서가 판정에 필요하다: f 가 f6 실행을 커밋해야(가짜 서버가 기록을 기억) g 가 재전송, h 가 충돌로 판정된다.
    // checkApiIngest 는 이 목록을 차례로 실행한다.
    {id: 'f', name: 'v2 run f6 최초 → 200', headers: auth, body: v2Body(INGEST_RUN_REPLAY)},
    {id: 'g', name: 'v2 run f6 동일 재전송 → 200 idempotent', headers: auth, body: v2Body(INGEST_RUN_REPLAY)},
    {id: 'h', name: 'v2 run f6 다른 본문 → 409 RUN_ID_CONFLICT', headers: auth, body: v2ConflictBody()},
    // i 는 가짜 서버가 commit_source 'report' 로 이미 가진 f7 기록과 키·digest 가 같은 본문(source_system 은 바꾸지 않는다)
    {id: 'i', name: 'v2 run f7 별도 보고가 먼저 기록 → 409 RUN_ID_CONFLICT', headers: auth, body: v2Body(INGEST_RUN_REPORT)},
    // j 는 문서 failed 예시(items []) 그대로, run_id 만 f8
    {id: 'j', name: 'v2 run f8 실패 보고 → 200 upserted 0', headers: auth, body: failedBody()},
    {id: 'k', name: 'v2 모양·version "2"(문자열) → 410 v1 ingest removed', headers: auth, body: stringVersionBody()},
    {id: 'l', name: 'version 없는 옛 v1 본문 → 410 v1 ingest removed', headers: auth, body: noVersionBody()},
    // m 은 body 대신 rawBody(문자열 원본)를 그대로 보낸다(checkApiIngest 송신부)
    {id: 'm', name: '인증된 깨진 JSON → 400 Invalid JSON', headers: auth, rawBody: truncatedJsonBody()},
  ];
}

const parse = text => { try { return JSON.parse(text); } catch { return undefined; } };
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 한 경우 판정(순수 함수). observed: {status, bodyText, cacheControl, calls(그 요청 동안 가짜 서버 기록)} → 문제 문자열 목록 */
export function judgeIngestCase(c, observed) {
  const errs = [];
  const body = parse(observed.bodyText);
  const calls = observed.calls || [];
  const commits = calls.filter(x => x.method === 'POST' && x.path === COMMIT_RPC);
  const status = want => { if (observed.status !== want) errs.push(`상태 ${observed.status} (기대 ${want})`); };
  const noStore = () => { if (observed.cacheControl !== 'no-store') errs.push(`Cache-Control ${observed.cacheControl} (기대 no-store)`); };
  const oneCommit = () => {
    if (commits.length !== 1) { errs.push(`commit RPC ${commits.length}건 (기대 1)`); return null; }
    return isObj(commits[0].body) ? commits[0].body : (errs.push('commit RPC 본문이 JSON 객체가 아님'), null);
  };
  const runKey = isObj(c.body) && isObj(c.body.run) ? c.body.run : {};
  const isReplayLookup = (x, runId = INGEST_RUN_REPLAY) => {
    if (x.method !== 'GET' || x.path !== RUNS_PATH) return false;
    const p = new URLSearchParams(x.query);
    return p.getAll('user_id').includes(`eq.${FAKE_USER_ID}`) && p.getAll('run_id').includes(`eq.${runId}`)
      && p.getAll('dataset').includes(`eq.${runKey.dataset}`) && p.getAll('source_system').includes(`eq.${runKey.source_system}`);
  };
  // ⓐ 네 필터(user_id·run_id(기본 f6)·dataset·source_system)를 모두 가진 실행 조회가 1건 이상
  const fourFilterLookup = (runId = INGEST_RUN_REPLAY) => {
    if (!calls.some(x => isReplayLookup(x, runId))) errs.push(`실행 조회에 user_id·run_id(${runId.slice(-2)})·dataset·source_system 네 필터가 모두 있는 요청이 없음`);
  };
  // ⓑ 항목 상태 RPC(existing·candidates)가 각각 0건 — 재전송·충돌 판정이 항목 상태 검사보다 먼저(lib/ingest-service.ts '(라)')
  const noItemLookups = () => {
    for (const path of [EXISTING_RPC, CANDIDATES_RPC]) {
      const n = calls.filter(x => x.method === 'POST' && x.path === path).length;
      if (n) errs.push(`${path.split('/').pop()} RPC ${n}건 (기대 0)`);
    }
  };
  const noCommit = () => { if (commits.length) errs.push(`commit RPC ${commits.length}건 (기대 0)`); };
  const expectedRun = {run_id: INGEST_RUN_REPLAY, dataset: runKey.dataset, source_system: runKey.source_system, status: 'success', accepted_count: 1};
  const noData = () => {
    const data = calls.filter(x => x.path.startsWith('/rest/v1')).length;
    if (data) errs.push(`데이터 요청 rest/v1 ${data}건 (기대 0)`);
  };
  switch (c.id) {
  case 'b': {
    status(200); noStore();
    if (!isObj(body) || body.version !== 2 || body.idempotent !== false) errs.push('v2 응답 본문 version 2·idempotent false 가 아님');
    const runLookups = calls.filter(x => x.method === 'GET' && x.path === RUNS_PATH);
    const q = runLookups.map(x => new URLSearchParams(x.query));
    if (!q.some(p => p.getAll('user_id').includes(`eq.${FAKE_USER_ID}`) && p.getAll('run_id').includes(`eq.${INGEST_RUN_OK}`))) errs.push('실행 조회에 user_id=eq.FAKE_USER_ID·run_id 가 없음');
    const args = oneCommit();
    if (args) {
      if (!isObj(args.p_run) || !/^[0-9a-f]{64}$/.test(String(args.p_run.payload_digest))) errs.push('commit p_run.payload_digest 가 64자 hex 가 아님');
      if (!isObj(args.p_run) || args.p_run.item_count !== 1) errs.push('commit p_run.item_count 가 1 이 아님');
    }
    break;
  }
  case 'c': {
    status(503); noStore();
    if (JSON.stringify(body) !== JSON.stringify({error: 'Ingest unavailable'})) errs.push('응답 본문이 {error:"Ingest unavailable"} 가 아님');
    const mine = commits.filter(x => isObj(x.body) && isObj(x.body.p_run) && x.body.p_run.run_id === INGEST_RUN_COMMIT_FAIL);
    if (mine.length !== 1) errs.push(`${INGEST_RUN_COMMIT_FAIL.slice(-2)} commit RPC ${mine.length}건 (기대 1, 앞 단계 실패가 아님을 확인)`);
    else if (mine[0].status !== 503) errs.push(`commit RPC 응답 ${mine[0].status} (기대 503)`);
    break;
  }
  case 'd': {
    status(401);
    if (observed.cacheControl !== null && observed.cacheControl !== undefined) errs.push(`Cache-Control ${observed.cacheControl} (기대 없음)`);
    noData();
    break;
  }
  case 'k':
  case 'l': {
    // v1 수신 제거(12단계): 숫자 2 가 아닌 version·version 없음 → 410, DB 를 부르지 않는다
    status(410); noStore();
    if (JSON.stringify(body) !== JSON.stringify(V1_REMOVED_BODY)) errs.push(`응답 본문이 ${JSON.stringify(V1_REMOVED_BODY)} 가 아님`);
    noData();
    break;
  }
  case 'm': {
    // route 의 JSON 파싱 실패: 지금 route 그대로라 Cache-Control 은 요구하지 않는다
    status(400);
    if (JSON.stringify(body) !== JSON.stringify({error: 'Invalid JSON'})) errs.push('응답 본문이 정확히 {error:"Invalid JSON"} 가 아님');
    noData();
    break;
  }
  case 'e': {
    status(200); noStore();
    const pages = calls.filter(x => x.method === 'POST' && x.path === EXISTING_RPC);
    const expectedPages = Math.ceil(PAGED_ITEMS / FAKE_PAGE_ROWS);
    if (pages.length !== expectedPages) errs.push(`existing RPC ${pages.length}회 (기대 ${expectedPages})`);
    else {
      // next_after 를 이어 가는지: 첫 p_after 는 null, 이후는 앞 페이지 마지막 id
      const afters = pages.map(x => (isObj(x.body) ? x.body.p_after : undefined));
      if (afters[0] !== null || afters.slice(1).some(a => typeof a !== 'string') || new Set(afters).size !== afters.length) errs.push('existing RPC p_after 가 next_after 를 이어 가지 않음');
    }
    const args = oneCommit();
    if (args) {
      const exp = Array.isArray(args.p_expected) ? args.p_expected : [];
      if (exp.length !== PAGED_ITEMS) errs.push(`commit p_expected ${exp.length}개 (기대 ${PAGED_ITEMS})`);
      const bad = exp.filter(x => !isObj(x) || x.updated_at !== PAGED_UPDATED_AT).length;
      if (bad) errs.push(`commit p_expected 중 ${bad}개가 고정 updated_at 이 아님(null 포함)`);
    }
    break;
  }
  case 'f': {
    status(200); noStore();
    if (!isObj(body) || body.version !== 2 || body.idempotent !== false || body.upserted !== 1 || !Array.isArray(body.items) || body.items.length !== 1) {
      errs.push('v2 응답 본문이 version 2·idempotent false·upserted 1·items 1개가 아님');
    }
    if (!isObj(body) || !isObj(body.run) || JSON.stringify(Object.keys(body.run).sort()) !== JSON.stringify(Object.keys(expectedRun).sort())
      || Object.keys(expectedRun).some(k => body.run[k] !== expectedRun[k])) errs.push(`응답 run 이 ${JSON.stringify(expectedRun)} 가 아님`);
    fourFilterLookup();
    const lookupAt = calls.findIndex(x => isReplayLookup(x));
    const commitAt = calls.findIndex(x => x.method === 'POST' && x.path === COMMIT_RPC);
    if (lookupAt >= 0 && commitAt >= 0 && lookupAt > commitAt) errs.push('네 필터 실행 조회가 commit 보다 뒤에 있음');
    const args = oneCommit();
    if (args) {
      if (!isObj(args.p_run) || args.p_run.item_count !== 1) errs.push('commit p_run.item_count 가 1 이 아님');
      if (!isObj(args.p_run) || !/^[0-9a-f]{64}$/.test(String(args.p_run.payload_digest))) errs.push('commit p_run.payload_digest 가 64자 hex 가 아님');
    }
    break;
  }
  case 'g': {
    status(200); noStore();
    const want = {version: 2, upserted: 0, items: [], run: expectedRun, idempotent: true};
    const sameKeys = isObj(body) && JSON.stringify(Object.keys(body).sort()) === JSON.stringify(Object.keys(want).sort())
      && isObj(body.run) && JSON.stringify(Object.keys(body.run).sort()) === JSON.stringify(Object.keys(expectedRun).sort());
    const sameValues = sameKeys && body.version === 2 && body.upserted === 0 && Array.isArray(body.items) && body.items.length === 0
      && body.idempotent === true && Object.keys(expectedRun).every(k => body.run[k] === expectedRun[k]);
    if (!sameValues) errs.push(`재전송 응답 본문이 ${JSON.stringify(want)} 가 아님`);
    noCommit(); noItemLookups(); fourFilterLookup();
    break;
  }
  case 'h': {
    status(409); noStore();
    const want = conflictExample();
    if (JSON.stringify(body) !== JSON.stringify(want)) errs.push(`응답 본문이 문서 conflict-response 예시 ${JSON.stringify(want)} 와 다름`);
    noCommit(); noItemLookups(); fourFilterLookup();
    break;
  }
  case 'i': {
    // 키·digest 가 같아도 commit_source 가 'report' 이면 앱은 재전송으로 보지 않고 409 (lib/ingest-service.ts judgeRunRecord)
    status(409); noStore();
    const want = conflictExample();
    if (JSON.stringify(body) !== JSON.stringify(want)) errs.push(`응답 본문이 문서 conflict-response 예시 ${JSON.stringify(want)} 와 다름`);
    noCommit(); noItemLookups(); fourFilterLookup(INGEST_RUN_REPORT);
    break;
  }
  case 'j': {
    // 실패 보고: 항목 없이 실행 기록만 commit (lib/ingest-service.ts v2 failed, tests/ingest-service.test.mjs)
    status(200); noStore();
    const isEmpty = v => Array.isArray(v) && v.length === 0;
    if (!isObj(body) || body.version !== 2 || body.idempotent !== false || body.upserted !== 0 || !isEmpty(body.items)) {
      errs.push('v2 응답 본문이 version 2·idempotent false·upserted 0·items [] 가 아님');
    }
    if (!isObj(body) || !isObj(body.run) || body.run.run_id !== INGEST_RUN_FAILED || body.run.status !== 'failed' || body.run.accepted_count !== 0) {
      errs.push(`응답 run 이 run_id ${INGEST_RUN_FAILED.slice(-2)}·status failed·accepted_count 0 이 아님`);
    }
    const args = oneCommit();
    if (args) {
      const r = isObj(args.p_run) ? args.p_run : {};
      if (r.run_id !== INGEST_RUN_FAILED || r.status !== 'failed' || r.error_code !== 'SOURCE_TIMEOUT' || r.item_count !== 0) {
        errs.push(`commit p_run 이 run_id ${INGEST_RUN_FAILED.slice(-2)}·status failed·error_code SOURCE_TIMEOUT·item_count 0 이 아님`);
      }
      for (const k of ['p_rows', 'p_expected', 'p_source_ids']) if (!isEmpty(args[k])) errs.push(`commit ${k} 가 빈 배열이 아님`);
    }
    noItemLookups(); fourFilterLookup(INGEST_RUN_FAILED);
    const lookupAt = calls.findIndex(x => isReplayLookup(x, INGEST_RUN_FAILED));
    const commitAt = calls.findIndex(x => x.method === 'POST' && x.path === COMMIT_RPC);
    if (lookupAt >= 0 && commitAt >= 0 && lookupAt > commitAt) errs.push('네 필터 실행 조회가 commit 보다 뒤에 있음');
    break;
  }
  default: errs.push(`알 수 없는 경우 ${c.id}`);
  }
  return errs;
}

/** 검사 목록을 차례로 실행(사례마다 그 요청 동안의 calls 만 잘라 판정하므로 f 의 호출이 g·h 판정에 섞이지 않는다) → {problems, results} */
export async function checkApiIngest(base, fake) {
  const problems = [], results = [];
  for (const c of apiIngestCases()) {
    const start = fake.calls.length;
    const observed = {status: undefined, bodyText: '', cacheControl: null};
    try {
      const payload = typeof c.rawBody === 'string' ? c.rawBody : JSON.stringify(c.body);
      const res = await fetch(base + '/api/ingest', {method: 'POST', headers: c.headers, body: payload, redirect: 'manual'});
      observed.status = res.status;
      observed.cacheControl = res.headers.get('cache-control');
      observed.bodyText = await res.text();
    } catch (e) { observed.status = `오류 ${e.message.split('\n')[0]}`; }
    observed.calls = fake.calls.slice(start);
    const errs = judgeIngestCase(c, observed);
    results.push({id: c.id, errs});
    if (errs.length) { problems.push(`(${c.id}) ${errs.join('; ')}`); console.log(`FAIL api ingest (${c.id}) ${c.name}: ${errs.join('; ')}`); }
    else console.log(`PASS api ingest (${c.id}) ${c.name} → ${observed.status}`);
  }
  return {problems, results};
}
