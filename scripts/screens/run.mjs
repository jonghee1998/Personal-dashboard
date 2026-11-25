// 화면 테스트. 빌드된 앱(next build 이후)을 가짜 Supabase env 로 띄우고, 합성 세션 쿠키로 로그인한 / 를 연다.
// /api/dashboard 는 브라우저에서 합성 응답(dashboard-fixture.mjs)으로 가로채고, 시계는 FIXTURE_NOW 로 고정한다.
// 검사: 무세션 / → /login, 구조 탭(섹션·SVG·넘침·짝·겹침·잘림), 다섯 탭 대표 문구·가로 넘침, DOM 뼈대 기준선 비교,
// 데이터 경계 검사(①~⑦: 조회 실패·401·지연, 상태·할 일·메모 쓰기와 중복 방지), api 인증·로그·수신·항목 검사.
// 하나라도 실패하면 exit 1.
// 기준선 갱신: SCREENS_UPDATE_BASELINE=1 npm run screens (화면 마크업을 일부러 바꿀 때만)
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium, expect} from '@playwright/test';
import {createInterface} from 'node:readline';
import {checkApiAuth, fakeAppEnv, startFakeSupabase, validSessionCookie} from './api-auth.mjs';
import {checkApiLogs} from './api-log.mjs';
import {checkApiIngest} from './api-ingest.mjs';
import {checkApiItems} from './api-items.mjs';
import {dashboardSnapshot, FIXTURE_DAY, FIXTURE_NEWS_CATEGORY, FIXTURE_NOW, FIXTURE_TEXT} from './dashboard-fixture.mjs';
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
    const panel = page.locator('section.dailySpendingPanel');
    if (!await visible(panel)) return ['일별 지출 패널 없음'];
    const errs = [];
    if (!await panel.locator('svg path').count()) errs.push('일별 지출 패널에 차트 svg path 없음');
    if (await panel.getByText('선택 월의 확인된 지출 내역이 없습니다').count()) errs.push('일별 지출 패널이 빈 안내를 표시');
    const [, m, d] = FIXTURE_DAY.split('-').map(Number);
    const hit = panel.locator(`.dailyHit[aria-label^="${m}월 ${d}일, 지출 "]`);
    if (!await hit.count()) return [...errs, `${m}월 ${d}일 점 버튼 없음`];
    await hit.first().click();
    if (!await visible(panel.locator('.dailyDetails', {hasText: FIXTURE_TEXT.merchant}))) errs.push(`.dailyDetails 에 '${FIXTURE_TEXT.merchant}' 없음`);
    return errs;
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
  if (id === 'benefits') return await visible(main.locator('.pointProvider', {hasText: FIXTURE_TEXT.points})) ? [] : [`'${FIXTURE_TEXT.points}' 포인트 항목 없음`];
  if (id === 'journal') return await visible(page.locator('.calendarAgendaEntry', {hasText: FIXTURE_TEXT.event})) ? [] : [`기록 일정 '${FIXTURE_TEXT.event}' 없음`];
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
    await page.locator('button.newsNavCard').click();
    await expect(category(page)).toBeVisible();
    await expect(detail(page)).toHaveCount(0);
    await expect(category(page)).toHaveAttribute('aria-expanded', 'false');
    await category(page).click();
    await expect(category(page)).toHaveAttribute('aria-expanded', 'true');
    await article(page).click();
    await expect(detail(page).getByRole('heading', {name: FIXTURE_TEXT.news, exact: true})).toBeVisible();
  };

  await run('금융 메모 초안 유지', async page => {
    await clickTab(page, '금융');
    await page.locator('.financeSeg button', {hasText: '메모'}).click();
    const entry = page.locator('.memoEntry', {hasText: FIXTURE_TEXT.merchant});
    await entry.locator('button.memoRead').click();
    const draft = entry.getByRole('textbox', {name: FIXTURE_TEXT.merchant + ' 메모', exact: true});
    await draft.fill('합성메모초안A');
    await clickTab(page, '홈');
    await clickTab(page, '금융');
    await expect(draft).toHaveValue('합성메모초안A');
  });

  await run('홈 뉴스 카드 → 목록 → 분류 펼침 → 상세', openHomeNews);

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
  const memoEntry = page => page.locator('.memoEntry', {hasText: FIXTURE_TEXT.merchant});
  const editMemo = async page => {
    await clickTab(page, '금융');
    await page.locator('.financeSeg button', {hasText: '메모'}).click();
    await memoEntry(page).locator('button.memoRead').click();
    const area = memoEntry(page).locator(`textarea[aria-label="${FIXTURE_TEXT.merchant} 메모"]`);
    await area.fill(MEMO_A);
    await memoEntry(page).locator('button.memoSave').click();
    return area;
  };
  const memoBody = log => { const p = log.filter(x => x.method === 'PATCH'); return p.length === 1 && same(p[0].body, memoRequest) ? [] : [`PATCH 본문 ${JSON.stringify(p.map(x => x.body))}`]; };
  await boundary(browser, '경계 ⑦ 메모 PATCH 200 → 편집창 닫힘·합성메모A 표시', {dashboard: okDashboard(), items: (route, e) => route.fulfill(e.method === 'PATCH' && same(e.body, memoRequest) ? json(200, {item: {...merchant, metadata: {...merchant.metadata, memo: MEMO_A}}}) : json(500, {}))}, async (page, log) => {
    const open = await openDashboard(page);
    if (open.length) return open;
    const area = await editMemo(page);
    const errs = [...memoBody(log)];
    try { await area.waitFor({state: 'detached', timeout: 5_000}); } catch { errs.push('편집창이 닫히지 않음'); }
    if (!await visible(memoEntry(page).locator('button.memoRead', {hasText: MEMO_A}))) errs.push(`저장된 메모 '${MEMO_A}' 안 보임`);
    if (await errorBox(page).count()) errs.push(`오류 표시: ${await errorBox(page).first().textContent()}`);
    return errs;
  });
  await boundary(browser, '경계 ⑦ 메모 PATCH 500 → 초안 유지·오류', {dashboard: okDashboard()}, async (page, log) => {
    const open = await openDashboard(page);
    if (open.length) return open;
    const area = await editMemo(page);
    const errs = [];
    if (!await visible(errorBox(page).filter({hasText: '거래 메모를 저장하지 못했습니다'}))) errs.push("'거래 메모를 저장하지 못했습니다' 안 보임");
    errs.push(...memoBody(log));
    if (await area.inputValue().catch(() => null) !== MEMO_A) errs.push(`입력란에 '${MEMO_A}' 초안이 남지 않음`);
    return errs;
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
        fail('DOM 뼈대 비교', [`${BASELINE_PATH} 없음 (SCREENS_UPDATE_BASELINE=1 로 먼저 기록)`]);
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
