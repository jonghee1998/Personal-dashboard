// Phase 2: comparisons are against collector-submitted evidence, not independent proof.
export type LedgerRecord={external_id:string;kind?:string;status?:string|null;currency?:string|null;source?:string|null;amount?:number|string|null;metadata?:Record<string,unknown>|null};
const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
// 원천 거래ID 정규화(결정 C): JS String.prototype.trim 이 지우는 문자 집합을 명시해 양끝에서 지운다.
// SQL public.dashboard_norm_id 와 같은 규칙. 결과는 trim() 과 같아야 한다.
// 공백 U+0020, U+0009~U+000D, U+00A0, U+1680, U+2000~U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
// (소스에 그 문자를 직접 쓰지 않도록 코드 포인트로 만든다.)
const sourceIdSpace=new Set<number>([0x20,0x09,0x0a,0x0b,0x0c,0x0d,0xa0,0x1680,0x2000,0x2001,0x2002,0x2003,0x2004,0x2005,0x2006,0x2007,0x2008,0x2009,0x200a,0x2028,0x2029,0x202f,0x205f,0x3000,0xfeff]);
export const normalizeSourceId=(v:string)=>{
 let start=0,end=v.length;
 while(start<end&&sourceIdSpace.has(v.charCodeAt(start)))start++;
 while(end>start&&sourceIdSpace.has(v.charCodeAt(end-1)))end--;
 return v.slice(start,end);
};
const cleanId=(v:unknown)=>typeof v==='string'?normalizeSourceId(v):'';
export function strongTransactionKey(row:LedgerRecord):string|null{
 const m=row.metadata??{};
 const source=clean(m.source_system),account=clean(m.account_key),id=cleanId(m.source_record_id),month=clean(m.billing_month),basis=clean(m.amount_basis);
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
