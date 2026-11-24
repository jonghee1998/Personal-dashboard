import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {adminDb} from '@/lib/supabase-server';
import {reconcileStatement} from '@/lib/transaction-reconciliation';
import {visibleDashboardItem} from '@/lib/dashboard-visibility';
import {isReportedSyntheticId} from '@/lib/ingest-integrity';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store'};
const won=z.number().int().min(-1e12).max(1e12);
const schema=z.object({
 scope:z.object({source_system:z.literal('samsungcard'),account_key:z.string().trim().min(1).max(100),billing_month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),amount_basis:z.enum(['statement_billed','purchase_approval']),currency:z.literal('KRW')}).strict(),
 expected_count:z.number().int().min(0).max(5000),expected_total:won,
 rows:z.array(z.object({source_record_id:z.string().trim().min(1).max(180),amount:won}).strict()).max(5000)
}).strict();
function authorized(req:NextRequest){
 const secret=process.env.PICKLE_INGEST_TOKEN,auth=req.headers.get('authorization')??'';
 if(!secret||secret.length<32||!auth.startsWith('Bearer '))return false;
 const a=Buffer.from(auth.slice(7)),b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b);
}
// Read-only: no approval, no new financial rows, no changes to the audit table.
export async function POST(req:NextRequest){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 const userId=process.env.DASHBOARD_USER_ID;
 if(!userId||!z.string().uuid().safeParse(userId).success)return NextResponse.json({error:'Server not configured'},{status:503,headers});
 let body:unknown;try{body=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400,headers});}
 const parsed=schema.safeParse(body);if(!parsed.success)return NextResponse.json({error:'Invalid statement manifest',details:parsed.error.flatten()},{status:422,headers});
 try{
  const db=adminDb();const rows:Record<string,any>[]=[];let after:string|null=null;
  while(true){
   let q=db.from('dashboard_items').select('*').eq('user_id',userId).eq('kind','transaction').neq('status','archived').order('id',{ascending:true}).limit(500);
   if(after)q=q.gt('id',after);
   const {data,error}=await q;if(error||!data)return NextResponse.json({error:'Transaction read failed'},{status:503,headers});
   rows.push(...data);if(data.length<500)break;
   after=data[data.length-1].id;
  }
  const v=parsed.data;
  const result=reconcileStatement(rows.filter(row=>visibleDashboardItem(row as any)&&!isReportedSyntheticId(row.external_id)) as any,v.rows,v.scope,v.expected_count,v.expected_total);
  return NextResponse.json(result,{headers});
 }catch{return NextResponse.json({error:'Reconciliation unavailable'},{status:503,headers});}
}
