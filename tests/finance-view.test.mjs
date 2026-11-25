import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amountTier, billingCycle, chartPath, cycleAmountLabel, cycleGroups, cycleSummary, dayRows, dayTotals,
  detailRows, installmentInfo, installmentLabel, isAggregateWithoutDetail, manwon, memoSearch,
} from '../lib/finance-view.ts';

const tx = (event_date, amount, metadata = {}) => ({
  title: '합성가맹점A', event_date, amount, metadata,
});

test('결제 주기 경계와 한국 날짜 기준 연도 전환', () => {
  assert.deepEqual(['2026-11-08', '2026-11-09', '2026-12-08', '2026-12-09']
    .map(date => billingCycle(date).payMonth), [11, 12, 12, 1]);
  const january = {payMonth: 1, start: '2026-12-09', end: '2027-01-08', payDate: '2027-01-21'};
  for (const date of ['2026-12-09', '2027-01-08', new Date('2026-12-08T15:00:00Z')]) {
    assert.deepEqual(billingCycle(date), january);
  }
});

test('수집 지연 이후 거래는 이번 주기와 일별 집계에서 제외', () => {
  const rows = [tx('2026-10-09', 10), tx('2026-10-10', 20), tx('2026-10-12', 40),
    tx('2026-11-10', 15), tx('2026-11-11', 99)];
  const summary = cycleSummary(rows, '2026-11-12', '2026-11-10');
  assert.equal(summary.status, 'ok');
  assert.equal(summary.countedThrough, '2026-11-10');
  assert.equal(summary.daysLeft, 26);
  assert.equal(summary.total, 15);
  assert.equal(summary.prevSameDayTotal, 30);
  assert.equal(summary.prevTotal, 70);
  assert.equal(summary.progress, 15 / 70);
  assert.deepEqual(cycleGroups(rows, '2026-11-12', '2026-11-10', 2)
    .map(({label, range, total, live, items}) => ({label, range, total, live, items})), [
    {label: '12월 결제', range: '11.9 – 12.8', total: 15, live: true, items: [rows[3]]},
    {label: '11월 결제', range: '10.9 – 11.8', total: 70, live: false, items: [rows[2], rows[1], rows[0]]},
  ]);
  assert.equal(dayTotals(rows, 2026, 11, '2026-11-10')[11], null);
  assert.deepEqual(dayRows(rows, '2026-11-11', '2026-11-10'),
    {status: 'no_coverage', lumpRows: [], installmentRows: [], lumpTotal: null});
});

test('수집 범위 없음은 이번 주기 합계와 경과일 비교에 전파', () => {
  const rows = [tx('2026-10-09', 50), tx('2026-11-10', 25)];
  for (const coverage of [null, '2026-11-08']) {
    const summary = cycleSummary(rows, '2026-11-12', coverage);
    assert.equal(summary.status, 'no_coverage');
    for (const key of ['total', 'lumpTotal', 'installmentTotal', 'countedThrough', 'prevSameDayTotal', 'progress']) {
      assert.equal(summary[key], null, key);
    }
    assert.equal(summary.prevTotal, 50);
    const [group] = cycleGroups(rows, '2026-11-12', coverage);
    assert.equal(group.status, 'no_coverage');
    assert.equal(group.total, null);
    assert.equal(group.installmentTotal, null);
    assert.deepEqual(group.items, []);
  }
  const totals = dayTotals(rows, 2026, 11, null);
  for (let day = 1; day <= 30; day++) {
    assert.equal(totals[day], null);
    assert.equal(dayRows(rows, `2026-11-${String(day).padStart(2, '0')}`, null).status, 'no_coverage');
  }
});

test('금액 미등록 거래와 비교 범위 밖의 지난 주기 금액 미등록을 구분', () => {
  const rows = [tx('2026-10-09', 50), tx('2026-10-15', null), tx('2026-11-10', null)];
  const summary = cycleSummary(rows, '2026-11-12', '2026-11-12');
  assert.equal(summary.status, 'amount_missing');
  assert.equal(summary.prevStatus, 'amount_missing');
  for (const key of ['total', 'lumpTotal', 'installmentTotal', 'prevTotal', 'progress']) assert.equal(summary[key], null, key);
  assert.equal(summary.missingCount, 1);
  assert.equal(summary.prevSameDayTotal, 50);
  assert.equal(cycleSummary(rows, '2026-11-15', '2026-11-15').prevSameDayTotal, null);
  for (const group of cycleGroups(rows, '2026-11-12', '2026-11-12', 2)) {
    assert.equal(group.status, 'amount_missing');
    assert.equal(group.total, null);
    assert.equal(group.installmentTotal, null);
    assert.equal(group.missingCount, 1);
    assert.ok(group.items.some(row => row.amount === null));
  }
  const day = dayRows(rows, '2026-11-10', '2026-11-12');
  assert.equal(day.status, 'amount_missing');
  assert.equal(day.lumpTotal, null);
  assert.equal(day.lumpTotal, dayTotals(rows, 2026, 11, '2026-11-12')[10]);
  assert.deepEqual(day.lumpRows, [rows[2]]);
});

test('같은 경과일 비교는 짧은 지난 주기 끝에서 자름', () => {
  const rows = [tx('2027-02-09', 10), tx('2027-03-08', 20), tx('2027-03-09', 100)];
  const summary = cycleSummary(rows, '2027-04-08', '2027-04-08');
  assert.equal(summary.prevSameDayTotal, 30);
  assert.equal(summary.prevTotal, 30);
  assert.equal(summary.total, 100);
  assert.equal(summary.progress, 1);
});

test('주기는 할부를 포함하고 일별 합계는 일시불만 집계', () => {
  const rows = [tx('2026-11-10', 12000, {line_items: [{title: '합성가맹점B', amount: '12000'}]}),
    tx('2026-11-10', 30000, {installment_months: '3'})];
  const day = dayRows(rows, '2026-11-10', '2026-11-12');
  assert.deepEqual(day, {status: 'ok', lumpRows: [rows[0]], installmentRows: [rows[1]], lumpTotal: 12000});
  assert.equal(day.lumpTotal, dayTotals(rows, 2026, 11, '2026-11-12')[10]);
  assert.equal(dayTotals(rows, 2026, 11, '2026-11-12')[12], 0);
  const summary = cycleSummary(rows, '2026-11-12', '2026-11-12');
  assert.equal(summary.total, 42000);
  assert.equal(summary.lumpTotal, 12000);
  assert.equal(summary.installmentTotal, 30000);
  assert.deepEqual(detailRows(rows[0]), [{title: '합성가맹점B', amount: 12000, date: null, time: null}]);
  const unknownInstallment = [...rows, tx('2026-11-10', null, {installment: true})];
  assert.equal(dayTotals(unknownInstallment, 2026, 11, '2026-11-12')[10], 12000);
  assert.equal(cycleSummary(unknownInstallment, '2026-11-12', '2026-11-12').status, 'amount_missing');
});

test('지난 주기 이력 없음, 등록 0건, 일부 등록 내역을 구분', () => {
  const current = tx('2026-11-10', 25);
  const undated = tx(null, 100);
  for (const rows of [[current, undated], [undated]]) {
    const summary = cycleSummary(rows, '2026-11-12', '2026-11-12');
    assert.equal(summary.prevStatus, 'no_history');
    for (const key of ['prevTotal', 'prevSameDayTotal', 'progress']) assert.equal(summary[key], null, key);
    const groups = cycleGroups(rows, '2026-11-12', '2026-11-12');
    assert.equal(groups.length, 6);
    assert.equal(groups[1].status, 'no_history');
    assert.equal(groups[1].total, null);
    assert.ok(groups.every(group => !group.items.includes(undated)));
  }
  const partial = tx('2026-10-10', 25);
  const rows = [current, partial];
  const [, group] = cycleGroups(rows, '2026-11-12', '2026-11-12');
  assert.equal(group.status, 'no_history');
  assert.equal(group.total, null);
  assert.equal(group.installmentTotal, null);
  assert.deepEqual(group.items, [partial]);
  assert.equal(cycleAmountLabel(group), '미확인 · 이력 일부 (등록 1건)');
  assert.equal(cycleAmountLabel(cycleGroups([current], '2026-11-12', '2026-11-12')[1]), '등록 내역 없음');
  const older = [current, tx('2026-10-08', 10)];
  const empty = cycleSummary(older, '2026-11-12', '2026-11-12');
  assert.equal(empty.prevStatus, 'ok');
  assert.equal(empty.prevTotal, 0);
  assert.equal(empty.progress, null);
  assert.equal(cycleGroups(older, '2026-11-12', '2026-11-12')[1].total, 0);
  assert.equal(cycleAmountLabel(cycleGroups(older, '2026-11-12', '2026-11-12')[1]), '0원'); // pii-allow 합성 금액
});

test('할부 판정과 표시, 상세 없는 합산 거래', () => {
  const lump = tx(null, 10, {payment_type: '일시불'});
  const installment = tx(null, 10, {installment_total_months: '3'});
  const unknown = tx(null, 10, {installment: ' YES '});
  assert.deepEqual(installmentInfo(lump), {installment: false, months: null});
  assert.deepEqual(installmentInfo(installment), {installment: true, months: 3});
  assert.deepEqual(installmentInfo(unknown), {installment: true, months: null});
  assert.equal(installmentLabel(lump), '(일시불)');
  assert.equal(installmentLabel(installment), '(할부 3개월)');
  assert.equal(installmentLabel(unknown), '(할부)');
  assert.equal(installmentInfo({...lump, description: '할부'}).installment, true);
  assert.equal(isAggregateWithoutDetail(tx(null, 10, {transaction_count: '2'})), true);
  assert.equal(isAggregateWithoutDetail(tx(null, 10, {transaction_count: 2, details: [{amount: 10}]})), false);
});

test('금액 단계와 만원 표기', () => {
  assert.deepEqual([29999, 30000, 69999, 70000].map(amountTier), ['low', 'mid', 'mid', 'high']);
  assert.deepEqual([12000, 10000, 168000].map(manwon), ['1.2만', '1만', '16.8만']);
});

test('메모 검색은 공백과 대소문자를 무시하고 부모 금액을 합산', () => {
  const match = tx(null, 20, {memo: '합성  Sample A'});
  const rows = [match, tx(null, 30, {memo: '합성 Sample B'}), tx(null, 40)];
  assert.deepEqual(memoSearch(rows, '  sAm PlE a  '), {items: [match], total: 20});
  assert.deepEqual(memoSearch(rows, ' \t '), {items: [], total: 0});
});

test('차트 경로는 증가하는 x와 영역 안의 y를 사용', () => {
  assert.equal(chartPath([], 60, 30), '');
  assert.equal(chartPath([{x: 3, y: 40}], 60, 30), 'M 3 30');
  const path = chartPath([{x: 50, y: 100}, {x: 1, y: -5}, {x: 25, y: 15}], 60, 30);
  assert.match(path, /^M .* C .* C /);
  const values = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  for (let i = 0; i < values.length; i += 2) {
    assert.ok(values[i] >= 0 && values[i] <= 60);
    assert.ok(values[i + 1] >= 0 && values[i + 1] <= 30);
    if (i > 0) assert.ok(values[i] > values[i - 2]);
  }
});
