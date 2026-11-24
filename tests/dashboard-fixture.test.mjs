import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {isDashboardSnapshot, monitoredSources, registeredCoverageDay, seoulDay} from '../lib/dashboard-freshness.ts';
import {dashboardSnapshot, FIXTURE_DAY, FIXTURE_NEWS_CATEGORY, FIXTURE_NOW} from '../scripts/screens/dashboard-fixture.mjs';
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

test('FIXTURE_DAY 는 FIXTURE_NOW 의 한국 날짜이고 거래는 그날 양수 금액이다', () => {
  assert.equal(seoulDay(FIXTURE_NOW), FIXTURE_DAY);
  const {items, syncHealth} = dashboardSnapshot();
  const transactions = items.filter(x => x.kind === 'transaction');
  assert.ok(transactions.some(x => x.event_date === FIXTURE_DAY && x.amount > 0 && x.title === '합성가맹점A'));
  for (const x of items) for (const d of [x.event_date, x.due_date]) if (d) assert.equal(d, FIXTURE_DAY);
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
  const tree = (cls) => ({tag: 'div', className: 'demoShell', children: [{tag: 'main', className: '', children: [leaf('a'), leaf('b'), leaf(cls)]}]});
  const base = Object.fromEntries(TABS.map(t => [t, tree('c')]));
  const changed = {...base, finance: tree('x')};
  assert.match(firstDomDifference(base, changed, TABS), /^finance > main > section\[2\]\.className/);
  const fewer = {...base, news: {tag: 'div', className: 'demoShell', children: []}};
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

test('화면 검사 스크립트는 /demo 를 쓰지 않는다', () => {
  for (const f of ['run.mjs', 'api-auth.mjs', 'api-log.mjs', 'api-ingest.mjs', 'api-items.mjs', 'dashboard-fixture.mjs', 'dom-skeleton.mjs'])
    assert.ok(!readFileSync(`scripts/screens/${f}`, 'utf8').includes('/demo'), f);
});
