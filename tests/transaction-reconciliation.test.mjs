import test from 'node:test';
import assert from 'node:assert/strict';
import {strongTransactionKey,duplicateConflicts,reconcileStatement} from '../lib/transaction-reconciliation.ts';
const scope={source_system:'samsungcard',account_key:'account-a',billing_month:'2026-11',amount_basis:'statement_billed',currency:'KRW'};
const row=(id,amount,external_id=id,overrides={})=>({kind:'transaction',external_id,status:'active',currency:'KRW',amount,metadata:{...scope,source_record_id:id,source_record_id_type:'provider',...overrides}});
test('same provider ID on different external IDs is blocked; retry is allowed',()=>{
 assert.equal(duplicateConflicts([row('a',100,'new')],[row('a',100,'old')])[0].code,'DUPLICATE_SOURCE_TRANSACTION');
 assert.deepEqual(duplicateConflicts([row('a',100)],[row('a',100)]),[]);
});
test('same batch duplicate and account or month isolation',()=>{
 assert.equal(duplicateConflicts([row('a',100,'x'),row('a',100,'y')],[]).length,1);
 assert.deepEqual(duplicateConflicts([row('a',100,'x',{account_key:'account-b'})],[row('a',100,'y')]),[]);
 assert.deepEqual(duplicateConflicts([row('a',100,'x',{billing_month:'2026-12'})],[row('a',100,'y')]),[]);
});
test('hash-only legacy identity is never a strong key',()=>assert.equal(strongTransactionKey(row('a',100,'x',{source_record_id_type:'fingerprint'})),null));
test('equal counts and totals with signed refunds match within scope only',()=>{
 const v=reconcileStatement([row('a',100),row('b',-20),row('c',99,'c',{billing_month:'2026-12'})],[{source_record_id:'a',amount:100},{source_record_id:'b',amount:-20}],scope,2,80);
 assert.equal(v.status,'scope_match');assert.equal(v.observed_total,80);
});
test('equal totals can hide missing and extra IDs',()=>{
 const v=reconcileStatement([row('a',100),row('x',20)],[{source_record_id:'a',amount:100},{source_record_id:'b',amount:20}],scope,2,120);
 assert.equal(v.status,'mismatch');assert.deepEqual(v.missing_ids,['b']);assert.deepEqual(v.extra_ids,['x']);
});
test('duplicates and amount discrepancies detected even if totals match',()=>{
 const v=reconcileStatement([row('a',50,'x'),row('a',50,'y')],[{source_record_id:'a',amount:100}],scope,1,100);
 assert.equal(v.status,'mismatch');assert.deepEqual(v.duplicate_ids,['a']);
 assert.equal(v.amount_mismatches.length,1);
});
test('unknown scope is reported without fabricated billing month',()=>{
 const v=reconcileStatement([row('a',100),row('b',10,'b',{billing_month:undefined})],[{source_record_id:'a',amount:100}],scope,1,100);
 assert.equal(v.status,'scope_match_unmapped_records_remain');assert.equal(v.unmapped_source_records,1);
});
test('manifest must independently match supplied count and total',()=>{
 const v=reconcileStatement([row('a',100)],[{source_record_id:'a',amount:100}],scope,1,101);
 assert.equal(v.status,'mismatch');
});

test('legacy records missing source_system are counted as unresolved, never assigned a scope',()=>{
 const v=reconcileStatement([row('a',100),{kind:'transaction',external_id:'legacy',source:'삼성카드',status:'active',currency:'KRW',amount:20,metadata:{memo:'keep'}}],[{source_record_id:'a',amount:100}],scope,1,100);
 assert.equal(v.status,'scope_match_unmapped_records_remain');assert.equal(v.unmapped_source_records,1);assert.equal(v.unknown_source_records,1);assert.equal(v.observed_count,1);
});
