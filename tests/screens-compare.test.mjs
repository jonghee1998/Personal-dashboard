// 커밋별 화면 비교 도구 단위 테스트(합성 픽셀·합성 로그만 사용).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {checkPairs, countDiffPixels, decodePng} from '../scripts/screens/compare.mjs';
import {EXPECTED_SCREENS} from '../scripts/screens/expected.mjs';
import {dirtyOutsideOrch, keepDirFor} from '../scripts/screens/snap-ref.mjs';
import {findBaseSha} from '../scripts/screens/base-sha.mjs';

const image = (w, h, rgba = [255, 255, 255, 255]) => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return {width: w, height: h, data};
};
const withPixel = (img, index, rgba) => { const data = img.data.slice(); data.set(rgba, index * 4); return {...img, data}; };

test('countDiffPixels: 같으면 0, 채널 차이 16 이하는 무시, 17 이상은 1픽셀', () => {
  const a = image(4, 3);
  assert.equal(countDiffPixels(a.data, image(4, 3).data, 4, 3), 0);
  assert.equal(countDiffPixels(a.data, withPixel(a, 5, [239, 255, 255, 255]).data, 4, 3), 0);
  assert.equal(countDiffPixels(a.data, withPixel(a, 5, [255, 255, 238, 255]).data, 4, 3), 1);
  assert.equal(countDiffPixels(a.data, withPixel(a, 0, [255, 255, 255, 0]).data, 4, 3), 1);
});

const NAMES = ['tab-a-390.png', 'tab-b-390.png'];
const side = entries => new Map(entries);

test('checkPairs: 모두 같으면 통과', () => {
  const r = checkPairs(NAMES, side(NAMES.map(n => [n, image(100, 20)])), side(NAMES.map(n => [n, image(100, 20)])));
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 2);
  assert.equal(r.maxRatio, 0);
});

test('checkPairs: 1픽셀 다름은 허용치(0.1%) 안이면 통과, 넘으면 실패', () => {
  const a = image(100, 20); // 2000픽셀 → 1픽셀 = 0.05%
  const r = checkPairs(['x.png'], {'x.png': a}, {'x.png': withPixel(a, 7, [0, 0, 0, 255])});
  assert.equal(r.ok, true);
  assert.equal(r.results[0].diff, 1);
  assert.equal(r.maxName, 'x.png');
  const small = image(10, 10); // 100픽셀 → 1픽셀 = 1%
  const over = checkPairs(['x.png'], {'x.png': small}, {'x.png': withPixel(small, 0, [0, 0, 0, 255])});
  assert.equal(over.ok, false);
  assert.match(over.results[0].reason, /허용치 초과/);
  assert.equal(over.maxRatio, 0.01);
});

test('checkPairs: 크기 다르면 실패', () => {
  const r = checkPairs(['x.png'], {'x.png': image(10, 10)}, {'x.png': image(10, 11)});
  assert.equal(r.ok, false);
  assert.match(r.results[0].reason, /크기 다름/);
});

test('checkPairs: 한쪽에만 파일이 없으면 실패', () => {
  const r = checkPairs(NAMES, side(NAMES.map(n => [n, image(5, 5)])), side([[NAMES[0], image(5, 5)]]));
  assert.equal(r.ok, false);
  assert.equal(r.results[1].reason, 'B 파일 없음');
  const r2 = checkPairs(['x.png'], {}, {'x.png': image(5, 5)});
  assert.equal(r2.ok, false);
  assert.equal(r2.results[0].reason, 'A 파일 없음');
});

test('checkPairs: 양쪽 모두 같은 파일이 없어도 실패', () => {
  const r = checkPairs(NAMES, side([[NAMES[0], image(5, 5)]]), side([[NAMES[0], image(5, 5)]]));
  assert.equal(r.ok, false);
  assert.equal(r.results[1].reason, '양쪽 파일 없음');
  assert.equal(checkPairs(['x.png'], {}, {}).ok, false);
});

test('checkPairs: 지연 해독 함수도 받는다', () => {
  const r = checkPairs(['x.png'], {'x.png': () => image(3, 3)}, {'x.png': () => image(3, 3)});
  assert.equal(r.ok, true);
});

test('decodePng: 합성 RGB·RGBA PNG 를 RGBA 로 해독(필터 0·1·2)', () => {
  const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (kind, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const kb = Buffer.from(kind, 'latin1');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([kb, body])));
    return Buffer.concat([len, kb, body, c]);
  };
  const png = (w, h, type, rows) => {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = type;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows.flat()))), chunk('IEND', Buffer.alloc(0))]);
  };
  // RGB 2x2: 첫 줄 필터 0, 둘째 줄 필터 2(위와 같음 → 0 차이)
  const rgb = decodePng(png(2, 2, 2, [[0, 10, 20, 30, 40, 50, 60], [2, 0, 0, 0, 0, 0, 0]]));
  assert.deepEqual([...rgb.data], [10, 20, 30, 255, 40, 50, 60, 255, 10, 20, 30, 255, 40, 50, 60, 255]);
  // RGBA 2x1, 필터 1(왼쪽 더하기)
  const rgba = decodePng(png(2, 1, 6, [[1, 1, 2, 3, 4, 1, 1, 1, 1]]));
  assert.deepEqual([...rgba.data], [1, 2, 3, 4, 2, 3, 4, 5]);
});

test('keepDirFor: 규칙에 맞는 이름만 루트 바로 아래로 허용', () => {
  assert.equal(keepDirFor('a', 'ok-1'), path.resolve('a', 'ok-1'));
  assert.equal(keepDirFor('a', 'verify-a'), path.resolve('a', 'verify-a'));
  for (const bad of ['..', '../x', 'a/b', 'a\\b', '', '.', 'Upper', 'a'.repeat(33), '-x', undefined, null]) {
    assert.throws(() => keepDirFor('a', bad), undefined, JSON.stringify(bad));
  }
  assert.equal(keepDirFor('a', 'a'.repeat(32)), path.resolve('a', 'a'.repeat(32)));
});

test('dirtyOutsideOrch: .orch/ 안 변경은 무시', () => {
  assert.deepEqual(dirtyOutsideOrch('?? .orch/SUMMARY.md\n?? .orch/\n'), []);
  assert.deepEqual(dirtyOutsideOrch(' M scripts/screens/run.mjs\n?? .orch/SUMMARY.md\n'), ['scripts/screens/run.mjs']);
  assert.deepEqual(dirtyOutsideOrch('R  a.txt -> .orch/b.txt\n'), ['a.txt']);
});

const SHA_A = 'a'.repeat(40), SHA_B = '0123456789abcdef0123456789abcdef01234567';
const entry = (body, h = 'f'.repeat(40)) => `${h}\x1f${body}\n`;

test('findBaseSha: 없음·하나·같은 값 여러 번·충돌·40자 아닌 값 무시', () => {
  assert.deepEqual(findBaseSha(''), {none: true});
  assert.deepEqual(findBaseSha(entry('제목\n\n본문만 있음')), {none: true});
  assert.deepEqual(findBaseSha(entry(`제목\n\nBASE_SHA: ${SHA_A}`)), {sha: SHA_A});
  assert.deepEqual(findBaseSha(entry(`제목\nBASE_SHA: ${SHA_A}`) + entry(`다른 제목\n\nBASE_SHA: ${SHA_A}`)), {sha: SHA_A});
  const c = findBaseSha(entry(`x\nBASE_SHA: ${SHA_A}`) + entry(`y\nBASE_SHA: ${SHA_B}`));
  assert.deepEqual(c.conflict?.sort(), [SHA_B, SHA_A].sort());
  assert.deepEqual(findBaseSha(entry(`x\nBASE_SHA: ${'a'.repeat(39)}\nBASE_SHA: ${'b'.repeat(41)}\nBASE_SHA: abc`)), {none: true});
  assert.deepEqual(findBaseSha(entry(`x\nBASE_SHA: ${'a'.repeat(39)}\nBASE_SHA: ${SHA_B}`)), {sha: SHA_B});
  // 줄 중간의 BASE_SHA 는 무시
  assert.deepEqual(findBaseSha(entry(`x 참고 BASE_SHA: ${SHA_A}`)), {none: true});
});

test('expected.mjs: 22개, tab 18 + state 4, arch- 이름 없음', () => {
  assert.equal(EXPECTED_SCREENS.length, 22);
  assert.equal(new Set(EXPECTED_SCREENS).size, 22);
  for (const id of ['home', 'finance', 'news', 'benefits', 'journal', 'architecture'])
    for (const w of [360, 390, 430]) assert.ok(EXPECTED_SCREENS.includes(`tab-${id}-${w}.png`), `${id} ${w}`);
  assert.deepEqual(EXPECTED_SCREENS.filter(n => n.startsWith('state-')).sort(),
    ['state-finance-category-open-390.png', 'state-finance-day-390.png', 'state-journal-day-390.png', 'state-news-detail-390.png']);
  assert.equal(EXPECTED_SCREENS.some(n => n.startsWith('arch-')), false);
});

test('run.mjs: 예상 파일 이름을 모두 찍고 탭 진입 화면은 checkTabContent 보다 먼저 찍는다', () => {
  const run = readFileSync(new URL('../scripts/screens/run.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(run, /`arch-/);
  assert.match(run, /`tab-architecture-\$\{/);
  for (const name of EXPECTED_SCREENS.filter(n => n.startsWith('state-'))) assert.ok(run.includes(`'${name}'`), name);
  const loop = run.slice(run.indexOf('for (const [id, tabLabel] of TABS) {\n        const name'));
  const click = loop.indexOf('await clickTab(page, tabLabel)');
  const entryCheck = loop.indexOf('await checkTabEntry(page, id, tabLabel)');
  const shot = loop.indexOf('await shot(page, `tab-${id}-${w}.png`)');
  const content = loop.indexOf('await checkTabContent(page, id)');
  assert.ok(click >= 0 && click < entryCheck && entryCheck < shot && shot < content, `${click} ${entryCheck} ${shot} ${content}`);
  const day = run.slice(run.indexOf("state-finance-day)'"), run.indexOf("'state-finance-day-390.png'"));
  assert.match(day, /toHaveAttribute\('aria-pressed', 'true'\)/);
  assert.match(day, /dailyDetailsTotal/);
  assert.match(day, /toHaveCount\(2\)/);
});

test('.gitignore 에 .screens/ 가 있다', () => {
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.ok(ignore.split('\n').map(s => s.trim()).includes('.screens/'));
});
