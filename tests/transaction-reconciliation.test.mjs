import test from 'node:test';
import assert from 'node:assert/strict';
import {strongTransactionKey,duplicateConflicts} from '../lib/transaction-reconciliation.ts';
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
