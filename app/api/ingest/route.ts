import {NextRequest,NextResponse} from 'next/server';
import {checkCollectorToken,collectorAuthFailureLog} from '@/lib/collector-auth';
import {logApiFailure} from '@/lib/api-log';
import {z} from 'zod';
import {adminDb} from '@/lib/supabase-server';
import {handleIngest,readAllPages,type IngestDeps,type Row} from '@/lib/ingest-service';
export const runtime='nodejs';
// 처리 본체는 lib/ingest-service.ts. 쓰기는 DB 함수 dashboard_ingest_commit 하나로만 한다(직접 upsert 없음).
// 충돌 키(user_id, kind, external_id)는 그 함수의 on conflict 에 있다.
const PAGE=500;
function ingestDeps():IngestDeps{
 // 결정 F: DB 클라이언트는 첫 DB 호출 때 한 번 만든다(형식·업무 검사는 DB 설정과 상관없이 먼저 나온다).
 let db:ReturnType<typeof adminDb>|null=null;
 const get=()=>db??(db=adminDb());
 const page=(fn:string,args:Record<string,unknown>)=>readAllPages(async after=>{
  const {data,error}=await get().rpc(fn,{...args,p_after:after,p_limit:PAGE});
  return {data:data as {rows:Row[];next_after:string|null}|null,error};
 });
 return {
  readExisting:(userId,externalIds)=>page('dashboard_ingest_existing',{p_user:userId,p_external_ids:externalIds}),
  readCandidates:(userId,sourceIds)=>page('dashboard_ingest_candidates',{p_user:userId,p_source_ids:sourceIds}),
  readRun:async(userId,key)=>{
   const {data,error}=await get().from('dashboard_sync_runs').select('*').eq('user_id',userId).eq('run_id',key.run_id).eq('dataset',key.dataset).eq('source_system',key.source_system).maybeSingle();
   return {data,error};
  },
  commit:async args=>{const {data,error}=await get().rpc('dashboard_ingest_commit',args);return {data,error};},
 };
}
export async function POST(req:NextRequest){
 const collector=checkCollectorToken(req.headers.get('authorization'),process.env.PICKLE_INGEST_TOKEN);
 if(!collector.ok){console.error(collectorAuthFailureLog('/api/ingest',collector.reason));return NextResponse.json({error:'Unauthorized'},{status:401});}
 const userId=process.env.DASHBOARD_USER_ID;
 if(!userId||!z.string().uuid().safeParse(userId).success){logApiFailure('/api/ingest','config');return NextResponse.json({error:'Server not configured'},{status:503});}
 let json:unknown;try{json=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
 try{
 const out=await handleIngest(json,userId,Date.now(),ingestDeps());
 if(out.kind==='response')return out.status===200?NextResponse.json(out.body,{headers:{'Cache-Control':'no-store'}}):NextResponse.json(out.body,{status:out.status});
 const {stage,err}=out;
 if(stage==='status_lookup'){logApiFailure('/api/ingest',stage,err);return NextResponse.json({error:'Status lookup failed'},{status:500});}
 if(stage==='duplicate_lookup'){logApiFailure('/api/ingest',stage,err);return NextResponse.json({error:'Duplicate lookup failed'},{status:503});}
 if(stage==='run_lookup'){logApiFailure('/api/ingest',stage,err);return NextResponse.json({error:'Run lookup failed'},{status:503});}
 logApiFailure('/api/ingest','write',err);return NextResponse.json({error:'Write failed'},{status:500});
 }catch(e){logApiFailure('/api/ingest','unexpected',e);return NextResponse.json({error:'Server configuration error'},{status:503})}
}
