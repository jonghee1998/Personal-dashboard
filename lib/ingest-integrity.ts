// Structural provenance checks for production writes. These checks are NOT proof that
// a collector actually visited the source. Independent reconciliation/review is separate.
type Meta=Record<string,unknown>;
export type IngestRecord={kind:string;external_id:string;title:string;description?:string|null;category?:string|null;source?:string|null;status?:string;amount?:number|null;event_date?:string|null;url?:string|null;metadata:Meta};
export type Violation={code:string;field:string};
const str=(v:unknown)=>typeof v==='string'?v.trim():'';
const lower=(v:unknown)=>str(v).toLowerCase();
const knownSyntheticIds=new Set([
 'benefit-point-sample-telco','benefit-point-sample-01','benefit-point-sample-02','benefit-point-sample-03','benefit-point-sample-04','benefit-point-sample-05',
 'benefit-app-sample-youth-transit','benefit-app-sample-tax','benefit-app-sample-trials-01','benefit-app-sample-trials-02','benefit-app-sample-trials-03'
]);
export const isReportedSyntheticId=(id:unknown)=>knownSyntheticIds.has(lower(id));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const timestamp=(v:unknown)=>{const s=str(v);const ms=Date.parse(s);return iso.test(s)&&Number.isFinite(ms)?ms:null;};
const syntheticTokens=/(?:^|[-_:/\s])(?:demo|dummy|sample|synthetic|mock|fixture|test)(?:$|[-_:/\s])/i;
// Do not reject legitimate descriptions that merely mention testing, estimates, etc.
const placeholder=/^(?:\[?\s*(?:가상|더미|샘플|테스트|임의|추정)(?:\s*(?:데이터|거래|예시|잔액|값|용))?\s*\]?|archived|deleted|보관된 이전 레코드|미등록|undefined|null)$/i;
const explicitSyntheticLabel=/^(?:\[(?:demo|dummy|sample|synthetic|mock|test|가상|더미|샘플|테스트)\]|(?:가상|더미|샘플|테스트)\s*(?:데이터|거래|예시|잔액))(?=$|[\s:·-])/i;
const allowedOrigins:Record<string,readonly string[]>={
 samsungcard:['monimo_session','samsungcard_session','samsungcard_web','card_statement','card_approval_ledger'],
 naverpay:['naverpay_session','naverpay_web'],
 news_rss:['official_rss','official_article','publisher_rss','publisher_web'],
 application_receipt:['official_receipt','application_confirmation','official_confirmation'],
 pickle_assistant_schedule:['user_calendar','user_confirmed','confirmed_task'],
 user_confirmed:['user_confirmed','user_record'],
 card_statement:['card_statement','official_receipt']
};
export const approvedSources=(record:IngestRecord):readonly string[]=>{
 if(record.kind==='transaction')return ['samsungcard'];
 if(record.kind==='news')return ['news_rss'];
 if(record.kind==='benefit'){
   if(record.category==='points')return ['samsungcard','naverpay'];
   if(record.category==='ai_subscription')return ['samsungcard'];
   return ['application_receipt'];
 }
 if(record.kind==='task'||record.kind==='event')return ['pickle_assistant_schedule','user_confirmed'];
 if(record.kind==='settlement')return ['user_confirmed','samsungcard','card_statement'];
 if(record.kind==='journal')return ['user_confirmed','pickle_assistant_schedule'];
 return [];
};
const validUrl=(value:unknown)=>{
 try{const url=new URL(str(value));const host=url.hostname.toLowerCase();
 return url.protocol==='https:'&&!!host&&!url.username&&!url.password&&host!=='localhost'&&!/(^|\.)(?:example\.(?:com|org|net)|invalid|test|localhost)$/.test(host)&&!/^\d+(?:\.\d+){3}$/.test(host)&&!host.includes(':');
 }catch{return false;}
};
export function validateProductionRecord(record:IngestRecord,now=Date.now()):Violation[]{
 const errors:Violation[]=[];const add=(code:string,field:string)=>errors.push({code,field});
 const m=record.metadata??{};
 const deleting=['archived','deleted'].includes(lower(record.status));
 // A tombstone can only target an existing record (checked by the API). It must never
 // be used to create a new dummy record. Legacy cleanup IDs may contain "sample".
 if(!deleting){
  if(isReportedSyntheticId(record.external_id)||syntheticTokens.test(record.external_id))add('SYNTHETIC_ID','external_id');
  for(const [field,value] of [['title',record.title],['source',record.source],['description',record.description]] as const){
   if(placeholder.test(str(value))||explicitSyntheticLabel.test(str(value)))add('SYNTHETIC_LABEL',field);
  }
 }
 if(m.environment!=='production')add('ENVIRONMENT_REQUIRED','metadata.environment');
 if(m.is_synthetic!==false)add('SYNTHETIC_OR_UNKNOWN','metadata.is_synthetic');
 if(['synthetic','demo','test','sample','estimated','generated','mock','dummy'].includes(lower(m.data_origin)))add('UNTRUSTED_ORIGIN','metadata.data_origin');
 const source=lower(m.source_system),verification=lower(m.verification_source);
 if(!approvedSources(record).includes(source)&&!(deleting&&source==='user_confirmed'))add('SOURCE_NOT_ALLOWED','metadata.source_system');
 if(!allowedOrigins[source]?.includes(verification))add('VERIFICATION_SOURCE_NOT_ALLOWED','metadata.verification_source');
 const asOf=timestamp(m.as_of),verified=timestamp(m.verified_at);
 if(asOf===null)add('INVALID_TIMESTAMP','metadata.as_of');
 if(verified===null)add('INVALID_TIMESTAMP','metadata.verified_at');
 if(asOf!==null&&verified!==null&&(asOf>verified||verified>now+5*60*1000))add('TIMESTAMP_ORDER','metadata.verified_at');
 if(!uuid.test(str(m.run_id)))add('INVALID_RUN_ID','metadata.run_id');
 if(deleting){
   if(!str(m.deletion_reason))add('DELETION_REASON_REQUIRED','metadata.deletion_reason');
   return errors;
 }
 if(record.kind==='transaction'||record.kind==='benefit'&&['points','ai_subscription'].includes(record.category??'')){
   if(typeof record.amount!=='number'||!Number.isFinite(record.amount))add('AMOUNT_REQUIRED','amount');
   if(!str(m.source_record_id)||syntheticTokens.test(str(m.source_record_id)))add('SOURCE_RECORD_ID_REQUIRED','metadata.source_record_id');
 }
 if(record.kind==='transaction'&&!record.event_date)add('EVENT_DATE_REQUIRED','event_date');
 if(record.kind==='benefit'&&record.category==='points'){
   const provider=str(m.provider);
   if(!((source==='samsungcard'&&provider==='삼성카드')||(source==='naverpay'&&provider==='네이버페이')))add('POINT_PROVIDER_NOT_ALLOWED','metadata.provider');
   if(typeof record.amount==='number'&&record.amount<0)add('NEGATIVE_POINT_BALANCE','amount');
   if(!record.event_date)add('SNAPSHOT_DATE_REQUIRED','event_date');
 }
 if(record.kind==='benefit'&&record.category!=='points'&&record.category!=='ai_subscription'){
   if(!str(m.receipt_id)&&!str(m.application_id)&&!str(m.source_record_id))add('RECEIPT_REQUIRED','metadata.receipt_id');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(str(m.applied_at)||str(record.event_date)))add('APPLICATION_DATE_REQUIRED','metadata.applied_at');
 }
 if(record.kind==='news'&&!validUrl(record.url))add('OFFICIAL_URL_REQUIRED','url');
 return errors;
}
export const isStaleReplay=(incoming:Meta,previous:Meta)=>{
 const current=timestamp(incoming.as_of),prior=timestamp(previous.as_of);
 return current!==null&&prior!==null&&current<prior;
};
