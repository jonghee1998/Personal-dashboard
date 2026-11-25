// 최근 커밋 메시지(HEAD 부터 200개)에서 비교 기준 커밋 줄 'BASE_SHA: <40자 16진수>' 를 찾는다.
// 사용: node scripts/screens/base-sha.mjs [--require <경로> <문자열>]   (npm run screens:base-sha)
// 없음 → exit 2('없음'), 서로 다른 값 둘 이상 → exit 1, 하나 → SHA 출력.
// 그 SHA 가 HEAD 의 조상이 아니면 exit 1. --require 를 주면 그 커밋의 <경로> 내용에 <문자열>이 없을 때 exit 1.
import {pathToFileURL} from 'node:url';
import {git} from './git.mjs';

const LINE = /^BASE_SHA: ([0-9a-fA-F]+)\s*$/;

/** git log --format=%H%x1f%B 출력 → {sha} | {none: true} | {conflict: [sha…]} */
export function findBaseSha(log) {
  const found = new Set();
  for (const line of String(log ?? '').split(/\r?\n/)) {
    // %x1f 뒤 첫 줄은 'SHA\x1f제목' 형태이므로 구분자 뒤만 본다.
    const text = line.includes('\x1f') ? line.slice(line.lastIndexOf('\x1f') + 1) : line;
    const m = text.match(LINE);
    if (m && m[1].length === 40) found.add(m[1].toLowerCase());
  }
  if (found.size === 0) return {none: true};
  if (found.size > 1) return {conflict: [...found]};
  return {sha: [...found][0]};
}

function main(argv) {
  let require = null;
  if (argv[0] === '--require') {
    if (argv.length !== 3) { console.error('사용법: node scripts/screens/base-sha.mjs [--require <경로> <문자열>]'); return 1; }
    require = {file: argv[1], text: argv[2]};
  } else if (argv.length) { console.error('사용법: node scripts/screens/base-sha.mjs [--require <경로> <문자열>]'); return 1; }
  const log = git(['log', '-n', '200', '--format=%H%x1f%B', 'HEAD']);
  if (log.status !== 0) { console.error(`git log 실패: ${log.stderr}`); return 1; }
  const r = findBaseSha(log.stdout);
  if (r.none) { console.log('없음'); return 2; }
  if (r.conflict) { console.error(`서로 다른 값 ${r.conflict.length}개: ${r.conflict.join(', ')}`); return 1; }
  if (git(['merge-base', '--is-ancestor', r.sha, 'HEAD']).status !== 0) { console.error(`${r.sha} 는 HEAD 의 조상이 아닙니다`); return 1; }
  if (require) {
    const shown = git(['show', `${r.sha}:${require.file}`]);
    if (shown.status !== 0 || !shown.stdout.includes(require.text)) {
      console.error(`${r.sha}:${require.file} 에 지정한 문자열이 없습니다`);
      return 1;
    }
  }
  console.log(r.sha);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)));
