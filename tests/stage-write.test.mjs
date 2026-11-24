import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {resolveStageWriteError,stageWriteOutcome} from '../lib/stage-write.ts';
import {apiFailureLog} from '../lib/api-log.ts';

const lookup=result=>{
 const fn=()=>{fn.calls++;return Promise.resolve(result);};
 fn.calls=0;return fn;
};
const fakeBatch={id:'00000000-0000-4000-8000-0000000000b1',status:'staged',plan_digest:'a'.repeat(64),summary:{},created_at:'2026-01-01T00:00:00Z'};

test('23505 + lookup success → ok with data, one lookup',async()=>{
 const l=lookup({data:fakeBatch,error:null});
 assert.deepEqual(await resolveStageWriteError({code:'23505'},l),{ok:true,data:fakeBatch});
 assert.equal(l.calls,1);
});

test('23505 + lookup error → existing_lookup with the lookup error (not writeError)',async()=>{
 const writeError={code:'23505'},lookupError={code:'PGRST116'};
 const l=lookup({data:null,error:lookupError});
 const r=await resolveStageWriteError(writeError,l);
 assert.equal(r.ok,false);
 assert.equal(r.stage,'existing_lookup');
 assert.equal(r.err,lookupError);
 assert.notEqual(r.err,writeError);
 assert.equal(l.calls,1);
});

test('other code or no code → write with writeError, no lookup',async()=>{
 for(const writeError of [{code:'42501'},{},{code:23505}]){
  const l=lookup({data:fakeBatch,error:null});
  const r=await resolveStageWriteError(writeError,l);
  assert.deepEqual(r,{ok:false,stage:'write',err:writeError});
  assert.equal(r.err,writeError);
  assert.equal(l.calls,0);
 }
});

test('a throwing lookup propagates the same exception',async()=>{
 const boom=new Error('fake lookup failure');
 await assert.rejects(resolveStageWriteError({code:'23505'},()=>{throw boom;}),e=>e===boom);
 await assert.rejects(resolveStageWriteError({code:'23505'},()=>Promise.reject(boom)),e=>e===boom);
 await assert.rejects(stageWriteOutcome({code:'23505'},()=>Promise.reject(boom)),e=>e===boom);
});

test('stageWriteOutcome: 23505 + lookup success → 200 with batch body, no log',async()=>{
 const o=await stageWriteOutcome({code:'23505'},lookup({data:fakeBatch,error:null}));
 assert.equal(o.status,200);
 assert.deepEqual(o.body,{batch:fakeBatch,applied_count:0});
 assert.deepEqual(Object.keys(o.body),['batch','applied_count']);
 assert.equal(o.log,null);
});

test('stageWriteOutcome: 23505 + lookup error → 503, existing_lookup, PGRST116',async()=>{
 const lookupError={code:'PGRST116',message:'fake-message',details:'fake-details'};
 const o=await stageWriteOutcome({code:'23505'},lookup({data:null,error:lookupError}));
 assert.equal(o.status,503);
 assert.deepEqual(o.body,{error:'Stage unavailable'});
 assert.equal(o.log.stage,'existing_lookup');
 assert.equal(o.log.err,lookupError);
 const line=apiFailureLog('/api/backfill/stage',o.log.stage,o.log.err);
 assert.equal(JSON.parse(line).code,'PGRST116');
 assert.ok(!line.includes('fake-'));
});

test('stageWriteOutcome: other write error → 503, write, 42501',async()=>{
 const l=lookup({data:fakeBatch,error:null});
 const writeError={code:'42501'};
 const o=await stageWriteOutcome(writeError,l);
 assert.equal(o.status,503);
 assert.deepEqual(o.body,{error:'Stage unavailable'});
 assert.equal(o.log.stage,'write');
 assert.equal(o.log.err,writeError);
 assert.equal(JSON.parse(apiFailureLog('/api/backfill/stage',o.log.stage,o.log.err)).code,'42501');
 assert.equal(l.calls,0);
});

test('static: stage route delegates the write-error branch to stageWriteOutcome',()=>{
 const route=readFileSync(join(process.cwd(),'app/api/backfill/stage/route.ts'),'utf8');
 assert.ok(route.includes('stageWriteOutcome('));
 assert.ok(route.includes('if(o.log)logApiFailure('));
 assert.ok(route.includes('NextResponse.json(o.body,{status:o.status,headers})'));
 assert.ok(!route.includes("writeError.code==='23505'"));
 // 'Stage unavailable' stays only on the pre-existing outer catch line; the 503 body now comes from lib.
 const lines=route.split('\n').filter(line=>line.includes('Stage unavailable'));
 assert.equal(lines.length,1);
 assert.match(lines[0],/\}catch\(e\)\{logApiFailure\('\/api\/backfill\/stage','unexpected',e\);/);
 const lib=readFileSync(join(process.cwd(),'lib/stage-write.ts'),'utf8');
 assert.ok(lib.includes("{error:'Stage unavailable'}"));
 assert.ok(!/from\s+['"]next/.test(lib));
});
