import {NextRequest,NextResponse} from 'next/server';
import {checkCollectorToken,collectorAuthFailureLog} from '@/lib/collector-auth';
import {logApiFailure} from '@/lib/api-log';
import {z} from 'zod';
import {adminDb,serverDb} from '@/lib/supabase-server';
import {datasets} from '@/lib/sync-audit';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const report=z.object({
 run_id:z.string().uuid(),dataset:z.enum(datasets),source_system:z.string().min(1).max(100),
 source_as_of:z.string().datetime({offset:true}).nullable(),collected_at:z.string().datetime({offset:true}).nullable(),
 status:z.enum(['success','partial','failed','quarantined']),
 expected_count:z.number().int().nonnegative().nullable(),
 received_count:z.number().int().nonnegative(),
 rejected_count:z.number().int().nonnegative().default(0),
 error_code:z.string().regex(/^[A-Z0-9_:-]{1,100}$/).nullable().default(null),
 payload_digest:z.string().regex(/^[a-f0-9]{64}$/i).nullable().default(null)
}).strict().superRefine((v,ctx)=>{
 if(v.source_as_of&&v.collected_at&&Date.parse(v.source_as_of)>Date.parse(v.collected_at))ctx.addIssue({code:z.ZodIssueCode.custom,path:['source_as_of'],message:'Source time after collection'});
 if(v.collected_at&&Date.parse(v.collected_at)>Date.now()+300000)ctx.addIssue({code:z.ZodIssueCode.custom,path:['collected_at'],message:'Future collection time'});
 if(v.rejected_count>v.received_count)ctx.addIssue({code:z.ZodIssueCode.custom,path:['rejected_count'],message:'Rejected exceeds received'});
 if(v.status==='success'&&(!v.source_as_of||!v.collected_at||v.expected_count===null||v.expected_count!==v.received_count||v.rejected_count!==0))ctx.addIssue({code:z.ZodIssueCode.custom,path:['status'],message:'Success requires complete counts and source/collection times'});
 if(v.status!=='success'&&!v.error_code)ctx.addIssue({code:z.ZodIssueCode.custom,path:['error_code'],message:'Non-success report requires an error code'});
});
const headers={'Cache-Control':'no-store'};
export async function GET(){
 const db=await serverDb();const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 const {data,error}=await db.from('dashboard_sync_runs').select('*').eq('user_id',user.id).order('received_at',{ascending:false}).limit(200);
 if(error)return NextResponse.json({error:'Sync audit unavailable; migration required or database unavailable'},{status:503,headers});
 return NextResponse.json({runs:data??[],verification:'collector_report_and_database_count_not_independent_source_verification'},{headers});
}
export async function POST(req:NextRequest){
 const collector=checkCollectorToken(req.headers.get('authorization'),process.env.PICKLE_INGEST_TOKEN);
 if(!collector.ok){console.error(collectorAuthFailureLog('/api/sync-runs',collector.reason));return NextResponse.json({error:'Unauthorized'},{status:401,headers});}
 const userId=process.env.DASHBOARD_USER_ID;
 if(!userId||!z.string().uuid().safeParse(userId).success){logApiFailure('/api/sync-runs','config');return NextResponse.json({error:'Server not configured'},{status:503,headers});}
 let raw:unknown;try{raw=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400,headers})}
 const parsed=report.safeParse(raw);
 if(!parsed.success)return NextResponse.json({error:'Invalid sync report',details:parsed.error.flatten()},{status:422,headers});
 const v=parsed.data;
 try{
 const db=adminDb();
 const key={user_id:userId,run_id:v.run_id,dataset:v.dataset,source_system:v.source_system};
 const {data:prior,error:readError}=await db.from('dashboard_sync_runs').select('*').match(key).maybeSingle();
 if(readError){logApiFailure('/api/sync-runs','read',readError);return NextResponse.json({error:'Sync audit unavailable; migration required or database unavailable'},{status:503,headers});}
 if(prior){
   // Compare the original report, not today's mutable item counts. Later syncs may
   // already have replaced the item metadata for this completed run.
   const fields=['status','source_as_of','collected_at','expected_count','received_count','rejected_count','error_code','payload_digest'] as const;
   const equivalent=fields.every(field=>field==='source_as_of'||field==='collected_at'?(prior[field]===null&&v[field]===null||Date.parse(prior[field]??'')===Date.parse(v[field]??'')):prior[field]===v[field]);
   if(!equivalent)return NextResponse.json({error:'Run already finalized; use a new run_id for a new collection',code:'RUN_ID_CONFLICT'},{status:409,headers});
   return NextResponse.json({recorded:true,idempotent:true,run:prior},{headers});
 }
 const kind:Record<string,string>={transactions:'transaction',settlements:'settlement',news:'news',points:'benefit',applications:'benefit',subscriptions:'benefit',tasks:'task',events:'event',journal:'journal'};
 let query=db.from('dashboard_items').select('id',{count:'exact',head:true}).eq('user_id',userId).eq('kind',kind[v.dataset]).eq('metadata->>run_id',v.run_id).eq('metadata->>source_system',v.source_system);
 if(v.dataset==='points')query=query.eq('category','points');
 if(v.dataset==='subscriptions')query=query.eq('category','ai_subscription');
 if(v.dataset==='applications')query=query.or('category.is.null,category.not.in.(points,ai_subscription)');
 const {count,error:countError}=await query;
 if(countError||count===null){logApiFailure('/api/sync-runs','count',countError);return NextResponse.json({error:'Unable to verify persisted count'},{status:503,headers});}
 if(count>v.received_count||count+v.rejected_count>v.received_count||(v.status==='success'&&count!==v.expected_count)||(v.status==='failed'&&count!==0))return NextResponse.json({error:'Sync report does not match persisted count',code:'SYNC_COUNT_MISMATCH',observed_count:count},{status:409,headers});
 const row={...v,...key,accepted_count:count,validated_at:new Date().toISOString(),verification_level:count>0?'structural_provenance_only':'unverified'};
 const {data,error}=await db.from('dashboard_sync_runs').insert(row).select('*').single();
 if(error){logApiFailure('/api/sync-runs','write',error);return NextResponse.json({error:'Sync audit write failed'},{status:503,headers});}
 return NextResponse.json({recorded:true,run:data},{headers});
 }catch(e){logApiFailure('/api/sync-runs','unexpected',e);return NextResponse.json({error:'Sync audit unavailable'},{status:503,headers});}
}
