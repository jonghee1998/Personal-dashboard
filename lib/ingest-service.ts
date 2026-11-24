// 수신(/api/ingest) 처리 본체. route.ts 는 인증·설정·JSON 파싱과 DB 어댑터만 맡는다.
// 이 파일은 next/* 를 import 하지 않는다(tests 가 직접 import).
// 쓰기는 DB 함수 dashboard_ingest_commit 하나로만 한다(docs/INGEST_V2.md ⑦·⑧).
import {z} from 'zod';
import {normalizeIncomingStatus} from './dashboard-visibility.ts';
import {validateProductionRecord,isStaleReplay} from './ingest-integrity.ts';
import {duplicateConflicts,strongTransactionKey,normalizeSourceId} from './transaction-reconciliation.ts';

export {normalizeSourceId};

export type Row=Record<string,any>;
export type RunRow=Record<string,any>;
export type DbResult<T>={data:T;error:unknown};
export type CommitArgs={p_user:string;p_rows:Row[];p_expected:{kind:string;external_id:string;updated_at:string|null}[];p_source_ids:string[];p_known:{id:string;updated_at:string}[];p_run:Record<string,unknown>|null};
export type IngestDeps={
 readExisting(userId:string,externalIds:string[]):Promise<DbResult<Row[]|null>>;
 readCandidates(userId:string,sourceIds:string[]):Promise<DbResult<Row[]|null>>;
 readRun(userId:string,key:{run_id:string;dataset:string;source_system:string}):Promise<DbResult<RunRow|null>>;
 commit(args:CommitArgs):Promise<DbResult<unknown>>;
};
export type IngestStage='status_lookup'|'duplicate_lookup'|'run_lookup'|'write';
export type IngestOutcome={kind:'response';status:number;body:object}|{kind:'failure';stage:IngestStage;err:unknown};

// v1 payload 스키마(옛 route.ts 에서 그대로 옮김)
const kinds=['transaction','settlement','news','benefit','task','event','journal'] as const;
const stoppedSubscriptionStatuses=['paused','stopped','cancelled','canceled','inactive'] as const;
const regularStatuses=['pending','done','active','archived','deleted'] as const;
const item=z.object({kind:z.enum(kinds),external_id:z.string().min(1).max(180),title:z.string().min(1).max(400),description:z.string().max(10000).nullable().optional(),amount:z.number().finite().nullable().optional(),currency:z.string().max(8).default('KRW'),status:z.enum([...regularStatuses,...stoppedSubscriptionStatuses]).default('active'),category:z.string().max(100).nullable().optional(),source:z.string().max(100).nullable().optional(),event_date:z.string().date().nullable().optional(),due_date:z.string().date().nullable().optional(),url:z.string().url().max(2000).nullable().optional(),metadata:z.record(z.unknown()).default({})}).strict().superRefine((value,ctx)=>{if((stoppedSubscriptionStatuses as readonly string[]).includes(value.status)&&!(value.kind==='benefit'&&value.category==='ai_subscription'))ctx.addIssue({code:z.ZodIssueCode.custom,path:['status'],message:'Subscription-specific status requires ai_subscription'});});
export const payload=z.object({items:z.array(item).min(1).max(100),validate_only:z.boolean().default(false)}).strict();
export type IngestItem=z.infer<typeof item>;

// 키셋 페이지 조회를 끝까지 읽는다. 끝은 next_after 가 null 인 것으로만 판단한다(행 개수로 판단하지 않음, 결정 E).
type Page={data:{rows:Row[];next_after:string|null}|null;error:unknown};
export async function readAllPages(fetchPage:(after:string|null)=>Promise<Page>):Promise<DbResult<Row[]|null>>{
 const rows:Row[]=[];const seen=new Set<string>();let after:string|null=null;
 while(true){
  const {data,error}=await fetchPage(after);
  if(error)return {data:null,error};
  if(!data||!Array.isArray(data.rows))return {data:null,error:new Error('invalid page')};
  rows.push(...data.rows);
  const next=data.next_after??null;
  if(next===null)return {data:rows,error:null};
  if(typeof next!=='string'||seen.has(next))return {data:null,error:new Error('repeated page cursor')};
  seen.add(next);after=next;
 }
}

const optionalFields=['description','amount','category','source','event_date','due_date','url'] as const;
const has=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
const key=(x:{kind:string;external_id:string})=>x.kind+':'+x.external_id;

// 행 만들기(옛 route.ts 규칙). 선택 필드는 받은 항목에 키가 있을 때만 행 JSON 에 넣는다(결정 A).
export function buildRows(items:IngestItem[],current:Map<string,Row>,userId:string):Row[]{
 return items.map(x=>{
  const prior=current.get(key(x));
  const isSubscription=x.kind==='benefit'&&x.category==='ai_subscription';
  const normalized=normalizeIncomingStatus(x.status,x.metadata,isSubscription);
  const deleting=normalized.status==='archived';
  const status=deleting?'archived':x.kind==='task'&&prior?.status==='archived'?'archived':(x.kind==='settlement'||x.kind==='task')&&prior?.status==='done'?'done':normalized.status;
  const previous=prior?.metadata;
  const memo=x.kind==='transaction'&&previous&&typeof previous==='object'&&!Array.isArray(previous)&&typeof previous.memo==='string'?previous.memo:null;
  const keepMemo=memo===null?{}:{memo};
  if(deleting&&prior){
   // 보관할 때는 기존 업무 필드를 유지한다(tombstone 은 새 스냅샷이 아님). 기존 거래 메모도 유지한다.
   const {id,created_at,updated_at,...original}=prior;
   return {...original,status:'archived',metadata:{...original.metadata,...normalized.metadata,...keepMemo},user_id:userId};
  }
  const row:Row={kind:x.kind,external_id:x.external_id,title:x.title,currency:x.currency};
  for(const f of optionalFields)if(has(x,f)&&x[f]!==undefined)row[f]=x[f];
  return {...row,status,metadata:{...normalized.metadata,...keepMemo},user_id:userId};
 });
}

// 저장 후 실제로 남을 값: 받은 항목에 없는 선택 필드는 기존 행 값을 쓴다.
export function effectiveRecord(x:IngestItem,prior:Row):IngestItem{
 const merged:Row={...x};
 for(const f of optionalFields)if(!has(x,f)||x[f]===undefined){if(prior[f]!==undefined)merged[f]=prior[f];}
 return merged as IngestItem;
}

const response=(status:number,body:object):IngestOutcome=>({kind:'response',status,body});
const failure=(stage:IngestStage,err:unknown):IngestOutcome=>({kind:'failure',stage,err});

// v1 수신. 이번 단계는 v1 만 받는다(v2 본문은 v1 strict 스키마에 걸려 400).
export async function handleIngest(body:unknown,userId:string,now:number,deps:IngestDeps):Promise<IngestOutcome>{
 const parsed=payload.safeParse(body);
 if(!parsed.success)return response(400,{error:'Invalid payload',details:parsed.error.flatten()});
 const incoming=parsed.data.items;
 const violations:{index:number;code:string;field:string}[]=incoming.flatMap((record,index)=>validateProductionRecord(record,now).map(error=>({index,...error})));
 const keys=new Set<string>();
 incoming.forEach((record,index)=>{const k=key(record);if(keys.has(k))violations.push({index,code:'DUPLICATE_BATCH_ID',field:'external_id'});keys.add(k);});
 if(violations.length)return response(422,{error:'Production integrity validation failed',violations});

 const existing=await deps.readExisting(userId,[...new Set(incoming.map(x=>x.external_id))]);
 if(existing.error)return failure('status_lookup',existing.error);
 const current=new Map<string,Row>((existing.data??[]).map(x=>[key(x as {kind:string;external_id:string}),x]));
 // 생략한 선택 필드는 기존 값이 남으므로(결정 A), 저장될 실제 값(기존 행 + 받은 키)으로 규칙을 다시 검사한다.
 // 그래야 category 등을 빼서 분류별 규칙(points·ai_subscription 등)을 피할 수 없다. 응답 모양은 위 422 와 같다.
 const effectiveViolations=incoming.flatMap((x,index)=>{
  const prior=current.get(key(x));
  if(!prior)return [];
  return validateProductionRecord(effectiveRecord(x,prior),now).map(error=>({index,...error}));
 });
 if(effectiveViolations.length)return response(422,{error:'Production integrity validation failed',violations:effectiveViolations});
 const conflicts=incoming.flatMap((x,index)=>{
  const prior=current.get(key(x));
  if(['archived','deleted'].includes(x.status)&&!prior)return [{index,code:'DELETE_TARGET_NOT_FOUND',field:'external_id'}];
  if(prior&&isStaleReplay(x.metadata,prior.metadata??{}))return [{index,code:'STALE_REPLAY',field:'metadata.as_of'}];
  return [];
 });
 if(conflicts.length)return response(409,{error:'Production integrity conflict',violations:conflicts});

 // 제공자가 발급한 원천 거래ID만 명시 범위(계정·월·금액 기준)에서 대조한다. 비교는 normalizeSourceId 규칙(결정 C).
 const strong=incoming.filter(x=>strongTransactionKey(x)!==null);
 const sourceIds=[...new Set(strong.map(x=>normalizeSourceId(String(x.metadata.source_record_id))))];
 let known:{id:string;updated_at:string}[]=[];
 if(strong.length){
  const found=await deps.readCandidates(userId,sourceIds);
  if(found.error||!found.data)return failure('duplicate_lookup',found.error);
  const duplicateIssues=duplicateConflicts(incoming,found.data as any);
  if(duplicateIssues.length)return response(409,{error:'Duplicate source transaction',violations:duplicateIssues});
  known=found.data.map(r=>({id:r.id,updated_at:r.updated_at}));
 }

 if(parsed.data.validate_only)return response(200,{validated:incoming.length,upserted:0,verification:'structural_provenance_only'});
 const rows=buildRows(incoming,current,userId);
 const expected=incoming.map(x=>({kind:x.kind,external_id:x.external_id,updated_at:(current.get(key(x))?.updated_at as string|undefined)??null}));
 const {data,error}=await deps.commit({p_user:userId,p_rows:rows,p_expected:expected,p_source_ids:sourceIds,p_known:known,p_run:null});
 if(error)return failure('write',error);
 const result=data as {ok?:unknown;code?:unknown;upserted?:unknown;items?:unknown}|null;
 if(result&&result.ok===false&&result.code==='CONCURRENT_CHANGE')return response(409,{error:'Concurrent change; retry',code:'CONCURRENT_CHANGE'});
 if(result&&result.ok===true&&Array.isArray(result.items))return response(200,{upserted:typeof result.upserted==='number'?result.upserted:result.items.length,items:result.items,verification:'structural_provenance_only'});
 return failure('write',new Error('unexpected commit result'));
}
