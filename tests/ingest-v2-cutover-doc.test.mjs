// docs/INGEST_V2.md ⑪ 전환 확인 절차(9단계, 운영자)의 필수 내용을 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const doc = readFileSync(new URL('../docs/INGEST_V2.md', import.meta.url), 'utf8');

const HEADING = /^## ⑪ 전환 확인 절차.*$/gm;

/** ⑪ 제목부터 다음 '## ' 제목 또는 파일 끝까지 */
const section = () => {
  const start = doc.search(/^## ⑪ 전환 확인 절차/m);
  assert.ok(start >= 0, '⑪ 제목이 없음');
  const rest = doc.slice(start);
  const next = rest.slice(1).search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

/** 줄 머리(앞의 '|'·'-'·'*'·공백 제외)가 mark 로 시작하는 줄들 */
const itemLines = (mark) =>
  section().split('\n').filter((line) => line.replace(/^[|\-*\s]+/, '').startsWith(mark));

test('⑪ 제목이 정확히 1개이고 ⑩ 뒤에 있다', () => {
  assert.equal((doc.match(HEADING) || []).length, 1);
  const s10 = doc.search(/^## ⑩/m);
  const s11 = doc.search(/^## ⑪ 전환 확인 절차/m);
  assert.ok(s10 >= 0, '⑩ 제목이 없음');
  assert.ok(s11 > s10, '⑪ 이 ⑩ 뒤에 있지 않음');
});

test('⑪ 절에 필수 용어가 모두 있다', () => {
  const s = section();
  for (const word of [
    'idempotent', 'RUN_ID_CONFLICT', 'RUN_ID_MISMATCH', 'metadata.run_id', 'CONCURRENT_CHANGE',
    'Production integrity conflict', 'Server not configured', 'failed', '400', '401', '422', '503',
    '/api/sync-runs', 'DEPLOY.md', '⑥',
  ]) assert.ok(s.includes(word), `⑪ 절에 '${word}' 가 없음`);
});

test('ⓖ 판정 줄: 새 키 발급 전 원본 재전송 확인과 두 곳 동시 갱신', () => {
  const lines = itemLines('ⓖ');
  assert.equal(lines.length, 1, `ⓖ 로 시작하는 줄이 ${lines.length}개`);
  for (const word of ['RUN_ID_CONFLICT', '원래', 'run.run_id', 'metadata.run_id'])
    assert.ok(lines[0].includes(word), `ⓖ 줄에 '${word}' 가 없음`);
});

test('ⓓ 판정 줄: 배포 점검 전 본문 최상위 version 타입 확인', () => {
  const lines = itemLines('ⓓ');
  assert.equal(lines.length, 1, `ⓓ 로 시작하는 줄이 ${lines.length}개`);
  for (const word of ['Invalid payload', 'version', '숫자'])
    assert.ok(lines[0].includes(word), `ⓓ 줄에 '${word}' 가 없음`);
});

test('ⓐ~ⓚ 판정 항목이 하나씩 있고 ⓖ 바로 다음 항목이 ⓗ 다', () => {
  const marks = [...'ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚ'];
  for (const m of marks) assert.equal(itemLines(m).length, 1, `${m} 항목 수`);
  const order = section().split('\n')
    .map((line) => line.replace(/^[|\-*\s]+/, '').charAt(0))
    .filter((c) => marks.includes(c));
  assert.equal(order[order.indexOf('ⓖ') + 1], 'ⓗ');
});

test('⑪ 절에 운영 주소·토큰 모양 문자열이 없다', () => {
  const s = section();
  assert.doesNotMatch(s, /https:\/\//);
  for (const word of ['supabase.co', 'vercel.app', 'eyJ']) assert.ok(!s.includes(word), `⑪ 절에 '${word}' 가 있음`);
});

test('기존 예시 마커가 그대로 1개씩 있다', () => {
  for (const name of ['success', 'failed', 'conflict-response']) {
    const n = doc.split(`<!-- example:${name} -->`).length - 1;
    assert.equal(n, 1, `example:${name} 마커 수`);
  }
});
