// docs/AI_COLLABORATION.md 의 v2 전환 시점·별도 보고 금지·브랜치·저장소 안내가
// docs/INGEST_V2.md ⑪ 와 docs/DEPLOY.md 에 맞는지, 한 줄 안에서 이어진 문장으로 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(join(root, 'docs/AI_COLLABORATION.md'), 'utf8');

/** '## <title>' 머리글 줄부터 다음 '## ' 머리글 직전까지를 돌려준다. 없으면 null. */
export function section(text, title) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('## ') && l.slice(3).trim().startsWith(title));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n');
}

const lineMatches = (text, re) => text.split(/\r?\n/).some((l) => re.test(l));

/** 문서 문자열을 받아 어긋난 점 목록을 돌려준다. 맞으면 []. */
export function checkAiCollabDoc(text) {
  const problems = [];
  const need = (sec, name, re, msg) => {
    if (sec === null) return;
    if (!lineMatches(sec, re)) problems.push(`${name}: ${msg}`);
  };
  const forbid = (sec, name, re, msg) => {
    if (sec === null) return;
    if (lineMatches(sec, re)) problems.push(`${name}: ${msg}`);
  };

  const api = section(text, 'Integration API');
  const branches = section(text, 'Default branches');
  const comm = section(text, 'Communication');
  for (const [s, n] of [[api, 'Integration API'], [branches, 'Default branches'], [comm, 'Communication']]) {
    if (s === null) problems.push(`'## ${n}' 절이 없음`);
  }

  // Integration API 절
  need(api, 'Integration API', /DEPLOY\.md[^\n]*\(3\) 배포 후 확인이 끝난 뒤[^\n]*INGEST_V2\.md[^\n]*⑪/,
    'DEPLOY.md (3) 배포 후 확인이 끝난 뒤 INGEST_V2.md ⑪ 로 전환한다는 줄이 없음');
  forbid(api, 'Integration API', /배포 후 확인[^\n]*(전에|끝나기 전|없이)/, '배포 후 확인 전에 전환해도 된다는 줄이 있음');
  need(api, 'Integration API', /수신은 v2 전용이다[^\n]*12단계에서 v1 제거/, '수신은 v2 전용이고 v1 은 12단계에서 제거됐다는 줄이 없음');
  forbid(api, 'Integration API', /v1 은 지금 사용한다|pickle-payload-v1/, '옛 v1 사용 안내가 남아 있음');
  need(api, 'Integration API', /Request body:[^\n]*`410 v1 ingest removed`/, 'v1 본문은 410 v1 ingest removed 라는 Request body 줄이 없음');
  need(api, 'Integration API', /별도 실행 보고 경로 `\/api\/sync-runs` 는 12단계에서 제거됐다/,
    '/api/sync-runs 가 12단계에서 제거됐다는 줄이 없음');
  need(api, 'Integration API', /실행 기록은 v2 본문의 `run` 으로 항목과 함께 저장되므로 따로 보고하지 않는다/,
    '실행 기록은 v2 본문과 함께 저장돼 따로 보고하지 않는다는 줄이 없음');
  forbid(api, 'Integration API', /sync-runs[^\n]*(보고한다|보고해도|보고를 켠다|호환용)/, 'sync-runs 로 보고하라거나 호환용으로 남았다는 줄이 있음');
  need(api, 'Integration API', /같은 실행 키[^\n]*옛 `\/api\/sync-runs`[^\n]*먼저[^\n]*'report'[^\n]*`409 RUN_ID_CONFLICT` 가 된다/,
    "같은 실행 키가 옛 'report' 기록과 겹치면 409 RUN_ID_CONFLICT 가 된다는 줄이 없음");
  forbid(api, 'Integration API', /RUN_ID_CONFLICT[^\n]*(되지 않는다|안 된다|않는다)/, 'RUN_ID_CONFLICT 뒤에 부정형이 붙은 줄이 있음');
  if (api !== null) {
    for (const s of ['운영 반영 뒤', '8단계']) {
      if (api.includes(s)) problems.push(`Integration API: 옛 전환 시점 '${s}' 가 남아 있음`);
    }
  }

  // Default branches 절
  need(branches, 'Default branches', /`main`[^\n]*production[^\n]*pull request \(PR\) targeting `main`/,
    'main 이 production 이고 PR 은 main 으로 간다는 줄이 없음');
  need(branches, 'Default branches', /Preview[^\n]*PR preview[^\n]*never use production credentials[^\n]*Preview/,
    'Preview 에 운영 자격 증명을 쓰지 않는다는 줄이 없음');
  need(branches, 'Default branches', /repository is public[^\n]*never/i, '공개 저장소 안내 줄이 없음');

  // Communication 절
  need(comm, 'Communication', /pull request \(PR\) targeting `main`/, 'main 대상 PR 안내 줄이 없음');
  need(comm, 'Communication', /Never point Pickle AI at preview with the \*\*production\*\*/, 'preview 에 운영 비밀값 금지 줄이 없음');
  need(comm, 'Communication', /\*\*public\*\* repository[^\n]*never put real data/, '공개 저장소·실데이터 금지 줄이 없음');

  // 문서 전체
  if (/\bdevelop\b/.test(text)) problems.push("문서: 'develop' 브랜치 언급이 남아 있음");
  if (/private repository/i.test(text)) problems.push("문서: 'private repository' 가 남아 있음");
  for (const s of ['https://', 'supabase.co', 'vercel.app', 'eyJ']) {
    if (text.includes(s)) problems.push(`문서: 주소·토큰처럼 보이는 '${s}' 가 있음`);
  }
  return problems;
}

test('section 은 ## 머리글부터 다음 ## 직전까지를 자른다', () => {
  const t = '# T\n## A\na1\n### sub\na2\n## B\nb1\n';
  assert.equal(section(t, 'A'), '## A\na1\n### sub\na2');
  assert.equal(section(t, 'B'), '## B\nb1\n');
  assert.equal(section(t, 'C'), null);
});

test('실제 docs/AI_COLLABORATION.md 는 어긋난 점이 없다', () => {
  assert.deepEqual(checkAiCollabDoc(doc), []);
});

const aLine = '새 수집기·새 dataset 의 첫 수신은 [DEPLOY.md](DEPLOY.md) (3) 배포 후 확인이 끝난 뒤에만 [INGEST_V2.md](INGEST_V2.md) ⑪ (3) 판정으로 확인한다.';
const aReversed = '새 수집기·새 dataset 의 첫 수신은 [INGEST_V2.md](INGEST_V2.md) ⑪ (3) 판정으로 확인하고 [DEPLOY.md](DEPLOY.md) (3) 배포 후 확인이 끝난 뒤에만 한다.';

const mutations = [
  ['확인이 끝난 뒤에만', '확인이 끝나기 전에'],
  ['수신은 v2 전용이다', '수신은 v1 도 받는다'],
  ['`410 v1 ingest removed` 로 거부된다', '그대로 받는다'],
  ['`/api/sync-runs` 는 12단계에서 제거됐다', '`/api/sync-runs` 는 호환용으로 남아 있다'],
  ['따로 보고하지 않는다', '따로 보고한다'],
  ["먼저 기록돼 있으면(기존 `commit_source` 'report' 행) v2 는 `409 RUN_ID_CONFLICT`", '먼저 기록돼 있어도 v2 는 `200`'],
  ['`409 RUN_ID_CONFLICT` 가 된다', '`409 RUN_ID_CONFLICT` 가 되지 않는다'],
  ['never use production credentials', 'always use production credentials'],
  ['Never point Pickle AI at preview', 'Always point Pickle AI at preview'],
  ['**public** repository', '**private** repository'],
  ['targeting `main`', 'targeting `develop`'],
  [aLine, aReversed],
];

for (const [from, to] of mutations) {
  test(`변형 문서는 잡힌다: '${from.slice(0, 40)}' → '${to.slice(0, 40)}'`, () => {
    assert.ok(doc.includes(from), `원본에 '${from}' 가 없음`);
    const mutated = doc.replace(from, to);
    assert.notEqual(mutated, doc);
    const problems = checkAiCollabDoc(mutated);
    assert.ok(problems.length >= 1, `변형이 통과함: ${from} → ${to}`);
  });
}
