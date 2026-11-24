import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {adminDb} from '@/lib/supabase-server';
import {normalizeIncomingStatus} from '@/lib/dashboard-visibility';
import {validateProductionRecord,isStaleReplay} from '@/lib/ingest-integrity';
import {duplicateConflicts,strongTransactionKey} from '@/lib/transaction-reconciliation';
export const runtime='nodejs';
const kinds=['transaction','settlement','news','benefit','task','event','journal'] as const;
const stoppedSubscriptionStatuses=['paused','stopped','cancelled','canceled','inactive'] as const;
const regularStatuses=['pending','done','active','archived','deleted'] as const;
const item=z.object({kind:z.enum(kinds),external_id:z.string().min(1).max(180),title:z.string().min(1).max(400),description:z.string().max(10000).nullable().optional(),amount:z.number().finite().nullable().optional(),currency:z.string().max(8).default('KRW'),status:z.enum([...regularStatuses,...stoppedSubscriptionStatuses]).default('active'),category:z.string().max(100).nullable().optional(),source:z.string().max(100).nullable().optional(),event_date:z.string().date().nullable().optional(),due_date:z.string().date().nullable().optional(),url:z.string().url().max(2000).nullable().optional(),metadata:z.record(z.unknown()).default({})}).strict().superRefine((value,ctx)=>{if((stoppedSubscriptionStatuses as readonly string[]).includes(value.status)&&!(value.kind==='benefit'&&value.category==='ai_subscription'))ctx.addIssue({code:z.ZodIssueCode.custom,path:['status'],message:'Subscription-specific status requires ai_subscription'});});
const payload=z.object({items:z.array(item).min(1).max(100),validate_only:z.boolean().default(false)}).strict();
function validToken(value:string|null){const secret=process.env.PICKLE_INGEST_TOKEN;if(!secret||secret.length<32||!value)return false;const a=Buffer.from(value);const b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b)}
export async function POST(req:NextRequest){
 const authorization=req.headers.get('authorization');
 if(!validToken(authorization?.startsWith('Bearer ')?authorization.slice(7):null))return NextResponse.json({error:'Unauthorized'},{status:401});
 const userId=process.env.DASHBOARD_USER_ID;
 if(!userId||!z.string().uuid().safeParse(userId).success)return NextResponse.json({error:'Server not configured'},{status:503});
 let json:unknown;try{json=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
 const parsed=payload.safeParse(json);if(!parsed.success)return NextResponse.json({error:'Invalid payload',details:parsed.error.flatten()},{status:400});
 const violations=parsed.data.items.flatMap((record,index)=>validateProductionRecord(record).map(error=>({index,...error})));
 const keys=new Set<string>();
 parsed.data.items.forEach((record,index)=>{const key=record.kind+':'+record.external_id;if(keys.has(key))violations.push({index,code:'DUPLICATE_BATCH_ID',field:'external_id'});keys.add(key);});
 if(violations.length)return NextResponse.json({error:'Production integrity validation failed',violations},{status:422});
 try{
 const db=adminDb();
 const incoming=parsed.data.items;
 const {data:existing,error:readError}=await db.from('dashboard_items')
   .select('*').eq('user_id',userId).in('external_id',incoming.map(x=>x.external_id));
 if(readError)return NextResponse.json({error:'Status lookup failed'},{status:500});
 const current=new Map((existing??[]).map(x=>[x.kind+':'+x.external_id,x]));
 const conflicts=incoming.flatMap((x,index)=>{
   const prior=current.get(x.kind+':'+x.external_id);
   if(['archived','deleted'].includes(x.status)&&!prior)return [{index,code:'DELETE_TARGET_NOT_FOUND',field:'external_id'}];
   if(prior&&isStaleReplay(x.metadata,prior.metadata??{}))return [{index,code:'STALE_REPLAY',field:'metadata.as_of'}];
   return [];
 });
 if(conflicts.length)return NextResponse.json({error:'Production integrity conflict',violations:conflicts},{status:409});
 // Match only provider-issued identities in an explicit account/month/amount scope.
 // Legacy/hash-only identities are audit candidates, not automatically deleted.
 const strong=incoming.filter(x=>strongTransactionKey(x)!==null);
 if(strong.length){
   const sourceIds=[...new Set(strong.map(x=>String(x.metadata.source_record_id)))];
   const candidates:Record<string,any>[]=[];let after:string|null=null;
   while(true){
     let query=db.from('dashboard_items').select('*').eq('user_id',userId).eq('kind','transaction').neq('status','archived').in('metadata->>source_record_id',sourceIds).order('id',{ascending:true}).limit(500);
     if(after)query=query.gt('id',after);
     const {data,error}=await query;
     if(error||!data)return NextResponse.json({error:'Duplicate lookup failed'},{status:503});
     candidates.push(...data);if(data.length<500)break;
     after=data[data.length-1].id;
   }
   const duplicateIssues=duplicateConflicts(incoming,candidates as any);
   if(duplicateIssues.length)return NextResponse.json({error:'Duplicate source transaction',violations:duplicateIssues},{status:409});
 }

 if(parsed.data.validate_only)return NextResponse.json({validated:incoming.length,upserted:0,verification:'structural_provenance_only'},{headers:{'Cache-Control':'no-store'}});
 const rows=parsed.data.items.map(x=>{
   const prior=current.get(x.kind+':'+x.external_id);
   const isSubscription=x.kind==='benefit'&&x.category==='ai_subscription';
   const normalized=normalizeIncomingStatus(x.status,x.metadata,isSubscription);
   const deleting=normalized.status==='archived';
   const status=deleting?'archived':x.kind==='task'&&prior?.status==='archived'?'archived':(x.kind==='settlement'||x.kind==='task')&&prior?.status==='done'?'done':normalized.status;
   const previous=prior?.metadata;
   const memo=x.kind==='transaction'&&previous&&typeof previous==='object'&&!Array.isArray(previous)&&typeof previous.memo==='string'?previous.memo:null;
   const metadata={...normalized.metadata,...(memo===null?{}:{memo})};
   if(deleting&&prior){
     // Preserve existing business fields when archiving; a tombstone is not a new snapshot.
     const {id,created_at,updated_at,...original}=prior;
     return {...original,status:'archived',metadata:{...original.metadata,...normalized.metadata},user_id:userId};
   }
   return {...x,status,metadata,user_id:userId};
 });
 const {data,error}=await db.from('dashboard_items').upsert(rows,{onConflict:'user_id,kind,external_id'}).select('id,kind,external_id');
 if(error)return NextResponse.json({error:'Write failed'},{status:500});
 return NextResponse.json({upserted:data?.length??0,items:data,verification:'structural_provenance_only'},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Server configuration error'},{status:503})}
}
