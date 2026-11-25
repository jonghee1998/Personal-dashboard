// 커밋 하나를 저장소 밖 임시 작업 폴더(git worktree)에서 빌드·촬영해 .screens/keep/<이름>/ 에 보관한다.
// 사용: node scripts/screens/snap-ref.mjs <git-ref> <이름>   (npm run screens:ref -- <git-ref> <이름>)
// 보관 폴더에는 run.mjs 가 찍은 PNG 와 meta.json({ref, sha, tree, buildExit, screensExit}) 이 남는다.
// HEAD 를 찍을 때 .orch/ 밖에 커밋 안 된 변경이 있으면 실패한다(촬영 이미지가 커밋과 일치하도록).
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ensureChromium} from './ensure-chromium.mjs';
import {git, resolveCommit, treeOf} from './git.mjs';

export const KEEP_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** 보관 루트 아래 <이름> 폴더 경로. 이름 규칙에 맞지 않거나 루트 바로 아래가 아니면 throw */
export function keepDirFor(root, name) {
  if (typeof name !== 'string' || !KEEP_NAME.test(name)) throw new Error(`보관 이름이 규칙(${KEEP_NAME})에 맞지 않습니다: ${JSON.stringify(name)}`);
  const base = path.resolve(root);
  const dir = path.resolve(base, name);
  if (path.dirname(dir) !== base) throw new Error(`보관 경로가 ${base} 바로 아래가 아닙니다: ${dir}`);
  return dir;
}

/** git status --porcelain 출력에서 .orch/ 밖 변경 경로 목록 */
export function dirtyOutsideOrch(porcelain) {
  return porcelain.split('\n').filter(Boolean).map(line => line.slice(3))
    .flatMap(p => p.split(' -> '))
    .map(p => p.replace(/^"|"$/g, ''))
    .filter(p => !(p === '.orch' || p === '.orch/' || p.startsWith('.orch/')));
}

const run = (cmd, args, options) => {
  console.log(`$ ${cmd} ${args.join(' ')}  (cwd ${options.cwd})`);
  const r = spawnSync(cmd, args, {stdio: 'inherit', ...options});
  if (r.error) console.error(r.error.message);
  return r.status ?? 1;
};

/** 촬영 본체 → 종료 코드(0 성공) */
export async function snapRef(ref, name) {
  const KEEP_ROOT = path.resolve('.screens/keep');
  // ① 이름 검증(아무것도 지우기 전에)
  let keepDir;
  try { keepDir = keepDirFor(KEEP_ROOT, name); } catch (e) { console.error(e.message); return 1; }
  // ② ref → SHA
  const sha = resolveCommit(ref);
  if (!sha) { console.error(`커밋을 찾을 수 없습니다: ${ref}`); return 1; }
  // ③ HEAD 면 .orch/ 밖 미커밋 변경 금지
  if (ref === 'HEAD') {
    const st = git(['status', '--porcelain', '--untracked-files=all']);
    if (st.status !== 0) { console.error(`git status 실패: ${st.stderr}`); return 1; }
    const dirty = dirtyOutsideOrch(st.stdout);
    if (dirty.length) {
      console.error(`HEAD 촬영 거부: .orch/ 밖에 커밋 안 된 변경 ${dirty.length}건 (${dirty.slice(0, 5).join(', ')}). 먼저 커밋하세요`);
      return 1;
    }
  }
  // ④ Chromium
  if (!await ensureChromium()) {
    console.error('chromium 을 설치하지 못했습니다. npx playwright install --with-deps chromium 으로 다시 시도하세요');
    return 1;
  }
  // ⑤ 보관 폴더 비우기(검증된 경로만)
  rmSync(keepDir, {recursive: true, force: true});
  mkdirSync(keepDir, {recursive: true});

  const meta = {ref, sha, tree: treeOf(sha), buildExit: null, screensExit: null};
  let workDir = null;
  let added = false;
  try {
    // ⑥ 저장소 밖 고유 작업 폴더에 detached worktree
    workDir = mkdtempSync(path.join(os.tmpdir(), 'screens-wt-'));
    const add = git(['worktree', 'add', '--detach', workDir, sha]);
    if (add.status !== 0) throw new Error(`git worktree add 실패: ${add.stderr}`);
    added = true;
    const modules = path.resolve('node_modules');
    if (!existsSync(modules)) throw new Error('node_modules 가 없습니다. npm ci 를 먼저 실행하세요');
    symlinkSync(modules, path.join(workDir, 'node_modules'), 'dir');
    const env = {...process.env, SCREENS_DIR: keepDir};
    delete env.SCREENS_UPDATE_BASELINE;
    meta.buildExit = run('npm', ['run', 'build'], {cwd: workDir, env});
    if (meta.buildExit === 0) meta.screensExit = run(process.execPath, ['scripts/screens/run.mjs'], {cwd: workDir, env});
  } catch (e) {
    console.error(e.message);
  } finally {
    // ⑦ 실패·예외여도 meta 기록과 작업 폴더 회수
    writeFileSync(path.join(keepDir, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
    if (workDir) {
      if (added) {
        const rm = git(['worktree', 'remove', '--force', workDir]);
        if (rm.status !== 0) console.warn(`경고: git worktree remove 실패: ${rm.stderr}`);
      }
      const prune = git(['worktree', 'prune']);
      if (prune.status !== 0) console.warn(`경고: git worktree prune 실패: ${prune.stderr}`);
      try { rmSync(workDir, {recursive: true, force: true}); } catch (e) { console.warn(`경고: 작업 폴더 삭제 실패: ${e.message}`); }
    }
  }
  console.log(`snap-ref ${name}: ref ${ref} sha ${sha} tree ${meta.tree} buildExit ${meta.buildExit} screensExit ${meta.screensExit} → ${keepDir}`);
  return meta.buildExit === 0 && meta.screensExit === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [ref, name] = process.argv.slice(2);
  if (!ref) { console.error('사용법: node scripts/screens/snap-ref.mjs <git-ref> <이름>'); process.exit(1); }
  process.exit(await snapRef(ref, name));
}
