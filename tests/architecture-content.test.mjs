import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative,sep} from 'node:path';
import * as content from '../lib/architecture-content.ts';
import {architectureSections,apiRows,vercelEnv,githubSecrets,flowSteps,targetRows,targetDiagram} from '../lib/architecture-content.ts';

const root=new URL('..',import.meta.url).pathname;
const routeFiles=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?routeFiles(join(dir,e.name)):e.name==='route.ts'?[join(dir,e.name)]:[]);
const apiPaths=()=>routeFiles(join(root,'app','api')).map(f=>'/'+relative(join(root,'app'),f).split(sep).slice(0,-1).join('/')).sort();

test('sections 01-09 appear in order with the required categories',()=>{
 assert.deepEqual(architectureSections.map(s=>s.no),['01','02','03','04','05','06','07','08','09']);
 assert.deepEqual(architectureSections.map(s=>s.kicker),['목표 구조','요약','아키텍처','배포·비밀값','데이터 흐름','화면','API','안전장치','개발 방식']);
 for(const s of architectureSections)assert.ok(s.title.length>0&&s.title.length<=30,s.title);
});

test('target table has 8 now→target rows with a phase per row',()=>{
 assert.equal(targetRows.length,8);
 assert.deepEqual(targetRows.map(r=>r.area),['저장소','AI 팀','수신 API','DB','배포','테스트','피클AI','화면']);
 for(const r of targetRows){
  for(const k of ['area','now','target','phase'])assert.ok(typeof r[k]==='string'&&r[k].trim().length>0,`${r.area}.${k}`);
  assert.match(r.phase,/^(완료|[1-9][0-9]*단계)$/,r.area);
 }
});

test('target table rows no longer mention the removed demo',()=>{
 for(const r of targetRows)assert.ok(!r.now.includes('데모'),`${r.area}.now mentions 데모: ${r.now}`);
});

test('target table phases point at roadmap phases that are not done yet',()=>{
 const phases=JSON.parse(readFileSync(join(root,'docs','roadmap.json'),'utf8')).phases;
 for(const r of targetRows){
  assert.ok(r.phase==='완료'||/^[1-9][0-9]*단계$/.test(r.phase),`${r.area}: phase must be 'N단계' or '완료' (got ${r.phase})`);
  if(r.phase==='완료')continue;
  const id=r.phase.replace(/단계$/,'');
  const phase=phases.find(p=>p.id===id);
  assert.notEqual(phase,undefined,`${r.area}: docs/roadmap.json has no phase with id '${id}'`);
  assert.notEqual(phase.status,'done',`${r.area}: roadmap phase ${id} is already done but the row still shows '${r.phase}'. 단계를 done 으로 바꿀 때 targetRows 와 docs/architecture.json 의 해당 행도 함께 갱신하세요(phase → '완료').`);
 }
});

test('screen row is complete after step 7',()=>{
 const screen=targetRows.find(r=>r.area==='화면');
 assert.notEqual(screen,undefined);
 assert.equal(screen.phase,'완료');
});

test('docs/architecture.json target table matches targetRows',()=>{
 const doc=JSON.parse(readFileSync(join(root,'docs','architecture.json'),'utf8'));
 const head=['영역','지금','목표','단계'];
 const tables=[];
 const walk=(v)=>{
  if(Array.isArray(v)){v.forEach(walk);return;}
  if(v&&typeof v==='object'){
   if(Array.isArray(v.head)&&JSON.stringify(v.head)===JSON.stringify(head))tables.push(v);
   Object.values(v).forEach(walk);
  }
 };
 walk(doc);
 assert.equal(tables.length,1,"docs/architecture.json must have exactly one table with head ['영역','지금','목표','단계']");
 assert.deepEqual(tables[0].rows,targetRows.map(r=>[r.area,r.now,r.target,r.phase]),'docs/architecture.json target table differs from targetRows — 둘을 함께 갱신하세요');
});

test('target diagram text names dev/ops areas and the legend',()=>{
 assert.equal(targetDiagram.legend,'왼쪽 = AI가 만지는 개발 영역 · 진한 상자 = 실데이터(AI 접근 금지)');
 assert.deepEqual(targetDiagram.github,['GitHub · AI 팀','코드만 · 데이터 없음']);
 assert.ok(targetDiagram.ariaLabel.length>0);
 assert.doesNotMatch(JSON.stringify(targetDiagram),/vercel\.app|supabase\.co/i);
});

test('API table lists every app/api/**/route.ts exactly once',()=>{
 const files=apiPaths();
 assert.equal(files.length,4);
 assert.deepEqual([...apiRows.map(r=>r.path)].sort(),files);
});

test('API methods match the exported handlers of each route',()=>{
 for(const row of apiRows){
  const source=readFileSync(join(root,'app',row.path,'route.ts'),'utf8');
  const exported=[...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)].map(m=>m[1]).sort();
  assert.deepEqual(row.methods.split(' · ').sort(),exported,row.path);
 }
});

test('no API is left marked for cleanup (one-off APIs removed in step 6-5)',()=>{
 const cleanup=apiRows.filter(r=>r.cleanup).map(r=>r.path);
 assert.deepEqual(cleanup,[]);
 const screen=readFileSync(join(root,'components','architecture-screen.tsx'),'utf8');
 assert.ok(!screen.includes('정리 예정'));
 assert.ok(!vercelEnv.some(e=>e.name==='BACKFILL_APPLY_ENABLED'));
});

test('environment variables are names used by the code, server-only ones are not public',()=>{
 const example=readFileSync(join(root,'.env.example'),'utf8');
 for(const env of vercelEnv){
  if(!env.note)assert.match(example,new RegExp('^'+env.name+'=','m'),env.name);
  assert.equal(env.scope==='공개',env.name.startsWith('NEXT_PUBLIC_'),env.name);
 }
 const workflows=readdirSync(join(root,'.github','workflows')).map(f=>readFileSync(join(root,'.github','workflows',f),'utf8')).join('\n');
 const secrets=[...new Set([...workflows.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(m=>m[1]))].sort();
 assert.deepEqual(githubSecrets.map(s=>s.name).sort(),secrets);
});

test('data flow uses the upsert conflict key from the ingest route',()=>{
 // The ingest route writes only through the DB function; the conflict key lives in its upsert.
 const ingest=readFileSync(join(root,'app','api','ingest','route.ts'),'utf8');
 assert.match(ingest,/rpc\('dashboard_ingest_commit'/);
 const commit=readFileSync(join(root,'supabase','migrations','20261124000100_ingest_support.sql'),'utf8');
 assert.match(commit,/on conflict \(user_id, kind, external_id\) do update/);
 assert.ok(flowSteps.some(s=>s.line2.includes('user_id + kind + external_id')));
});

test('static content contains no URLs or secret-looking values',()=>{
 const text=JSON.stringify(content);
 assert.doesNotMatch(text,/https?:\/\//);
 assert.doesNotMatch(text,/supabase\.co|vercel\.app|eyJ[A-Za-z0-9_-]{10,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test('dashboard registers the architecture tab outside the data-loading branch',()=>{
 const src=readFileSync(join(root,'components','dashboard','dashboard-shell.tsx'),'utf8');
 assert.match(src,/\['architecture','구조'\]/);
 assert.match(src,/tab==='architecture'\?<ArchitectureScreen\/>:loading\?/);
 assert.match(src,/tab!=='architecture'&&<small className="pageUpdateTime"/);
 assert.match(src,/tab!=='architecture'&&<button type="button" className=\{"refreshButton"/);
});
