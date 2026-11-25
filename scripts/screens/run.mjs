// 화면 테스트. 빌드된 앱(next build 이후)을 가짜 Supabase env 로 띄우고, 합성 세션 쿠키로 로그인한 / 를 연다.
// /api/dashboard 는 브라우저에서 합성 응답(dashboard-fixture.mjs)으로 가로채고, 시계는 FIXTURE_NOW 로 고정한다.
// 검사: 무세션 / → /login, 구조 탭(섹션·SVG·넘침·짝·겹침·잘림), 다섯 탭 대표 문구·가로 넘침, DOM 뼈대 기준선 비교,
// 데이터 경계 검사(①~⑦: 조회 실패·401·지연, 상태·할 일·메모 쓰기와 중복 방지), api 인증·로그·수신·항목 검사.
// 하나라도 실패하면 exit 1.
// 기준선 갱신: npm run screens:baseline (= SCREENS_UPDATE_BASELINE=1, 화면 마크업을 일부러 바꿀 때만)
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium, expect} from '@playwright/test';
import {createInterface} from 'node:readline';
import {checkApiAuth, fakeAppEnv, startFakeSupabase, validSessionCookie} from './api-auth.mjs';
import {checkApiLogs} from './api-log.mjs';
import {checkApiIngest} from './api-ingest.mjs';
import {checkApiItems} from './api-items.mjs';
import {dashboardSnapshot, FIXTURE_DAY, FIXTURE_NEWS_CATEGORY, FIXTURE_NEWS_CATEGORY_B, FIXTURE_NOW, FIXTURE_PREVIOUS_DAY, FIXTURE_TEXT} from './dashboard-fixture.mjs';
import {firstDomDifference} from './dom-skeleton.mjs';

const PORT = process.env.PORT || '3100';
const SCREENS_DIR = process.env.SCREENS_DIR || '.screens';
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = [[360, 800], [390, 844], [430, 932]];
const BASELINE_PATH = 'scripts/screens/dom-baseline.json';
const BASELINE_WIDTH = 390;
const UPDATE_BASELINE = process.env.SCREENS_UPDATE_BASELINE === '1';
/** 하단 탭: [id, 버튼 글자] */
const TABS = [['home', '홈'], ['finance', '금융'], ['news', '뉴스'], ['benefits', '혜택'], ['journal', '기록']];

if (!existsSync(chromium.executablePath())) {
  console.error('chromium 이 없습니다. npx playwright install chromium 을 먼저 실행하세요');
  process.exit(1);
}
if (!existsSync('.next')) {
  console.error('빌드 결과(.next)가 없습니다. npm run build 를 먼저 실행하세요');
  process.exit(1);
}

mkdirSync(SCREENS_DIR, {recursive: true});
// 가짜 Supabase 서버와 가짜 env 는 next start 전에 준비해 자식 프로세스에 넘긴다.
const fake = await startFakeSupabase();
// 서버 출력(stdout·stderr)은 화면에 내보내지 않고 줄 단위로 serverLogs 에 모은다(api 로그 검사용).
const server = spawn('npx', ['next', 'start', '-p', PORT], {stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: {...process.env, ...fakeAppEnv(fake.url)}});
const serverLogs = [];
for (const stream of [server.stdout, server.stderr]) createInterface({input: stream, crlfDelay: Infinity}).on('line', line => serverLogs.push(line));
const stop = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch {} };
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitReady() {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try { if ((await fetch(`${BASE}/login`)).status === 200) return; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('/login 이 60초 안에 200 을 주지 않았습니다');
}

/** 합성 세션 쿠키·고정 시계·합성 /api/dashboard 를 갖춘 새 페이지 */
async function sessionPage(browser, w, h) {
  const context = await browser.newContext({viewport: {width: w, height: h}});
  const raw = validSessionCookie(fake.url);
  const eq = raw.indexOf('=');
  await context.addCookies([{name: raw.slice(0, eq), value: raw.slice(eq + 1), url: BASE}]);
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(FIXTURE_NOW));
  await page.route('**/api/dashboard', route => route.request().method() === 'GET'
    ? route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(dashboardSnapshot())})
    : route.continue());
  return {context, page};
}

/** / 를 열고 로그인 화면이 아니며 홈 탭에 합성 할 일이 보이는지 확인 → 문제 목록 */
async function openDashboard(page) {
  await page.goto(`${BASE}/`, {waitUntil: 'networkidle'});
  if (new URL(page.url()).pathname === '/login') return ['합성 세션 / 가 /login 으로 이동'];
  try { await page.locator('main', {hasText: FIXTURE_TEXT.task}).first().waitFor({state: 'visible', timeout: 15_000}); }
  catch { return [`홈 탭에 '${FIXTURE_TEXT.task}' 없음`]; }
  return [];
}

const clickTab = (page, label) => page.locator('nav.bottom button', {hasText: label}).click();
const overflow = page => page.evaluate(() => ({sw: document.documentElement.scrollWidth, iw: window.innerWidth}));

/** 기존 구조 탭 검사 → 문제 목록 */
/** 계산된 스타일 검사(새 디자인 바탕): body·카드·하단 탭·선택 탭·SVG 아이콘, 옛 탭 글자 대비 */
async function checkComputedStyles(page) {
  await clickTab(page, '홈');
  const r = await page.evaluate(() => {
    const cs = el => getComputedStyle(el);
    const card = document.querySelector('.shell.uiV2 .panel') || document.querySelector('.shell.uiV2 .metric');
    const nav = document.querySelector('nav.bottom');
    const active = nav && nav.querySelector('button.active');
    return {
      body: cs(document.body).backgroundColor,
      card: card ? {shadow: cs(card).boxShadow, image: cs(card).backgroundImage, border: cs(card).borderTopColor} : null,
      nav: nav ? {bg: cs(nav).backgroundColor, shadow: cs(nav).boxShadow} : null,
      activeColor: active ? cs(active).color : null,
      svgs: nav ? nav.querySelectorAll('button svg').length : 0,
    };
  });
  const errs = [];
  if (r.body !== 'rgb(255, 255, 255)') errs.push(`body 배경 ${r.body}`);
  if (!r.card) errs.push('홈 카드 없음');
  else {
    if (r.card.shadow !== 'none') errs.push(`카드 box-shadow ${r.card.shadow}`);
    if (r.card.image !== 'none') errs.push(`카드 background-image ${r.card.image}`);
    if (r.card.border !== 'rgb(235, 235, 235)') errs.push(`카드 테두리 ${r.card.border}`);
  }
  if (!r.nav) errs.push('nav.bottom 없음');
  else {
    if (r.nav.bg !== 'rgb(11, 11, 12)') errs.push(`하단 탭 배경 ${r.nav.bg}`);
    if (r.nav.shadow !== 'none') errs.push(`하단 탭 box-shadow ${r.nav.shadow}`);
  }
  if (r.activeColor !== 'rgb(255, 255, 255)') errs.push(`선택 탭 글자 ${r.activeColor}`);
  if (r.svgs !== 6) errs.push(`하단 탭 svg ${r.svgs}개 (기대 6)`);
  // 옛 탭 글자 대비(뉴스 상세·기록 달력·혜택 포인트 줄): 4.5:1 이상
  for (const [id, label] of [['news', '뉴스'], ['benefits', '혜택'], ['journal', '기록']]) {
    await clickTab(page, label);
    const low = await page.evaluate(() => {
      const parse = c => { const m = c.match(/[\d.]+/g).map(Number); return {c: m.slice(0, 3), a: m.length > 3 ? m[3] : 1}; };
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bgOf = el => { for (let e = el; e; e = e.parentElement) { const p = parse(getComputedStyle(e).backgroundColor); if (p.a > 0.5) return p.c; } return [255, 255, 255]; };
      const out = [];
      for (const el of document.querySelectorAll('.newsDetail *, .journalCalendar *, .pointRow, .pointRow *, .pointSummary *, .calendarAgendaEntry *, .applicationItem *')) {
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const box = el.getBoundingClientRect(); if (!box.width || !box.height) continue;
        const [hi, lo] = [lum(parse(getComputedStyle(el).color).c), lum(bgOf(el))].sort((x, y) => y - x);
        const ratio = (hi + 0.05) / (lo + 0.05);
        if (ratio < 4.5) out.push(`${el.className || el.tagName} ${ratio.toFixed(2)}`);
      }
      return out.slice(0, 5);
    });
    if (low.length) errs.push(`${id} 탭 글자 대비 4.5 미만: ${low.join(', ')}`);
  }
  return errs;
}

async function checkArchitecture(page, label) {
  await clickTab(page, '구조');
  await page.locator('section.archSection').first().waitFor();
  const heads = await page.locator('.archKicker').allTextContents();
  const missing = [];
  for (let i = 1; i <= 9; i++) {
    const no = String(i).padStart(2, '0');
    if (!heads.some(t => t.trim().startsWith(no + ' ·'))) missing.push(no);
  }
  const svgs = await page.locator('main.archScreen svg[role="img"]').count();
  const {sw, iw} = await overflow(page);
  const check = await page.evaluate(PAIRS => {
    const out = {pairs: [], overlaps: [], clipped: []};
    const sections = [...document.querySelectorAll('section.archSection')];
    // 짝 검사: 번호가 밀린 섹션이 원래 내용 컴포넌트를 그대로 갖고 있는지
    for (const [head, text] of PAIRS) {
      const sec = sections.find(s => s.querySelector('.archKicker')?.textContent.trim() === head);
      if (!sec || !sec.textContent.includes(text)) out.pairs.push(`${head} 섹션에 '${text}' 없음`);
    }
    // 목표 구조 SVG: 상자 글자가 자기 rect 안, 서로 다른 상자 rect 끼리 겹치지 않음
    const svg = sections[0]?.querySelector('svg[role="img"]');
    const boxes = svg ? [...svg.querySelectorAll('g.archBox')] : [];
    if (!boxes.length) out.overlaps.push('목표 구조 SVG 상자 없음');
    const rects = boxes.map(g => {
      const r = g.querySelector('rect');
      const v = n => Number(r.getAttribute(n));
      return {x: v('x'), y: v('y'), w: v('width'), h: v('height'), name: g.textContent};
    });
    boxes.forEach((g, i) => {
      const r = rects[i];
      for (const t of g.querySelectorAll('text')) {
        const b = t.getBBox();
        if (b.x < r.x || b.y < r.y || b.x + b.width > r.x + r.w || b.y + b.height > r.y + r.h)
          out.overlaps.push(`'${t.textContent}' 글자가 상자 밖`);
      }
    });
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        out.overlaps.push(`상자 겹침: ${a.name} / ${b.name}`);
    }
    // 패널(overflow hidden) 안에서 잘림 없음
    for (const el of document.querySelectorAll('main.archScreen .archTable, main.archScreen .archBody'))
      if (el.scrollWidth > el.clientWidth) out.clipped.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
    return out;
  }, [['02 · 요약', '피클AI 수집기가 카드·뉴스·혜택·일정 데이터를'], ['07 · API', '/api/ingest']]);
  await page.screenshot({path: join(SCREENS_DIR, `arch-${label}.png`), fullPage: true});
  const errs = [];
  if (missing.length) errs.push(`섹션 머리 누락: ${missing.join(',')}`);
  if (svgs < 3) errs.push(`SVG ${svgs}개 (3개 이상 필요)`);
  if (sw > iw) errs.push(`가로 넘침 scrollWidth ${sw} > innerWidth ${iw}`);
  if (check.pairs.length) errs.push(`짝 불일치: ${check.pairs.join(', ')}`);
  if (check.overlaps.length) errs.push(`목표 구조 겹침: ${check.overlaps.join(', ')}`);
  if (check.clipped.length) errs.push(`패널 안 잘림: ${check.clipped.join(', ')}`);
  return errs;
}

const visible = async (locator, timeout = 5_000) => {
  try { await locator.first().waitFor({state: 'visible', timeout}); return true; } catch { return false; }
};

/** 탭 하나의 대표 합성 문구 검사 → 문제 목록 */
async function checkTabContent(page, id) {
  const main = page.locator('div.demoShell > main');
  if (id === 'home') return await visible(main.locator('.taskPanel', {hasText: FIXTURE_TEXT.task})) ? [] : [`'${FIXTURE_TEXT.task}' 없음`];
  if (id === 'finance') {
    const chart = main.locator('.dailyChart');
    const cycle = main.locator('.financeCycle');
    const details = main.locator('.dailyDetails');
    const calendar = main.locator('.financeCalendar');
    const [, m, d] = FIXTURE_DAY.split('-').map(Number);
    const nextDay = new Date(Date.parse(FIXTURE_DAY) + 86_400_000).toISOString().slice(0, 10);
    const paymentDay = calendar.locator(`[data-date="${FIXTURE_DAY}"]`);
    const unconfirmedDay = calendar.locator(`[data-date="${nextDay}"]`);
    const formatWon = amount => `${amount.toLocaleString('ko-KR')}원`;
    const lumpAmount = formatWon(12000);

    await expect(chart).toBeVisible();
    expect(await chart.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const paths = await chart.locator('path.dailyLine').evaluateAll(lines => lines.map(line => line.getAttribute('d')));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const coordinates = [...path.matchAll(/(?:M|C) ([^MC]+)/g)]
        .flatMap(([, values]) => values.trim().split(/\s+/).map(Number).filter((_, i) => i % 2 === 0));
      expect(coordinates.length).toBeGreaterThan(1);
      expect(coordinates.every((x, i) => Number.isFinite(x) && (i === 0 || x > coordinates[i - 1]))).toBe(true);
    }
    await expect(cycle).toContainText('결제 예정');
    await expect(cycle.locator('.financeCycleTotal')).toHaveText(formatWon(57000));
    await expect(cycle.locator('.financeCycleSplit')).toContainText(`할부 ${formatWon(30000)}`);
    await expect(cycle.getByText('지난 주기 등록 내역 없음', {exact: true})).toBeVisible();
    await expect(cycle.getByText('지난 주기 비교 없음', {exact: true})).toBeVisible();
    await expect(cycle.locator('progress')).toHaveCount(0);
    const hit = chart.getByRole('button', {name: `${m}월 ${d}일, 지출 ${lumpAmount}`, exact: true});
    await chart.getByRole('button', {name: `${m}월 1일, 지출 0원`, exact: true}).click();
    await expect(details.locator('.dailyDetailsTotal')).toHaveText('0원');
    await hit.click();
    await expect(chart.locator('.dailyMarker')).toHaveCount(1);
    await expect(chart.locator('.dailyTooltip text')).toHaveText(`${d}일 · 1.2만원`);
    await expect(hit).toHaveAttribute('aria-pressed', 'true');
    await expect(paymentDay).toHaveAttribute('aria-pressed', 'true');
    await expect(paymentDay.locator('.financeCalendarAmount')).toHaveText('1.2만');
    await expect(details.locator('.dailyDetailsTotal')).toHaveText(lumpAmount);
    const rows = details.locator('.dailyTransactionWrap');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(FIXTURE_TEXT.merchant);
    await expect(rows.last()).toContainText(FIXTURE_TEXT.installment);
    await expect(rows.last().locator('.dailyInstallment')).toHaveText('(할부 3개월) · 일 합계 제외');

    await unconfirmedDay.click();
    await expect(unconfirmedDay).toHaveAttribute('aria-pressed', 'true');
    await expect(unconfirmedDay.locator('.financeCalendarAmount')).toHaveCount(0);
    await expect(chart.locator('.dailyPoint')).toHaveCount(0);
    await expect(details.locator('.dailyDetailsTotal')).toHaveText('미확인');
    await expect(details.getByText('수집 확인 전')).toBeVisible();
    await expect(rows).toHaveCount(0);
    await paymentDay.click();
    await expect(hit).toHaveAttribute('aria-pressed', 'true');
    await expect(details.locator('.dailyDetailsTotal')).toHaveText(lumpAmount);
    return [];
  }
  if (id === 'news') {
    const toggle = main.locator(`.newsCategoryToggle[aria-label="${FIXTURE_NEWS_CATEGORY} 카테고리 펼치기"]`);
    if (!await visible(toggle)) return [`'${FIXTURE_NEWS_CATEGORY}' 카테고리 펼치기 버튼 없음`];
    const article = main.locator('.newsListButton', {hasText: FIXTURE_TEXT.news});
    const errs = [];
    if (await article.count()) errs.push('분류를 펼치기 전에 기사 목록이 그려짐');
    await toggle.click();
    const opened = main.locator(`.newsCategoryToggle[aria-label="${FIXTURE_NEWS_CATEGORY} 카테고리 접기"]`);
    if (await opened.getAttribute('aria-expanded').catch(() => null) !== 'true') errs.push("펼친 뒤 aria-expanded 가 'true' 가 아님");
    if (!await visible(article)) errs.push(`.newsListButton 에 '${FIXTURE_TEXT.news}' 없음`);
    return errs;
  }
  if (id === 'benefits') {
    const errs = [];
    if (!await visible(main.locator('.pointRow', {hasText: FIXTURE_TEXT.points}))) errs.push(`'${FIXTURE_TEXT.points}' 포인트 항목 없음`);
    const delta = (await main.locator('.pointSummaryDelta').textContent().catch(() => '')) ?? '';
    if (!delta.includes('어제보다 +500P')) errs.push(`'(어제보다 +500P)' 없음: ${delta}`); // pii-allow
    for (const label of ['대기', '합격', '불합격']) if (!await visible(main.locator('.applicationCounts span', {hasText: new RegExp(`^${label}$`)}))) errs.push(`신청 숫자 칸 '${label}' 없음`);
    return errs;
  }
  if (id === 'journal') {
    const errs = [];
    if (!await visible(page.locator('.calendarAgendaEntry', {hasText: FIXTURE_TEXT.event}))) errs.push(`기록 일정 '${FIXTURE_TEXT.event}' 없음`);
    const dots = await page.locator(`.journalCalendar [data-date="${FIXTURE_DAY}"] .journalDot`).evaluateAll(list => list.map(x => x.getAttribute('data-kind')));
    for (const kind of ['event', 'task', 'news', 'point']) if (!dots.includes(kind)) errs.push(`${FIXTURE_DAY} 종류 점 '${kind}' 없음 (${dots.join(',')})`);
    if (!await visible(page.locator('.journalLegend'))) errs.push('기록 달력 범례 없음');
    return errs;
  }
  return [`알 수 없는 탭 ${id}`];
}

/** .demoShell(없으면 body) 아래 요소 트리 {tag, className, children}. 글자·style·좌표·path d 는 넣지 않는다. */
const domSkeleton = page => page.evaluate(() => {
  const walk = el => ({tag: el.tagName.toLowerCase(), className: el.getAttribute('class') ?? '', children: [...el.children].map(walk)});
  return walk(document.querySelector('.demoShell') ?? document.body);
});

// ── 데이터 경계 검사(390 폭). 각 검사는 새 페이지에서 /api/dashboard·/api/items 를 가로채 합성 응답만 쓴다. ──
const TASK_B = '합성할일B';
const MEMO_A = '합성메모A';
const fixtureItem = title => dashboardSnapshot().items.find(x => x.title === title);
const previousDraft = '합성메모초안C';
const financeDay = (page, date) => page.locator(`.financeCalendar [data-date="${date}"]`);
const dayMemoArea = (page, title) => page.getByRole('textbox', {name: title + ' 결제 메모', exact: true});
const memoButton = (section, title, action) => section.getByRole('button', {name: title + ' 메모 ' + action, exact: true});
const monthly = page => page.locator('.financeMonthly');
const monthlyRow = (page, title) => monthly(page).locator('.financeTransaction', {hasText: title});
async function openPreviousDayMemo(page) {
  await clickTab(page, '금융');
  await page.getByRole('button', {name: '이전 달'}).click();
  await expect(page.locator('.financeCalendar [aria-pressed="true"]')).toHaveCount(0);
  await financeDay(page, FIXTURE_PREVIOUS_DAY).click();
  await expect(page.locator('.dailyDetailsTotal')).toHaveText('8,000원');
  await page.getByRole('button', {name: FIXTURE_TEXT.previousMerchant + ' 메모 수정', exact: true}).click();
  const area = dayMemoArea(page, FIXTURE_TEXT.previousMerchant);
  await area.fill(previousDraft);
  return area;
}

/** 합성할일B: 할 일 추가 성공 응답·두 번째 할 일 */
const taskB = () => ({...fixtureItem(FIXTURE_TEXT.task), id: '00000000-0000-4000-8000-000000000910', title: TASK_B, kind: 'task', status: 'pending', due_date: null, event_date: null, metadata: {created_manually: true}});
const json = (status, body) => ({status, contentType: 'application/json', body: JSON.stringify(body)});
/** 풀릴 때까지 기다리는 문 (지연 route 용) */
function gate() { let open; const wait = new Promise(r => { open = r; }); return {wait, open}; }

/**
 * 경계 검사용 페이지. dashboard(route) 와 items(route, request) 를 직접 넘긴다(기본 합성 응답 route 없음).
 * items 요청은 method·본문을 itemsLog 에 쌓는다.
 */
async function boundaryPage(browser, {dashboard, items}) {
  const context = await browser.newContext({viewport: {width: BASELINE_WIDTH, height: 844}});
  const raw = validSessionCookie(fake.url);
  const eq = raw.indexOf('=');
  await context.addCookies([{name: raw.slice(0, eq), value: raw.slice(eq + 1), url: BASE}]);
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(FIXTURE_NOW));
  const itemsLog = [];
  await page.route('**/api/dashboard', route => route.request().method() === 'GET'
    ? dashboard(route) : route.fulfill(json(405, {error: 'Method not allowed'})));
  await page.route('**/api/items', async route => {
    const req = route.request();
    let body = null;
    try { body = req.postDataJSON(); } catch {}
    const entry = {method: req.method(), body};
    itemsLog.push(entry);
    if (items) return items(route, entry);
    return route.fulfill(json(500, {error: '합성 오류'}));
  });
  return {context, page, itemsLog};
}
const okDashboard = (extra = []) => route => route.fulfill(json(200, (s => ({...s, items: [...s.items, ...extra]}))(dashboardSnapshot())));
const errorBox = page => page.locator('aside.error');
const taskPanel = page => page.locator('.taskPanel');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 한 경계 검사: fn(page, itemsLog, ctx) → 문제 목록. 결과를 PASS/FAIL 로 출력 */
async function boundary(browser, name, routes, fn) {
  const {context, page, itemsLog} = await boundaryPage(browser, routes);
  try {
    const errs = await fn(page, itemsLog);
    if (errs.length) fail(name, errs); else console.log(`PASS ${name}`);
  } catch (e) { fail(name, [e.message.split('\n')[0]]); }
  finally { await context.close(); }
}

async function captureFinanceState(page, filename) {
  // 고정 하단 탭이 펼친 거래를 가리지 않도록 화면 끝에서 전체 페이지를 촬영한다.
  await page.evaluate(() => window.scrollTo({top: document.body.scrollHeight, behavior: 'instant'}));
  await page.screenshot({path: join(SCREENS_DIR, filename), fullPage: true});
}

async function checkTabInteractions(browser) {
  const run = (name, check) => boundary(browser, name, {dashboard: okDashboard()}, async page => {
    const errs = await openDashboard(page);
    if (errs.length) return errs;
    await check(page);
    return [];
  });
  const detail = page => page.locator('article.newsDetail');
  const category = page => page.locator('.newsCategoryToggle', {hasText: FIXTURE_NEWS_CATEGORY});
  const article = page => page.locator('.newsListButton', {hasText: FIXTURE_TEXT.news});
  const openHomeNews = async page => {
    await page.locator('.homeNewsPanel button.homeNewsAll').click();
    await expect(category(page)).toBeVisible();
    await expect(detail(page)).toHaveCount(0);
    await expect(category(page)).toHaveAttribute('aria-expanded', 'false');
    await category(page).click();
    await expect(category(page)).toHaveAttribute('aria-expanded', 'true');
    await article(page).click();
    await expect(detail(page).getByRole('heading', {name: FIXTURE_TEXT.news, exact: true})).toBeVisible();
  };

  await run('금융 월별 진행 주기 기본 펼침·할부 표기', async page => {
    await clickTab(page, '금융');
    const section = monthly(page);
    const toggles = section.locator('.financeGroupToggle');
    await expect(toggles).toHaveCount(6);
    await expect(toggles.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(toggles.first()).toContainText('(할부 30,000원)'); // pii-allow 합성 금액
    await expect(monthlyRow(page, FIXTURE_TEXT.installment).locator('.financeInstallment')).toHaveText('(할부 3개월)');
    await expect(monthlyRow(page, FIXTURE_TEXT.undatedMerchant)).toHaveCount(0);
    await captureFinanceState(page, 'finance-monthly-open-390.png');
  });

  await run('금융 카테고리 부모 금액·하위 항목·날짜 없는 거래', async page => {
    await clickTab(page, '금융');
    const section = page.locator('.financeCategories');
    const toggle = section.getByRole('button', {name: /합성지출분류A/});
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('5건');
    await expect(toggle).toContainText('60,000원'); // pii-allow 합성 금액
    await toggle.click();
    const aggregate = section.locator('.financeTransaction', {hasText: FIXTURE_TEXT.aggregateMerchant});
    const subItems = aggregate.locator('.financeSubItems li');
    await expect(subItems).toHaveText([/합성하위항목A.*2026-11-11 · 09:10.*6,000원/, /합성하위항목B.*2026-11-11 · 09:20.*9,000원/]);
    const undated = section.locator('.financeTransaction', {hasText: FIXTURE_TEXT.undatedMerchant});
    await expect(undated).toContainText('날짜 없음 · 합성카드A');
    const add = memoButton(undated, FIXTURE_TEXT.undatedMerchant, '추가');
    await expect(add).toBeVisible();
    await captureFinanceState(page, 'finance-category-open-390.png');
    await add.click();
    await expect(undated.getByRole('textbox')).toBeEditable();
  });

  await run('금융 메모 검색 결과에서 지난달 20일 선택', async page => {
    await clickTab(page, '금융');
    const section = page.locator('.financeMemoSearch');
    await section.getByRole('searchbox', {name: '메모 검색'}).fill('정산');
    await expect(section.getByRole('status')).toHaveText('"정산" 메모 1건 · 합계 8,000원');
    const result = section.getByRole('button', {name: /합성정산메모B 정산/});
    await expect(result).toBeVisible();
    await captureFinanceState(page, 'finance-memo-search-390.png');
    await result.click();
    await expect(page.locator('.dailyMonthNav strong')).toHaveText('2026.10');
    await expect(financeDay(page, FIXTURE_PREVIOUS_DAY)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.dailyChart [aria-pressed="true"]')).toHaveAttribute('aria-label', '10월 20일, 지출 8,000원');
    await expect(page.locator('.dailyDetails h2')).toHaveText('10월 20일 거래내역');
    const row = section.locator('.financeTransaction', {hasText: FIXTURE_TEXT.previousMerchant});
    await memoButton(row, FIXTURE_TEXT.previousMerchant, '수정').click();
    await expect(row.getByRole('textbox')).toHaveValue('합성정산메모B 정산');
  });

  await run('금융 메모 초안 유지', async page => {
    await clickTab(page, '금융');
    await financeDay(page, FIXTURE_DAY).click();
    await memoButton(page.locator('.dailyDetails'), FIXTURE_TEXT.merchant, '추가').click();
    const draft = dayMemoArea(page, FIXTURE_TEXT.merchant);
    await draft.fill('합성메모초안A');
    await clickTab(page, '홈');
    await clickTab(page, '금융');
    await expect(draft).toHaveValue('합성메모초안A');
  });

  await run('금융 다른 달 그날 내역 초안 유지', async page => {
    const area = await openPreviousDayMemo(page);
    await clickTab(page, '홈');
    await clickTab(page, '금융');
    await expect(page.locator('.dailyMonthNav strong')).toHaveText('2026.10');
    await expect(financeDay(page, FIXTURE_PREVIOUS_DAY)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.dailyDetails h2')).toHaveText('10월 20일 거래내역');
    await expect(area).toHaveValue(previousDraft);
    await page.getByRole('button', {name: '다음 달'}).click();
    await page.getByRole('button', {name: '이전 달'}).click();
    await expect(page.locator('.financeCalendar [aria-pressed="true"]')).toHaveCount(0);
    await financeDay(page, FIXTURE_PREVIOUS_DAY).click();
    await expect(area).toHaveValue(previousDraft);
  });

  await run('홈 뉴스 카드 → 목록 → 분류 펼침 → 상세', openHomeNews);

  await run('혜택 포인트 제공처 줄 펼침 → 증감·사유', async page => {
    await clickTab(page, '혜택');
    const row = page.locator('.pointRow', {hasText: FIXTURE_TEXT.points});
    const head = row.locator('button.pointRowHead');
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(row.locator('.pointDetail')).toHaveCount(0);
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await expect(row.locator('.pointIncreaseReason')).toContainText('+700P');
    await expect(row.locator('.pointIncreaseReason')).toContainText('합성적립사유A');
    await expect(row.locator('.pointDecreaseReason')).toContainText('−200P');
    await expect(row.locator('.pointDecreaseReason')).toContainText('합성사용사유A');
    await expect(row.locator('.pointLogDate')).toHaveText(FIXTURE_DAY.replace(/-/g, '.'));
    await page.evaluate(() => window.scrollTo({top: 0, behavior: 'instant'}));
    await page.screenshot({path: join(SCREENS_DIR, 'benefits-points-open-390.png'), fullPage: true});
    await clickTab(page, '홈');
    await clickTab(page, '혜택');
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'false');
  });

  const pointB = {...fixtureItem(FIXTURE_TEXT.points), id: '00000000-0000-4000-8000-000000000920', title: '합성포인트B', source: '합성포인트B', amount: 100, metadata: {provider: '합성포인트B'}};
  await boundary(browser, '혜택 전일 잔액 없는 포인트 → 어제 잔액 데이터 없음 · 증감 없는 줄은 펼침 버튼 없음', {dashboard: okDashboard([pointB])}, async page => {
    const errs = await openDashboard(page);
    if (errs.length) return errs;
    await clickTab(page, '혜택');
    await expect(page.locator('.pointSummaryDelta')).toHaveText('(어제 잔액 데이터 없음)');
    await expect(page.locator('.pointSummaryDelta')).not.toContainText('어제보다');
    const plain = page.locator('.pointRow', {hasText: '합성포인트B'});
    await expect(plain).toBeVisible();
    await expect(plain.locator('button')).toHaveCount(0);
    await expect(plain.locator('small').first()).toHaveText('전일 데이터 없음');
    await expect(page.locator('.pointRow', {hasText: FIXTURE_TEXT.points}).locator('button.pointRowHead')).toHaveCount(1);
    return [];
  });

  await run('기록 달력 FIXTURE_DAY 종류 점 4가지', async page => {
    await clickTab(page, '기록');
    const dots = page.locator(`.journalCalendar [data-date="${FIXTURE_DAY}"] .journalDot`);
    await expect(dots).toHaveCount(4);
    for (const kind of ['event', 'task', 'news', 'point']) await expect(dots.and(page.locator(`[data-kind="${kind}"]`))).toHaveCount(1);
    await expect(page.locator('.journalLegend span')).toHaveText(['일정', '할 일', '뉴스', '포인트']);
  });

  await run('기록 뉴스 검색 결과 → 바로 상세', async page => {
    await clickTab(page, '기록');
    await page.getByRole('searchbox', {name: '통합 기록 검색'}).fill(FIXTURE_TEXT.news);
    await page.locator('.calendarSearchResult', {hasText: FIXTURE_TEXT.news}).click();
    await expect(detail(page).getByRole('heading', {name: FIXTURE_TEXT.news, exact: true})).toBeVisible();
  });

  await run('뉴스 상세 → 홈 → 뉴스 목록·분류 펼침 유지', async page => {
    await openHomeNews(page);
    await clickTab(page, '홈');
    await clickTab(page, '뉴스');
    await expect(detail(page)).toHaveCount(0);
    await expect(category(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(article(page)).toBeVisible();
  });

  await run('홈 뉴스 항목 → 바로 상세', async page => {
    const items = page.locator('.homeNewsPanel button.homeNewsItem');
    await expect(items).toHaveCount(2);
    await items.filter({hasText: FIXTURE_TEXT.news}).click();
    await expect(detail(page).getByRole('heading', {name: FIXTURE_TEXT.news, exact: true})).toBeVisible();
  });

  await run('뉴스 칩 전환 → 그 분류만 · 전체로 돌아옴', async page => {
    await clickTab(page, '뉴스');
    const chips = page.locator('.newsChips button.newsChip');
    const panels = page.locator('.newsCategoryPanel');
    const chip = name => chips.filter({hasText: new RegExp(`^${name}$`)});
    await expect(chips).toHaveText(['전체', FIXTURE_NEWS_CATEGORY, FIXTURE_NEWS_CATEGORY_B]);
    await expect(chip('전체')).toHaveAttribute('aria-pressed', 'true');
    await expect(panels).toHaveCount(2);
    await chip(FIXTURE_NEWS_CATEGORY_B).click();
    await expect(chip(FIXTURE_NEWS_CATEGORY_B)).toHaveAttribute('aria-pressed', 'true');
    await expect(chip('전체')).toHaveAttribute('aria-pressed', 'false');
    await expect(panels).toHaveCount(1);
    await expect(panels.locator('.newsCategoryName')).toHaveText(FIXTURE_NEWS_CATEGORY_B);
    await chip('전체').click();
    await expect(chip('전체')).toHaveAttribute('aria-pressed', 'true');
    await expect(panels.locator('.newsCategoryName')).toHaveText([FIXTURE_NEWS_CATEGORY, FIXTURE_NEWS_CATEGORY_B]);
  });

  await run('홈 결제 주기 카드 금액 = 금융 탭 카드 금액', async page => {
    const home = page.locator('button.homeCycleCard .homeCycleTotal');
    await expect(home).toHaveText(`${(57000).toLocaleString('ko-KR')}원`);
    const amount = await home.textContent();
    await page.locator('button.homeCycleCard').click();
    await expect(page.locator('nav.bottom button.active')).toHaveText('금융');
    await expect(page.locator('.financeCycle .financeCycleTotal')).toHaveText(amount);
  });

  await run('기록 탭 옛 안내 문구 없음', async page => {
    await clickTab(page, '기록');
    const note = page.locator('p.calendarDemoNote');
    await expect(note).toBeVisible();
    await expect(note).not.toContainText(/가상 데이터|실제 데이터 저장은 아직 연결되지 않았어|🧪/);
  });
}

async function checkDataBoundaries(browser) {
  // ① 첫 조회 200 → 수동 새로고침 500: 오류 + '마지막 조회값 유지 중', 합성할일A 유지
  // ①-2 같은 상황에서 형식이 틀린 200(isDashboardSnapshot 실패)
  for (const [name, bad, message] of [
    ['경계 ① 새로고침 500 → 마지막 스냅샷 유지', route => route.fulfill(json(500, {error: '합성 오류'})), '데이터 조회에 실패했습니다'],
    ['경계 ①-2 새로고침 형식 틀린 200 → 마지막 스냅샷 유지', route => route.fulfill(json(200, {items: '합성형식오류A'})), '불완전한 조회 응답입니다'],
  ]) {
    let calls = 0;
    await boundary(browser, name, {dashboard: route => (++calls === 1 ? okDashboard() : bad)(route)}, async page => {
      const open = await openDashboard(page);
      if (open.length) return open;
      await page.locator('button.refreshButton').click();
      const errs = [];
      if (!await visible(errorBox(page).filter({hasText: '마지막 조회값 유지 중'}).filter({hasText: message}))) errs.push(`'${message} · 마지막 조회값 유지 중' 안 보임`);
      if (!await visible(taskPanel(page).filter({hasText: FIXTURE_TEXT.task}))) errs.push(`'${FIXTURE_TEXT.task}' 사라짐`);
      if (calls < 2) errs.push(`새로고침 요청 없음 (조회 ${calls}번)`);
      return errs;
    });
  }

  // ② PATCH 500 → 체크 되돌림 + '상태 저장에 실패했습니다'
  await boundary(browser, '경계 ② 상태 PATCH 500 → 체크 되돌림·오류', {dashboard: okDashboard()}, async (page, log) => {
    const open = await openDashboard(page);
    if (open.length) return open;
    const check = taskPanel(page).locator(`button.check[aria-label^="${FIXTURE_TEXT.task} "]`);
    await check.click();
    const errs = [];
    if (!await visible(errorBox(page).filter({hasText: '상태 저장에 실패했습니다'}))) errs.push("'상태 저장에 실패했습니다' 안 보임");
    if ((await check.getAttribute('class')).split(' ').includes('checked')) errs.push('체크가 되돌아가지 않음');
    if (await check.getAttribute('aria-label') !== `${FIXTURE_TEXT.task} 완료 표시`) errs.push('aria-label 이 원래대로가 아님');
    const patch = log.filter(x => x.method === 'PATCH');
    if (patch.length !== 1 || !same(patch[0].body, {action: 'status', id: fixtureItem(FIXTURE_TEXT.task).id, status: 'done'})) errs.push(`PATCH 본문 ${JSON.stringify(patch.map(x => x.body))}`);
    return errs;
  });

  // ③ /api/dashboard 401 → /login
  await boundary(browser, '경계 ③ 조회 401 → /login', {dashboard: route => route.fulfill(json(401, {error: 'Unauthorized'}))}, async page => {
    await page.goto(`${BASE}/`);
    try { await page.waitForURL(url => new URL(url).pathname === '/login', {timeout: 15_000}); return []; }
    catch { return [`${new URL(page.url()).pathname} 에 머묾 (기대 /login)`]; }
  });

  // ④ 조회 응답 전에도 구조 탭은 열린다
  {
    const g = gate();
    await boundary(browser, '경계 ④ 응답 전 구조 탭', {dashboard: async route => { await g.wait; await okDashboard()(route).catch(() => {}); }}, async page => {
      await page.goto(`${BASE}/`, {waitUntil: 'domcontentloaded'});
      const errs = [];
      if (!await visible(page.locator('.loading'), 15_000)) errs.push('로딩 화면이 아님');
      await clickTab(page, '구조');
      if (!await visible(page.locator('section.archSection'))) errs.push('section.archSection 안 보임');
      g.open();
      return errs;
    });
    g.open();
  }

  // ⑤ 할 일 추가: 본문 {title}, 201 + {item} → 목록 반영·입력 비움 / 500 → 입력 유지·오류
  const addTask = async page => {
    await page.locator('button.taskOpenButton').click();
    const input = page.locator('input[aria-label="새 할 일"]');
    await input.fill(TASK_B);
    await page.locator('form.taskAddForm button[type="submit"]').click();
    return input;
  };
  await boundary(browser, '경계 ⑤ 할 일 추가 201 → 목록 반영·입력 비움', {dashboard: okDashboard(), items: (route, e) => route.fulfill(e.method === 'POST' ? json(201, {item: taskB()}) : json(500, {}))}, async (page, log) => {
    const open = await openDashboard(page);
    if (open.length) return open;
    const input = await addTask(page);
    const errs = [];
    if (!await visible(taskPanel(page).locator('.listitem', {hasText: TASK_B}))) errs.push(`목록에 '${TASK_B}' 없음`);
    if (await input.count()) errs.push('추가 뒤 입력 폼이 닫히지 않음');
    await page.locator('button.taskOpenButton').click();
    if (await input.inputValue() !== '') errs.push('다시 연 입력이 비어 있지 않음');
    const post = log.filter(x => x.method === 'POST');
    if (post.length !== 1 || !same(post[0].body, {title: TASK_B})) errs.push(`POST 본문 ${JSON.stringify(post.map(x => x.body))}`);
    return errs;
  });
  await boundary(browser, '경계 ⑤ 할 일 추가 500 → 입력 유지·오류', {dashboard: okDashboard()}, async page => {
    const open = await openDashboard(page);
    if (open.length) return open;
    const input = await addTask(page);
    const errs = [];
    if (!await visible(errorBox(page).filter({hasText: '할 일을 추가하지 못했습니다'}))) errs.push('추가 실패 오류 안 보임');
    if (await input.inputValue().catch(() => null) !== TASK_B) errs.push('입력이 남지 않음');
    if (await taskPanel(page).locator('.listitem', {hasText: TASK_B}).count()) errs.push(`실패했는데 '${TASK_B}' 가 목록에 있음`);
    return errs;
  });

  // ⑤-2 POST 지연 중 반복 제출(Enter·저장 버튼·requestSubmit) → POST 1건
  {
    const g = gate();
    await boundary(browser, '경계 ⑤-2 지연 중 반복 제출 → POST 1건', {dashboard: okDashboard(), items: async (route, e) => { await g.wait; await route.fulfill(e.method === 'POST' ? json(201, {item: taskB()}) : json(500, {})).catch(() => {}); }}, async (page, log) => {
      const open = await openDashboard(page);
      if (open.length) return open;
      const input = await addTask(page);
      for (let i = 0; i < 3; i++) {
        await input.press('Enter').catch(() => {});
        await page.locator('form.taskAddForm button[type="submit"]').click({force: true, timeout: 1_000}).catch(() => {});
        await page.evaluate(() => document.querySelector('form.taskAddForm')?.requestSubmit()).catch(() => {});
      }
      await sleep(300);
      const during = log.filter(x => x.method === 'POST').length;
      g.open();
      const errs = [];
      if (!await visible(taskPanel(page).locator('.listitem', {hasText: TASK_B}))) errs.push(`목록에 '${TASK_B}' 없음`);
      await sleep(300);
      const total = log.filter(x => x.method === 'POST').length;
      if (during !== 1 || total !== 1) errs.push(`POST ${total}건 (지연 중 ${during}건, 기대 1건)`);
      else console.log(`  가로챈 POST ${total}건`);
      return errs;
    });
    g.open();
  }

  // ⑥ 할 일 삭제: 본문 {id}, 200 → 사라짐 / 500 → 남음
  const taskA = fixtureItem(FIXTURE_TEXT.task);
  const deleteButton = (page, title) => taskPanel(page).locator(`button.taskDeleteButton[aria-label="${title} 삭제"]`);
  await boundary(browser, '경계 ⑥ 할 일 삭제 200 → 목록에서 사라짐', {dashboard: okDashboard(), items: (route, e) => route.fulfill(e.method === 'DELETE' ? json(200, {deleted: true}) : json(500, {}))}, async (page, log) => {
    const open = await openDashboard(page);
    if (open.length) return open;
    await deleteButton(page, FIXTURE_TEXT.task).click();
    const errs = [];
    try { await taskPanel(page).locator('.listitem', {hasText: FIXTURE_TEXT.task}).waitFor({state: 'detached', timeout: 5_000}); }
    catch { errs.push(`'${FIXTURE_TEXT.task}' 가 남음`); }
    const del = log.filter(x => x.method === 'DELETE');
    if (del.length !== 1 || !same(del[0].body, {id: taskA.id})) errs.push(`DELETE 본문 ${JSON.stringify(del.map(x => x.body))}`);
    return errs;
  });
  await boundary(browser, '홈 할 일 삭제 버튼 aria-label·선 SVG ✕ → DELETE 본문', {dashboard: okDashboard(), items: (route, e) => route.fulfill(e.method === 'DELETE' ? json(200, {deleted: true}) : json(500, {}))}, async (page, log) => {
    const open = await openDashboard(page);
    if (open.length) return open;
    const errs = [];
    const button = page.getByRole('button', {name: `${FIXTURE_TEXT.task} 삭제`, exact: true});
    if (!await visible(button)) return [`aria-label '${FIXTURE_TEXT.task} 삭제' 버튼 없음`];
    const shape = await button.evaluate(el => ({text: el.textContent.trim(), svg: el.querySelectorAll('svg path').length, fill: el.querySelector('svg')?.getAttribute('fill')}));
    if (shape.text !== '' || shape.svg !== 1 || shape.fill !== 'none') errs.push(`삭제 버튼 모양 ${JSON.stringify(shape)}`);
    await button.click();
    try { await button.waitFor({state: 'detached', timeout: 5_000}); } catch { errs.push(`'${FIXTURE_TEXT.task}' 가 남음`); }
    const del = log.filter(x => x.method === 'DELETE');
    if (del.length !== 1 || !same(del[0].body, {id: taskA.id})) errs.push(`DELETE 본문 ${JSON.stringify(del.map(x => x.body))}`);
    return errs;
  });
  await boundary(browser, '경계 ⑥ 할 일 삭제 500 → 남음', {dashboard: okDashboard()}, async page => {
    const open = await openDashboard(page);
    if (open.length) return open;
    await deleteButton(page, FIXTURE_TEXT.task).click();
    const errs = [];
    if (!await visible(errorBox(page).filter({hasText: '할 일을 삭제하지 못했습니다'}))) errs.push('삭제 실패 오류 안 보임');
    if (!await visible(taskPanel(page).locator('.listitem', {hasText: FIXTURE_TEXT.task}))) errs.push(`'${FIXTURE_TEXT.task}' 가 사라짐`);
    return errs;
  });

  // ⑥-2 DELETE 지연 중 같은 항목·다른 할 일 삭제 반복 → DELETE 1건
  {
    const g = gate();
    await boundary(browser, '경계 ⑥-2 지연 중 반복 삭제 → DELETE 1건', {dashboard: okDashboard([taskB()]), items: async (route, e) => { await g.wait; await route.fulfill(e.method === 'DELETE' ? json(200, {deleted: true}) : json(500, {})).catch(() => {}); }}, async (page, log) => {
      const open = await openDashboard(page);
      if (open.length) return open;
      if (!await visible(deleteButton(page, TASK_B))) return [`두 번째 할 일 '${TASK_B}' 없음`];
      await deleteButton(page, FIXTURE_TEXT.task).click();
      for (let i = 0; i < 3; i++) {
        await deleteButton(page, FIXTURE_TEXT.task).click({force: true, timeout: 1_000}).catch(() => {});
        await deleteButton(page, TASK_B).click({timeout: 1_000}).catch(() => {});
      }
      await sleep(300);
      const during = log.filter(x => x.method === 'DELETE').length;
      g.open();
      const errs = [];
      try { await taskPanel(page).locator('.listitem', {hasText: FIXTURE_TEXT.task}).waitFor({state: 'detached', timeout: 5_000}); }
      catch { errs.push(`'${FIXTURE_TEXT.task}' 가 남음`); }
      await sleep(300);
      const del = log.filter(x => x.method === 'DELETE');
      if (during !== 1 || del.length !== 1) errs.push(`DELETE ${del.length}건 (지연 중 ${during}건, 기대 1건)`);
      else if (!same(del[0].body, {id: taskA.id})) errs.push(`DELETE 본문 ${JSON.stringify(del[0].body)}`);
      else console.log(`  가로챈 DELETE ${del.length}건`);
      if (!await visible(taskPanel(page).locator('.listitem', {hasText: TASK_B}))) errs.push(`'${TASK_B}' 가 사라짐`);
      return errs;
    });
    g.open();
  }

  // ⑦ 거래 메모 PATCH: 본문 {action:'memo', id, memo}, 200 + {item} → 편집창 닫힘·메모 표시 / 500 → 초안 유지·오류
  const merchant = fixtureItem(FIXTURE_TEXT.merchant);
  const memoRequest = {action: 'memo', id: merchant.id, memo: MEMO_A};
  const editMemo = async page => {
    await clickTab(page, '금융');
    const row = monthlyRow(page, FIXTURE_TEXT.merchant);
    await memoButton(row, FIXTURE_TEXT.merchant, '추가').click();
    const area = row.getByRole('textbox', {name: FIXTURE_TEXT.merchant + ' 메모', exact: true});
    await area.fill(MEMO_A);
    await row.locator('.dailyMemoSave').click();
    return area;
  };
  const memoBody = log => { const p = log.filter(x => x.method === 'PATCH'); return p.length === 1 && same(p[0].body, memoRequest) ? [] : [`PATCH 본문 ${JSON.stringify(p.map(x => x.body))}`]; };
  await boundary(browser, '경계 ⑦ 메모 PATCH 200 → 편집창 닫힘·합성메모A 표시', {dashboard: okDashboard(), items: (route, e) => route.fulfill(e.method === 'PATCH' && same(e.body, memoRequest) ? json(200, {item: {...merchant, metadata: {...merchant.metadata, memo: MEMO_A}}}) : json(500, {}))}, async (page, log) => {
    const open = await openDashboard(page);
    if (open.length) return open;
    const area = await editMemo(page);
    const errs = [...memoBody(log)];
    try { await area.waitFor({state: 'detached', timeout: 5_000}); } catch { errs.push('편집창이 닫히지 않음'); }
    if (!await visible(monthlyRow(page, FIXTURE_TEXT.merchant).locator('.financeSavedMemo', {hasText: MEMO_A}))) errs.push(`저장된 메모 '${MEMO_A}' 안 보임`);
    if (await errorBox(page).count()) errs.push(`오류 표시: ${await errorBox(page).first().textContent()}`);
    return errs;
  });
  await boundary(browser, '경계 ⑦ 메모 PATCH 500 → 초안 유지·오류', {dashboard: okDashboard()}, async (page, log) => {
    const open = await openDashboard(page);
    if (open.length) return open;
    const area = await editMemo(page);
    const errs = [];
    if (!await visible(errorBox(page).filter({hasText: '거래 메모를 저장하지 못했습니다'}))) errs.push("'거래 메모를 저장하지 못했습니다' 안 보임");
    await expect(monthlyRow(page, FIXTURE_TEXT.merchant).getByRole('alert')).toContainText('메모 저장에 실패했습니다');
    errs.push(...memoBody(log));
    if (await area.inputValue().catch(() => null) !== MEMO_A) errs.push(`입력란에 '${MEMO_A}' 초안이 남지 않음`);
    return errs;
  });

  const delayedMerchant = fixtureItem(FIXTURE_TEXT.previousMerchant);
  const delayedRequest = {action: 'memo', id: delayedMerchant.id, memo: previousDraft};
  const daySave = page => page.locator('.dailyMemoSave');
  const openPreviousCycle = page => monthly(page).getByRole('button', {name: /11월 결제/}).click();
  const checkDelayedMemo = async (name, changeEditor) => {
    const response = gate();
    await boundary(browser, name, {
      dashboard: okDashboard(),
      items: async (route, entry) => {
        await response.wait;
        const item = {...delayedMerchant, metadata: {...delayedMerchant.metadata, memo: previousDraft}};
        await route.fulfill(entry.method === 'PATCH' && same(entry.body, delayedRequest)
          ? json(200, {item}) : json(500, {}));
      },
    }, async (page, log) => {
      try {
        const open = await openDashboard(page);
        if (open.length) return open;
        const area = await openPreviousDayMemo(page);
        const save = daySave(page);
        // 같은 렌더 안에서 두 번 클릭해 비동기 요청 진입도 중복 차단되는지 검사한다.
        await save.evaluate(button => { button.click(); button.click(); });
        await expect(save).toBeDisabled();
        const verifyEditor = await changeEditor(page, area);
        const pendingResponse = page.waitForResponse(res => res.url().endsWith('/api/items') && res.request().method() === 'PATCH');
        response.open();
        expect((await pendingResponse).status()).toBe(200);
        await verifyEditor();
        expect(log.filter(entry => entry.method === 'PATCH').map(entry => entry.body)).toEqual([delayedRequest]);
        return [];
      } finally {
        response.open();
      }
    });
  };

  await checkDelayedMemo('금융 메모 중복 클릭 PATCH 1회 · 늦은 응답 뒤 다른 거래 편집 유지', async page => {
    await page.getByRole('button', {name: '다음 달'}).click();
    await financeDay(page, FIXTURE_DAY).click();
    await memoButton(page.locator('.dailyDetails'), FIXTURE_TEXT.installment, '추가').click();
    const other = dayMemoArea(page, FIXTURE_TEXT.installment);
    await other.fill('합성메모초안D');
    return async () => {
      // 저장된 값이 화면에 반영된 뒤에도 다른 편집창이 남아 있어야 한다.
      await openPreviousCycle(page);
      await expect(monthlyRow(page, FIXTURE_TEXT.previousMerchant).locator('.financeSavedMemo')).toHaveText(previousDraft);
      await expect(other).toHaveValue('합성메모초안D');
    };
  });
  await checkDelayedMemo('금융 늦은 응답 뒤 같은 거래 새 초안 유지', async (page, area) => {
    await area.fill('합성메모초안E');
    return async () => {
      await expect(daySave(page)).toBeEnabled();
      await expect(area).toHaveValue('합성메모초안E');
    };
  });
  await checkDelayedMemo('금융 늦은 응답 뒤 같은 거래 월별 펼침 재열기 유지', async page => {
    await page.locator('.dailyMemoEditor').getByRole('button', {name: '취소'}).click();
    await openPreviousCycle(page);
    const entry = monthlyRow(page, FIXTURE_TEXT.previousMerchant);
    await memoButton(entry, FIXTURE_TEXT.previousMerchant, '수정').click();
    const area = entry.getByRole('textbox');
    // 같은 초안을 입력해 편집 세션까지 일치해야 닫히는지 검사한다.
    await area.fill(previousDraft);
    await expect(entry.locator('.dailyMemoSave')).toBeDisabled();
    await expect(page.locator('.dailyDetails .dailyMemoEditor')).toHaveCount(0);
    return async () => {
      await expect(entry.locator('.dailyMemoSave')).toBeEnabled();
      await expect(area).toHaveValue(previousDraft);
    };
  });
}

const problems = [];
const fail =(name, errs) => { problems.push(...errs.map(e => `${name}: ${e}`)); console.log(`FAIL ${name} ${errs.join('; ')}`); };
let browser;
try {
  await waitReady();
  browser = await chromium.launch();

  // 쿠키 없는 새 컨텍스트로 / → /login
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}/`, {waitUntil: 'networkidle'});
      const path = new URL(page.url()).pathname;
      if (path === '/login') console.log('PASS 무세션 / → /login');
      else fail('무세션 /', [`${path} 에 머묾 (기대 /login)`]);
    } catch (e) { fail('무세션 /', [e.message.split('\n')[0]]); }
    finally { await context.close(); }
  }

  // 지운 데모 경로는 404
  try {
    const res = await fetch(`${BASE}/demo`, {redirect: 'manual'});
    if (res.status === 404) console.log('PASS GET /demo 404');
    else fail('GET /demo', [`상태 ${res.status} (기대 404)`]);
  } catch (e) { fail('GET /demo', [e.message.split('\n')[0]]); }

  for (const [w, h] of VIEWPORTS) {
    const label = `${w}x${h}`;
    const {context, page} = await sessionPage(browser, w, h);
    try {
      const open = await openDashboard(page);
      if (open.length) { fail(`합성 세션 / ${label}`, open); continue; }
      console.log(`PASS 합성 세션 / ${label}`);
      const arch = await checkArchitecture(page, label);
      if (arch.length) fail(label, arch); else console.log(`PASS ${label}`);
      for (const [id, tabLabel] of TABS) {
        const name = `탭 ${id} ${label}`;
        try {
          await clickTab(page, tabLabel);
          const errs = await checkTabContent(page, id);
          const {sw, iw} = await overflow(page);
          if (sw > iw) errs.push(`가로 넘침 scrollWidth ${sw} > innerWidth ${iw}`);
          await page.screenshot({path: join(SCREENS_DIR, `tab-${id}-${w}.png`), fullPage: true});
          if (errs.length) fail(name, errs); else console.log(`PASS ${name} 대표 문구·가로 넘침`);
        } catch (e) { fail(name, [e.message.split('\n')[0]]); }
      }
      try {
        const errs = await checkComputedStyles(page);
        if (errs.length) fail(`계산된 스타일 ${label}`, errs); else console.log(`PASS 계산된 스타일 ${label}`);
      } catch (e) { fail(`계산된 스타일 ${label}`, [e.message.split('\n')[0]]); }
    } catch (e) {
      fail(label, [e.message.split('\n')[0]]);
    } finally { await context.close(); }
  }

  // DOM 뼈대: 390 폭 새 페이지에서 각 탭 첫 화면(분류 펼치기 등 상호작용 전)
  {
    const {context, page} = await sessionPage(browser, BASELINE_WIDTH, 844);
    try {
      const open = await openDashboard(page);
      if (open.length) throw new Error(open.join('; '));
      const current = {};
      for (const [id, tabLabel] of TABS) {
        await clickTab(page, tabLabel);
        await page.locator('nav.bottom button.active', {hasText: tabLabel}).waitFor();
        await page.waitForLoadState('networkidle');
        current[id] = await domSkeleton(page);
      }
      if (UPDATE_BASELINE) {
        writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 1) + '\n');
        console.log(`기준선 기록 ${BASELINE_PATH}`);
      } else if (!existsSync(BASELINE_PATH)) {
        fail('DOM 뼈대 비교', [`${BASELINE_PATH} 없음 (npm run screens:baseline 으로 먼저 기록)`]);
      } else {
        const diff = firstDomDifference(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')), current, TABS.map(([id]) => id));
        if (diff) fail('DOM 뼈대 비교', [diff]); else console.log('PASS DOM 뼈대 비교');
      }
    } catch (e) { fail('DOM 뼈대 비교', [e.message.split('\n')[0]]); }
    finally { await context.close(); }
  }

  await checkTabInteractions(browser);
  await checkDataBoundaries(browser);

  const api =await checkApiAuth(BASE, fake);
  if (api.problems.length) fail('api 인증 검사', [`${api.problems.length}건`]);
  else console.log(`PASS api 인증 검사 ${api.results.length}건`);
  const logCheck = await checkApiLogs(BASE, fake, serverLogs);
  if (logCheck.problems.length) fail('api 로그 검사', [`${logCheck.problems.length}건`]);
  else console.log(`PASS api 로그 검사 ${logCheck.results.length}건`);
  const ingestCheck = await checkApiIngest(BASE, fake);
  const kResults = ingestCheck.results.filter(result => result.id === 'k');
  const ingestErrors = [];
  if (ingestCheck.problems.length) ingestErrors.push(`판정 오류 ${ingestCheck.problems.length}건`);
  if (kResults.length !== 1) ingestErrors.push(`k 결과 ${kResults.length}건 (기대 1)`);
  else if (kResults[0].errs.length) ingestErrors.push(`k 판정 오류 ${kResults[0].errs.length}건`);
  if (ingestErrors.length) fail('api 수신 검사', ingestErrors);
  else console.log(`PASS api 수신 검사 ${ingestCheck.results.length}건`);
  const itemsCheck = await checkApiItems(BASE, fake);
  if (itemsCheck.problems.length) fail('api 항목 검사', [`${itemsCheck.problems.length}건`]);
  else console.log(`PASS api 항목 검사 ${itemsCheck.results.length}건`);
} catch (e) {
  problems.push(e.message);
  console.error(e.message);
} finally {
  if (browser) await browser.close();
  stop();
  await fake.close();
}
process.exit(problems.length ? 1 : 0);
