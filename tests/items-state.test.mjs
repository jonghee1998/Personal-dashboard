// 화면의 상태 변경 도우미: 같은 항목 요청은 한 번에 하나, 실패 복원은 그 행이 아직 낙관적 상태일 때만.
import test from 'node:test';
import assert from 'node:assert/strict';
import {beginStatusChange, endStatusChange, revertStatus} from '../lib/items-state.ts';

const A = '00000000-0000-4000-8000-0000000000b1';
const B = '00000000-0000-4000-8000-0000000000b2';
const rows = () => [{id: A, kind: 'task', title: '합성할일A', status: 'pending'}, {id: B, kind: 'settlement', title: '친구A 정산', status: 'pending'}];
const setStatus = (items, id, status) => items.map(y => (y.id === id ? {...y, status} : y));

test('같은 항목 연속 클릭: 첫 요청이 끝나기 전 두 번째(done→pending)는 보내지 않는다', () => {
  const inFlight = new Set();
  assert.equal(beginStatusChange(inFlight, A), true);   // pending→done 요청 시작
  assert.equal(beginStatusChange(inFlight, A), false);  // 끝나기 전 done→pending 클릭 무시
  endStatusChange(inFlight, A);
  assert.equal(beginStatusChange(inFlight, A), true);   // 끝난 뒤 다시 보낼 수 있음
});

test('다른 항목은 동시에 진행할 수 있다', () => {
  const inFlight = new Set();
  assert.equal(beginStatusChange(inFlight, A), true);
  assert.equal(beginStatusChange(inFlight, B), true);
  endStatusChange(inFlight, A);
  assert.equal(inFlight.has(A), false);
  assert.equal(inFlight.has(B), true);
});

test('일반 실패 → previous 로 복원', () => {
  const optimistic = setStatus(rows(), A, 'done');
  const out = revertStatus(optimistic, A, 'done', 'pending');
  assert.equal(out.find(x => x.id === A).status, 'pending');
  assert.deepEqual(out, rows());
});

test('PATCH 낙관적 변경 → DELETE 성공(archived) → PATCH 실패 → archived 유지', () => {
  let items = setStatus(rows(), A, 'done');        // 낙관적 변경
  items = setStatus(items, A, 'archived');          // removeTask 성공
  const out = revertStatus(items, A, 'done', 'pending');
  assert.equal(out.find(x => x.id === A).status, 'archived');
  assert.equal(out, items);
});

test('다른 행의 그사이 변경은 유지된다', () => {
  let items = setStatus(rows(), A, 'done');
  items = setStatus(items, B, 'done');              // 그사이 다른 행 변경
  const out = revertStatus(items, A, 'done', 'pending');
  assert.equal(out.find(x => x.id === A).status, 'pending');
  assert.equal(out.find(x => x.id === B).status, 'done');
  assert.equal(out[1], items[1]);                   // 같은 객체 그대로
});

test('없는 id → 목록 그대로', () => {
  const items = rows();
  const out = revertStatus(items, '00000000-0000-4000-8000-0000000000b9', 'done', 'pending');
  assert.equal(out, items);
  assert.deepEqual(out, rows());
});
