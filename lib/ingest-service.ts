// 수신(/api/ingest) 처리 본체. route.ts 는 인증·설정·JSON 파싱과 DB 어댑터만 맡는다.
// 이 파일은 next/* 를 import 하지 않는다(tests 가 직접 import).
// 쓰기는 DB 함수 dashboard_ingest_commit 하나로만 한다(docs/INGEST_V2.md ⑦·⑧).
import {z} from 'zod';
import {normalizeIncomingStatus} from './dashboard-visibility.ts';
import {validateProductionRecord,isStaleReplay} from './ingest-integrity.ts';
import {duplicateConflicts,strongTransactionKey,normalizeSourceId} from './transaction-reconciliation.ts';
import {parseIngestV2,type IngestV2Parsed} from './ingest-v2.ts';

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
// v2 응답(version:2)은 route 가 상태와 상관없이 Cache-Control no-store 를 붙인다(결정 D).
// v2 의 DB 실패·deps 예외는 'v2failure' 로 돌려주고 route 가 503 {error:'Ingest unavailable'} 로 바꾼다.
export type IngestV2Stage='status_lookup'|'duplicate_lookup'|'run_lookup'|'write'|'unexpected';
export type IngestOutcome={kind:'response';status:number;body:object;version?:2}|{kind:'failure';stage:IngestStage;err:unknown}|{kind:'v2failure';stage:IngestV2Stage;err:unknown};

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

// 본문 최상위가 객체이고 version 이 2 면 v2, 아니면 v1(version 키가 있는 v1 본문은 v1 strict 스키마에 걸려 400).
export const isIngestV2Body=(body:unknown)=>typeof body==='object'&&body!==null&&!Array.isArray(body)&&(body as {version?:unknown}).version===2;
export async function handleIngest(body:unknown,userId:string,now:number,deps:IngestDeps):Promise<IngestOutcome>{
 if(!isIngestV2Body(body))return handleIngestV1(body,userId,now,deps);
 // 버전 판별 뒤 deps 호출에서 난 예외(adminDb 생성 실패 포함)는 여기서 잡아 v2failure 로 돌려준다.
 try{return await handleIngestV2(body,userId,now,deps);}
 catch(err){return {kind:'v2failure',stage:'unexpected',err};}
}

// v1 수신(v1 전용 경로: v2 본문은 strict 스키마에 걸려 400).
export async function handleIngestV1(body:unknown,userId:string,now:number,deps:IngestDeps):Promise<IngestOutcome>{
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

// ---------------- v2 (docs/INGEST_V2.md ⑤~⑧) ----------------

const isObj=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const keptMetaKeys=['dashboard_deleted','subscription_status'] as const;

// v2 행 만들기(⑧ (바)). 행 JSON 은 rawItems 에 있는 키에서 시작한다(없는 키는 넣지 않아 DB 가 기존 값을 유지).
// - status 키가 있으면 v1 과 같은 정규화·완료/보관 유지 규칙. 명시적 archived·deleted 이고 기존 행이 있으면 기존 업무 필드를 복사하고
//   metadata 는 기존 metadata → 정규화한 요청 metadata → 기존 거래 memo 순으로 합친다.
// - status 키가 없으면 status 를 넣지 않고, metadata 는 받은 metadata 에 기존 행의 dashboard_deleted·subscription_status 를 합친다.
// - 모든 경우 기존 거래 memo(문자열이면)를 마지막에 합친다.
export function buildRowsV2(rawItems:Record<string,unknown>[],items:IngestItem[],current:Map<string,Row>,userId:string):Row[]{
 return items.map((x,i)=>{
  const raw=rawItems[i]??{};
  const prior=current.get(key(x));
  const prevMeta:Record<string,unknown>=isObj(prior?.metadata)?prior.metadata:{};
  const keepMemo=x.kind==='transaction'&&typeof prevMeta.memo==='string'?{memo:prevMeta.memo}:{};
  const row:Row={};
  for(const k of Object.keys(raw))if(k!=='status'&&k!=='metadata')row[k]=(x as Row)[k];
  if(has(raw,'status')){
   const isSubscription=x.kind==='benefit'&&x.category==='ai_subscription';
   const normalized=normalizeIncomingStatus(x.status,x.metadata,isSubscription);
   const deleting=normalized.status==='archived';
   if(deleting&&prior){
    // 보관할 때는 기존 업무 필드를 유지한다(v1 과 같음).
    const {id,created_at,updated_at,...original}=prior;
    return {...original,status:'archived',metadata:{...prevMeta,...normalized.metadata,...keepMemo},user_id:userId};
   }
   row.status=deleting?'archived':x.kind==='task'&&prior?.status==='archived'?'archived':(x.kind==='settlement'||x.kind==='task')&&prior?.status==='done'?'done':normalized.status;
   row.metadata={...normalized.metadata,...keepMemo};
  }else{
   const kept:Record<string,unknown>={};
   for(const k of keptMetaKeys)if(has(prevMeta,k))kept[k]=prevMeta[k];
   row.metadata={...x.metadata,...kept,...keepMemo};
  }
  row.user_id=userId;
  return row;
 });
}

// 저장 후 실제로 남을 currency·status(⑧ (아)): 받은 키가 있으면 그 값, 없으면 기존 행 값, 둘 다 없으면 KRW·active.
export function effectiveV2Item(x:IngestItem,raw:Record<string,unknown>,prior:Row|undefined):IngestItem{
 const currency=has(raw,'currency')?x.currency:typeof prior?.currency==='string'?prior.currency:'KRW';
 const status=has(raw,'status')?x.status:typeof prior?.status==='string'?prior.status:'active';
 return {...x,currency,status} as IngestItem;
}

const v2response=(status:number,body:object):IngestOutcome=>({kind:'response',status,body,version:2});
const v2failure=(stage:IngestV2Stage,err:unknown):IngestOutcome=>({kind:'v2failure',stage,err});
const runConflict=()=>v2response(409,{error:'Run id conflict',code:'RUN_ID_CONFLICT'});

// 실행 기록 판정(⑤): ingest_v2 기록이고 status·error_code·expected_count·payload_digest 가 모두 같으면 재전송(200 idempotent), 아니면 409.
export function judgeRunRecord(record:RunRow,parsed:Pick<IngestV2Parsed,'run'|'manifest'|'payloadDigest'>):IngestOutcome{
 const {run,manifest,payloadDigest}=parsed;
 const same=record.commit_source==='ingest_v2'&&record.status===run.status&&(record.error_code??null)===(run.error_code??null)
  &&record.expected_count!==null&&record.expected_count!==undefined&&Number(record.expected_count)===manifest.item_count
  &&record.payload_digest===payloadDigest;
 if(!same)return runConflict();
 return v2response(200,{version:2,upserted:0,items:[],run:{run_id:record.run_id,dataset:record.dataset,source_system:record.source_system,status:record.status,accepted_count:record.accepted_count},idempotent:true});
}

export async function handleIngestV2(body:unknown,userId:string,now:number,deps:IngestDeps):Promise<IngestOutcome>{
 const parsed=parseIngestV2(body,now);
 if(!parsed.ok)return v2response(422,{error:'Ingest v2 validation failed',violations:parsed.violations});
 if(parsed.itemViolations.length)return v2response(422,{error:'Ingest v2 validation failed',violations:parsed.itemViolations});
 const {run,items,rawItems,manifest,payloadDigest}=parsed;
 const runKey={run_id:run.run_id,dataset:run.dataset,source_system:run.source_system};

 // (라) 재전송·충돌 판정을 항목 상태 검사보다 먼저 한다. 기록이 없을 때만 항목 검사.
 const found=await deps.readRun(userId,runKey);
 if(found.error)return v2failure('run_lookup',found.error);
 if(found.data)return judgeRunRecord(found.data,parsed);
 // (사) 항목 충돌로 409 를 돌려주기 직전에 실행 기록을 다시 본다(그사이 같은 실행이 커밋됐으면 그 판정이 우선).
 const conflictOr=async(conflict:IngestOutcome):Promise<IngestOutcome>=>{
  const again=await deps.readRun(userId,runKey);
  if(again.error)return v2failure('run_lookup',again.error);
  return again.data?judgeRunRecord(again.data,parsed):conflict;
 };

 let rows:Row[]=[],expected:CommitArgs['p_expected']=[],sourceIds:string[]=[],known:{id:string;updated_at:string}[]=[];
 if(run.status==='success'){
  const existing=await deps.readExisting(userId,[...new Set(items.map(x=>x.external_id))]);
  if(existing.error||!existing.data)return v2failure('status_lookup',existing.error);
  const current=new Map<string,Row>(existing.data.map(x=>[key(x as {kind:string;external_id:string}),x]));
  // 생략한 선택 필드는 기존 값이 남으므로 저장될 값으로 업무 규칙을 다시 검사한다(v1 과 같음).
  const effectiveViolations=items.flatMap((x,index)=>{
   const prior=current.get(key(x));
   if(!prior)return [];
   return validateProductionRecord(effectiveRecord(x,prior),now).map(error=>({index,...error}));
  });
  if(effectiveViolations.length)return v2response(422,{error:'Ingest v2 validation failed',violations:effectiveViolations});
  // (아) 충돌·중복 판정은 저장될 유효 currency·status 로 만든 항목으로 한다.
  const effective=items.map((x,i)=>effectiveV2Item(x,rawItems[i]??{},current.get(key(x))));
  const conflicts=effective.flatMap((x,index)=>{
   const prior=current.get(key(x));
   if(['archived','deleted'].includes(x.status)&&!prior)return [{index,code:'DELETE_TARGET_NOT_FOUND',field:'external_id'}];
   if(prior&&isStaleReplay(x.metadata,isObj(prior.metadata)?prior.metadata:{}))return [{index,code:'STALE_REPLAY',field:'metadata.as_of'}];
   return [];
  });
  if(conflicts.length)return conflictOr(v2response(409,{error:'Production integrity conflict',violations:conflicts}));

  const strong=effective.filter(x=>strongTransactionKey(x)!==null);
  sourceIds=[...new Set(strong.map(x=>normalizeSourceId(String(x.metadata.source_record_id))))];
  if(strong.length){
   const candidates=await deps.readCandidates(userId,sourceIds);
   if(candidates.error||!candidates.data)return v2failure('duplicate_lookup',candidates.error);
   const duplicateIssues=duplicateConflicts(effective,candidates.data as any);
   if(duplicateIssues.length)return conflictOr(v2response(409,{error:'Duplicate source transaction',violations:duplicateIssues}));
   known=candidates.data.map(r=>({id:r.id,updated_at:r.updated_at}));
  }
  rows=buildRowsV2(rawItems,items,current,userId);
  expected=items.map(x=>({kind:x.kind,external_id:x.external_id,updated_at:(current.get(key(x))?.updated_at as string|undefined)??null}));
 }
 // failed(항목 0개)는 항목 검사 없이 바로 commit(실행 기록만).
 const p_run={run_id:run.run_id,dataset:run.dataset,source_system:run.source_system,status:run.status,error_code:run.error_code,item_count:manifest.item_count,payload_digest:payloadDigest,source_as_of:run.source_as_of,collected_at:run.collected_at};
 const {data,error}=await deps.commit({p_user:userId,p_rows:rows,p_expected:expected,p_source_ids:sourceIds,p_known:known,p_run});
 if(error)return v2failure('write',error);
 const result=data as {ok?:unknown;code?:unknown;upserted?:unknown;items?:unknown;run?:unknown;idempotent?:unknown}|null;
 if(result&&result.ok===false&&result.code==='RUN_ID_CONFLICT')return runConflict();
 if(result&&result.ok===false&&result.code==='CONCURRENT_CHANGE')return v2response(409,{error:'Concurrent change; retry',code:'CONCURRENT_CHANGE'});
 if(result&&result.ok===true&&Array.isArray(result.items)){
  return v2response(200,{version:2,upserted:typeof result.upserted==='number'?result.upserted:result.items.length,items:result.items,run:result.run??null,idempotent:result.idempotent===true});
 }
 return v2failure('write',new Error('unexpected commit result'));
}
