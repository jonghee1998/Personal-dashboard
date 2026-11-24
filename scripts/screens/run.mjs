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
      for (let i = 1; i <= 9; i++) {
        const no = String(i).padStart(2, '0');
        if (!heads.some(t => t.trim().startsWith(no + ' ·'))) missing.push(no);
      }
      const svgs = await page.locator('main.archScreen svg[role="img"]').count();
      const {sw, iw} = await page.evaluate(() => ({sw: document.documentElement.scrollWidth, iw: window.innerWidth}));
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
