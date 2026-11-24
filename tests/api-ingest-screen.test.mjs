import test from 'node:test';
import assert from 'node:assert/strict';
import {apiIngestCases, judgeIngestCase, pagedBody, v1Body, v2Body, PAGED_ITEMS} from '../scripts/screens/api-ingest.mjs';
import {
  FAKE_USER_ID, INGEST_RUN_OK, INGEST_RUN_COMMIT_FAIL, INGEST_RUN_PAGED, PAGED_UPDATED_AT, FAKE_PAGE_ROWS,
  fakeCommitResponse, fakeExistingPage, fakeSupabaseResponse, startFakeSupabase,
} from '../scripts/screens/api-auth.mjs';
import {parseIngestV2} from '../lib/ingest-v2.ts';
import {handleIngest, readAllPages, payload} from '../lib/ingest-service.ts';

const NOW = Date.parse('2026-01-02T00:00:00+09:00');
const cases = Object.fromEntries(apiIngestCases().map(c => [c.id, c]));

test('검사 다섯 경우 a~e, run_id f3·f4·f5', () => {
  assert.deepEqual(apiIngestCases().map(c => c.id), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(cases.b.body.run.run_id, INGEST_RUN_OK);
  assert.equal(cases.c.body.run.run_id, INGEST_RUN_COMMIT_FAIL);
  assert.equal(cases.e.body.run.run_id, INGEST_RUN_PAGED);
  assert.ok(!cases.d.headers.authorization);
});

test('v2 본문은 parseIngestV2 를 통과(1항목·500항목), v1 본문은 v1 스키마 통과', () => {
  for (const body of [v2Body(INGEST_RUN_OK), v2Body(INGEST_RUN_COMMIT_FAIL), pagedBody()]) {
    const r = parseIngestV2(structuredClone(body), NOW);
    assert.equal(r.ok, true, JSON.stringify(r.violations));
    assert.deepEqual(r.itemViolations, []);
    assert.equal(r.items.length, body.manifest.item_count);
    for (const x of body.items) assert.equal(x.metadata.run_id, body.run.run_id);
  }
  assert.equal(pagedBody().items.length, PAGED_ITEMS);
  assert.equal(new Set(pagedBody().items.map(x => x.metadata.source_record_id)).size, PAGED_ITEMS);
  assert.equal(v2Body(INGEST_RUN_OK).items.length, 1);
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
async function simulate(c) {
  const calls = [];
  const rpc = (path, body) => { const out = fakeSupabaseResponse('POST', path, '', 'application/json', body); calls.push({method: 'POST', path, query: '', body, status: out.status}); return out; };
  const page = (fn, args) => readAllPages(async after => {
    const out = rpc(`/rest/v1/rpc/${fn}`, {...args, p_after: after, p_limit: 500});
    return out.status === 200 ? {data: out.body, error: null} : {data: null, error: out.body};
  });
  const deps = {
    readExisting: (u, ids) => page('dashboard_ingest_existing', {p_user: u, p_external_ids: ids}),
    readCandidates: (u, ids) => page('dashboard_ingest_candidates', {p_user: u, p_source_ids: ids}),
    readRun: async (u, k) => {
      const query = `select=*&user_id=eq.${u}&run_id=eq.${k.run_id}&dataset=eq.${k.dataset}&source_system=eq.${k.source_system}`;
      const out = fakeSupabaseResponse('GET', '/rest/v1/dashboard_sync_runs', query, 'application/json');
      calls.push({method: 'GET', path: '/rest/v1/dashboard_sync_runs', query, status: out.status});
      return out.status === 200 ? {data: out.body[0] ?? null, error: null} : {data: null, error: out.body};
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
