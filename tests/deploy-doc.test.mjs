// docs/DEPLOY.md(8단계 배포 전 점검표)의 필수 내용과 순서를 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const doc = read('docs/DEPLOY.md');

const has = (s) => assert.ok(doc.includes(s), `DEPLOY.md 에 '${s}' 가 없음`);
/** 줄 맨 앞이 marker 로 시작하는 첫 줄의 위치 */
const lineStart = (marker) => {
  const m = doc.match(new RegExp(`^${marker}`, 'm'));
  assert.ok(m, `'${marker}' 로 시작하는 줄이 없음`);
  return m.index;
};

test('.env.example 의 모든 이름이 나온다', () => {
  const names = read('.env.example').split(/\r?\n/).map((l) => l.match(/^([A-Z_][A-Z0-9_]*)=/)?.[1]).filter(Boolean);
  assert.ok(names.length >= 5);
  for (const n of names) has(n);
});

test('마이그레이션 4번이 5번보다 앞에 나오고 두 파일이 실제로 있다', () => {
  const a = '20261124000000_ingest_commit.sql', b = '20261124000100_ingest_support.sql';
  has(a); has(b);
  assert.ok(doc.indexOf(a) < doc.indexOf(b));
  for (const f of [a, b]) assert.ok(existsSync(join(root, 'supabase/migrations', f)), f);
});

test('필수 용어가 나온다', () => {
  for (const s of [
    'npm run check-env', '--compare', 'chmod 600', '저장소 밖',
    'ORCH_AUTO', '자동 모드', 'awaiting_merge',
    'Preview', 'Production', 'Development', '미사용', '수집기',
    'has_function_privilege', 'pg_get_functiondef', 'pg_get_constraintdef', 'commit_source', 'is_nullable', 'column_default', 'dashboard_norm_id',
    '부분 적용', '배포 보류', 'targetRows', 'architecture.json',
  ]) has(s);
});

test('배포 후 확인 절은 200 만이 아니라 저장 건수·화면으로 확인한다', () => {
  const start = doc.search(/^## .*배포 후 확인/m);
  assert.ok(start >= 0, '배포 후 확인 절이 없음');
  const rest = doc.slice(start + 3);
  const next = rest.search(/^## /m);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  for (const s of ['v2', '200', 'run.status', 'upserted', '수집 기록', '새로고침']) {
    assert.ok(section.includes(s), `배포 후 확인 절에 '${s}' 가 없음`);
  }
  assert.ok(!section.includes('validate_only'), "배포 후 확인 절에 제거된 'validate_only' 절차가 남아 있음");
  const lines = section.split(/\r?\n/);
  assert.ok(
    lines.some((l) => l.includes('수집 확인') && l.includes('run.status') && l.includes('success') && l.includes('upserted') && l.includes('1 이상')),
    "배포 후 확인 절에 'run.status success·upserted 1 이상' 수집 확인 줄이 없음",
  );
  assert.ok(
    lines.some((l) => l.includes('/api/sync-runs') && l.includes('12단계에서 제거')),
    "배포 후 확인 절에 '/api/sync-runs' 가 12단계에서 제거됐다는 줄이 없음",
  );
  assert.ok(
    !lines.some((l) => l.includes('/api/sync-runs') && !l.includes('제거')),
    "배포 후 확인 절에 '/api/sync-runs' 를 확인 절차로 쓰는 줄이 남아 있음",
  );
  assert.ok(
    section.split(/\r?\n/).some((l) => l.includes('개발 토큰') && l.includes('401')),
    "배포 후 확인 절에 '개발 토큰' 과 '401' 이 함께 있는 줄이 없음",
  );
  for (const s of ['collector_auth_failed', 'mismatch', '요청 ID']) {
    assert.ok(section.includes(s), `배포 후 확인 절에 '${s}' 가 없음`);
  }
});

test('배포 순서: 연결 보류 → 대조·DB 확인 → 연결·배포, env 파일은 대조 뒤 삭제', () => {
  const p1 = lineStart('①'), p4 = lineStart('④'), p5 = lineStart('⑤'), p6 = lineStart('⑥'), p8 = lineStart('⑧');
  const line1 = doc.slice(p1, doc.indexOf('\n', p1));
  assert.ok(line1.includes('보류'), '① 줄에 보류가 없음');
  assert.ok(p4 > p1 && p5 > p1);
  assert.ok(p8 > p4 && p8 > p5 && p8 > p6);
  const del = doc.indexOf('성공·실패 모두');
  assert.ok(del > p4 && del < p5, 'env 파일 삭제 문장은 ④ 뒤, ⑤ 앞이어야 함');
});

test('배포 보류 조건에 백필 플래그 항목은 하나 있고 백필 표 항목은 없으며, ⑤~⑥ 에 백필 표 확인이 없다', () => {
  const p5 = lineStart('⑤'), p6 = lineStart('⑥'), p7 = lineStart('⑦'), p8 = lineStart('⑧');
  assert.ok(p7 < p8, '⑦ 이 ⑧ 보다 앞이어야 함');
  const items = doc.slice(p7, p8).split(/\r?\n/).filter((l) => l.startsWith('- '));

  const flag = items.filter((l) => l.includes('BACKFILL_APPLY_ENABLED'));
  assert.equal(flag.length, 1, "⑦ 에 'BACKFILL_APPLY_ENABLED' 항목이 정확히 하나여야 함");
  for (const s of ['켜져', '확인하지 못']) assert.ok(flag[0].includes(s), `플래그 항목에 '${s}' 가 없음`);

  const table = items.filter((l) => l.includes('dashboard_backfill_batches'));
  assert.equal(table.length, 0, "⑦ 에 'dashboard_backfill_batches' 항목이 없어야 함(12단계에서 제거)");

  assert.ok(p5 < p6, '⑤ 가 ⑥ 보다 앞이어야 함');
  const db = doc.slice(p5, p6);
  assert.ok(!db.includes('backfill_table'), "⑤~⑥ 구간에 'backfill_table' 이 남아 있음");
});

test('운영 주소·키 모양 문자열이 없다', () => {
  assert.ok(!/https?:\/\//.test(doc), 'URL 이 있음');
  assert.ok(!doc.includes('supabase.co'));
  assert.ok(!doc.includes('vercel.app'));
  assert.ok(!/eyJ/.test(doc), 'JWT 모양 문자열이 있음');
});

test('.gitignore 가 저장소 안 env 파일을 막고 .env.example 은 허용한다', () => {
  const lines = read('.gitignore').split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('.env.*'));
  assert.ok(lines.includes('!.env.example'));
});
