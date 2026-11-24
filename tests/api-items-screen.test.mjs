import test from 'node:test';
import assert from 'node:assert/strict';
import {apiItemsCases, judgeItemsCase} from '../scripts/screens/api-items.mjs';
import {
  FAKE_USER_ID, ITEM_SETTLEMENT, ITEM_TASK, ITEM_NEWS, ITEM_TASK_DELETE, VALID_ACCESS_TOKEN,
  fakeItemRows, fakePatchItems, fakeSupabaseResponse, parseFilter, sessionCookie, startFakeSupabase, validSessionCookie,
} from '../scripts/screens/api-auth.mjs';
import {itemPatchSchema} from '../lib/items-schema.ts';

const cases = Object.fromEntries(apiItemsCases().map(c => [c.id, c]));
const OBJ = 'application/vnd.pgrst.object+json';
const statusQuery = id => new URLSearchParams([['id', `eq.${id}`], ['user_id', `eq.${FAKE_USER_ID}`], ['kind', 'in.(settlement,task)'], ['status', 'neq.archived'], ['select', '*']]).toString();
const rowsOf = items => Object.fromEntries(items.map(r => [r.id, r.status]));

test('경우 a·a2·b·c·d·e1·e2, 본문은 새 스키마 통과/거부가 기대와 맞음', () => {
  assert.deepEqual(apiItemsCases().map(c => c.id), ['a', 'a2', 'b', 'c', 'd', 'e1', 'e2']);
  for (const id of ['a', 'a2', 'c', 'e2']) assert.equal(itemPatchSchema.safeParse(cases[id].body).success, true, id);
  for (const id of ['b', 'd']) assert.equal(itemPatchSchema.safeParse(cases[id].body).success, false, id);
});

test('유효 세션 쿠키는 VALID_ACCESS_TOKEN, 기존 쿠키는 다른 토큰', () => {
  const token = c => JSON.parse(Buffer.from(c.split('=')[1].slice(7), 'base64url').toString()).access_token;
  assert.equal(token(validSessionCookie('http://127.0.0.1:4555')), VALID_ACCESS_TOKEN);
  assert.notEqual(token(sessionCookie('http://127.0.0.1:4555')), VALID_ACCESS_TOKEN);
});

test('가짜 /auth/v1/user 는 유효 토큰에만 200, 그 밖 401', () => {
  assert.equal(fakeSupabaseResponse('GET', '/auth/v1/user', '', '', undefined, {authorization: `Bearer ${VALID_ACCESS_TOKEN}`}).status, 200);
  assert.equal(fakeSupabaseResponse('GET', '/auth/v1/user', '', '', undefined, {authorization: 'Bearer synthetic-access-token'}).status, 401);
  assert.equal(fakeSupabaseResponse('GET', '/auth/v1/user', '', '', undefined).status, 401);
  const items = fakeItemRows();
  assert.equal(fakeSupabaseResponse('PATCH', '/rest/v1/dashboard_items', statusQuery(ITEM_TASK), OBJ, {status: 'done'}, {authorization: 'Bearer x', items}).status, 401);
  assert.equal(rowsOf(items)[ITEM_TASK], 'pending');
});

test('필터 파싱 eq·neq·in, 모르는 연산자는 null', () => {
  assert.equal(parseFilter('eq.a')('a'), true);
  assert.equal(parseFilter('neq.archived')('archived'), false);
  assert.equal(parseFilter('in.(settlement,task)')('task'), true);
  assert.equal(parseFilter('in.(settlement,task)')('news'), false);
  assert.equal(parseFilter('gt.1'), null);
});

test('가짜 PATCH: 조건에 맞는 1행만 바꾸고, 0행이면 406·변화 없음, 배열 Accept 면 배열', () => {
  const items = fakeItemRows();
  const a = fakePatchItems(items, statusQuery(ITEM_SETTLEMENT), OBJ, {status: 'done'});
  assert.equal(a.status, 200);
  assert.equal(a.body.status, 'done');
  const c = fakePatchItems(items, statusQuery(ITEM_NEWS), OBJ, {status: 'done'});
  assert.deepEqual([c.status, c.body.code], [406, 'PGRST116']);
  const del = fakePatchItems(items, new URLSearchParams([['id', `eq.${ITEM_TASK_DELETE}`], ['user_id', `eq.${FAKE_USER_ID}`], ['kind', 'eq.task'], ['select', 'id']]).toString(), 'application/json', {status: 'archived'});
  assert.equal(del.status, 200);
  assert.ok(Array.isArray(del.body) && del.body.length === 1);
  const e = fakePatchItems(items, statusQuery(ITEM_TASK_DELETE), OBJ, {status: 'done'});
  assert.equal(e.status, 406);
  assert.deepEqual(rowsOf(items), {[ITEM_SETTLEMENT]: 'done', [ITEM_TASK]: 'pending', [ITEM_NEWS]: 'active', [ITEM_TASK_DELETE]: 'archived'});
});

test('판정: 기대대로면 문제 없음', () => {
  const patch = id => [{method: 'PATCH', path: '/rest/v1/dashboard_items', query: statusQuery(id)}];
  assert.deepEqual(judgeItemsCase(cases.a, {status: 200, bodyText: JSON.stringify({item: {status: 'done'}}), calls: patch(ITEM_SETTLEMENT), rows: {[ITEM_SETTLEMENT]: 'done'}}), []);
  assert.deepEqual(judgeItemsCase(cases.b, {status: 400, bodyText: '{"error":"Invalid payload"}', calls: [], rows: {[ITEM_SETTLEMENT]: 'done'}}), []);
  assert.deepEqual(judgeItemsCase(cases.c, {status: 400, bodyText: '{"error":"Update failed"}', calls: patch(ITEM_NEWS), rows: {[ITEM_NEWS]: 'active'}}), []);
  assert.deepEqual(judgeItemsCase(cases.e1, {status: 200, bodyText: '{"deleted":true}', calls: [], rows: {[ITEM_TASK_DELETE]: 'archived'}}), []);
  assert.deepEqual(judgeItemsCase(cases.e2, {status: 400, bodyText: '{"error":"Update failed"}', calls: patch(ITEM_TASK_DELETE), rows: {[ITEM_TASK_DELETE]: 'archived'}}), []);
});

test('판정: 조건 빠짐·옛 형식 통과·행 되살아남·PATCH 나감을 잡는다', () => {
  const noKind = [{method: 'PATCH', path: '/rest/v1/dashboard_items', query: `id=eq.${ITEM_SETTLEMENT}&user_id=eq.${FAKE_USER_ID}&select=*`}];
  const a = judgeItemsCase(cases.a, {status: 200, bodyText: JSON.stringify({item: {status: 'done'}}), calls: noKind, rows: {[ITEM_SETTLEMENT]: 'done'}});
  assert.ok(a.some(e => e.includes('kind=in.(settlement,task)')));
  assert.ok(a.some(e => e.includes('status=neq.archived')));
  const b = judgeItemsCase(cases.b, {status: 200, bodyText: '{}', calls: noKind, rows: {[ITEM_SETTLEMENT]: 'pending'}});
  assert.equal(b.length, 3);
  const e2 = judgeItemsCase(cases.e2, {status: 200, bodyText: '{"item":{}}', calls: [], rows: {[ITEM_TASK_DELETE]: 'done'}});
  assert.ok(e2.some(e => e.includes('행 …c4 done')));
  assert.ok(judgeItemsCase(cases.d, {status: 400, bodyText: '{}', calls: noKind, rows: {[ITEM_TASK]: 'done'}}).some(e => e.includes('PATCH')));
});

test('가짜 서버는 행을 메모리에 두고 resetItems 로 되돌린다', async () => {
  const fake = await startFakeSupabase();
  try {
    const res = await fetch(`${fake.url}/rest/v1/dashboard_items?${statusQuery(ITEM_TASK)}`, {method: 'PATCH', headers: {authorization: `Bearer ${VALID_ACCESS_TOKEN}`, accept: OBJ, 'content-type': 'application/json'}, body: JSON.stringify({status: 'done'})});
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'done');
    assert.equal(rowsOf(fake.items)[ITEM_TASK], 'done');
    fake.resetItems();
    assert.equal(rowsOf(fake.items)[ITEM_TASK], 'pending');
  } finally { await fake.close(); }
});
