// Phase 2: comparisons are against collector-submitted evidence, not independent proof.
export type LedgerRecord={external_id:string;kind?:string;status?:string|null;currency?:string|null;source?:string|null;amount?:number|string|null;metadata?:Record<string,unknown>|null};
export type LedgerScope={source_system:string;account_key:string;billing_month:string;amount_basis:'statement_billed'|'purchase_approval';currency:'KRW'};
export type ManifestRow={source_record_id:string;amount:number};
const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
export function strongTransactionKey(row:LedgerRecord):string|null{
 const m=row.metadata??{};
 const source=clean(m.source_system),account=clean(m.account_key),id=clean(m.source_record_id),month=clean(m.billing_month),basis=clean(m.amount_basis);
 if(row.kind!=='transaction'||!source||!account||!id||m.source_record_id_type!=='provider'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!['statement_billed','purchase_approval'].includes(basis))return null;
 return JSON.stringify([source,account,month,basis,row.currency??'KRW',id]);
}
export function duplicateConflicts(incoming:LedgerRecord[],existing:LedgerRecord[]){
 const keys=new Map<string,string>();const conflicts:{index:number;code:string;field:string}[]=[];
 for(const row of existing){const k=strongTransactionKey(row);if(k&&row.status!=='archived'&&row.status!=='deleted')keys.set(k,row.external_id);}
 incoming.forEach((row,index)=>{
  if(row.status==='archived'||row.status==='deleted')return;
  const k=strongTransactionKey(row);if(!k)return;
  const prior=keys.get(k);
  if(prior&&prior!==row.external_id)conflicts.push({index,code:'DUPLICATE_SOURCE_TRANSACTION',field:'metadata.source_record_id'});
  else keys.set(k,row.external_id);
 });
 return conflicts;
}
export function matchesScope(row:LedgerRecord,scope:LedgerScope){
 const m=row.metadata??{};
 return row.status!=='archived'&&row.status!=='deleted'&&clean(m.source_system)===scope.source_system&&clean(m.account_key)===scope.account_key&&clean(m.billing_month)===scope.billing_month&&clean(m.amount_basis)===scope.amount_basis&&row.currency===scope.currency;
}
function won(v:unknown):number|null{
 if(typeof v==='string'&&/^-?\d+(?:\.0+)?$/.test(v))v=Number(v);
 return typeof v==='number'&&Number.isSafeInteger(v)?v:null;
}
export function reconcileStatement(rows:LedgerRecord[],manifest:ManifestRow[],scope:LedgerScope,expectedCount:number,expectedTotal:number){
 const scoped=rows.filter(row=>matchesScope(row,scope));
 const expected=new Map<string,number>();const duplicates=new Set<string>();const expectedDuplicates=new Set<string>();
 for(const item of manifest){if(expected.has(item.source_record_id))expectedDuplicates.add(item.source_record_id);else expected.set(item.source_record_id,item.amount);}
 const actual=new Map<string,number>();const invalid:string[]=[];
 let observedTotal=0;
 for(const row of scoped){
  const key=strongTransactionKey(row),amount=won(row.amount);
  if(amount!==null)observedTotal+=amount;
  if(!key||amount===null){invalid.push(row.external_id);continue;}
  const id=clean(row.metadata?.source_record_id);
  if(actual.has(id))duplicates.add(id);else actual.set(id,amount);
 }
 const missing=[...expected.keys()].filter(id=>!actual.has(id));
 const extra=[...actual.keys()].filter(id=>!expected.has(id));
 const mismatched=[...expected].filter(([id,amount])=>actual.has(id)&&actual.get(id)!==amount).map(([id,amount])=>({source_record_id:id,expected_amount:amount,observed_amount:actual.get(id)!}));
 const manifestTotal=manifest.reduce((sum,row)=>sum+row.amount,0);
 // Unknown scope is not guessed from event_date: billing month and approval month differ.
 const active=rows.filter(row=>row.status!=='archived'&&row.status!=='deleted');
 // Missing provenance is not proof of another source. Count these as unresolved,
 // even if only a legacy display label exists; do not infer authoritative scope.
 const unknownSource=active.filter(row=>!clean(row.metadata?.source_system)).length;
 const incompleteScope=active.filter(row=>clean(row.metadata?.source_system)===scope.source_system&&(!clean(row.metadata?.account_key)||!clean(row.metadata?.billing_month)||!clean(row.metadata?.amount_basis)||!clean(row.metadata?.source_record_id)||!clean(row.metadata?.source_record_id_type))).length;
 const unscoped=unknownSource+incompleteScope;
 const consistent=manifest.length===expectedCount&&manifestTotal===expectedTotal&&scoped.length===expectedCount&&observedTotal===expectedTotal&&expectedDuplicates.size===0&&duplicates.size===0&&!invalid.length&&!missing.length&&!extra.length&&!mismatched.length&&Number.isSafeInteger(manifestTotal)&&Number.isSafeInteger(observedTotal);
 return {status:consistent?(unscoped?'scope_match_unmapped_records_remain':'scope_match'):'mismatch',verification:'collector_manifest_comparison_only',expected_count:expectedCount,manifest_count:manifest.length,observed_count:scoped.length,expected_total:expectedTotal,manifest_total:manifestTotal,observed_total:observedTotal,difference:observedTotal-expectedTotal,missing_ids:missing,extra_ids:extra,duplicate_ids:[...duplicates],manifest_duplicate_ids:[...expectedDuplicates],invalid_external_ids:invalid,amount_mismatches:mismatched,unmapped_source_records:unscoped,unknown_source_records:unknownSource,incomplete_source_scope_records:incompleteScope};
}
