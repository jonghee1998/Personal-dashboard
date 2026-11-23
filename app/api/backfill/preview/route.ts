import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {adminDb} from '@/lib/supabase-server';
import {visibleDashboardItem} from '@/lib/dashboard-visibility';
import {isReportedSyntheticId} from '@/lib/ingest-integrity';
import {previewBackfill} from '@/lib/transaction-backfill';
import type {ExistingRow} from '@/lib/transaction-backfill';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store'};
import {backfillPlanSchema as schema} from '@/lib/backfill-plan-schema';
function authorized(req:NextRequest){
 const secret=process.env.PICKLE_INGEST_TOKEN,auth=req.headers.get('authorization')??'';
 if(!secret||secret.length<32||!auth.startsWith('Bearer '))return false;
 const a=Buffer.from(auth.slice(7)),b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b);
}
// Preview only. No DB write, approval, or executable apply token.
export async function POST(req:NextRequest){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 const userId=process.env.DASHBOARD_USER_ID;
 if(!userId||!z.string().uuid().safeParse(userId).success)return NextResponse.json({error:'Server not configured'},{status:503,headers});
 let raw:unknown;try{raw=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400,headers});}
 const parsed=schema.safeParse(raw);if(!parsed.success)return NextResponse.json({error:'Invalid backfill plan',details:parsed.error.flatten()},{status:422,headers});
 try{
  const db=adminDb(),rows:ExistingRow[]=[];let after:string|null=null;
  const snapshot=await db.rpc('dashboard_backfill_inventory',{p_user:userId});
  if(!snapshot.error){
   if(!Array.isArray(snapshot.data)||snapshot.data.length>5000)return NextResponse.json({error:'Inventory unavailable'},{status:503,headers});
   rows.push(...(snapshot.data as ExistingRow[]).filter(row=>visibleDashboardItem(row)&&!isReportedSyntheticId(row.external_id)));
  }else if(snapshot.error.code==='PGRST202'||snapshot.error.code==='42883'){
   // Compatibility before the new migration is installed. Stage uses the RPC only.
  while(true){
   let q=db.from('dashboard_items').select('*').eq('user_id',userId).eq('kind','transaction').neq('status','archived').neq('status','deleted').order('id',{ascending:true}).limit(500);
   if(after)q=q.gt('id',after);
   const {data,error}=await q;if(error||!data)return NextResponse.json({error:'Transaction inventory read failed'},{status:503,headers});
   rows.push(...data.filter(row=>visibleDashboardItem(row)&&!isReportedSyntheticId(row.external_id)) as ExistingRow[]);
   if(data.length<500)break;after=data[data.length-1].id;
  }
  }else return NextResponse.json({error:'Transaction inventory read failed'},{status:503,headers});
  if(rows.length>5000)return NextResponse.json({error:'Inventory exceeds preview limit'},{status:409,headers});
  const result=previewBackfill(rows,parsed.data.entries,userId);
  return NextResponse.json(result,{status:result.status==='blocked'?409:200,headers});
 }catch{return NextResponse.json({error:'Backfill preview unavailable'},{status:503,headers});}
}
