import test from 'node:test';
import assert from 'node:assert/strict';
import {apiIngestCases, judgeIngestCase, pagedBody, v1Body, v2Body, v2ConflictBody, failedExample, PAGED_ITEMS} from '../scripts/screens/api-ingest.mjs';
import {
  FAKE_TOKEN, FAKE_USER_ID, INGEST_RUN_OK, INGEST_RUN_COMMIT_FAIL, INGEST_RUN_PAGED, INGEST_RUN_REPLAY, INGEST_RUN_REPORT, INGEST_RUN_FAILED, PAGED_UPDATED_AT, FAKE_PAGE_ROWS,
  fakeCommitResponse, fakeReportRun, fakeExistingPage, fakeSupabaseResponse, startFakeSupabase,
} from '../scripts/screens/api-auth.mjs';
import {parseIngestV2} from '../lib/ingest-v2.ts';
import {handleIngest, readAllPages, payload} from '../lib/ingest-service.ts';

const NOW = Date.parse('2026-01-02T00:00:00+09:00');
const cases = Object.fromEntries(apiIngestCases().map(c => [c.id, c]));

test('검사 목록 a~k, run_id f3·f4·f5·f6·f7·f8', () => {
  assert.deepEqual(apiIngestCases().map(c => c.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
  assert.equal(cases.k.headers.authorization, `Bearer ${FAKE_TOKEN}`);
  assert.equal(typeof cases.k.body.version, 'string');
  assert.equal(cases.k.body.version, '2');
  assert.deepEqual({...cases.k.body, version: 2}, v2Body(INGEST_RUN_OK));
  // j: 문서 failed 예시 그대로, run_id 만 f8
  assert.equal(cases.j.headers.authorization, `Bearer ${FAKE_TOKEN}`);
  assert.equal(cases.j.body.run.run_id, INGEST_RUN_FAILED);
  assert.deepEqual(cases.j.body.items, []);
  assert.equal(cases.j.body.run.status, 'failed');
  assert.deepEqual(cases.j.body.manifest, {item_count: 0, amount_total: null});
  assert.deepEqual({...cases.j.body, run: {...cases.j.body.run, run_id: failedExample().run.run_id}}, failedExample());
  // i: f7 본문의 키가 가짜 서버의 report 기록과 같다
  assert.equal(cases.i.body.run.run_id, INGEST_RUN_REPORT);
  assert.equal(cases.i.headers.authorization, `Bearer ${FAKE_TOKEN}`);
  assert.equal(cases.i.body.run.source_system, fakeReportRun().source_system);
  assert.equal(cases.i.body.run.dataset, fakeReportRun().dataset);
  assert.equal(cases.b.body.run.run_id, INGEST_RUN_OK);
  assert.equal(cases.c.body.run.run_id, INGEST_RUN_COMMIT_FAIL);
  assert.equal(cases.e.body.run.run_id, INGEST_RUN_PAGED);
  assert.ok(!cases.d.headers.authorization);
  for (const id of ['f', 'g', 'h']) {
    assert.equal(cases[id].body.run.run_id, INGEST_RUN_REPLAY, id);
    assert.equal(cases[id].headers.authorization, `Bearer ${FAKE_TOKEN}`, id);
  }
  // g 는 f 와 같은 본문, h 는 title 만 다른 본문
  assert.deepEqual(cases.g.body, cases.f.body);
  assert.notDeepEqual(cases.h.body.items, cases.g.body.items);
  assert.equal(cases.g.body.items[0].title, '합성가맹점A');
  assert.equal(cases.h.body.items[0].title, '합성가맹점B');
  assert.deepEqual({...cases.h.body.items[0], title: '합성가맹점A'}, cases.g.body.items[0]);
});

test('v2 본문은 parseIngestV2 를 통과(1항목·500항목), v1 본문은 v1 스키마 통과', () => {
  for (const body of [v2Body(INGEST_RUN_OK), v2Body(INGEST_RUN_COMMIT_FAIL), pagedBody(), v2Body(INGEST_RUN_REPLAY), v2ConflictBody(), cases.i.body, cases.j.body]) {
    const r = parseIngestV2(structuredClone(body), NOW);
    assert.equal(r.ok, true, JSON.stringify(r.violations));
    assert.deepEqual(r.itemViolations, []);
    assert.equal(r.items.length, body.manifest.item_count);
    for (const x of body.items) assert.equal(x.metadata.run_id, body.run.run_id);
  }
  assert.equal(pagedBody().items.length, PAGED_ITEMS);
  assert.equal(new Set(pagedBody().items.map(x => x.metadata.source_record_id)).size, PAGED_ITEMS);
  assert.equal(v2Body(INGEST_RUN_OK).items.length, 1);
  assert.equal(parseIngestV2(structuredClone(cases.j.body), NOW).items.length, 0);
  assert.equal(payload.safeParse(v1Body()).success, true);
});

test('가짜 existing RPC: 500건을 200개씩 next_after 로 이어 3페이지', () => {
  const ids = pagedBody().items.map(x => x.external_id);
  const afters = [];
  let after = null, total = 0;
  for (;;) {
    afters.push(after);
    const page = fakeExistingPage({p_external_ids: ids, p_after: after});
    assert.ok(page.rows.length <= FAKE_PAGE_ROWS);
    total += page.rows.length;
    assert.ok(page.rows.every(r => r.updated_at === PAGED_UPDATED_AT));
    if (page.next_after === null) break;
    after = page.next_after;
  }
  assert.equal(afters.length, 3); assert.equal(total, PAGED_ITEMS);
  assert.deepEqual(fakeExistingPage({p_external_ids: ['txn-000001'], p_after: null}), {rows: [], next_after: null});
});

test('가짜 commit RPC: f4 는 503, p_run null 이면 run null', () => {
  assert.equal(fakeCommitResponse({p_run: {run_id: INGEST_RUN_COMMIT_FAIL}, p_rows: []}).status, 503);
  const v1 = fakeCommitResponse({p_run: null, p_rows: [{kind: 'transaction', external_id: 'txn-000001'}]});
  assert.equal(v1.status, 200); assert.equal(v1.body.run, null); assert.equal(v1.body.upserted, 1);
  const r = fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', `select=*&user_id=eq.${FAKE_USER_ID}&run_id=eq.${INGEST_RUN_OK}`, 'application/json');
  assert.deepEqual(r, {status: 200, body: []});
  assert.deepEqual(fakeSupabaseResponse('POST', '/rest/v1/rpc/dashboard_ingest_candidates', '', '', {}), {status: 200, body: {rows: [], next_after: null}});
  // 다른 데이터 경로는 그대로 401
  assert.equal(fakeSupabaseResponse('GET', '/rest/v1/dashboard_items', 'select=*', 'application/json').status, 401);
});

test('가짜 서버는 요청 본문과 응답 상태를 calls 에 기록', async () => {
  const fake = await startFakeSupabase();
  try {
    const r = await fetch(`${fake.url}/rest/v1/rpc/dashboard_ingest_commit`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({p_run: {run_id: INGEST_RUN_COMMIT_FAIL}})});
    assert.equal(r.status, 503); await r.arrayBuffer();
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].status, 503); assert.equal(fake.calls[0].body.p_run.run_id, INGEST_RUN_COMMIT_FAIL);
    assert.deepEqual(fake.queries, [{method: 'POST', path: '/rest/v1/rpc/dashboard_ingest_commit', query: ''}]);
  } finally { await fake.close(); }
});

// 가짜 서버 응답 함수를 그대로 쓰는 deps 로 handleIngest 를 돌려, 앱이 보낼 호출 기록(calls)을 만든 뒤 판정한다.
// ctx.runs(Map) 를 넘기면 가짜 commit 이 f6 실행을 기억하고 readRun 이 그 기록을 돌려준다(f→g→h 를 같은 runs 로 차례 실행).
// mapRow(선택): readRun 이 돌려줄 기록을 테스트 안에서만 바꾼다(가짜 서버 기본 동작은 그대로).
async function simulate(c, runs, mapRow = row => row) {
  const calls = [];
  const ctx = runs ? {runs} : {};
  const rpc = (path, body) => { const out = fakeSupabaseResponse('POST', path, '', 'application/json', body, ctx); calls.push({method: 'POST', path, query: '', body, status: out.status}); return out; };
  const page = (fn, args) => readAllPages(async after => {
    const out = rpc(`/rest/v1/rpc/${fn}`, {...args, p_after: after, p_limit: 500});
    return out.status === 200 ? {data: out.body, error: null} : {data: null, error: out.body};
  });
  const deps = {
    readExisting: (u, ids) => page('dashboard_ingest_existing', {p_user: u, p_external_ids: ids}),
    readCandidates: (u, ids) => page('dashboard_ingest_candidates', {p_user: u, p_source_ids: ids}),
    readRun: async (u, k) => {
      const query = `select=*&user_id=eq.${u}&run_id=eq.${k.run_id}&dataset=eq.${k.dataset}&source_system=eq.${k.source_system}`;
      const out = fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', query, 'application/json', undefined, ctx);
      calls.push({method: 'GET', path: '/rest/v1/dashboard_sync_runs', query, status: out.status});
      return out.status === 200 ? {data: mapRow(out.body[0] ?? null), error: null} : {data: null, error: out.body};
    },
    commit: async args => { const out = rpc('/rest/v1/rpc/dashboard_ingest_commit', structuredClone(args)); return out.status === 200 ? {data: out.body, error: null} : {data: null, error: out.body}; },
  };
  const out = await handleIngest(structuredClone(c.body), FAKE_USER_ID, NOW, deps);
  // route 와 같은 변환(결정 D)
  let status, body, cacheControl = null;
  if (out.kind === 'v2failure') { status = 503; body = {error: 'Ingest unavailable'}; cacheControl = 'no-store'; }
  else { status = out.status; body = out.body; if (out.version === 2 || out.status === 200) cacheControl = 'no-store'; }
  return {status, bodyText: JSON.stringify(body), cacheControl, calls};
}

test('a·b·c·e: lib 처리 결과를 판정하면 통과(ⓔ existing 3회·p_expected 500개 고정 updated_at)', async () => {
  for (const id of ['a', 'b', 'c', 'e']) {
    const observed = await simulate(cases[id]);
    assert.deepEqual(judgeIngestCase(cases[id], observed), [], id);
  }
  const e = await simulate(cases.e);
  assert.equal(e.calls.filter(x => x.path.endsWith('dashboard_ingest_existing')).length, 3);
});

test('판정: 어긋난 관찰은 실패', async () => {
  const a = await simulate(cases.a);
  assert.ok(judgeIngestCase(cases.a, {...a, cacheControl: null}).length);
  assert.ok(judgeIngestCase(cases.a, {...a, calls: []}).length);
  const b = await simulate(cases.b);
  assert.ok(judgeIngestCase(cases.b, {...b, calls: b.calls.filter(x => x.method !== 'GET')}).length);
  assert.ok(judgeIngestCase(cases.b, {...b, bodyText: JSON.stringify({version: 2, idempotent: true})}).length);
  const c = await simulate(cases.c);
  // 앞 단계(실행 조회 등)에서 503 이 난 경우: commit 기록이 없으므로 실패
  assert.ok(judgeIngestCase(cases.c, {...c, calls: c.calls.filter(x => !x.path.endsWith('dashboard_ingest_commit'))}).length);
  assert.ok(judgeIngestCase(cases.c, {...c, calls: c.calls.map(x => ({...x, status: 200}))}).length);
  assert.ok(judgeIngestCase(cases.c, {...c, cacheControl: null}).length);
  assert.deepEqual(judgeIngestCase(cases.d, {status: 401, bodyText: '{"error":"Unauthorized"}', cacheControl: null, calls: []}), []);
  assert.ok(judgeIngestCase(cases.d, {status: 401, bodyText: '', cacheControl: 'no-store', calls: []}).length);
  const e = await simulate(cases.e);
  const pages = e.calls.filter(x => x.path.endsWith('dashboard_ingest_existing'));
  assert.ok(judgeIngestCase(cases.e, {...e, calls: e.calls.filter(x => x !== pages[2])}).length);
  const commit = e.calls.find(x => x.path.endsWith('dashboard_ingest_commit'));
  const nulls = {...commit, body: {...commit.body, p_expected: commit.body.p_expected.map((x, i) => i === 0 ? {...x, updated_at: null} : x)}};
  assert.ok(judgeIngestCase(cases.e, {...e, calls: e.calls.map(x => x === commit ? nulls : x)}).length);
});

// f→g→h 를 같은 runs 로 차례 실행한 관찰
async function simulateReplay() {
  const runs = new Map();
  const f = await simulate(cases.f, runs);
  const g = await simulate(cases.g, runs);
  const h = await simulate(cases.h, runs);
  return {runs, f, g, h};
}

test('f·g·h: 같은 runs 로 f→g→h 차례 실행하면 판정 모두 통과', async () => {
  const {runs, f, g, h} = await simulateReplay();
  assert.equal(runs.size, 1);
  assert.deepEqual(judgeIngestCase(cases.f, f), [], 'f');
  assert.deepEqual(judgeIngestCase(cases.g, g), [], 'g');
  assert.deepEqual(judgeIngestCase(cases.h, h), [], 'h');
  // f 는 항목 상태 RPC 를 부르지만 g·h 의 calls 에는 섞이지 않는다
  assert.ok(f.calls.some(x => x.path.endsWith('dashboard_ingest_existing')));
  assert.ok(!g.calls.some(x => x.path.endsWith('dashboard_ingest_existing')));
  assert.ok(!h.calls.some(x => x.path.endsWith('dashboard_ingest_existing')));
  assert.equal(JSON.parse(g.bodyText).idempotent, true);
});

test('f·g·h 판정: 어긋난 관찰은 실패', async () => {
  const {f, g, h} = await simulateReplay();
  const commitCall = f.calls.find(x => x.path.endsWith('dashboard_ingest_commit'));
  const existingCall = f.calls.find(x => x.path.endsWith('dashboard_ingest_existing'));
  const candidatesCall = {method: 'POST', path: '/rest/v1/rpc/dashboard_ingest_candidates', query: '', body: {p_user: FAKE_USER_ID, p_source_ids: ['apv-000001']}, status: 200};
  const gBody = JSON.parse(g.bodyText);
  // g
  assert.ok(judgeIngestCase(cases.g, {...g, calls: [...g.calls, commitCall]}).length, 'g commit 1건');
  assert.ok(judgeIngestCase(cases.g, {...g, bodyText: JSON.stringify({...gBody, idempotent: false})}).length, 'g idempotent false');
  assert.ok(judgeIngestCase(cases.g, {...g, bodyText: JSON.stringify({...gBody, items: [{id: 'x'}]})}).length, 'g items 1개');
  const noDataset = g.calls.map(x => x.method === 'GET' ? {...x, query: x.query.split('&').filter(p => !p.startsWith('dataset=')).join('&')} : x);
  assert.ok(judgeIngestCase(cases.g, {...g, calls: noDataset}).length, 'g dataset 필터 누락');
  assert.ok(judgeIngestCase(cases.g, {...g, calls: [...g.calls, existingCall]}).length, 'g existing RPC 1건');
  assert.ok(judgeIngestCase(cases.g, {...g, calls: [...g.calls, candidatesCall]}).length, 'g candidates RPC 1건');
  // h
  assert.ok(judgeIngestCase(cases.h, {...h, status: 200}).length, 'h 200');
  assert.ok(judgeIngestCase(cases.h, {...h, calls: [...h.calls, commitCall]}).length, 'h commit 있음');
  assert.ok(judgeIngestCase(cases.h, {...h, calls: [...h.calls, existingCall]}).length, 'h existing RPC 있음');
  assert.ok(judgeIngestCase(cases.h, {...h, cacheControl: null}).length, 'h no-store 없음');
  // f 를 runs 가 이미 있는 상태(재전송)로 돌리면 실패
  const runs = new Map();
  await simulate(cases.f, runs);
  const fAgain = await simulate(cases.f, runs);
  assert.ok(judgeIngestCase(cases.f, fAgain).length, 'f 재전송 상태');
});

const countPath = (calls, name) => calls.filter(x => x.path.endsWith(name)).length;

test('i: simulate 판정 통과', async () => {
  const i = await simulate(cases.i);
  assert.deepEqual(judgeIngestCase(cases.i, i), []);
  assert.equal(i.status, 409);
  for (const name of ['dashboard_ingest_existing', 'dashboard_ingest_candidates', 'dashboard_ingest_commit']) {
    assert.equal(countPath(i.calls, name), 0, name);
  }
  // 대조군: f7 조회 응답의 commit_source 만 'ingest_v2' 로 바꾸면 같은 본문이 200 idempotent
  const ctl = await simulate(cases.i, undefined, row => (row && row.run_id === INGEST_RUN_REPORT ? {...row, commit_source: 'ingest_v2'} : row));
  assert.equal(ctl.status, 200);
  assert.equal(JSON.parse(ctl.bodyText).idempotent, true);
  assert.equal(countPath(ctl.calls, 'dashboard_ingest_commit'), 0);
});

test('i 판정: 어긋난 관찰은 실패', async () => {
  const i = await simulate(cases.i);
  const f = await simulate(cases.f, new Map());
  const commitCall = f.calls.find(x => x.path.endsWith('dashboard_ingest_commit'));
  const existingCall = f.calls.find(x => x.path.endsWith('dashboard_ingest_existing'));
  assert.ok(commitCall && existingCall);
  assert.ok(judgeIngestCase(cases.i, {...i, status: 200}).length, 'i 200');
  assert.ok(judgeIngestCase(cases.i, {...i, cacheControl: null}).length, 'i no-store 없음');
  assert.ok(judgeIngestCase(cases.i, {...i, bodyText: '{}'}).length, 'i 본문 {}');
  assert.ok(judgeIngestCase(cases.i, {...i, calls: [...i.calls, commitCall]}).length, 'i commit 1건');
  assert.ok(judgeIngestCase(cases.i, {...i, calls: [...i.calls, existingCall]}).length, 'i existing 1건');
  const noDataset = i.calls.map(x => x.method === 'GET' ? {...x, query: x.query.split('&').filter(p => !p.startsWith('dataset=')).join('&')} : x);
  assert.ok(judgeIngestCase(cases.i, {...i, calls: noDataset}).length, 'i dataset 필터 누락');
  const f6 = i.calls.map(x => x.method === 'GET' ? {...x, query: x.query.replace(`run_id=eq.${INGEST_RUN_REPORT}`, `run_id=eq.${INGEST_RUN_REPLAY}`)} : x);
  assert.ok(f6.some(x => x.query.includes(INGEST_RUN_REPLAY)));
  assert.ok(judgeIngestCase(cases.i, {...i, calls: f6}).length, 'i run_id f6');
});

test('j: simulate 판정 통과', async () => {
  const j = await simulate(cases.j);
  assert.deepEqual(judgeIngestCase(cases.j, j), []);
  assert.equal(j.status, 200);
  assert.equal(countPath(j.calls, 'dashboard_ingest_existing'), 0);
  assert.equal(countPath(j.calls, 'dashboard_ingest_candidates'), 0);
  assert.equal(countPath(j.calls, 'dashboard_ingest_commit'), 1);
  const body = JSON.parse(j.bodyText);
  assert.equal(body.upserted, 0); assert.deepEqual(body.items, []); assert.equal(body.run.status, 'failed');
});

test('j 판정: 어긋난 관찰은 실패', async () => {
  const j = await simulate(cases.j);
  const body = JSON.parse(j.bodyText);
  const commitCall = j.calls.find(x => x.path.endsWith('dashboard_ingest_commit'));
  const lookupCall = j.calls.find(x => x.method === 'GET');
  assert.ok(commitCall && lookupCall);
  const withCommit = f => j.calls.map(x => x === commitCall ? {...x, body: f(structuredClone(x.body))} : x);
  const existingCall = {method: 'POST', path: '/rest/v1/rpc/dashboard_ingest_existing', query: '', body: {p_user: FAKE_USER_ID, p_external_ids: ['txn-000001'], p_after: null}, status: 200};
  const bad = {
    'status 503': {...j, status: 503},
    'no-store 없음': {...j, cacheControl: null},
    '본문 upserted 1': {...j, bodyText: JSON.stringify({...body, upserted: 1})},
    '본문 run.status success': {...j, bodyText: JSON.stringify({...body, run: {...body.run, status: 'success'}})},
    'commit 0건': {...j, calls: j.calls.filter(x => x !== commitCall)},
    'commit 2건': {...j, calls: [...j.calls, commitCall]},
    'commit p_rows 1행': {...j, calls: withCommit(b => ({...b, p_rows: [{kind: 'transaction', external_id: 'txn-000001', title: '합성가맹점A'}]}))},
    'p_run.error_code null': {...j, calls: withCommit(b => ({...b, p_run: {...b.p_run, error_code: null}}))},
    'existing RPC 1건': {...j, calls: [...j.calls, existingCall]},
    '실행 조회 run_id f6': {...j, calls: j.calls.map(x => x.method === 'GET' ? {...x, query: x.query.replace(`run_id=eq.${INGEST_RUN_FAILED}`, `run_id=eq.${INGEST_RUN_REPLAY}`)} : x)},
  };
  for (const [name, observed] of Object.entries(bad)) assert.ok(judgeIngestCase(cases.j, observed).length, name);
  // 호출 순서만 바꿈: commit 을 실행 조회 앞으로 옮기고 내용은 그대로 → 순서 오류만으로 실패
  const reordered = [commitCall, ...j.calls.filter(x => x !== commitCall)];
  assert.equal(reordered.length, j.calls.length);
  assert.ok(reordered.indexOf(commitCall) < reordered.indexOf(lookupCall));
  const errs = judgeIngestCase(cases.j, {...j, calls: reordered});
  assert.equal(errs.length, 1, JSON.stringify(errs));
  assert.match(errs[0], /뒤|commit 보다/);
});

test('k: 문자열 version은 400 Invalid payload, 숫자 version은 200', async () => {
  const k = await simulate(cases.k);
  assert.equal(k.status, 400);
  assert.equal(JSON.parse(k.bodyText).error, 'Invalid payload');
  assert.equal(k.cacheControl, null);
  assert.equal(k.calls.length, 0);
  assert.deepEqual(judgeIngestCase(cases.k, k), []);

  const ctl = await simulate({...cases.k, body: {...cases.k.body, version: 2}});
  assert.equal(ctl.status, 200);
  assert.equal(JSON.parse(ctl.bodyText).version, 2);
});

test('k 판정: 어긋난 관찰은 실패', async () => {
  const k = await simulate(cases.k);
  const body = JSON.parse(k.bodyText);
  const bad = {
    '상태 200': {...k, status: 200},
    '상태 422': {...k, status: 422},
    'Invalid JSON 오류': {...k, bodyText: JSON.stringify({error: 'Invalid JSON'})},
    '본문 version 키': {...k, bodyText: JSON.stringify({...body, version: 2})},
    'details 누락': {...k, bodyText: JSON.stringify({...body, details: undefined})},
    'details 배열': {...k, bodyText: JSON.stringify({...body, details: []})},
    'Cache-Control no-store': {...k, cacheControl: 'no-store'},
    'commit POST 1건': {...k, calls: [{method: 'POST', path: '/rest/v1/rpc/dashboard_ingest_commit'}]},
    '실행 조회 GET 1건': {...k, calls: [{method: 'GET', path: '/rest/v1/dashboard_sync_runs'}]},
    '빈 본문': {...k, bodyText: ''},
    'JSON이 아닌 본문': {...k, bodyText: 'Invalid payload'},
  };
  for (const [name, observed] of Object.entries(bad)) {
    assert.ok(judgeIngestCase(cases.k, observed).length, name);
  }
});

// f6: 가짜 commit 이 받은 p_run 을 실행 기록으로 기억하고, 네 필터(user_id·run_id·dataset·source_system)로 조회한다.
const OTHER_USER = '00000000-0000-4000-8000-0000000000a2';
const replayRun = {run_id: INGEST_RUN_REPLAY, dataset: 'transactions', source_system: 'fake-source', status: 'succeeded',
  error_code: null, item_count: 2, payload_digest: 'f'.repeat(64), source_as_of: '2026-01-01T00:00:00+09:00', collected_at: '2026-01-01T00:01:00+09:00'};
const replayCommit = () => ({p_user: FAKE_USER_ID, p_rows: [{kind: 'transaction', external_id: 'txn-f6-1', title: '합성가맹점A'}, {kind: 'transaction', external_id: 'txn-f6-2', title: '합성가맹점B'}],
  p_expected: [], p_source_ids: [], p_known: [], p_run: {...replayRun}});
const runQuery = (o = {}) => {
  const f = {user_id: FAKE_USER_ID, run_id: INGEST_RUN_REPLAY, dataset: replayRun.dataset, source_system: replayRun.source_system, ...o};
  return ['select=*', ...Object.entries(f).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)].join('&');
};
const getRun = (q, ctx, accept = 'application/json') => fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', q, accept, undefined, ctx);
const commitRun = (args, ctx) => fakeSupabaseResponse('POST', '/rest/v1/rpc/dashboard_ingest_commit', '', 'application/json', args, ctx);

test('f6: ctx.runs 없으면 commit 200 이지만 기록을 저장하지 않고 조회는 []', () => {
  const out = commitRun(replayCommit());
  assert.equal(out.status, 200); assert.equal(out.body.run.run_id, INGEST_RUN_REPLAY);
  assert.deepEqual(getRun(runQuery()), {status: 200, body: []});
  // ctx 는 있지만 runs 가 Map 이 아니어도 저장·반환 없음
  commitRun(replayCommit(), {items: []});
  assert.deepEqual(getRun(runQuery(), {items: []}), {status: 200, body: []});
});

test('f6: ctx.runs 가 있으면 commit 뒤 네 필터가 맞는 조회가 ingest_v2 기록 1개', () => {
  const runs = new Map();
  assert.deepEqual(getRun(runQuery(), {runs}), {status: 200, body: []}, 'commit 전에는 []');
  assert.equal(commitRun(replayCommit(), {runs}).status, 200);
  const r = getRun(runQuery(), {runs});
  assert.equal(r.status, 200); assert.equal(r.body.length, 1);
  assert.deepEqual(r.body[0], {
    user_id: FAKE_USER_ID, run_id: INGEST_RUN_REPLAY, dataset: 'transactions', source_system: 'fake-source', status: 'succeeded',
    error_code: null, expected_count: replayRun.item_count, payload_digest: replayRun.payload_digest, commit_source: 'ingest_v2',
    accepted_count: 2, source_as_of: replayRun.source_as_of, collected_at: replayRun.collected_at,
  });
  // Accept 가 객체면 객체
  assert.deepEqual(getRun(runQuery(), {runs}, 'application/vnd.pgrst.object+json').body, r.body[0]);
  // 이미 있으면 덮어쓰지 않는다
  commitRun({...replayCommit(), p_run: {...replayRun, payload_digest: 'e'.repeat(64), item_count: 1}}, {runs});
  assert.equal(runs.size, 1);
  assert.equal(getRun(runQuery(), {runs}).body[0].payload_digest, replayRun.payload_digest);
  assert.equal(getRun(runQuery(), {runs}).body[0].expected_count, 2);
});

test('f6: user_id·dataset·source_system 불일치는 각각 []', () => {
  const runs = new Map();
  commitRun(replayCommit(), {runs});
  for (const o of [{user_id: OTHER_USER}, {dataset: 'other-dataset'}, {source_system: 'other-source'}]) {
    assert.deepEqual(getRun(runQuery(o), {runs}), {status: 200, body: []}, JSON.stringify(o));
  }
});

test('f6: dataset·source_system·user_id 필터를 뺀 조회는 각각 []', () => {
  const runs = new Map();
  commitRun(replayCommit(), {runs});
  for (const k of ['dataset', 'source_system', 'user_id']) {
    assert.deepEqual(getRun(runQuery({[k]: undefined}), {runs}), {status: 200, body: []}, k);
    assert.deepEqual(getRun(runQuery({[k]: undefined}), {runs}, 'application/vnd.pgrst.object+json'), {status: 200, body: []}, k);
  }
});

test('f6: startFakeSupabase 로 HTTP commit 뒤 네 필터 GET 이 기록을 돌려주고, f3 은 여전히 []', async () => {
  const fake = await startFakeSupabase();
  const post = args => fetch(`${fake.url}/rest/v1/rpc/dashboard_ingest_commit`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(args)});
  try {
    assert.ok(fake.runs instanceof Map); assert.equal(fake.runs.size, 0);
    const c = await post(replayCommit());
    assert.equal(c.status, 200); await c.arrayBuffer();
    assert.equal(fake.runs.size, 1);
    const g = await fetch(`${fake.url}/rest/v1/dashboard_sync_runs?${runQuery()}`, {headers: {accept: 'application/vnd.pgrst.object+json'}});
    assert.equal(g.status, 200);
    const row = await g.json();
    assert.equal(row.commit_source, 'ingest_v2'); assert.equal(row.run_id, INGEST_RUN_REPLAY);
    assert.equal(row.expected_count, replayRun.item_count); assert.equal(row.payload_digest, replayRun.payload_digest);
    // f3 commit 뒤에도 f3 조회는 [] (f3 은 기억하지 않는다)
    const c3 = await post({...replayCommit(), p_run: {...replayRun, run_id: INGEST_RUN_OK}});
    assert.equal(c3.status, 200); await c3.arrayBuffer();
    assert.equal(fake.runs.size, 1);
    const g3 = await fetch(`${fake.url}/rest/v1/dashboard_sync_runs?${runQuery({run_id: INGEST_RUN_OK})}`);
    assert.equal(g3.status, 200); assert.deepEqual(await g3.json(), []);
  } finally { await fake.close(); }
});
