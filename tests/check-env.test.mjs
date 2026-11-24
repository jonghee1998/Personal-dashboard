import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkEnv, compareEnvs, parseEnvFile, normalizeSupabaseUrl, readExample} from '../scripts/check-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts', 'check-env.mjs');
const {names, examples} = readExample(readFileSync(join(root, '.env.example'), 'utf8'));

// 가짜 값은 실행 시 조립한다(소스에 키 모양 문자열을 그대로 쓰지 않음).
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) => [b64u({alg: 'HS256', typ: 'JWT'}), b64u({role, ref: 'fake'}), 'fakesig' + 'z'.repeat(10)].join('.');
const H = 'dev-a.example.test';
const dev = () => ({
  NEXT_PUBLIC_SUPABASE_URL: 'https://' + H,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'),
  SUPABASE_SERVICE_ROLE_KEY: 'sb_' + 'secret_' + 'd'.repeat(20),
  PICKLE_INGEST_TOKEN: 'fake-dev-token-' + 't'.repeat(30),
  DASHBOARD_USER_ID: '00000000-0000-4000-8000-' + '0'.repeat(12),
});
const ops = () => ({
  NEXT_PUBLIC_SUPABASE_URL: 'https://ops-b.example.test',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon') + 'o',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_' + 'secret_' + 'o'.repeat(20),
  PICKLE_INGEST_TOKEN: 'fake-ops-token-' + 'u'.repeat(30),
  DASHBOARD_USER_ID: '11111111-1111-4111-8111-' + '1'.repeat(12),
});
const check = (env) => checkEnv(env, names, examples);
const namesOf = (ps) => ps.map((p) => p.name);

test('.env.example 에서 필수 이름을 읽는다', () => {
  for (const n of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PICKLE_INGEST_TOKEN', 'DASHBOARD_USER_ID']) assert.ok(names.includes(n), n);
});

test('모두 통과하는 경우', () => {
  assert.deepEqual(check(dev()), []);
  assert.deepEqual(check(ops()), []);
  assert.deepEqual(compareEnvs(dev(), ops()), []);
});

test('(a) 없거나 비어 있음', () => {
  const e = dev(); delete e.DASHBOARD_USER_ID; e.PICKLE_INGEST_TOKEN = '';
  assert.deepEqual(namesOf(check(e)).sort(), ['DASHBOARD_USER_ID', 'PICKLE_INGEST_TOKEN']);
});

test('(b) 자리표시자', () => {
  const e = dev(); e.SUPABASE_SERVICE_ROLE_KEY = examples.SUPABASE_SERVICE_ROLE_KEY;
  assert.deepEqual(namesOf(check(e)), ['SUPABASE_SERVICE_ROLE_KEY']);
  const e2 = dev(); e2.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'abc' + 'YOUR_' + 'thing';
  assert.deepEqual(namesOf(check(e2)), ['NEXT_PUBLIC_SUPABASE_ANON_KEY']);
});

test('(c) Supabase URL 형식', () => {
  for (const ok of ['https://' + H, 'https://' + H + '/', 'https://' + H + ':8443']) {
    assert.notEqual(normalizeSupabaseUrl(ok), null, 'ok case');
    const e = dev(); e.NEXT_PUBLIC_SUPABASE_URL = ok; assert.deepEqual(check(e), []);
  }
  const bad = [
    'http://' + H, 'https://' + H + '/rest/v1', 'https://' + H + '?a=1', 'https://' + H + '#x', 'https://u:p@' + H,
    'https://' + H + '?', 'https://' + H + '#', 'https://@' + H, 'https://' + H + '/a/..', 'https://' + H + '/./', 'https://' + H + '//',
    'https://', 'not a url',
  ];
  bad.forEach((u, i) => {
    assert.equal(normalizeSupabaseUrl(u), null, 'bad case #' + i);
    const e = dev(); e.NEXT_PUBLIC_SUPABASE_URL = u;
    assert.deepEqual(namesOf(check(e)), ['NEXT_PUBLIC_SUPABASE_URL'], 'bad case #' + i);
  });
  assert.equal(normalizeSupabaseUrl('https://DEV-A.Example.test:443/'), 'https://dev-a.example.test');
});

test('(d) 수신 토큰 32자 미만', () => {
  const e = dev(); e.PICKLE_INGEST_TOKEN = 'x'.repeat(31);
  assert.deepEqual(namesOf(check(e)), ['PICKLE_INGEST_TOKEN']);
  e.PICKLE_INGEST_TOKEN = 'x'.repeat(32);
  assert.deepEqual(check(e), []);
});

test('(e) DASHBOARD_USER_ID UUID 형식', () => {
  const e = dev(); e.DASHBOARD_USER_ID = 'not-a-uuid';
  assert.deepEqual(namesOf(check(e)), ['DASHBOARD_USER_ID']);
});

test('(f) NEXT_PUBLIC_CONFIG 에 합성 service_role JWT·sb_secret_ 키를 넣으면 실패', () => {
  const e = dev(); e.NEXT_PUBLIC_CONFIG = jwt('service_role');
  assert.deepEqual(namesOf(check(e)), ['NEXT_PUBLIC_CONFIG']);
  const e2 = dev(); e2.NEXT_PUBLIC_CONFIG = 'sb_' + 'secret_' + 'q'.repeat(20);
  assert.deepEqual(namesOf(check(e2)), ['NEXT_PUBLIC_CONFIG']);
  const e3 = dev(); e3.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt('service_role');
  assert.deepEqual(namesOf(check(e3)), ['NEXT_PUBLIC_SUPABASE_ANON_KEY']);
  const e4 = dev(); e4.NEXT_PUBLIC_CONFIG = 'a.%%%.b'; // 디코드 실패는 무시
  assert.deepEqual(check(e4), []);
});

test('(g) 서버 키·수신 토큰을 NEXT_PUBLIC_CONFIG 로 복사하면 실패, 서버 키와 토큰이 같아도 실패', () => {
  const t = dev(); t.NEXT_PUBLIC_CONFIG = t.PICKLE_INGEST_TOKEN;
  assert.deepEqual(namesOf(check(t)), ['NEXT_PUBLIC_CONFIG']);
  const k = dev(); k.SUPABASE_SERVICE_ROLE_KEY = 'srv-' + 'k'.repeat(30); k.NEXT_PUBLIC_CONFIG = k.SUPABASE_SERVICE_ROLE_KEY;
  assert.deepEqual(namesOf(check(k)), ['NEXT_PUBLIC_CONFIG']);
  const s = dev(); s.SUPABASE_SERVICE_ROLE_KEY = s.PICKLE_INGEST_TOKEN;
  assert.deepEqual(namesOf(check(s)), ['PICKLE_INGEST_TOKEN']);
});

test('(h) NEXT_PUBLIC_ 이름에 SERVICE_ROLE·SECRET·TOKEN', () => {
  for (const n of ['NEXT_PUBLIC_SERVICE_ROLE', 'NEXT_PUBLIC_MY_SECRET', 'NEXT_PUBLIC_TOKEN_X']) {
    const e = dev(); e[n] = 'harmless';
    assert.deepEqual(namesOf(check(e)), [n]);
  }
});

test('비교 규칙', () => {
  const same = (patch) => { const o = {...ops(), ...patch}; return namesOf(compareEnvs(dev(), o)); };
  assert.deepEqual(same({NEXT_PUBLIC_SUPABASE_URL: 'https://' + H}), ['NEXT_PUBLIC_SUPABASE_URL']);
  assert.deepEqual(same({NEXT_PUBLIC_SUPABASE_URL: 'https://' + H + '/'}), ['NEXT_PUBLIC_SUPABASE_URL']);
  assert.deepEqual(same({NEXT_PUBLIC_SUPABASE_URL: 'https://' + H.toUpperCase()}), ['NEXT_PUBLIC_SUPABASE_URL']);
  assert.deepEqual(same({SUPABASE_SERVICE_ROLE_KEY: dev().SUPABASE_SERVICE_ROLE_KEY}), ['SUPABASE_SERVICE_ROLE_KEY']);
  assert.deepEqual(same({PICKLE_INGEST_TOKEN: dev().PICKLE_INGEST_TOKEN}), ['PICKLE_INGEST_TOKEN']);

  // DASHBOARD_USER_ID
  assert.deepEqual(same({DASHBOARD_USER_ID: dev().DASHBOARD_USER_ID}), ['DASHBOARD_USER_ID']);
  const lowerId = 'abcdefab-cdef-4abc-8def-' + 'abcdef'.repeat(2);
  const upperId = lowerId.toUpperCase();
  assert.notEqual(lowerId, upperId);
  assert.deepEqual(namesOf(compareEnvs({...dev(), DASHBOARD_USER_ID: lowerId}, {...ops(), DASHBOARD_USER_ID: upperId})), ['DASHBOARD_USER_ID']);
  assert.ok(!same({DASHBOARD_USER_ID: 'not-a-uuid'}).includes('DASHBOARD_USER_ID'));
  assert.ok(!same({DASHBOARD_USER_ID: ''}).includes('DASHBOARD_USER_ID'));
  const both = (v) => namesOf(compareEnvs({...dev(), DASHBOARD_USER_ID: v}, {...ops(), DASHBOARD_USER_ID: v}));
  assert.ok(!both('not-a-uuid').includes('DASHBOARD_USER_ID'));
  assert.ok(!both('').includes('DASHBOARD_USER_ID'));
});

test('파싱: 허용되는 문법', () => {
  const text = ['# 주석', '', '  # 들여쓴 주석', 'A_1=plain value  ', 'B="quoted # x"', "C='single $ ok'", 'D=a=b=c', 'E=', 'F=""'].join('\n');
  const {env, errors} = parseEnvFile(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(env, {A_1: 'plain value', B: 'quoted # x', C: 'single $ ok', D: 'a=b=c', E: '', F: ''});
});

test('파싱 오류', () => {
  const cases = ['NO_EQUALS_LINE', 'export A=1', 'lower=1', 'A="unclosed', "A='unclosed", 'A="x" tail', 'A=$OTHER_VALUE', 'A="pre${OTHER_VALUE}"'];
  for (const c of cases) {
    const {errors} = parseEnvFile('# head\n' + c);
    assert.equal(errors.length, 1, c);
    assert.equal(errors[0].line, 2);
  }
  const dup = parseEnvFile('A=1\nB=2\nA=3');
  assert.deepEqual(dup.errors.map((e) => e.line), [3]);
});

// ---- CLI ----
const toFile = (env) => Object.entries(env).map(([k, v]) => `${k}="${v}"`).join('\n') + '\n';
const fakeValues = [...Object.values(dev()), ...Object.values(ops()), H, 'ops-b.example.test', jwt('service_role')];

function run(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {encoding: 'utf8', env: {PATH: process.env.PATH, ...extraEnv}});
  return {code: r.status, out: (r.stdout || '') + (r.stderr || '')};
}
function assertNoLeak(out, extra = []) {
  for (const v of [...fakeValues, ...extra]) assert.ok(!out.includes(v), 'CLI 출력에 가짜 값/원문이 들어 있음');
}

test('CLI: 종료 코드와 값 비노출', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'check-env-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const f = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
  const devF = f('dev.env', toFile(dev()));
  const opsF = f('ops.env', toFile(ops()));

  let r = run([devF]);
  assert.equal(r.code, 0); assert.match(r.out, /OK/); assertNoLeak(r.out, [devF, dir]);

  r = run(['--compare', devF, opsF]);
  assert.equal(r.code, 0); assertNoLeak(r.out, [devF, opsF, dir]);

  const leakVal = jwt('service_role');
  const badF = f('bad.env', toFile({...dev(), NEXT_PUBLIC_CONFIG: leakVal, PICKLE_INGEST_TOKEN: 'short-' + 'w'.repeat(8)}));
  r = run([badF]);
  assert.equal(r.code, 1); assert.match(r.out, /NEXT_PUBLIC_CONFIG/); assert.match(r.out, /PICKLE_INGEST_TOKEN/);
  assertNoLeak(r.out, [badF, dir, leakVal, 'short-' + 'w'.repeat(8)]);

  const sameF = f('same.env', toFile({...ops(), NEXT_PUBLIC_SUPABASE_URL: 'https://' + H + '/', SUPABASE_SERVICE_ROLE_KEY: dev().SUPABASE_SERVICE_ROLE_KEY}));
  r = run(['--compare', devF, sameF]);
  assert.equal(r.code, 1); assert.match(r.out, /NEXT_PUBLIC_SUPABASE_URL/); assert.match(r.out, /SUPABASE_SERVICE_ROLE_KEY/);
  assertNoLeak(r.out, [sameF, dir]);

  const sameIdF = f('same-id.env', toFile({...ops(), DASHBOARD_USER_ID: dev().DASHBOARD_USER_ID}));
  r = run(['--compare', devF, sameIdF]);
  assert.equal(r.code, 1); assert.match(r.out, /DASHBOARD_USER_ID/);
  assertNoLeak(r.out, [sameIdF, dir]);

  const rawLine = 'PICKLE_INGEST_TOKEN=$OTHER_VALUE_' + 'p'.repeat(12);
  const parseF = f('parse.env', toFile(dev()).replace(/PICKLE_INGEST_TOKEN=.*\n/, rawLine + '\n'));
  r = run([parseF]);
  assert.equal(r.code, 2); assert.match(r.out, /줄/);
  assertNoLeak(r.out, [rawLine, 'OTHER_VALUE_', parseF, dir]);

  const missing = join(dir, 'missing-' + 'm'.repeat(6) + '.env');
  for (const args of [[missing], ['--compare', devF, missing], ['--compare', missing, opsF]]) {
    r = run(args);
    assert.equal(r.code, 2);
    assert.match(r.out, /파일을 읽을 수 없음/);
    assert.ok(!/ENOENT|no such file/i.test(r.out));
    assertNoLeak(r.out, [missing, dir, 'missing-']);
  }

  for (const args of [['--compare'], ['--compare', devF], ['--compare', devF, opsF, devF], [devF, opsF], ['--bogus']]) {
    r = run(args);
    assert.equal(r.code, 2); assert.match(r.out, /사용법/); assertNoLeak(r.out, [devF, opsF, dir]);
  }

  // 인자가 없으면 process.env 점검
  r = run([], dev());
  assert.equal(r.code, 0); assertNoLeak(r.out);
  r = run([], {...dev(), NEXT_PUBLIC_CONFIG: dev().PICKLE_INGEST_TOKEN});
  assert.equal(r.code, 1); assertNoLeak(r.out);
  r = run([], {});
  assert.equal(r.code, 1);
});

test('BACKFILL_APPLY_ENABLED: 켜진 값은 위반, 없음·빈 값·false 는 통과', () => {
  for (const v of ['true', 'TRUE', ' 1 ', 'yes']) {
    assert.deepEqual(namesOf(check({...dev(), BACKFILL_APPLY_ENABLED: v})), ['BACKFILL_APPLY_ENABLED'], v);
  }
  for (const v of ['', 'false', 'FALSE', ' False ']) {
    assert.deepEqual(check({...dev(), BACKFILL_APPLY_ENABLED: v}), [], JSON.stringify(v));
  }
  assert.deepEqual(check(dev()), []);
});

test('CLI --compare: 운영 파일에만 켜진 BACKFILL_APPLY_ENABLED 는 종료 코드 1, 값 비노출', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'check-env-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const flag = 'synthetic-flag-on-A';
  const devF = join(dir, 'dev.env');
  const opsF = join(dir, 'ops.env');
  writeFileSync(devF, toFile(dev()));
  writeFileSync(opsF, toFile({...ops(), BACKFILL_APPLY_ENABLED: flag}));
  const r = spawnSync(process.execPath, [script, '--compare', devF, opsF], {encoding: 'utf8', env: {PATH: process.env.PATH}});
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  assert.equal(r.status, 1);
  assert.match(stderr, /운영 BACKFILL_APPLY_ENABLED/);
  const lines = stderr.split('\n').filter((l) => l.includes('BACKFILL_APPLY_ENABLED'));
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(!l.includes(flag), '플래그 값이 줄에 노출됨');
  assertNoLeak(stdout + stderr, [devF, opsF, dir, flag]);
});

test('npm run check-env 스크립트가 등록되어 있다', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['check-env'], 'node scripts/check-env.mjs');
});
