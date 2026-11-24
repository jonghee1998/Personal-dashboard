// 화면 테스트. 빌드된 앱(next build 이후)을 가짜 Supabase env 로 띄우고, 합성 세션 쿠키로 로그인한 / 를 연다.
// /api/dashboard 는 브라우저에서 합성 응답(dashboard-fixture.mjs)으로 가로채고, 시계는 FIXTURE_NOW 로 고정한다.
// 검사: 무세션 / → /login, 구조 탭(섹션·SVG·넘침·짝·겹침·잘림), 다섯 탭 대표 문구·가로 넘침, DOM 뼈대 기준선 비교,
// api 인증·로그·수신·항목 검사. 하나라도 실패하면 exit 1.
// 기준선 갱신: SCREENS_UPDATE_BASELINE=1 npm run screens (화면 마크업을 일부러 바꿀 때만)
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
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

const problems = [];
const fail = (name, errs) => { problems.push(...errs.map(e => `${name}: ${e}`)); console.log(`FAIL ${name} ${errs.join('; ')}`); };
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

  const api = await checkApiAuth(BASE, fake);
  if (api.problems.length) fail('api 인증 검사', [`${api.problems.length}건`]);
  else console.log(`PASS api 인증 검사 ${api.results.length}건`);
  const logCheck = await checkApiLogs(BASE, fake, serverLogs);
  if (logCheck.problems.length) fail('api 로그 검사', [`${logCheck.problems.length}건`]);
  else console.log(`PASS api 로그 검사 ${logCheck.results.length}건`);
  const ingestCheck = await checkApiIngest(BASE, fake);
  if (ingestCheck.problems.length) fail('api 수신 검사', [`${ingestCheck.problems.length}건`]);
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
