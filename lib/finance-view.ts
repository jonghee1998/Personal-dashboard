import {seoulDay} from './dashboard-freshness.ts';
import {paymentTime} from './transaction-time.ts';

type FinanceTransaction = {
  title: string;
  amount: number | null;
  event_date: string | null;
  metadata: Record<string, unknown>;
  category?: string | null;
  description?: string | null;
};
type CycleStatus = 'ok' | 'no_coverage' | 'amount_missing' | 'no_history';

const DAY_MS = 86_400_000;
const dateAt = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const dayNumber = (date: string) => Date.parse(date) / DAY_MS;
const addDays = (date: string, days: number) =>
  new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
const earlier = (a: string, b: string) => a < b ? a : b;

export function koreanDate(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$)/.test(value)) {
    return value.slice(0, 10);
  }
  const day = seoulDay(value);
  if (!day) throw new RangeError('Invalid finance date');
  return day;
}

export function billingCycle(date: string | Date) {
  const [year, month, day] = koreanDate(date).split('-').map(Number);
  const paymentMonth = month + Number(day >= 9);
  const payDate = dateAt(year, paymentMonth, 21);
  return {
    payMonth: Number(payDate.slice(5, 7)),
    start: dateAt(year, paymentMonth - 1, 9),
    end: dateAt(year, paymentMonth, 8),
    payDate,
  };
}

export function installmentInfo(tx: FinanceTransaction) {
  const m = tx.metadata ?? {};
  const flags = [m.is_installment, m.installment];
  const flagged = flags.some(v => v === true || v === 1 || typeof v === 'string' && /^(true|yes|y|1)$/i.test(v.trim()));
  const months = [m.installment_months, m.installment_total_months, m.installment_count, m.total_installments]
    .map(Number).find(v => Number.isFinite(v) && v > 1);
  const fields = [tx.category, tx.title, tx.description, m.payment_type, m.payment_method, m.payment_plan,
    m.installment_type, m.installment, m.installment_info];
  const installment = flagged || months !== undefined || fields.some(v => typeof v === 'string'
    && !/^(일시불|single|lump.sum|false|no|0)$/i.test(v.trim())
    && (/할부|installment/i.test(v) || /\b\d+\s*\/\s*\d+\s*회차\b/.test(v)));
  if (!installment) return {installment, months: null};

  const textMonths = fields.filter(v => typeof v === 'string')
    .map(v => Number(v.match(/(\d+)\s*개월|\d+\s*\/\s*(\d+)\s*회차/)?.slice(1).find(Boolean)))
    .find(v => Number.isFinite(v) && v > 1);
  return {installment, months: months ?? textMonths ?? null};
}

export function installmentLabel(tx: FinanceTransaction) {
  const {installment, months} = installmentInfo(tx);
  if (!installment) return '(일시불)';
  return months === null ? '(할부)' : `(할부 ${months}개월)`;
}

export function detailRows(tx: FinanceTransaction) {
  const candidates = [tx.metadata.line_items, tx.metadata.transactions, tx.metadata.items, tx.metadata.details];
  const raw = candidates.find(Array.isArray);
  if (!raw) return [];
  return raw.filter((value): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)).map(value => {
    const date = typeof value.event_date === 'string' ? value.event_date : typeof value.date === 'string' ? value.date : null;
    return {
      title: String(value.title ?? value.merchant ?? value.name ?? value.description ?? '거래 항목'),
      amount: typeof value.amount === 'number' ? value.amount
        : typeof value.amount === 'string' && value.amount.trim() !== '' && Number.isFinite(Number(value.amount))
          ? Number(value.amount) : null,
      date,
      time: paymentTime({event_date: date, metadata: value}),
    };
  });
}

export function isAggregateWithoutDetail(tx: FinanceTransaction) {
  return detailRows(tx).length === 0 && (/합산|\d+\s*건/.test(tx.title) || Number(tx.metadata.transaction_count ?? 0) > 1);
}

function datedRows<T extends FinanceTransaction>(transactions: readonly T[]) {
  return transactions.flatMap(tx => tx.event_date ? [{tx, date: koreanDate(tx.event_date)}] : []);
}

function historyStart(rows: readonly {date: string}[]) {
  return rows.reduce<string | null>((start, {date}) => start === null ? date : earlier(start, date), null);
}

function rowsBetween<T>(rows: readonly {tx: T; date: string}[], start: string, end: string) {
  return rows.filter(({date}) => date >= start && date <= end).map(({tx}) => tx);
}

function countedEnd(cycle: ReturnType<typeof billingCycle>, today: string, coverageDay: string | null) {
  return coverageDay && coverageDay >= cycle.start ? earlier(earlier(today, coverageDay), cycle.end) : null;
}

function cycleAmounts(items: readonly FinanceTransaction[], unavailable?: 'no_history' | 'no_coverage') {
  let lumpTotal = 0;
  let installmentTotal = 0;
  let missingCount = 0;
  for (const item of items) {
    if (item.amount === null) missingCount++;
    else if (installmentInfo(item).installment) installmentTotal += item.amount;
    else lumpTotal += item.amount;
  }
  const status: CycleStatus = unavailable ?? (missingCount ? 'amount_missing' : 'ok');
  if (status !== 'ok') return {status, total: null, lumpTotal: null, installmentTotal: null, missingCount};
  return {status, total: lumpTotal + installmentTotal, lumpTotal, installmentTotal, missingCount};
}

export function cycleSummary(transactions: readonly FinanceTransaction[], today: string | Date, coverageDay: string | null) {
  const todayDate = koreanDate(today);
  const cycle = billingCycle(todayDate);
  const countedThrough = countedEnd(cycle, todayDate, coverageDay);
  const rows = datedRows(transactions);
  const current = countedThrough
    ? cycleAmounts(rowsBetween(rows, cycle.start, countedThrough))
    : cycleAmounts([], 'no_coverage');

  const prev = billingCycle(addDays(cycle.start, -1));
  const first = historyStart(rows);
  const hasHistory = first !== null && prev.start >= first;
  const previous = hasHistory ? cycleAmounts(rowsBetween(rows, prev.start, prev.end)) : cycleAmounts([], 'no_history');
  let prevSameDayTotal = null;
  if (hasHistory && countedThrough) {
    const elapsed = dayNumber(countedThrough) - dayNumber(cycle.start);
    const compareEnd = earlier(addDays(prev.start, elapsed), prev.end);
    prevSameDayTotal = cycleAmounts(rowsBetween(rows, prev.start, compareEnd)).total;
  }

  return {
    cycle,
    ...current,
    prevStatus: previous.status,
    countedThrough,
    daysLeft: dayNumber(cycle.end) - dayNumber(todayDate),
    prevSameDayTotal,
    prevTotal: previous.total,
    progress: current.total !== null && previous.total
      ? Math.min(1, Math.max(0, current.total / previous.total)) : null,
  };
}

function shortDate(date: string) {
  return `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
}

export function cycleGroups<T extends FinanceTransaction>(
  transactions: readonly T[], today: string | Date, coverageDay: string | null, n = 6,
) {
  const todayDate = koreanDate(today);
  const rows = datedRows(transactions);
  const first = historyStart(rows);
  let cycle = billingCycle(todayDate);
  return Array.from({length: n}, (_, index) => {
    const live = index === 0;
    const end = live ? countedEnd(cycle, todayDate, coverageDay) : cycle.end;
    const items = end ? rowsBetween(rows, cycle.start, end) : [];
    items.sort((a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity));
    const unavailable = !end ? 'no_coverage' : !live && (first === null || cycle.start < first) ? 'no_history' : undefined;
    const {status, total, installmentTotal, missingCount} = cycleAmounts(items, unavailable);
    const group = {
      label: `${cycle.payMonth}월 결제`,
      range: `${shortDate(cycle.start)} – ${shortDate(cycle.end)}`,
      status, total, installmentTotal, missingCount, live, items,
    };
    cycle = billingCycle(addDays(cycle.start, -1));
    return group;
  });
}

/** 월별 줄 금액 문구. 이력이 일부만 있는 주기(no_history 인데 등록 거래가 있음)는 '등록 내역 없음'과 구분한다. */
export function cycleAmountLabel(group: {status: CycleStatus; total: number | null; missingCount: number; items: readonly unknown[]}) {
  const won = (value: number) => value.toLocaleString('ko-KR') + '원';
  if (group.status === 'no_history') {
    return group.items.length ? `미확인 · 이력 일부 (등록 ${group.items.length}건)` : '등록 내역 없음';
  }
  if (group.status === 'amount_missing') return `미확인 · 금액 미등록 ${group.missingCount}건`;
  return group.total === null ? '미확인' : won(group.total);
}

function summarizeDay<T extends FinanceTransaction>(items: readonly T[], covered: boolean) {
  const lumpRows: T[] = [];
  const installmentRows: T[] = [];
  if (!covered) return {status: 'no_coverage' as const, lumpRows, installmentRows, lumpTotal: null};
  let lumpTotal = 0;
  let missing = false;
  for (const item of items) {
    if (installmentInfo(item).installment) installmentRows.push(item);
    else {
      lumpRows.push(item);
      if (item.amount === null) missing = true;
      else lumpTotal += item.amount;
    }
  }
  return missing
    ? {status: 'amount_missing' as const, lumpRows, installmentRows, lumpTotal: null}
    : {status: 'ok' as const, lumpRows, installmentRows, lumpTotal};
}

export function dayRows<T extends FinanceTransaction>(
  transactions: readonly T[], date: string, coverageDay: string | null,
) {
  if (!coverageDay || date > coverageDay) return summarizeDay<T>([], false);
  return summarizeDay(rowsBetween(datedRows(transactions), date, date), true);
}

/** Month and result keys use calendar numbering (January and the first day are 1). */
export function dayTotals(transactions: readonly FinanceTransaction[], year: number, month: number, coverageDay: string | null) {
  const byDate = new Map<string, FinanceTransaction[]>();
  const totals: Record<number, number | null> = {};
  if (coverageDay) {
    for (const {tx, date} of datedRows(transactions)) {
      const rows = byDate.get(date);
      if (rows) rows.push(tx);
      else byDate.set(date, [tx]);
    }
  }
  const lastDay = Number(dateAt(year, month + 1, 0).slice(8, 10));
  for (let day = 1; day <= lastDay; day++) {
    const date = dateAt(year, month, day);
    totals[day] = summarizeDay(byDate.get(date) ?? [], coverageDay !== null && date <= coverageDay).lumpTotal;
  }
  return totals;
}

export function amountTier(value: number) {
  if (value < 30_000) return 'low';
  return value < 70_000 ? 'mid' : 'high';
}

export const manwon = (value: number) => `${Number((value / 10_000).toFixed(1))}만`;

export function memoSearch<T extends FinanceTransaction>(transactions: readonly T[], query: string) {
  const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase();
  const needle = normalize(query);
  const items = needle ? transactions.filter(({metadata}) =>
    typeof metadata.memo === 'string' && normalize(metadata.memo).includes(needle)) : [];
  return {items, total: items.reduce((sum, item) => sum + (item.amount ?? 0), 0)};
}

/** Pass one contiguous segment of plotted coordinates per call. */
export function chartPath(points: readonly {x: number; y: number}[], w: number, h: number) {
  const sorted = points.filter(({x, y}) => Number.isFinite(x) && Number.isFinite(y))
    .map(({x, y}) => ({x: Math.min(w, Math.max(0, x)), y: Math.min(h, Math.max(0, y))}))
    .sort((a, b) => a.x - b.x);
  const path: string[] = [];
  let previous: {x: number; y: number} | undefined;
  for (const point of sorted) {
    if (previous && point.x === previous.x) continue;
    if (!previous) path.push(`M ${point.x} ${point.y}`);
    else {
      const dx = (point.x - previous.x) / 3;
      path.push(`C ${previous.x + dx} ${previous.y} ${point.x - dx} ${point.y} ${point.x} ${point.y}`);
    }
    previous = point;
  }
  return path.join(' ');
}
