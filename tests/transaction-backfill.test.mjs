import test from 'node:test';
import assert from 'node:assert/strict';
import {previewBackfill,fingerprint} from '../lib/transaction-backfill.ts';
const row=(id='a',amount=100,title='shop')=>({id,external_id:id,kind:'transaction',title,amount,currency:'KRW',event_date:'2026-11-01',status:'active',updated_at:'2026-11-12T00:00:00Z',metadata:{memo:'preserve'}});
const evidence=(overrides={})=>({source_system:'samsungcard',account_key:'opaque-card-a',billing_month:'2026-11',amount_basis:'statement_billed',source_record_id_type:'fingerprint',source_date:'2026-11-01',source_merchant:'shop',source_amount:100,evidence_sha256:'a'.repeat(64),source_row_ref:'row-1',...overrides});
const entry=(id='a',e=evidence())=>({external_id:id,classification:'exact_unique',evidence:e});
test('preview changes nothing and patch does not overwrite memo or business fields',()=>{
 const rows=[row()];const before=JSON.stringify(rows);const v=previewBackfill(rows,[entry()],'user');
 assert.equal(v.status,'preview_only');assert.equal(v.eligible_count,1);assert.equal(v.applied_count,0);assert.equal(JSON.stringify(rows),before);assert.equal(v.candidates[0].patch.memo,undefined);assert.equal(v.candidates[0].patch.amount,undefined);
});
test('missing inventory and duplicate plan IDs block',()=>{
 assert.equal(previewBackfill([row(),row('b',200)],[entry()],'u').status,'blocked');
 assert.equal(previewBackfill([row()],[entry(),entry()],'u').status,'blocked');
});
test('amount mismatch and ambiguous equal tuple block',()=>{
 assert.equal(previewBackfill([row()],[entry('a',evidence({source_amount:99}))],'u').problems[0].code,'BUSINESS_FIELDS_MISMATCH');
 const v=previewBackfill([row(),row('b')],[entry(),{external_id:'b',classification:'ambiguous'}],'u');
 assert.equal(v.problems[0].code,'AMBIGUOUS_EXISTING_TUPLE');
});
test('unresolved rows are left alone',()=>{
 const v=previewBackfill([row(),row('b',200)],[entry(),{external_id:'b',classification:'unmatched'}],'u');
 assert.equal(v.status,'preview_only');assert.equal(v.unresolved_count,1);
});
test('existing metadata conflicts are rejected',()=>{
 const r=row();r.metadata.billing_month='2026-12';
 assert.equal(previewBackfill([r],[entry()],'u').problems[0].code,'EXISTING_METADATA_CONFLICT');
});
test('snapshot and user bind plan digest; fingerprint is stable',()=>{
 const r=row();const a=previewBackfill([r],[entry()],'u');const b=previewBackfill([r],[entry()],'other');
 assert.notEqual(a.plan_digest,b.plan_digest);r.metadata.memo='changed';assert.notEqual(a.inventory_digest,previewBackfill([r],[entry()],'u').inventory_digest);
 assert.equal(fingerprint(evidence()),fingerprint(evidence()));
});
test('provider ID cannot be asserted for statement without provider evidence',()=>{
 const v=previewBackfill([row()],[entry('a',evidence({source_record_id_type:'provider',source_record_id:'12345678'}))],'u');
 assert.equal(v.problems[0].code,'PROVIDER_ID_REQUIRED');
});

test('server computes classification and eligible amounts from actual inventory',()=>{
 const v=previewBackfill([row(),row('b',200)],[entry(),{external_id:'b',classification:'unmatched'}],'u');
 assert.equal(v.inventory_amount_krw,300);assert.equal(v.classification_amounts_krw.exact_unique,100);assert.equal(v.classification_amounts_krw.unmatched,200);assert.equal(v.eligible_amount_krw,100);assert.equal(v.unresolved_amount_krw,200);
});
test('invalid inventory amount blocks even when row is unresolved',()=>{
 const r=row();r.amount=null;
 const v=previewBackfill([r],[{external_id:'a',classification:'unmatched'}],'u');assert.equal(v.status,'blocked');assert.equal(v.problems[0].code,'INVALID_INVENTORY_AMOUNT');
});
