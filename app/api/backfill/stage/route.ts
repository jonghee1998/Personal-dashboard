import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {adminDb} from '@/lib/supabase-server';
import {backfillPlanSchema} from '@/lib/backfill-plan-schema';
import {previewBackfill} from '@/lib/transaction-backfill';
import type {ExistingRow} from '@/lib/transaction-backfill';
import {visibleDashboardItem} from '@/lib/dashboard-visibility';
import {isReportedSyntheticId} from '@/lib/ingest-integrity';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store'};
const schema=backfillPlanSchema.extend({expected_plan_digest:z.string().regex(/^[a-f0-9]{64}$/)});
export async function POST(req:NextRequest){
 const token=process.env.PICKLE_INGEST_TOKEN,auth=req.headers.get('authorization')??'';
 if(!token||token.length<32||!auth.startsWith('Bearer '))return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 const a=Buffer.from(auth.slice(7)),b=Buffer.from(token);if(a.length!==b.length||!timingSafeEqual(a,b))return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 const userId=process.env.DASHBOARD_USER_ID;
 if(!userId||!z.string().uuid().safeParse(userId).success)return NextResponse.json({error:'Server not configured'},{status:503,headers});
 let raw:unknown;try{raw=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400,headers});}
 const parsed=schema.safeParse(raw);if(!parsed.success)return NextResponse.json({error:'Invalid stage request'},{status:422,headers});
 try{
  const db=adminDb();const {data:snapshot,error}=await db.rpc('dashboard_backfill_inventory',{p_user:userId});
  if(error||!Array.isArray(snapshot)||snapshot.length>5000)return NextResponse.json({error:'Inventory unavailable'},{status:503,headers});
  const visible=(snapshot as ExistingRow[]).filter(row=>visibleDashboardItem(row)&&!isReportedSyntheticId(row.external_id));
  const v=previewBackfill(visible,parsed.data.entries,userId);
  if(v.status!=='preview_only'||v.eligible_count===0||v.plan_digest!==parsed.data.expected_plan_digest)return NextResponse.json({error:'Plan changed or blocked; rerun preview',preview:v},{status:409,headers});
  const {candidates,...summary}=v;
  const record={user_id:userId,plan_digest:v.plan_digest,inventory_digest:v.inventory_digest,inventory_snapshot:snapshot,plan_entries:parsed.data.entries,candidates,summary};
  const {data,error:writeError}=await db.from('dashboard_backfill_batches').insert(record).select('id,status,plan_digest,summary,created_at').single();
  if(writeError){
   if(writeError.code==='23505'){
    const existing=await db.from('dashboard_backfill_batches').select('id,status,plan_digest,summary,created_at').eq('user_id',userId).eq('plan_digest',v.plan_digest).single();
    if(!existing.error)return NextResponse.json({batch:existing.data,applied_count:0},{headers});
   }
   return NextResponse.json({error:'Stage unavailable'},{status:503,headers});
  }
  return NextResponse.json({batch:data,applied_count:0},{headers});
 }catch{return NextResponse.json({error:'Stage unavailable'},{status:503,headers});}
}
