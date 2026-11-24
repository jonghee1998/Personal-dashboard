import {NextRequest,NextResponse} from 'next/server';
import {checkCollectorToken,collectorAuthFailureLog} from '@/lib/collector-auth';
import {logApiFailure} from '@/lib/api-log';
import {stageWriteOutcome} from '@/lib/stage-write';
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
 const collector=checkCollectorToken(req.headers.get('authorization'),process.env.PICKLE_INGEST_TOKEN);
 if(!collector.ok){console.error(collectorAuthFailureLog('/api/backfill/stage',collector.reason));return NextResponse.json({error:'Unauthorized'},{status:401,headers});}
 const userId=process.env.DASHBOARD_USER_ID;
 if(!userId||!z.string().uuid().safeParse(userId).success){logApiFailure('/api/backfill/stage','config');return NextResponse.json({error:'Server not configured'},{status:503,headers});}
 let raw:unknown;try{raw=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400,headers});}
 const parsed=schema.safeParse(raw);if(!parsed.success)return NextResponse.json({error:'Invalid stage request'},{status:422,headers});
 try{
  const db=adminDb();const {data:snapshot,error}=await db.rpc('dashboard_backfill_inventory',{p_user:userId});
  if(error||!Array.isArray(snapshot)||snapshot.length>5000){logApiFailure('/api/backfill/stage','inventory',error);return NextResponse.json({error:'Inventory unavailable'},{status:503,headers});}
  const visible=(snapshot as ExistingRow[]).filter(row=>visibleDashboardItem(row)&&!isReportedSyntheticId(row.external_id));
  const v=previewBackfill(visible,parsed.data.entries,userId);
  if(v.status!=='preview_only'||v.eligible_count===0||v.plan_digest!==parsed.data.expected_plan_digest)return NextResponse.json({error:'Plan changed or blocked; rerun preview',preview:v},{status:409,headers});
  const {candidates,...summary}=v;
  const record={user_id:userId,plan_digest:v.plan_digest,inventory_digest:v.inventory_digest,inventory_snapshot:snapshot,plan_entries:parsed.data.entries,candidates,summary};
  const {data,error:writeError}=await db.from('dashboard_backfill_batches').insert(record).select('id,status,plan_digest,summary,created_at').single();
  if(writeError){
   const o=await stageWriteOutcome(writeError,()=>db.from('dashboard_backfill_batches').select('id,status,plan_digest,summary,created_at').eq('user_id',userId).eq('plan_digest',v.plan_digest).single());
   if(o.log)logApiFailure('/api/backfill/stage',o.log.stage,o.log.err);return NextResponse.json(o.body,{status:o.status,headers});
  }
  return NextResponse.json({batch:data,applied_count:0},{headers});
 }catch(e){logApiFailure('/api/backfill/stage','unexpected',e);return NextResponse.json({error:'Stage unavailable'},{status:503,headers});}
}
