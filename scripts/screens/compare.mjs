// 두 보관 폴더(.screens/keep/<이름A>, <이름B>)의 스크린샷을 expected.mjs 목록대로 짝지어 비교한다.
// 사용: node scripts/screens/compare.mjs <이름A> <이름B>   (npm run screens:compare -- <이름A> <이름B>)
// 짝마다 크기(가로·세로) 같음, 다른 픽셀 비율(어느 채널이든 차이 > 16 인 픽셀 / 전체) ≤ 0.1% 를 검사한다.
// meta.json 없음·종료 코드 0 아님·예상 파일 누락·크기 다름·허용치 초과 중 하나라도 있으면 exit 1.
// PNG 해독은 새 의존성 없이 node:zlib 으로 한다(8비트 회색·RGB·회색+알파·RGBA·팔레트, 비인터레이스).
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {inflateSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {EXPECTED_SCREENS} from './expected.mjs';
import {keepDirFor} from './snap-ref.mjs';

export const CHANNEL_TOLERANCE = 16;
export const MAX_DIFF_RATIO = 0.001;

/** 두 RGBA 배열에서 어느 채널이든 차이가 CHANNEL_TOLERANCE 를 넘는 픽셀 수 */
export function countDiffPixels(a, b, width, height) {
  const n = width * height;
  if (a.length < n * 4 || b.length < n * 4) throw new Error('RGBA 배열 길이가 가로×세로×4 보다 짧습니다');
  let count = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (Math.abs(a[o] - b[o]) > CHANNEL_TOLERANCE || Math.abs(a[o + 1] - b[o + 1]) > CHANNEL_TOLERANCE
      || Math.abs(a[o + 2] - b[o + 2]) > CHANNEL_TOLERANCE || Math.abs(a[o + 3] - b[o + 3]) > CHANNEL_TOLERANCE) count++;
  }
  return count;
}

/**
 * 예상 목록 이름마다 A·B 쪽 이미지를 짝지어 판정한다.
 * sideA·sideB: Map 또는 객체, 이름 → {width, height, data(RGBA)} 또는 그것을 돌려주는 함수(지연 해독). 없으면 누락.
 * → {ok, results: [{name, ok, reason, width?, height?, diff?, ratio?}], maxRatio, maxName}
 */
export function checkPairs(expected, sideA, sideB) {
  const get = (side, name) => {
    const v = side instanceof Map ? side.get(name) : side?.[name];
    return typeof v === 'function' ? v() : v ?? null;
  };
  const results = [];
  let maxRatio = 0, maxName = null;
  for (const name of expected) {
    const a = get(sideA, name), b = get(sideB, name);
    if (!a || !b) {
      const where = !a && !b ? '양쪽' : !a ? 'A' : 'B';
      results.push({name, ok: false, reason: `${where} 파일 없음`});
      continue;
    }
    if (a.width !== b.width || a.height !== b.height) {
      results.push({name, ok: false, reason: `크기 다름 ${a.width}x${a.height} / ${b.width}x${b.height}`});
      continue;
    }
    const diff = countDiffPixels(a.data, b.data, a.width, a.height);
    const total = a.width * a.height;
    const ratio = total ? diff / total : 0;
    if (maxName === null || ratio > maxRatio) { maxRatio = ratio; maxName = name; }
    const ok = ratio <= MAX_DIFF_RATIO;
    results.push({name, ok, reason: ok ? '같음' : `허용치 초과`, width: a.width, height: a.height, diff, ratio});
  }
  return {ok: results.length > 0 && results.every(r => r.ok), results, maxRatio, maxName};
}

/** PNG 바이트 → {width, height, data(RGBA Uint8Array)} */
export function decodePng(buf) {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (SIG.some((v, i) => buf[i] !== v)) throw new Error('PNG 서명이 아닙니다');
  let pos = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; type = body[9]; interlace = body[12];
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[type];
  if (depth !== 8 || !channels || interlace !== 0) throw new Error(`지원하지 않는 PNG 형식(비트 ${depth}, 색 ${type}, 인터레이스 ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      let v;
      if (filter === 0) v = line[x];
      else if (filter === 1) v = line[x] + left;
      else if (filter === 2) v = line[x] + up;
      else if (filter === 3) v = line[x] + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        v = line[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else throw new Error(`알 수 없는 PNG 필터 ${filter}`);
      out[x] = v & 255;
    }
    prev = out;
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels, o = i * 4;
    if (type === 6) { data[o] = pixels[s]; data[o + 1] = pixels[s + 1]; data[o + 2] = pixels[s + 2]; data[o + 3] = pixels[s + 3]; }
    else if (type === 2) { data[o] = pixels[s]; data[o + 1] = pixels[s + 1]; data[o + 2] = pixels[s + 2]; data[o + 3] = 255; }
    else if (type === 0) { data[o] = data[o + 1] = data[o + 2] = pixels[s]; data[o + 3] = 255; }
    else if (type === 4) { data[o] = data[o + 1] = data[o + 2] = pixels[s]; data[o + 3] = pixels[s + 1]; }
    else {
      const p = pixels[s];
      data[o] = palette[p * 3]; data[o + 1] = palette[p * 3 + 1]; data[o + 2] = palette[p * 3 + 2];
      data[o + 3] = trns && p < trns.length ? trns[p] : 255;
    }
  }
  return {width, height, data};
}

/** 보관 폴더 → 이름별 지연 해독 함수 맵(있는 파일만) */
function sideFor(dir, expected) {
  const side = new Map();
  for (const name of expected) {
    const file = path.join(dir, name);
    if (existsSync(file)) side.set(name, () => decodePng(readFileSync(file)));
  }
  return side;
}

function readMeta(dir) {
  const file = path.join(dir, 'meta.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

const pct = r => `${(r * 100).toFixed(4)}%`;

/** 비교 본체 → 종료 코드 */
export function compareKept(nameA, nameB) {
  const KEEP_ROOT = path.resolve('.screens/keep');
  let dirA, dirB;
  try { dirA = keepDirFor(KEEP_ROOT, nameA); dirB = keepDirFor(KEEP_ROOT, nameB); }
  catch (e) { console.error(e.message); return 1; }
  let metaOk = true;
  for (const [label, name, dir] of [['A', nameA, dirA], ['B', nameB, dirB]]) {
    const meta = readMeta(dir);
    if (!meta) { console.log(`${label} ${name}: meta.json 없음`); metaOk = false; continue; }
    console.log(`${label} ${name}: ref ${meta.ref} sha ${meta.sha} tree ${meta.tree} buildExit ${meta.buildExit} screensExit ${meta.screensExit}`);
    if (meta.buildExit !== 0 || meta.screensExit !== 0) { console.log(`${label} ${name}: 빌드·촬영 종료 코드가 0 이 아님`); metaOk = false; }
  }
  const {ok, results, maxRatio, maxName} = checkPairs(EXPECTED_SCREENS, sideFor(dirA, EXPECTED_SCREENS), sideFor(dirB, EXPECTED_SCREENS));
  for (const r of results) {
    const detail = r.ratio === undefined ? r.reason : `${r.width}x${r.height} 다른 픽셀 ${r.diff} (${pct(r.ratio)}) ${r.reason}`;
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} ${detail}`);
  }
  console.log(`짝 ${results.length}개 · 최대 차이 ${pct(maxRatio)} (${maxName ?? '없음'})`);
  const pass = ok && metaOk;
  console.log(pass ? '비교 통과' : '비교 실패');
  return pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [a, b] = process.argv.slice(2);
  if (!a || !b) { console.error('사용법: node scripts/screens/compare.mjs <이름A> <이름B>'); process.exit(1); }
  process.exit(compareKept(a, b));
}
