// 구조 탭 화면 테스트. 빌드된 앱(next build 이후)을 띄워 /demo 에서 표시·가로 넘침을 검사한다.
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '@playwright/test';

const PORT = process.env.PORT || '3100';
const SCREENS_DIR = process.env.SCREENS_DIR || '.screens';
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = [[360, 800], [390, 844], [430, 932]];

if (!existsSync(chromium.executablePath())) {
  console.error('chromium 이 없습니다. npx playwright install chromium 을 먼저 실행하세요');
  process.exit(1);
}
if (!existsSync('.next')) {
  console.error('빌드 결과(.next)가 없습니다. npm run build 를 먼저 실행하세요');
  process.exit(1);
}

mkdirSync(SCREENS_DIR, {recursive: true});
const server = spawn('npx', ['next', 'start', '-p', PORT], {stdio: 'ignore', detached: true});
const stop = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch {} };
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

async function waitReady() {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try { if ((await fetch(`${BASE}/demo`)).status === 200) return; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('/demo 가 60초 안에 200 을 주지 않았습니다');
}

let failed = false;
let browser;
try {
  await waitReady();
  browser = await chromium.launch();
  for (const [w, h] of VIEWPORTS) {
    const label = `${w}x${h}`;
    const page = await browser.newPage({viewport: {width: w, height: h}});
    try {
      await page.goto(`${BASE}/demo`, {waitUntil: 'networkidle'});
      await page.locator('nav.bottom button', {hasText: '구조'}).click();
      await page.locator('section.archSection').first().waitFor();
      const heads = await page.locator('.archKicker').allTextContents();
      const missing = [];
      for (let i = 1; i <= 8; i++) {
        const no = String(i).padStart(2, '0');
        if (!heads.some(t => t.trim().startsWith(no + ' ·'))) missing.push(no);
      }
      const svgs = await page.locator('main.archScreen svg[role="img"]').count();
      const {sw, iw} = await page.evaluate(() => ({sw: document.documentElement.scrollWidth, iw: window.innerWidth}));
      await page.screenshot({path: join(SCREENS_DIR, `arch-${label}.png`), fullPage: true});
      const errs = [];
      if (missing.length) errs.push(`섹션 머리 누락: ${missing.join(',')}`);
      if (svgs < 2) errs.push(`SVG ${svgs}개 (2개 이상 필요)`);
      if (sw > iw) errs.push(`가로 넘침 scrollWidth ${sw} > innerWidth ${iw}`);
      if (errs.length) { failed = true; console.log(`FAIL ${label} ${errs.join('; ')}`); }
      else console.log(`PASS ${label}`);
    } catch (e) {
      failed = true;
      console.log(`FAIL ${label} ${e.message.split('\n')[0]}`);
    } finally { await page.close(); }
  }
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  if (browser) await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);
