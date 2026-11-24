import {createHash} from 'node:crypto';
export type Evidence={source_system:'samsungcard';account_key:string;billing_month:string;amount_basis:'statement_billed'|'purchase_approval';source_record_id_type:'provider'|'fingerprint';source_record_id?:string;source_date:string;source_merchant:string;source_amount:number;evidence_sha256:string;source_row_ref:string};
export type PlanEntry={external_id:string;classification:'exact_unique'|'ambiguous'|'unmatched'|'conflict';evidence?:Evidence;reason?:string};
export type ExistingRow={id:string;external_id:string;kind:string;title:string;amount:number|string|null;currency:string;event_date:string|null;status:string;updated_at:string;metadata?:Record<string,unknown>|null;[key:string]:unknown};
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
export const merchantKey=(value:string)=>value.normalize('NFC').trim().replace(/\s+/g,' ');
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value)??'null';
}
export function fingerprint(e:Evidence){
 // No occurrence or row order is used to turn indistinguishable purchases into unique matches.
 return hash(canonical(['v1',e.account_key,e.billing_month,e.amount_basis,e.source_date,merchantKey(e.source_merchant),e.source_amount,'KRW']));
}
export function previewBackfill(rows:ExistingRow[],entries:PlanEntry[],userId:string){
 const current=new Map(rows.map(row=>[row.external_id,row]));
 const seen=new Set<string>(),problems:{external_id:string;code:string}[]=[];
 const candidates:{external_id:string;id:string;expected_updated_at:string;row_digest:string;patch:Record<string,unknown>;evidence_sha256:string;source_row_ref:string}[]=[];
 const identity=new Map<string,string>(),evidenceRefs=new Map<string,string>();
 const classifications={exact_unique:0,ambiguous:0,unmatched:0,conflict:0};
 const classification_amounts_krw={exact_unique:0,ambiguous:0,unmatched:0,conflict:0};
 const krw=(row:ExistingRow)=>row.currency==='KRW'&&row.amount!==null&&String(row.amount).trim()!==''&&Number.isSafeInteger(Number(row.amount))?Number(row.amount):null;
 let inventory_amount_krw=0,eligible_amount_krw=0;
 for(const row of rows){const amount=krw(row);if(amount===null)problems.push({external_id:row.external_id,code:'INVALID_INVENTORY_AMOUNT'});else inventory_amount_krw+=amount;}
 const bad=(id:string,code:string)=>problems.push({external_id:id,code});
 const sameTuple=(row:ExistingRow,e:Evidence)=>row.event_date===e.source_date&&row.currency==='KRW'&&row.amount!==null&&Number(row.amount)===e.source_amount&&merchantKey(row.title)===merchantKey(e.source_merchant);
 // Check all active rows, not just those proposed for patching.
 for(const row of rows){
  const m=row.metadata??{};
  if(typeof m.source_record_id==='string'&&typeof m.source_record_id_type==='string'&&typeof m.account_key==='string'&&typeof m.billing_month==='string'&&typeof m.amount_basis==='string'){
   const key=canonical([m.source_system,m.account_key,m.billing_month,m.amount_basis,row.currency,m.source_record_id_type,m.source_record_id]);
   const prior=identity.get(key);if(prior&&prior!==row.external_id)bad(row.external_id,'EXISTING_IDENTITY_COLLISION');
   else identity.set(key,row.external_id);
  }
 }
 for(const entry of entries){
  const id=entry.external_id;
  if(seen.has(id)){bad(id,'DUPLICATE_PLAN_ID');continue;}seen.add(id);
  const row=current.get(id);
  if(!row){bad(id,'TARGET_NOT_FOUND');continue;}
  classifications[entry.classification]++;
  classification_amounts_krw[entry.classification]+=krw(row)??0;
  if(entry.classification!=='exact_unique'){if(entry.evidence)bad(id,'UNRESOLVED_ENTRY_HAS_PATCH');continue;}
  const e=entry.evidence;
  if(!e){bad(id,'EVIDENCE_REQUIRED');continue;}
  if(!sameTuple(row,e)){bad(id,'BUSINESS_FIELDS_MISMATCH');continue;}
  // Matching the same amount/date/merchant twice is not proof of a unique row mapping.
  if(rows.filter(other=>sameTuple(other,e)).length!==1){bad(id,'AMBIGUOUS_EXISTING_TUPLE');continue;}
  if(e.source_record_id_type==='provider'&&(!e.source_record_id||e.amount_basis!=='purchase_approval')){bad(id,'PROVIDER_ID_REQUIRED');continue;}
  if(e.source_record_id_type==='fingerprint'&&(e.amount_basis!=='statement_billed'||e.source_record_id)){bad(id,'FINGERPRINT_RULE');continue;}
  const sourceId=e.source_record_id_type==='fingerprint'?fingerprint(e):e.source_record_id!;
  const patch:Record<string,unknown>={source_system:e.source_system,account_key:e.account_key,billing_month:e.billing_month,amount_basis:e.amount_basis,source_record_id_type:e.source_record_id_type,source_record_id:sourceId,...(e.source_record_id_type==='fingerprint'?{fingerprint_version:'v1'}:{})};
  const priorMeta=row.metadata??{};
  if(Object.keys(patch).some(k=>priorMeta[k]!==undefined&&priorMeta[k]!==null&&priorMeta[k]!==''&&priorMeta[k]!==patch[k])){bad(id,'EXISTING_METADATA_CONFLICT');continue;}
  const key=canonical([e.source_system,e.account_key,e.billing_month,e.amount_basis,row.currency,e.source_record_id_type,sourceId]);
  const prior=identity.get(key);
  if(prior&&prior!==id){bad(id,'IDENTITY_COLLISION');continue;}
  const ref=canonical([e.evidence_sha256,e.source_row_ref]);
  const priorRef=evidenceRefs.get(ref);
  if(priorRef&&priorRef!==id){bad(id,'EVIDENCE_ROW_REUSED');continue;}
  identity.set(key,id);evidenceRefs.set(ref,id);
  eligible_amount_krw+=krw(row)??0;
  candidates.push({external_id:id,id:row.id,expected_updated_at:row.updated_at,row_digest:hash(canonical(row)),patch,evidence_sha256:e.evidence_sha256,source_row_ref:e.source_row_ref});
 }
 for(const row of rows)if(!seen.has(row.external_id))bad(row.external_id,'MISSING_PLAN_ENTRY');
 if(!Number.isSafeInteger(inventory_amount_krw)||!Number.isSafeInteger(eligible_amount_krw)||Object.values(classification_amounts_krw).some(v=>!Number.isSafeInteger(v)))bad('inventory','AMOUNT_TOTAL_OVERFLOW');
 const sorted=candidates.sort((a,b)=>a.external_id<b.external_id?-1:a.external_id>b.external_id?1:0);
 const inventory_digest=hash(canonical(rows.map(row=>({id:row.id,digest:hash(canonical(row))})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)));
 const plan_digest=hash(canonical({version:1,userId,inventory_digest,entries:[...entries].sort((a,b)=>a.external_id<b.external_id?-1:a.external_id>b.external_id?1:0),candidates:sorted}));
 return {status:problems.length?'blocked':'preview_only',verification:'collector_evidence_structural_preview_only',inventory_count:rows.length,classification_counts:classifications,inventory_amount_krw,classification_amounts_krw,eligible_amount_krw,unresolved_amount_krw:inventory_amount_krw-eligible_amount_krw,eligible_count:sorted.length,unresolved_count:rows.length-sorted.length,problems,inventory_digest,plan_digest,candidates:sorted,applied_count:0};
}
