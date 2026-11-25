// 화면 비교 도구 공통: node:child_process 로 git 을 부른다(셸 없이 인자 배열로).
import {spawnSync} from 'node:child_process';

/** git 실행 → {status, stdout, stderr} (stdout 은 끝 공백 제거) */
export function git(args, options = {}) {
  const r = spawnSync('git', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options});
  return {status: r.status ?? 1, stdout: (r.stdout ?? '').trimEnd(), stderr: (r.stderr ?? '').trim()};
}

/** <ref>^{commit} → 40자 SHA, 실패하면 null */
export function resolveCommit(ref, options) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-')) return null;
  const r = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], options);
  return r.status === 0 && /^[0-9a-f]{40}$/.test(r.stdout) ? r.stdout : null;
}

/** <sha>^{tree} → 트리 SHA, 실패하면 null */
export function treeOf(sha, options) {
  const r = git(['rev-parse', '--verify', '--quiet', `${sha}^{tree}`], options);
  return r.status === 0 && /^[0-9a-f]{40}$/.test(r.stdout) ? r.stdout : null;
}
