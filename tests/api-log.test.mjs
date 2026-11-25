import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {apiFailureLog,logApiFailure} from '../lib/api-log.ts';

const parse=line=>JSON.parse(line);
const code=err=>parse(apiFailureLog('/api/ingest','status_lookup',err)).code;
const withCapturedConsole=fn=>{
 const original=console.error;const lines=[];
 console.error=(...args)=>{lines.push(args.join(' '));};
 try{fn();}finally{console.error=original;}
 return lines;
};

test('allow-listed PostgREST code is kept, message is never logged',()=>{
 const line=apiFailureLog('/api/ingest','run_lookup',{code:'PGRST301',message:'https://fake.example.invalid fake-secret'});
 assert.equal(parse(line).code,'PGRST301');
 assert.ok(!line.includes('fake.example.invalid'));
 assert.ok(!line.includes('fake-secret'));
});

test('allow-listed SQLSTATE is kept, details are never logged',()=>{
 const line=apiFailureLog('/api/ingest','write',{code:'42501',details:'Key (x)=(y)',hint:'fake-hint'});
 assert.equal(parse(line).code,'42501');
 assert.ok(!line.includes('Key'));
 assert.ok(!line.includes('fake-hint'));
});

test('every allow-listed code passes through',()=>{
 for(const c of ['PGRST000','PGRST001','PGRST002','PGRST003','PGRST100','PGRST102','PGRST116','PGRST200','PGRST204','PGRST205','PGRST301','PGRST302','PGRST303',
  '08001','08006','22P02','23502','23503','23505','23514','28P01','40001','40P01','42501','42703','42883','42P01','53300','57014','57P01','XX000'])assert.equal(code({code:c}),c);
});

test('plausible-looking codes outside the list are unknown',()=>{
 assert.equal(code({code:'1'.repeat(11)}),'unknown');
 assert.equal(code({code:'123456'}),'unknown');
 assert.equal(code({code:'PGRST999'}),'unknown');
 assert.equal(code({code:'fake_token_abc'}),'unknown');
 assert.equal(code({code:'pgrst301'}),'unknown');
 assert.equal(code({code:42501}),'unknown');
 assert.equal(code({}),'unknown');
});

test('allow-listed Error names, message never logged',()=>{
 const line=apiFailureLog('/api/ingest','unexpected',new TypeError('fetch failed https://fake.example.invalid'));
 assert.equal(parse(line).code,'TypeError');
 assert.ok(!line.includes('fake.example.invalid'));
 assert.equal(code(new Error('x')),'Error');
 assert.equal(code(new SyntaxError('x')),'SyntaxError');
 assert.equal(code(new RangeError('x')),'RangeError');
 const abort=new Error('x');abort.name='AbortError';assert.equal(code(abort),'AbortError');
 const timeout=new Error('x');timeout.name='TimeoutError';assert.equal(code(timeout),'TimeoutError');
 const custom=new Error('x');custom.name='FakeSecretError';assert.equal(code(custom),'unknown');
 assert.equal(code({name:'TypeError'}),'unknown');
});

test('allow-listed code on an Error wins over its name',()=>{
 const e=new Error('fake');e.code='PGRST002';
 assert.equal(code(e),'PGRST002');
 const f=new TypeError('fake');f.code='not-listed';
 assert.equal(code(f),'TypeError');
});

test('throwing getters and proxies become unknown and never throw',()=>{
 const codeGetter={};Object.defineProperty(codeGetter,'code',{get(){throw new Error('x');}});
 const nameGetter=new Error('x');Object.defineProperty(nameGetter,'name',{get(){throw new Error('x');}});
 const proxy=new Proxy({},{getPrototypeOf(){throw new Error('x');}});
 const proxyAll=new Proxy({},{get(){throw new Error('x');},getPrototypeOf(){throw new Error('x');}});
 for(const err of [codeGetter,nameGetter,proxy,proxyAll]){
  let line;
  assert.doesNotThrow(()=>{line=apiFailureLog('/api/ingest','write',err);});
  assert.equal(parse(line).code,'unknown');
  let lines;
  assert.doesNotThrow(()=>{lines=withCapturedConsole(()=>logApiFailure('/api/ingest','write',err));});
  assert.equal(lines.length,1);
  assert.equal(parse(lines[0]).code,'unknown');
 }
});

test('logApiFailure swallows a throwing console.error',()=>{
 const original=console.error;
 console.error=()=>{throw new Error('x');};
 try{assert.doesNotThrow(()=>logApiFailure('/api/ingest','write',{code:'PGRST301'}));}
 finally{console.error=original;}
});

test('missing err is none; primitive err is unknown',()=>{
 assert.equal(code(),'none');
 assert.equal(code(undefined),'none');
 assert.equal(code(null),'none');
 assert.equal(code('PGRST301'),'unknown');
 assert.equal(code(42501),'unknown');
 assert.equal(code(true),'unknown');
});

test('output has exactly event, route, stage, code',()=>{
 const err=new Error('fake-message');err.code='PGRST301';err.details='fake-details';err.hint='fake-hint';err.cause=new Error('fake-cause');
 const line=apiFailureLog('/api/ingest','existing_lookup',err);
 const o=parse(line);
 assert.deepEqual(Object.keys(o).sort(),['code','event','route','stage']);
 assert.deepEqual(o,{event:'api_failure',route:'/api/ingest',stage:'existing_lookup',code:'PGRST301'});
 for(const s of ['fake-message','fake-details','fake-hint','fake-cause','at '])assert.ok(!line.includes(s),s);
 assert.ok(!line.includes('\n'));
});

test('odd route or stage becomes invalid',()=>{
 assert.equal(parse(apiFailureLog('/x','write')).route,'invalid');
 assert.equal(parse(apiFailureLog('https://a.example.invalid','write')).route,'invalid');
 assert.equal(parse(apiFailureLog('/api/'+'a'.repeat(61),'write')).route,'invalid');
 assert.equal(parse(apiFailureLog('/api/ingest','Status Lookup')).stage,'invalid');
 assert.equal(parse(apiFailureLog('/api/ingest','a'.repeat(41))).stage,'invalid');
 assert.equal(parse(apiFailureLog(undefined,undefined)).route,'invalid');
 assert.equal(parse(apiFailureLog('/api/reconcile/transactions','status_lookup')).route,'/api/reconcile/transactions');
});

test('logApiFailure writes exactly one apiFailureLog line',()=>{
 const lines=withCapturedConsole(()=>logApiFailure('/api/ingest','run_lookup',{code:'PGRST301',message:'fake-message'}));
 assert.deepEqual(lines,[apiFailureLog('/api/ingest','run_lookup',{code:'PGRST301'})]);
});

// Static check: every 5xx response in a collector POST handler logs on the same line or the line above.
// A computed status like {status:o.status,...} can be 5xx too, so it is counted with the literal 5xx lines.
const routes=[
 // ingest: 설정 503·v2failure 503·예외 503 (v1 분기는 12단계에서 제거). /api/sync-runs 는 12단계에서 삭제.
 ['app/api/ingest/route.ts',3],
];
const fivexx=/status:\s*(5\d\d|o\.status)\b/;
function postFiveXxLines(source){
 const start=source.indexOf('export async function POST');
 if(start<0)return null;
 const lines=source.slice(start).split('\n');
 return lines.map((line,i)=>({line,prev:i>0?lines[i-1]:'',i})).filter(x=>fivexx.test(x.line));
}

for(const [file,min] of routes){
 test(`static: ${file} logs before every POST 5xx response`,()=>{
  const source=readFileSync(join(process.cwd(),file),'utf8');
  const found=postFiveXxLines(source);
  assert.ok(found,'POST handler missing');
  assert.ok(found.length>=min,`${file}: ${found.length} POST 5xx lines (expected >= ${min})`);
  for(const {line,prev} of found)assert.ok(line.includes('logApiFailure(')||prev.includes('logApiFailure('),`${file}: no logApiFailure near: ${line.trim()}`);
  assert.match(source,/import \{logApiFailure\} from '@\/lib\/api-log';/);
 });
}

test('static: lib/api-log.ts is a pure module',()=>{
 const source=readFileSync(join(process.cwd(),'lib/api-log.ts'),'utf8');
 assert.ok(!/from\s+['"]next/.test(source));
 for(const field of ['.message','.details','.hint','.stack','.cause'])assert.ok(!source.includes(field),field);
});
