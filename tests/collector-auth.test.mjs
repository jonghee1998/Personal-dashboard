import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkCollectorToken,collectorAuthFailureLog} from '../lib/collector-auth.ts';

const secret='fake-collector-token-0123456789abcdef';
const fail=(authorization,...rest)=>{const r=checkCollectorToken(authorization,rest.length?rest[0]:secret);return r.ok?'ok':r.reason;};

test('server secret missing or empty',()=>{
 assert.equal(fail('Bearer '+secret,undefined),'server_secret_missing');
 assert.equal(fail('Bearer '+secret,''),'server_secret_missing');
});

test('server secret shorter than 32 JS characters',()=>{
 const short='fake-collector-token-0123456789';
 assert.equal(short.length,31);
 assert.equal(fail('Bearer '+short,short),'server_secret_short');
 const multibyte='fake-'+'가'.repeat(26);
 assert.equal(multibyte.length,31);
 assert.ok(Buffer.byteLength(multibyte)>=32);
 assert.equal(fail('Bearer '+multibyte,multibyte),'server_secret_short');
});

test('missing or non-Bearer authorization header',()=>{
 assert.equal(fail(null),'no_bearer');
 assert.equal(fail('bearer '+secret),'no_bearer');
 assert.equal(fail('Token '+secret),'no_bearer');
 assert.equal(fail('Bearer'),'no_bearer');
});

test('wrong token is mismatch regardless of length or content',()=>{
 assert.equal(fail('Bearer '),'mismatch');
 const sameLength='fake-collector-token-ZZZZZZZZZZZZZZZZ';
 assert.equal(sameLength.length,secret.length);
 assert.equal(fail('Bearer '+sameLength),'mismatch');
 assert.equal(fail('Bearer '+secret.slice(0,-1)),'mismatch');
 assert.equal(fail('Bearer '+secret+' '),'mismatch');
});

test('exact token is accepted',()=>{
 assert.deepEqual(checkCollectorToken('Bearer '+secret,secret),{ok:true});
});

test('failure log is one JSON line with only event, route, reason',()=>{
 const header='Bearer fake-collector-token-header-value-xyz';
 const line=collectorAuthFailureLog('/api/ingest','mismatch');
 assert.ok(!line.includes('\n'));
 const parsed=JSON.parse(line);
 assert.deepEqual(Object.keys(parsed).sort(),['event','reason','route']);
 assert.deepEqual(parsed,{event:'collector_auth_failed',route:'/api/ingest',reason:'mismatch'});
 assert.ok(!line.includes(secret));
 assert.ok(!line.includes(header));
 for(const reason of ['server_secret_missing','server_secret_short','no_bearer','mismatch'])
  assert.equal(JSON.parse(collectorAuthFailureLog('/api/ingest',reason)).reason,reason);
});

test('failure log replaces odd route or reason with invalid',()=>{
 assert.equal(JSON.parse(collectorAuthFailureLog('/x','mismatch')).route,'invalid');
 assert.equal(JSON.parse(collectorAuthFailureLog('https://a.example.invalid','mismatch')).route,'invalid');
 const leaked=JSON.parse(collectorAuthFailureLog('/api/ingest',secret));
 assert.equal(leaked.reason,'invalid');
 assert.ok(!collectorAuthFailureLog('/api/ingest',secret).includes(secret));
});

const root=new URL('..',import.meta.url).pathname;
const routes=['app/api/ingest/route.ts'];

test('removed /api/sync-runs route file is absent',()=>{
 assert.equal(existsSync(join(root,'app/api/sync-runs')),false);
});
const call=/checkCollectorToken\(\s*req\.headers\.get\('authorization'\)\s*,\s*process\.env\.PICKLE_INGEST_TOKEN\s*\)/g;

test('collector routes use only the shared token check',()=>{
 for(const file of routes){
  const src=readFileSync(join(root,file),'utf8');
  assert.ok(src.includes('checkCollectorToken('),file);
  assert.ok((src.match(call)??[]).length>=1,file);
  const rest=src.replace(call,'');
  assert.ok(!rest.includes('timingSafeEqual'),file);
  assert.ok(!rest.includes('process.env.PICKLE_INGEST_TOKEN'),file);
 }
});
