import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative,sep} from 'node:path';
import * as content from '../lib/architecture-content.ts';
import {architectureSections,apiRows,vercelEnv,githubSecrets,flowSteps} from '../lib/architecture-content.ts';

const root=new URL('..',import.meta.url).pathname;
const routeFiles=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?routeFiles(join(dir,e.name)):e.name==='route.ts'?[join(dir,e.name)]:[]);
const apiPaths=()=>routeFiles(join(root,'app','api')).map(f=>'/'+relative(join(root,'app'),f).split(sep).slice(0,-1).join('/')).sort();

test('sections 01-08 appear in order with the required categories',()=>{
 assert.deepEqual(architectureSections.map(s=>s.no),['01','02','03','04','05','06','07','08']);
 assert.deepEqual(architectureSections.map(s=>s.kicker),['요약','아키텍처','배포·비밀값','데이터 흐름','화면','API','안전장치','개발 방식']);
 for(const s of architectureSections)assert.ok(s.title.length>0&&s.title.length<=30,s.title);
});

test('API table lists every app/api/**/route.ts exactly once',()=>{
 const files=apiPaths();
 assert.equal(files.length,8);
 assert.deepEqual([...apiRows.map(r=>r.path)].sort(),files);
});

test('API methods match the exported handlers of each route',()=>{
 for(const row of apiRows){
  const source=readFileSync(join(root,'app',row.path,'route.ts'),'utf8');
  const exported=[...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)].map(m=>m[1]).sort();
  assert.deepEqual(row.methods.split(' · ').sort(),exported,row.path);
 }
});

test('one-off backfill and reconcile APIs are marked for cleanup',()=>{
 const cleanup=apiRows.filter(r=>r.cleanup).map(r=>r.path).sort();
 assert.deepEqual(cleanup,['/api/backfill/control','/api/backfill/preview','/api/backfill/stage','/api/reconcile/transactions']);
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
 const ingest=readFileSync(join(root,'app','api','ingest','route.ts'),'utf8');
 assert.match(ingest,/onConflict:'user_id,kind,external_id'/);
 assert.ok(flowSteps.some(s=>s.line2.includes('user_id + kind + external_id')));
});

test('static content contains no URLs or secret-looking values',()=>{
 const text=JSON.stringify(content);
 assert.doesNotMatch(text,/https?:\/\//);
 assert.doesNotMatch(text,/supabase\.co|eyJ[A-Za-z0-9_-]{10,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test('dashboard registers the architecture tab outside the data-loading branch',()=>{
 const src=readFileSync(join(root,'components','demo-dashboard.tsx'),'utf8');
 assert.match(src,/\['architecture','구조',''\]/);
 assert.match(src,/tab==='architecture'\?<ArchitectureScreen\/>:loading\?/);
 assert.match(src,/tab!=='architecture'&&<small className="pageUpdateTime"/);
 assert.match(src,/tab!=='architecture'&&<button type="button" className=\{"refreshButton"/);
});
