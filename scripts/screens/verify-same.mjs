// 검수용 진입점: 두 커밋의 화면이 같은지 node 한 줄로 확인한다(npm run 불필요, Chromium 준비 포함).
// 사용: node scripts/screens/verify-same.mjs <refA> <refB> [--same-tree <sha>]
// 순서: Chromium 준비 → snap-ref(refA → verify-a) → snap-ref(refB → verify-b) → compare(verify-a, verify-b).
// --same-tree <sha>: <sha>^{tree} 와 refB 의 tree 가 같은지 먼저 확인(증거의 촬영 커밋과 검수 HEAD 코드가 같은지).
// 하나라도 실패하면 exit 1.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ensureChromium} from './ensure-chromium.mjs';
import {resolveCommit, treeOf} from './git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 인자 → {refA, refB, sameTree} 또는 {error} */
export function parseArgs(argv) {
  const rest = [];
  let sameTree = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--same-tree') {
      sameTree = argv[++i];
      if (!sameTree) return {error: '--same-tree 뒤에 sha 가 필요합니다'};
    } else rest.push(argv[i]);
  }
  if (rest.length !== 2) return {error: '사용법: node scripts/screens/verify-same.mjs <refA> <refB> [--same-tree <sha>]'};
  return {refA: rest[0], refB: rest[1], sameTree};
}

const step = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], {stdio: 'inherit'});
  return r.status ?? 1;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error(args.error); return 1; }
  const {refA, refB, sameTree} = args;
  const shaA = resolveCommit(refA), shaB = resolveCommit(refB);
  const treeA = shaA && treeOf(shaA), treeB = shaB && treeOf(shaB);
  console.log(`A ${refA}: sha ${shaA ?? '없음'} tree ${treeA ?? '없음'}`);
  console.log(`B ${refB}: sha ${shaB ?? '없음'} tree ${treeB ?? '없음'}`);
  if (!shaA || !shaB) { console.error('커밋을 찾을 수 없습니다'); return 1; }
  if (sameTree !== null) {
    const want = resolveCommit(sameTree), wantTree = want && treeOf(want);
    console.log(`--same-tree ${sameTree}: sha ${want ?? '없음'} tree ${wantTree ?? '없음'}`);
    if (!wantTree || wantTree !== treeB) { console.error(`--same-tree 불일치: ${wantTree ?? '없음'} ≠ B tree ${treeB}`); return 1; }
    console.log('--same-tree 일치');
  }
  const exits = {};
  exits.chromium = await ensureChromium() ? 0 : 1;
  console.log(`단계 chromium 종료 코드 ${exits.chromium}`);
  if (exits.chromium !== 0) { console.error('chromium 준비 실패. npx playwright install --with-deps chromium 으로 다시 시도하세요'); return 1; }
  exits.snapA = step('snap-ref.mjs', [refA, 'verify-a']);
  console.log(`단계 snap-ref A(${refA} → verify-a) 종료 코드 ${exits.snapA}`);
  exits.snapB = step('snap-ref.mjs', [refB, 'verify-b']);
  console.log(`단계 snap-ref B(${refB} → verify-b) 종료 코드 ${exits.snapB}`);
  exits.compare = step('compare.mjs', ['verify-a', 'verify-b']);
  console.log(`단계 compare 종료 코드 ${exits.compare}`);
  console.log(`요약: A sha ${shaA} tree ${treeA} · B sha ${shaB} tree ${treeB} · 종료 코드 ${JSON.stringify(exits)}`);
  return Object.values(exits).every(c => c === 0) ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main());
