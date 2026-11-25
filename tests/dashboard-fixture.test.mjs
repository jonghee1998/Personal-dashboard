import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {isDashboardSnapshot, monitoredSources, registeredCoverageDay, seoulDay} from '../lib/dashboard-freshness.ts';
import {dashboardSnapshot, FIXTURE_DAY, FIXTURE_NEWS_CATEGORY, FIXTURE_NEWS_CATEGORY_B, FIXTURE_NOW, FIXTURE_PREVIOUS_DAY, FIXTURE_TEXT} from '../scripts/screens/dashboard-fixture.mjs';
import {firstDomDifference} from '../scripts/screens/dom-skeleton.mjs';

const TABS = ['home', 'finance', 'news', 'benefits', 'journal'];

test('합성 대시보드 응답은 isDashboardSnapshot 을 통과한다', () => {
  assert.equal(isDashboardSnapshot(dashboardSnapshot()), true);
});

test('필요한 kind 가 모두 있고 benefit 은 points·ai_subscription 을 갖는다', () => {
  const {items} = dashboardSnapshot();
  for (const kind of ['transaction', 'settlement', 'news', 'benefit', 'task', 'event'])
    assert.ok(items.some(x => x.kind === kind), `${kind} 없음`);
  for (const category of ['points', 'ai_subscription'])
    assert.ok(items.some(x => x.kind === 'benefit' && x.category === category), `benefit ${category} 없음`);
  assert.ok(items.some(x => x.kind === 'task' && x.title === '합성할일A'));
  assert.ok(items.some(x => x.kind === 'news' && x.title === '합성뉴스A' && x.category === '합성분류A'));
  assert.equal(FIXTURE_NEWS_CATEGORY, '합성분류A');
});

test('뉴스 칩 전환 검사용으로 서로 다른 뉴스 분류가 두 개 있다', () => {
  const news = dashboardSnapshot().items.filter(x => x.kind === 'news');
  assert.deepEqual([...new Set(news.map(x => x.category))].sort(), [FIXTURE_NEWS_CATEGORY, FIXTURE_NEWS_CATEGORY_B]);
  assert.ok(news.some(x => x.title === FIXTURE_TEXT.newsB && x.category === FIXTURE_NEWS_CATEGORY_B));
});

test('홈·뉴스 탭은 분류 이모지·글자 아이콘을 쓰지 않고 할 일 삭제는 aria-label 을 갖는다', () => {
  for (const f of ['home-tab.tsx', 'news-tab.tsx']) {
    const src = readFileSync(`components/dashboard/${f}`, 'utf8');
    assert.ok(!/[⌂▤▣✦◷⌘↗◎›⌄×]/.test(src), f);
    assert.ok(!src.includes('newsCategoryEmoji'), f);
  }
  const home = readFileSync('components/dashboard/home-tab.tsx', 'utf8');
  assert.ok(home.includes("aria-label={x.title+' 삭제'}"));
  assert.ok(home.includes('cycleSummary(transactions,today,coverageDay)'));
});

test('FIXTURE_DAY 는 FIXTURE_NOW 의 한국 날짜이고 지난달 합성 거래가 한 건 있다', () => {
  assert.equal(seoulDay(FIXTURE_NOW), FIXTURE_DAY);
  const {items, syncHealth} = dashboardSnapshot();
  const transactions = items.filter(x => x.kind === 'transaction');
  assert.ok(transactions.some(x => x.event_date === FIXTURE_DAY && x.amount > 0 && x.title === '합성가맹점A'));
  const previous = transactions.filter(x => x.event_date && x.event_date.slice(0, 7) === FIXTURE_PREVIOUS_DAY.slice(0, 7));
  assert.equal(previous.length, 1);
  const [record] = previous;
  assert.equal(record.kind, 'transaction');
  assert.equal(record.title, FIXTURE_TEXT.previousMerchant);
  assert.equal(record.event_date, FIXTURE_PREVIOUS_DAY);
  assert.equal(record.amount, 8000);
  assert.deepEqual(record.metadata, {payment_type: '일시불', memo: '합성정산메모B 정산'});
  for (const x of items) if (x.due_date) assert.equal(x.due_date, FIXTURE_DAY);
  assert.equal(registeredCoverageDay(syncHealth.transactions.last_source_at, transactions.map(x => x.event_date), new Date(FIXTURE_NOW)), FIXTURE_DAY);
});

test('syncHealth 는 감시 출처 네 키가 current 이고 하나라도 빠지면 거부된다', () => {
  for (const {key} of monitoredSources) {
    const snap = dashboardSnapshot();
    assert.equal(snap.syncHealth[key].state, 'current');
    delete snap.syncHealth[key];
    assert.equal(isDashboardSnapshot(snap), false, `${key} 를 지워도 통과함`);
  }
});

test('합성 응답에 example.invalid 밖의 http(s) URL 이 없다', () => {
  const urls = JSON.stringify(dashboardSnapshot()).match(/https?:\/\/[^"\s]+/g) ?? [];
  for (const url of urls) assert.equal(new URL(url).hostname, 'example.invalid', url);
});

test('dom-baseline.json 이 있고 다섯 탭 뼈대를 갖는다', () => {
  const path = 'scripts/screens/dom-baseline.json';
  assert.ok(existsSync(path));
  const baseline = JSON.parse(readFileSync(path, 'utf8'));
  for (const tab of TABS) {
    assert.ok(baseline[tab], `${tab} 없음`);
    assert.equal(typeof baseline[tab].tag, 'string');
    assert.ok(Array.isArray(baseline[tab].children));
  }
  assert.equal(firstDomDifference(baseline, baseline, TABS), null);
});

test('DOM 뼈대 비교는 처음 달라진 경로를 돌려준다', () => {
  const leaf = className => ({tag: 'section', className, children: []});
  const tree = (cls) => ({tag: 'div', className: 'shell uiV2', children: [{tag: 'main', className: '', children: [leaf('a'), leaf('b'), leaf(cls)]}]});
  const base = Object.fromEntries(TABS.map(t => [t, tree('c')]));
  const changed = {...base, finance: tree('x')};
  assert.match(firstDomDifference(base, changed, TABS), /^finance > main > section\[2\]\.className/);
  const fewer = {...base, news: {tag: 'div', className: 'shell uiV2', children: []}};
  assert.match(firstDomDifference(base, fewer, TABS), /^news\.children/);
  const {journal, ...missing} = base;
  assert.match(firstDomDifference(missing, base, TABS), /^journal/);
});

test('app/page.tsx 는 force-dynamic 이고 env 검사·getUser·/login 이동을 유지한다', () => {
  const src = readFileSync('app/page.tsx', 'utf8');
  assert.match(src, /^export const dynamic = 'force-dynamic';$/m);
  assert.ok(src.includes("if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return <main style={{padding:40}}>Supabase 환경변수를 설정해 주세요.</main>;"));
  assert.ok(src.includes('const {data:{user}}=await db.auth.getUser();'));
  assert.ok(src.includes("if(!user)redirect('/login');"));
});

// 지운 /demo 는 run.mjs 의 404 확인 요청 한 곳에서만 쓴다(화면 검사 대상으로 쓰지 않는다).
const DEMO_404_FETCH = "fetch(`${BASE}/demo`, {redirect: 'manual'})";
test('화면 검사 스크립트는 /demo 를 404 확인 말고는 쓰지 않는다', () => {
  for (const f of ['run.mjs', 'api-auth.mjs', 'api-log.mjs', 'api-ingest.mjs', 'api-items.mjs', 'dashboard-fixture.mjs', 'dom-skeleton.mjs'])
    assert.ok(!readFileSync(`scripts/screens/${f}`, 'utf8').replaceAll(DEMO_404_FETCH, '').replaceAll('GET /demo', '').includes('/demo'), f);
  assert.equal(readFileSync('scripts/screens/run.mjs', 'utf8').split(DEMO_404_FETCH).length - 1, 1, 'run.mjs 에 GET /demo 404 확인이 한 번 있어야 함');
});

const sourceFiles = dir => readdirSync(dir, {recursive: true}).map(String).filter(f => /\.tsx?$/.test(f)).map(f => join(dir, f));
test('데모 경로·데이터·옛 화면이 지워졌고 데모 분기 이름이 남지 않았다', () => {
  for (const p of ['app/demo', 'lib/demo-data.ts', 'components/dashboard.tsx']) assert.equal(existsSync(p), false, p);
  const files = ['app', 'components', 'lib'].flatMap(sourceFiles);
  assert.ok(files.includes(join('components', 'dashboard', 'dashboard-shell.tsx')));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const name of ['isDemo', 'demoData', 'demo-data', 'SAMPLE_UPDATED_AT', 'demoBanner']) assert.ok(!src.includes(name), `${f}: ${name}`);
  }
});

test('헤더는 운영 문구만 쓴다', () => {
  const src = readFileSync('components/dashboard/dashboard-shell.tsx', 'utf8');
  for (const text of ['DB 저장 · ', '원본 기준 · ', 'aria-label="로그아웃"']) assert.ok(src.includes(text), text);
  for (const text of ['샘플 업데이트', '샘플 기준', '샘플 초기화', '운영 대시보드로 이동', 'resetDemo']) assert.ok(!src.includes(text), text);
});

test('혜택 포인트 로그는 오늘 날짜를 사용한다', () => {
  const src = readFileSync('components/dashboard/benefits-tab.tsx', 'utf8');
  assert.ok(src.includes('const pointLogDate=pointToday();'));
});
