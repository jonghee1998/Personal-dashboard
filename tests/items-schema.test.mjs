// PATCH /api/items 스키마: 옛 형식 없음, 상태는 pending·done 만. 그리고 route·화면 정적 검사.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {itemPatchSchema} from '../lib/items-schema.ts';

const ID = '00000000-0000-4000-8000-0000000000c1';
const ok = v => itemPatchSchema.safeParse(v).success;
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('status pending·done 통과', () => {
  assert.equal(ok({action: 'status', id: ID, status: 'done'}), true);
  assert.equal(ok({action: 'status', id: ID, status: 'pending'}), true);
});

test('옛 형식 {id,status}(action 없음) 거부', () => {
  assert.equal(ok({id: ID, status: 'done'}), false);
});

test('status archived·active 거부', () => {
  assert.equal(ok({action: 'status', id: ID, status: 'archived'}), false);
  assert.equal(ok({action: 'status', id: ID, status: 'active'}), false);
});

test('memo 400자 통과, 401자 거부', () => {
  assert.equal(ok({action: 'memo', id: ID, memo: '가'.repeat(400)}), true);
  assert.equal(ok({action: 'memo', id: ID, memo: '가'.repeat(401)}), false);
});

test('id 가 uuid 아니면 거부', () => {
  assert.equal(ok({action: 'status', id: 'not-a-uuid', status: 'done'}), false);
  assert.equal(ok({action: 'memo', id: '123', memo: '합성메모'}), false);
});

test('route: legacySchema 없음, status update 에 kind·archived 조건', () => {
  const src = read('app/api/items/route.ts');
  assert.ok(!src.includes('legacySchema'));
  assert.ok(src.includes('itemPatchSchema'));
  const line = src.split('\n').find(l => l.includes('.update({status:input.status})'));
  assert.ok(line, 'status update 줄 없음');
  assert.ok(line.includes(".in('kind',['settlement','task'])"));
  assert.ok(line.includes(".neq('status','archived')"));
  assert.ok(line.includes(".eq('id',input.id).eq('user_id',user.id)"));
});

test('화면: 옛 형식 본문 없음, action:status 사용, 도우미 사용', () => {
  for (const p of ['components/demo-dashboard.tsx']) {
    const src = read(p);
    assert.ok(!src.includes('JSON.stringify({id:x.id,status})'), p);
    assert.ok(src.includes("action:'status'"), p);
    assert.ok(src.includes('setItems(cur=>revertStatus(cur,x.id,status,x.status))'), p);
    assert.ok(src.includes('beginStatusChange(statusInFlight.current,x.id)'), p);
    assert.ok(src.includes('endStatusChange(statusInFlight.current,x.id)'), p);
    assert.ok(!src.includes('setItems(prev)'), p);
  }
});
