import test from 'node:test';
import assert from 'node:assert/strict';
import {isDashboardSnapshot,monitoredSources,sourceHealth,registeredCoverageDay} from '../lib/dashboard-freshness.ts';
const now=new Date('2026-11-12T06:00:00Z');
test('failed or partial sync preserves previous source timestamp and does not invent a new one',()=>{
 const source='2026-11-11T04:00:00Z';
 for(const status of ['failed','partial','quarantined']){
  const h=sourceHealth(source,{status,received_at:'2026-11-12T03:00:00Z',source_as_of:'2026-11-12T03:00:00Z'},now);
  assert.equal(h.state,'failed');assert.equal(h.last_source_at,source);
 }
});
test('Seoul date freshness and unknown source are distinct',()=>{
 assert.equal(sourceHealth('2026-11-11T16:00:00Z',null,now).state,'current');
 assert.equal(sourceHealth('2026-11-11T14:59:00Z',null,now).state,'delayed');
 assert.equal(sourceHealth(null,null,now).state,'unknown');
});
test('invalid dashboard responses cannot overwrite prior snapshot with empty defaults',()=>{
 assert.equal(isDashboardSnapshot({}),false);
 assert.equal(isDashboardSnapshot({items:[],updates:{},sourceUpdates:{},syncHealth:{}}),false);
 const health=Object.fromEntries(monitoredSources.map(x=>[x.key,sourceHealth(null,null,now)]));
 assert.equal(isDashboardSnapshot({items:[],updates:{},sourceUpdates:{},syncHealth:health}),true);
 assert.equal(isDashboardSnapshot({items:[{id:'a'}],updates:{},sourceUpdates:{},syncHealth:health}),false);
});
test('chart stops at last source or registered date rather than inventing later zero days',()=>{
 assert.equal(registeredCoverageDay('2026-11-10T04:00:00Z',['2026-11-09'],now),'2026-11-10');
 assert.equal(registeredCoverageDay(null,['2026-11-09','2026-11-11'],now),'2026-11-11');
 assert.equal(registeredCoverageDay(null,[],now),null);
});
