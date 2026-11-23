import {NextResponse} from 'next/server';
import {serverDb} from '@/lib/supabase-server';
import {visibleDashboardItem} from '@/lib/dashboard-visibility';
import {isReportedSyntheticId} from '@/lib/ingest-integrity';
import {latestSourceTime,datasetFor} from '@/lib/sync-audit';
import {monitoredSources,sourceHealth} from '@/lib/dashboard-freshness';
export const dynamic='force-dynamic';

export async function GET(){
 const db=await serverDb();
 const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 // Give every section its own window so dated news/card records cannot crowd out
 // undated subscriptions, point balances, applications or manually entered tasks.
 const group=(kind:string,category?:'points'|'ai_subscription'|'applications')=>{
   let query=db.from('dashboard_items').select('*').eq('user_id',user.id).eq('kind',kind).neq('status','archived').neq('status','deleted');
   if(category==='applications')query=query.or('category.is.null,category.not.in.(points,ai_subscription)');
   else if(category)query=query.eq('category',category);
   return query.order('updated_at',{ascending:false}).order('id',{ascending:true}).limit(500);
 };
 // Fetch every transaction with stable keyset pagination, avoiding the old 500-row cap.
 const allTransactions=async()=>{
   const data:any[]=[];let after:string|null=null;
   while(true){
     let query=db.from('dashboard_items').select('*').eq('user_id',user.id).eq('kind','transaction').neq('status','archived').neq('status','deleted').order('id',{ascending:true}).limit(500);
     if(after)query=query.gt('id',after);
     const result=await query;
     if(result.error||!result.data)return {data:null,error:result.error??new Error('Transaction read failed')};
     data.push(...result.data);
     if(result.data.length<500)break;
     after=result.data[result.data.length-1].id;
   }
   data.sort((a,b)=>(b.updated_at??'').localeCompare(a.updated_at??'')||a.id.localeCompare(b.id));
   return {data,error:null};
 };
 const [transactions,settlements,news,task,event,journal,subscriptions,points,applications]=await Promise.all([
   allTransactions(),group('settlement'),group('news'),group('task'),group('event'),group('journal'),
   group('benefit','ai_subscription'),group('benefit','points'),group('benefit','applications')
 ]);
 const groups=[transactions,settlements,news,task,event,journal,subscriptions,points,applications];
 if(groups.some(result=>result.error))return NextResponse.json({error:'Read failed'},{status:500});
 const stamp=(result:{data:{updated_at:string}[]|null})=>result.data?.[0]?.updated_at??null;
 const newest=(...values:(string|null)[])=>values.filter((v):v is string=>!!v).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
 // Preserve event-date ordering in the UI after retrieving the latest saved records.
 const items=groups.flatMap(result=>result.data??[]).filter(row=>visibleDashboardItem(row)&&!isReportedSyntheticId(row.external_id)).sort((a,b)=>(b.event_date??'').localeCompare(a.event_date??'')||(b.updated_at??'').localeCompare(a.updated_at??''));
 const source=(...datasets:string[])=>latestSourceTime(items.filter(row=>datasets.includes(datasetFor(row)??'')));
 const syncHealth=Object.fromEntries(await Promise.all(monitoredSources.map(async spec=>{
   const matching=items.filter(row=>datasetFor(row)===spec.dataset&&row.metadata?.source_system===spec.source);
   const lastSource=latestSourceTime(matching);
   // Audit read failure must not blank otherwise valid published dashboard values.
   try{const {data,error}=await db.from('dashboard_sync_runs').select('status,received_at,source_as_of').eq('user_id',user.id).eq('dataset',spec.dataset).eq('source_system',spec.source).order('received_at',{ascending:false}).limit(1);
   return [spec.key,sourceHealth(lastSource,error?null:data?.[0]??null)];}catch{return [spec.key,sourceHealth(lastSource,null)];}
 })));
 return NextResponse.json({items,syncHealth,sourceUpdates:{home:source('transactions','tasks','news'),finance:source('transactions','settlements','subscriptions'),news:source('news'),benefits:source('points','applications'),journal:source('events','tasks','news','points'),subscriptions:source('subscriptions'),points:source('points'),applications:source('applications')},updates:{
   home:newest(stamp(transactions),stamp(task),stamp(news)),
   finance:newest(stamp(transactions),stamp(settlements),stamp(subscriptions)),
   news:stamp(news),
   benefits:newest(stamp(points),stamp(applications)),
   journal:newest(stamp(event),stamp(task),stamp(news),stamp(points)),
   subscriptions:stamp(subscriptions),points:stamp(points),applications:stamp(applications)
 }},{headers:{'Cache-Control':'no-store, max-age=0'}});
}
