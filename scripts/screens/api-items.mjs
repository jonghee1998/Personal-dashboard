// 빌드된 앱(next start)의 /api/items 상태 수정 검사. run.mjs 가 checkApiIngest 뒤에 checkApiItems 를 부른다.
// 가짜 Supabase 서버(api-auth.mjs)의 '유효한 합성 세션'과 메모리 행(c1 정산·c2 할 일·c3 뉴스·c4 할 일)을 쓴다.
// ⓐ c1 정산 done → 200(쿼리 조건 4개) ⓐ2 c2 할 일 done → 200 ⓑ 옛 형식 → 400·PATCH 0건
// ⓒ c3 뉴스 → 400 Update failed·active 유지 ⓓ status archived → 400·PATCH 0건 ⓔ c4 삭제 → 200, 그 뒤 체크 → 400·archived 유지.
// 값은 모두 가짜다.
import {
  FAKE_USER_ID, ITEM_SETTLEMENT, ITEM_TASK, ITEM_NEWS, ITEM_TASK_DELETE, appOrigin, validSessionCookie,
} from './api-auth.mjs';

const ITEMS_REST = '/rest/v1/dashboard_items';
const STATUS_FILTERS = id => [['id', `eq.${id}`], ['user_id', `eq.${FAKE_USER_ID}`], ['kind', 'in.(settlement,task)'], ['status', 'neq.archived']];

/** 검사 목록(순서대로 실행). expect: 상태 코드, patches: rest PATCH 건수, filters: PATCH 쿼리에 있어야 할 조건,
 *  item: 응답 item.status, error: 응답 error, rows: 요청 뒤 메모리 행 상태 */
export function apiItemsCases() {
  return [
    {id: 'a', name: 'ⓐ 정산 c1 done → 200', method: 'PATCH', body: {action: 'status', id: ITEM_SETTLEMENT, status: 'done'},
      expect: 200, patches: 1, filters: STATUS_FILTERS(ITEM_SETTLEMENT), item: 'done', rows: {[ITEM_SETTLEMENT]: 'done'}},
    {id: 'a2', name: 'ⓐ2 할 일 c2 done → 200', method: 'PATCH', body: {action: 'status', id: ITEM_TASK, status: 'done'},
      expect: 200, patches: 1, filters: STATUS_FILTERS(ITEM_TASK), item: 'done', rows: {[ITEM_TASK]: 'done'}},
    {id: 'b', name: 'ⓑ 옛 형식 {id,status} → 400', method: 'PATCH', body: {id: ITEM_SETTLEMENT, status: 'pending'},
      expect: 400, patches: 0, rows: {[ITEM_SETTLEMENT]: 'done'}},
    {id: 'c', name: 'ⓒ 뉴스 c3 done → 400 Update failed', method: 'PATCH', body: {action: 'status', id: ITEM_NEWS, status: 'done'},
      expect: 400, error: 'Update failed', rows: {[ITEM_NEWS]: 'active'}},
    {id: 'd', name: 'ⓓ status archived → 400', method: 'PATCH', body: {action: 'status', id: ITEM_TASK, status: 'archived'},
      expect: 400, patches: 0, rows: {[ITEM_TASK]: 'done'}},
    {id: 'e1', name: 'ⓔ 할 일 c4 삭제 → 200', method: 'DELETE', body: {id: ITEM_TASK_DELETE},
      expect: 200, deleted: true, rows: {[ITEM_TASK_DELETE]: 'archived'}},
    {id: 'e2', name: 'ⓔ 삭제한 c4 done → 400', method: 'PATCH', body: {action: 'status', id: ITEM_TASK_DELETE, status: 'done'},
      expect: 400, error: 'Update failed', rows: {[ITEM_TASK_DELETE]: 'archived'}},
  ];
}

const parse = text => { try { return JSON.parse(text); } catch { return undefined; } };

/** 한 경우 판정(순수 함수). observed: {status, bodyText, calls(그 요청 동안 가짜 서버 기록), rows({id: status})} → 문제 문자열 목록 */
export function judgeItemsCase(c, observed) {
  const errs = [];
  const body = parse(observed.bodyText);
  if (observed.status !== c.expect) errs.push(`상태 ${observed.status} (기대 ${c.expect})`);
  const patches = (observed.calls || []).filter(x => x.method === 'PATCH' && x.path === ITEMS_REST);
  if (c.patches !== undefined && patches.length !== c.patches) errs.push(`PATCH ${ITEMS_REST} ${patches.length}건 (기대 ${c.patches})`);
  if (c.filters) {
    const params = patches.map(p => new URLSearchParams(p.query));
    for (const [k, v] of c.filters) if (!params.some(q => q.getAll(k).includes(v))) errs.push(`쿼리 조건 ${k}=${v} 없음`);
  }
  if (c.item !== undefined && body?.item?.status !== c.item) errs.push(`item.status ${body?.item?.status} (기대 ${c.item})`);
  if (c.error !== undefined && body?.error !== c.error) errs.push(`error ${body?.error} (기대 ${c.error})`);
  if (c.deleted && body?.deleted !== true) errs.push('deleted:true 없음');
  for (const [id, want] of Object.entries(c.rows || {})) {
    const got = observed.rows?.[id];
    if (got !== want) errs.push(`행 …${id.slice(-2)} ${got} (기대 ${want})`);
  }
  return errs;
}

/** 모든 경우를 순서대로 실행 → {problems, results} */
export async function checkApiItems(base, fake, origin = appOrigin(base)) {
  const problems = [], results = [];
  fake.resetItems();
  const headers = {'content-type': 'application/json', cookie: validSessionCookie(fake.url), origin};
  for (const c of apiItemsCases()) {
    const start = fake.calls.length;
    let status, bodyText = '';
    try {
      const res = await fetch(base + '/api/items', {method: c.method, headers, body: JSON.stringify(c.body), redirect: 'manual'});
      status = res.status;
      bodyText = await res.text();
    } catch (e) { status = `오류 ${e.message.split('\n')[0]}`; }
    const rows = Object.fromEntries(fake.items.map(r => [r.id, r.status]));
    const errs = judgeItemsCase(c, {status, bodyText, calls: fake.calls.slice(start), rows});
    results.push({name: c.name, status});
    if (errs.length) { problems.push(`${c.name}: ${errs.join('; ')}`); console.log(`FAIL items ${c.name} ${errs.join('; ')}`); }
    else console.log(`PASS items ${c.name} → ${status}`);
  }
  return {problems, results};
}
