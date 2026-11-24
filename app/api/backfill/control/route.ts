import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {adminDb,serverDb} from '@/lib/supabase-server';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store'};
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('apply'),batch_id:z.string().uuid(),plan_digest:z.string().regex(/^[a-f0-9]{64}$/),expected_count:z.number().int().min(1).max(5000),confirmation:z.literal('APPLY_METADATA_ONLY')}).strict(),
 z.object({action:z.literal('rollback'),batch_id:z.string().uuid(),plan_digest:z.string().regex(/^[a-f0-9]{64}$/),confirmation:z.literal('ROLLBACK_METADATA_ONLY')}).strict()
]);
async function owner(){
 const db=await serverDb();const {data:{user}}=await db.auth.getUser();
 return user&&user.id===process.env.DASHBOARD_USER_ID?user.id:null;
}
export async function GET(){
 const userId=await owner();if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 try{
  const {data,error}=await adminDb().from('dashboard_backfill_batches').select('id,status,plan_digest,summary,created_at,applied_at,rolled_back_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(20);
  if(error)return NextResponse.json({error:'Batch read unavailable'},{status:503,headers});
  return NextResponse.json({batches:data},{headers});
 }catch{return NextResponse.json({error:'Batch read unavailable'},{status:503,headers});}
}
export async function POST(req:NextRequest){
 // User session, never collector bearer. Explicit same-origin confirmation.
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Same origin required'},{status:403,headers});
 const userId=await owner();if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 if(process.env.BACKFILL_APPLY_ENABLED!=='true')return NextResponse.json({error:'Backfill execution disabled'},{status:503,headers});
 let raw:unknown;try{raw=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400,headers});}
 const parsed=schema.safeParse(raw);if(!parsed.success)return NextResponse.json({error:'Explicit confirmation and valid batch required'},{status:422,headers});
 const v=parsed.data;
 try{
  const db=adminDb();
  const args={p_user:userId,p_batch:v.batch_id,p_digest:v.plan_digest};
  const result=v.action==='apply'?await db.rpc('dashboard_backfill_apply',{...args,p_expected_count:v.expected_count}):await db.rpc('dashboard_backfill_rollback',args);
  if(result.error)return NextResponse.json({error:result.error.code==='P0001'?'Backfill rejected: '+result.error.message:'Backfill unavailable'},{status:result.error.code==='P0001'?409:503,headers});
  return NextResponse.json(result.data,{headers});
 }catch{return NextResponse.json({error:'Backfill unavailable'},{status:503,headers});}
}
