// 정적 검사: supabase/seed.sql 과 tests/db/*.test.sql 의 형태. 실제 실행은 CI db 잡(PostgreSQL)이 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const seed=readFileSync(new URL('../supabase/seed.sql',import.meta.url),'utf8');
const dbDir=new URL('./db/',import.meta.url);
const dbTests=readdirSync(dbDir).filter(f=>f.endsWith('.test.sql')).sort();
const read=f=>readFileSync(new URL(f,dbDir),'utf8');
const A='00000000-0000-4000-8000-0000000000a1', B='00000000-0000-4000-8000-0000000000b1';
const kinds=['transaction','settlement','news','benefit','task','event','journal'];

test('seed is re-runnable: every insert has an on conflict clause',()=>{
  const inserts=seed.match(/insert into [\s\S]*?;/gi)||[];
  assert.equal(inserts.length,3);
  for(const s of inserts) assert.match(s,/on conflict/i);
  assert.match(seed,/on conflict \(user_id,kind,external_id\) do nothing/);
  assert.match(seed,/on conflict \(user_id,run_id,dataset,source_system\) do nothing/);
});

test('seed rows are synthetic development data for fixed users A and B, 1–2 per kind',()=>{
  assert.match(seed,/"environment":"development","is_synthetic":true/);
  assert.doesNotMatch(seed,/"environment":"production"|"is_synthetic":false/);
  const rows=[...seed.matchAll(/\('(0{8}-0000-4000-8000-0000000000[ab]1)','(\w+)','(seed-[ab]-[\w-]+)'/g)];
  assert.equal(rows.length,15);
  for(const u of [A,B]) for(const k of kinds){
    const n=rows.filter(r=>r[1]===u&&r[2]===k).length;
    assert.ok(n>=1&&n<=2,`${u} ${k}: ${n}`);
  }
  assert.equal(new Set(rows.map(r=>r[1]+r[2]+r[3])).size,rows.length);
});

test('seed rerun test asserts every seeded key',()=>{
  const rerun=read('60_seed_rerun.test.sql');
  assert.match(rerun,/^\\i supabase\/seed\.sql$/m);
  for(const m of seed.matchAll(/'(seed-[ab]-[\w-]+)'/g)) assert.ok(rerun.includes(`'${m[1]}'`),m[1]);
});

test('db tests 10–60 exist, end with reset role, and wrap data changes in rollback',()=>{
  for(const p of ['10_rls','20_sync_runs_write','30_upsert','40_trigger','50_sync_runs_check','60_seed_rerun'])
    assert.ok(dbTests.includes(`${p}.test.sql`),p);
  for(const f of dbTests){
    const s=read(f);
    if(f==='01_migrations.test.sql') continue;
    assert.match(s.trim(),/reset role;$/,f);
    if(/^\s*(insert|update)\b/im.test(s)&&!f.startsWith('60_')) assert.match(s,/^rollback;$/m,f);
  }
});
