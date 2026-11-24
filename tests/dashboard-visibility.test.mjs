import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleDashboardItem,pointProvider,normalizeIncomingStatus} from '../lib/dashboard-visibility.ts';
import {subscriptionDisplay,pointChangeDisplay} from '../lib/dashboard-display.ts';

test('archived point and application examples from Issue #7 are hidden',()=>{
 const rows=[
  {kind:'benefit',category:'points',status:'archived',source:'archived',title:'보관된 이전 레코드',amount:0,metadata:{}},
  {kind:'benefit',category:'archived_history',status:'archived',title:'보관된 이전 레코드',amount:0,metadata:{}}
 ];
 assert.deepEqual(rows.filter(visibleDashboardItem),[]);
});
test('all record kinds hide archived and deleted records',()=>{
 for(const kind of ['transaction','settlement','news','benefit','task','event','journal']){
  for(const status of ['archived','deleted'])assert.equal(visibleDashboardItem({kind,status,title:'old'}),false);
 }
});
test('placeholder point labels are hidden but valid zero balance stays',()=>{
 for(const provider of ['archived','보관','미등록','undefined','null','더미']){
  const row={kind:'benefit',category:'points',status:'active',metadata:{provider}};
  assert.equal(pointProvider(row),null);
  assert.equal(visibleDashboardItem(row),false);
 }
 const row={kind:'benefit',category:'points',status:'active',amount:0,metadata:{provider:'네이버페이'}};
 assert.equal(visibleDashboardItem(row),true);
});
test('paused subscription remains visible and is excluded from active total',()=>{
 const normalized=normalizeIncomingStatus('paused',{last_payment_date:'2026-10-07'},true);
 const row={kind:'benefit',category:'ai_subscription',title:'AI service',...normalized};
 assert.equal(row.status,'active');
 assert.equal(row.metadata.subscription_status,'paused');
 assert.equal(visibleDashboardItem(row),true);
 assert.equal(subscriptionDisplay(row).active,false);
 assert.deepEqual(subscriptionDisplay(row).rows,[{label:'마지막 결제',value:'2026.10.07'}]);
});
test('explicit subscription deletion remains hidden',()=>{
 const normalized=normalizeIncomingStatus('deleted',{subscription_status:'paused'},true);
 assert.equal(normalized.status,'archived');
 assert.equal(visibleDashboardItem({kind:'benefit',category:'ai_subscription',...normalized}),false);
});
test('today point events show both directions without past events',()=>{
 const row={event_date:'2026-11-12',amount:1000,metadata:{previous_balance:900,change_events:[
  {date:'2026-11-11',amount:500,reason:'old'},
  {date:'2026-11-12',amount:300,reason:'적립'},
  {date:'2026-11-12',amount:-200,reason:'사용'}
 ]}};
 const result=pointChangeDisplay(row,'2026-11-12');
 assert.equal(result.up.amount,300);
 assert.equal(result.down.amount,200);
 assert.deepEqual(result.up.reasons,['적립']);
 assert.deepEqual(result.down.reasons,['사용']);
});
