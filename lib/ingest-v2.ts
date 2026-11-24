// 피클AI 수신 규격 v2 (docs/INGEST_V2.md) 형식·규칙 검사.
// 이 파일은 next/* 를 import 하지 않는다(tests 가 직접 import).
// 업무 규칙(항목 검증)은 TS 에서 하고, DB 함수는 잠금 안에서 '검사할 때 본 상태'만 다시 확인한다.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {validateProductionRecord} from './ingest-integrity.ts';
import {datasets,type Dataset} from './sync-audit.ts';

export const INGEST_V2_VERSION=2 as const;
export const MAX_V2_ITEMS=500;
const FUTURE_SKEW_MS=5*60*1000;

// v1(app/api/ingest/route.ts)과 같은 항목 규칙. ③에서 route 가 이 정의를 쓴다.
export const itemKinds=['transaction','settlement','news','benefit','task','event','journal'] as const;
export const stoppedSubscriptionStatuses=['paused','stopped','cancelled','canceled','inactive'] as const;
export const regularStatuses=['pending','done','active','archived','deleted'] as const;
export const ingestItemSchema=z.object({
 kind:z.enum(itemKinds),
 external_id:z.string().min(1).max(180),
 title:z.string().min(1).max(400),
 description:z.string().max(10000).nullable().optional(),
 amount:z.number().finite().nullable().optional(),
 currency:z.string().max(8).default('KRW'),
 status:z.enum([...regularStatuses,...stoppedSubscriptionStatuses]).default('active'),
 category:z.string().max(100).nullable().optional(),
 source:z.string().max(100).nullable().optional(),
 event_date:z.string().date().nullable().optional(),
 due_date:z.string().date().nullable().optional(),
 url:z.string().url().max(2000).nullable().optional(),
 metadata:z.record(z.unknown()).default({})
}).strict().superRefine((value,ctx)=>{
 if((stoppedSubscriptionStatuses as readonly string[]).includes(value.status)&&!(value.kind==='benefit'&&value.category==='ai_subscription'))
  ctx.addIssue({code:z.ZodIssueCode.custom,path:['status'],message:'Subscription-specific status requires ai_subscription'});
});
export type IngestItem=z.infer<typeof ingestItemSchema>;

const runSchema=z.object({
 run_id:z.string().uuid(),
 dataset:z.enum(datasets),
 source_system:z.string().min(1).max(100),
 source_as_of:z.string().datetime({offset:true}).nullable(),
 collected_at:z.string().datetime({offset:true}),
 status:z.enum(['success','failed']).default('success'),
 error_code:z.string().regex(/^[A-Z0-9_:-]{1,100}$/).nullable().default(null)
}).strict();
export type IngestV2Run=z.infer<typeof runSchema>;

const manifestSchema=z.object({
 item_count:z.number().int().nonnegative(),
 amount_total:z.number().finite().nullable()
}).strict();
export type IngestV2Manifest=z.infer<typeof manifestSchema>;

export const ingestV2Schema=z.object({
 version:z.literal(INGEST_V2_VERSION),
 run:runSchema,
 items:z.array(ingestItemSchema).max(MAX_V2_ITEMS),
 manifest:manifestSchema
}).strict();

// 문서(docs/INGEST_V2.md ②)의 code 표와 같아야 한다. 테스트가 비교한다.
export const ingestV2Codes=[
 'INVALID_FORMAT',
 'RUN_ID_MISMATCH',
 'SOURCE_SYSTEM_MISMATCH',
 'KIND_DATASET_MISMATCH',
 'ITEM_COUNT_MISMATCH',
 'AMOUNT_TOTAL_MISMATCH',
 'RUN_TIME_ORDER',
 'ERROR_CODE_REQUIRED',
 'ITEMS_NOT_ALLOWED_FOR_FAILED',
 'ITEMS_REQUIRED',
 'DUPLICATE_BATCH_ID'
] as const;
export type IngestV2Code=typeof ingestV2Codes[number];
export type IngestV2Violation={index?:number;code:string;field:string};

export type IngestV2Parsed={
 ok:true;
 run:IngestV2Run;
 items:IngestItem[];
 rawItems:Record<string,unknown>[];
 manifest:IngestV2Manifest;
 payloadDigest:string;
 itemViolations:IngestV2Violation[];
};
export type IngestV2Rejected={ok:false;status:422;violations:IngestV2Violation[]};

const benefitCategories=new Set(['points','ai_subscription']);
export const kindMatchesDataset=(dataset:Dataset,item:{kind:string;category?:string|null})=>{
 switch(dataset){
 case 'transactions':return item.kind==='transaction';
 case 'settlements':return item.kind==='settlement';
 case 'news':return item.kind==='news';
 case 'points':return item.kind==='benefit'&&item.category==='points';
 case 'subscriptions':return item.kind==='benefit'&&item.category==='ai_subscription';
 case 'applications':return item.kind==='benefit'&&(item.category==null||!benefitCategories.has(item.category));
 case 'tasks':return item.kind==='task';
 case 'events':return item.kind==='event';
 case 'journal':return item.kind==='journal';
 default:return false;
 }
};

// 객체 키를 재귀적으로 정렬하고 배열 순서는 유지, 공백 없는 JSON.
export function canonicalJson(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';
 if(Array.isArray(value))return '['+value.map(v=>v===undefined?'null':canonicalJson(v)).join(',')+']';
 const obj=value as Record<string,unknown>;
 const keys=Object.keys(obj).filter(k=>obj[k]!==undefined).sort();
 return '{'+keys.map(k=>JSON.stringify(k)+':'+canonicalJson(obj[k])).join(',')+'}';
}
export const payloadDigestOf=(rawItems:readonly unknown[])=>createHash('sha256').update(canonicalJson(rawItems),'utf8').digest('hex');

const cents=(n:number)=>Math.round(n*100);

export function parseIngestV2(body:unknown,now:number):IngestV2Parsed|IngestV2Rejected{
 const parsed=ingestV2Schema.safeParse(body);
 if(!parsed.success){
  const violations=parsed.error.issues.map(issue=>{
   const field=issue.path.join('.');
   const v:IngestV2Violation={code:'INVALID_FORMAT',field};
   if(issue.path[0]==='items'&&typeof issue.path[1]==='number')v.index=issue.path[1];
   return v;
  });
  return {ok:false,status:422,violations};
 }
 const {run,items,manifest}=parsed.data;
 // 형식 검사를 통과했으므로 body.items 는 알려진 키만 가진 객체 배열이다. 기본값을 채우지 않은 원본 사본.
 const rawItems=structuredClone((body as {items:Record<string,unknown>[]}).items);
 const violations:IngestV2Violation[]=[];
 const add=(code:IngestV2Code,field:string,index?:number)=>violations.push(index===undefined?{code,field}:{index,code,field});

 const keys=new Set<string>();
 items.forEach((item,index)=>{
  if(item.metadata.run_id!==run.run_id)add('RUN_ID_MISMATCH','metadata.run_id',index);
  if(item.metadata.source_system!==run.source_system)add('SOURCE_SYSTEM_MISMATCH','metadata.source_system',index);
  if(!kindMatchesDataset(run.dataset,item))add('KIND_DATASET_MISMATCH','kind',index);
  const key=item.kind+':'+item.external_id;
  if(keys.has(key))add('DUPLICATE_BATCH_ID','external_id',index);
  keys.add(key);
 });
 if(manifest.item_count!==items.length)add('ITEM_COUNT_MISMATCH','manifest.item_count');
 if(manifest.amount_total!==null){
  const sum=items.reduce((total,item)=>typeof item.amount==='number'?total+item.amount:total,0);
  if(cents(sum)!==cents(manifest.amount_total))add('AMOUNT_TOTAL_MISMATCH','manifest.amount_total');
 }
 const collected=Date.parse(run.collected_at);
 if(run.source_as_of!==null&&Date.parse(run.source_as_of)>collected)add('RUN_TIME_ORDER','run.source_as_of');
 if(collected>now+FUTURE_SKEW_MS)add('RUN_TIME_ORDER','run.collected_at');
 if(run.status==='failed'){
  if(!run.error_code)add('ERROR_CODE_REQUIRED','run.error_code');
  if(items.length>0)add('ITEMS_NOT_ALLOWED_FOR_FAILED','items');
 }else if(items.length===0)add('ITEMS_REQUIRED','items');
 if(violations.length)return {ok:false,status:422,violations};

 const itemViolations=items.flatMap((item,index)=>validateProductionRecord(item,now).map(error=>({index,...error})));
 return {ok:true,run,items,rawItems,manifest,payloadDigest:payloadDigestOf(rawItems),itemViolations};
}
