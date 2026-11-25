// 화면 검사(run.mjs)용 합성 /api/dashboard 응답. 값은 전부 가짜다(실데이터·운영 주소 없음).
// 일별 지출 차트·달력은 브라우저의 '오늘'을 기준으로 그리므로, run.mjs 는 page.clock.setFixedTime(FIXTURE_NOW) 로
// 시계를 고정한다. 기본 날짜는 FIXTURE_DAY, 지난달 거래는 FIXTURE_PREVIOUS_DAY 를 사용한다.

/** 고정 시각(한국 시간 2026-11-12 12:00) */
export const FIXTURE_NOW = '2026-11-12T03:00:00.000Z';
/** FIXTURE_NOW 의 한국 날짜 */
export const FIXTURE_DAY = '2026-11-12';
export const FIXTURE_PREVIOUS_DAY = '2026-10-20';
export const FIXTURE_NEWS_CATEGORY = '합성분류A';
/** 탭별 대표 합성 문구 (run.mjs 탭 검사) */
export const FIXTURE_TEXT = {
  task: '합성할일A',
  merchant: '합성가맹점A',
  installment: '합성가맹점C',
  previousMerchant: '합성가맹점D',
  aggregateMerchant: '합성가맹점E',
  undatedMerchant: '합성가맹점F',
  news: '합성뉴스A',
  points: '합성포인트A',
  event: '합성일정A',
};

/** FIXTURE_DAY 안의 한국 시각 → ISO */
const at = hhmm => `${FIXTURE_DAY}T${hhmm}:00+09:00`;
const id = n => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;

function item(n, fields) {
  return {
    id: id(n), description: null, amount: null, currency: 'KRW', status: 'pending', category: null, source: null,
    due_date: null, event_date: null, url: null, metadata: {}, updated_at: at('10:00'), ...fields,
  };
}

const monitoredKeys = ['transactions', 'samsungPoints', 'naverPoints', 'news'];

/** isDashboardSnapshot 을 통과하는 합성 응답 {items, updates, sourceUpdates, syncHealth} */
export function dashboardSnapshot() {
  const items = [
    item(1, {kind: 'transaction', title: FIXTURE_TEXT.merchant, amount: 12000, status: 'confirmed', category: '합성지출분류A', source: '합성카드A', event_date: FIXTURE_DAY, metadata: {payment_type: '일시불', paid_at: at('09:30')}}),
    item(2, {kind: 'settlement', title: '친구A 정산', amount: 5000, category: '정산', source: '친구A', due_date: FIXTURE_DAY, event_date: FIXTURE_DAY}),
    item(3, {kind: 'news', title: FIXTURE_TEXT.news, description: '합성 요약문A', status: 'unread', category: FIXTURE_NEWS_CATEGORY, source: '합성언론A', event_date: FIXTURE_DAY, url: 'https://example.invalid/news-a', metadata: {full_body: '합성 본문A'}}),
    item(4, {kind: 'benefit', title: FIXTURE_TEXT.points, amount: 3000, status: 'active', category: 'points', source: FIXTURE_TEXT.points, event_date: FIXTURE_DAY, metadata: {provider: FIXTURE_TEXT.points, previous_balance: 2500}}),
    item(5, {kind: 'benefit', title: '합성구독A', amount: 10000, status: 'active', category: 'ai_subscription', source: '합성구독A', event_date: FIXTURE_DAY, metadata: {billing_day: 12, plan: '합성요금제A'}}),
    item(6, {kind: 'task', title: FIXTURE_TEXT.task, category: '할 일', source: '직접 추가', due_date: FIXTURE_DAY, event_date: FIXTURE_DAY}),
    item(7, {kind: 'event', title: FIXTURE_TEXT.event, description: '합성 일정 설명A', status: 'active', category: '일정', source: '합성달력A', event_date: FIXTURE_DAY}),
    item(8, {kind: 'transaction', title: FIXTURE_TEXT.installment, amount: 30000, status: 'confirmed', category: '합성지출분류A', source: '합성카드A', event_date: FIXTURE_DAY, metadata: {installment_months: 3, paid_at: at('09:00')}}),
    item(9, {kind: 'transaction', title: FIXTURE_TEXT.previousMerchant, amount: 8000, status: 'confirmed', category: '합성지출분류B', source: '합성카드A', event_date: FIXTURE_PREVIOUS_DAY, metadata: {payment_type: '일시불', memo: '합성정산메모B 정산'}}),
    item(11, {kind: 'transaction', title: FIXTURE_TEXT.aggregateMerchant, amount: 15000, status: 'confirmed', category: '합성지출분류A', source: '합성카드A', event_date: '2026-11-11', metadata: {line_items: [
      {title: '합성하위항목A', amount: 6000, date: '2026-11-11', time: '09:10'},
      {title: '합성하위항목B', amount: 9000, date: '2026-11-11', time: '09:20'},
    ]}}),
    item(12, {kind: 'transaction', title: FIXTURE_TEXT.undatedMerchant, amount: 3000, status: 'confirmed', category: '합성지출분류A', source: '합성카드A'}),
  ];
  const stamp = at('10:00');
  const tabs = ['home', 'finance', 'news', 'benefits', 'journal', 'subscriptions', 'points', 'applications'];
  const updates = Object.fromEntries(tabs.map(k => [k, stamp]));
  const sourceUpdates = Object.fromEntries(tabs.map(k => [k, at('09:30')]));
  const syncHealth = Object.fromEntries(monitoredKeys.map(k => [k, {
    state: 'current', last_source_at: at('09:30'), last_attempt_at: at('09:40'), last_status: 'succeeded',
  }]));
  return {items, updates, sourceUpdates, syncHealth};
}
