import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {adminDb,serverDb} from '@/lib/supabase-server';

const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('status'),id:z.string().uuid(),status:z.enum(['pending','done','active','archived'])}),
 z.object({action:z.literal('memo'),id:z.string().uuid(),memo:z.string().max(400)})
]);
const legacySchema=z.object({id:z.string().uuid(),status:z.enum(['pending','done','active','archived'])});

export async function PATCH(req:NextRequest){
 const db=await serverDb();
 const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 let json:unknown;
 try{json=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
 const legacy=legacySchema.safeParse(json);
 const parsed=schema.safeParse(legacy.success?{action:'status',...legacy.data}:json);
 if(!parsed.success)return NextResponse.json({error:'Invalid payload'},{status:400});
 const input=parsed.data;
 if(input.action==='status'){
   const {data,error}=await db.from('dashboard_items').update({status:input.status}).eq('id',input.id).eq('user_id',user.id).select().single();
   if(error||!data)return NextResponse.json({error:'Update failed'},{status:400});
   return NextResponse.json({item:data});
 }
 const {data:existing,error:readError}=await db.from('dashboard_items').select('id,kind,metadata').eq('id',input.id).eq('user_id',user.id).single();
 if(readError||!existing||existing.kind!=='transaction')return NextResponse.json({error:'Transaction not found'},{status:404});
 const metadata=(existing.metadata&&typeof existing.metadata==='object'&&!Array.isArray(existing.metadata))?existing.metadata as Record<string,unknown>:{};
 const {data,error}=await db.from('dashboard_items').update({metadata:{...metadata,memo:input.memo.trim()}}).eq('id',input.id).eq('user_id',user.id).eq('kind','transaction').select().single();
 if(error||!data)return NextResponse.json({error:'Memo save failed'},{status:400});
 return NextResponse.json({item:data});
}

const createTaskSchema=z.object({title:z.string().trim().min(1).max(200)}).strict();
const removeTaskSchema=z.object({id:z.string().uuid()}).strict();

/** Manual tasks are stored per authenticated user; server never trusts a client user ID. */
export async function POST(req:NextRequest){
 const db=await serverDb();
 const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 let json:unknown;try{json=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
 const parsed=createTaskSchema.safeParse(json);
 if(!parsed.success)return NextResponse.json({error:'Invalid task'},{status:400});
 try{
   const {data,error}=await adminDb().from('dashboard_items').insert({
     user_id:user.id,kind:'task',external_id:'manual-'+crypto.randomUUID(),
     title:parsed.data.title,description:null,amount:null,currency:'KRW',
     status:'pending',category:'할 일',source:'직접 추가',event_date:null,
     due_date:null,url:null,metadata:{created_manually:true}
   }).select().single();
   if(error||!data)return NextResponse.json({error:'Create failed'},{status:400});
   return NextResponse.json({item:data},{status:201});
 }catch{return NextResponse.json({error:'Create failed'},{status:500})}
}
/** Archiving, rather than physically deleting, keeps re-ingested tasks from reappearing. */
export async function DELETE(req:NextRequest){
 const db=await serverDb();
 const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 let json:unknown;try{json=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
 const parsed=removeTaskSchema.safeParse(json);
 if(!parsed.success)return NextResponse.json({error:'Invalid task'},{status:400});
 const {data,error}=await db.from('dashboard_items').update({status:'archived'}).eq('id',parsed.data.id).eq('user_id',user.id).eq('kind','task').select('id').maybeSingle();
 if(error||!data)return NextResponse.json({error:'Delete failed'},{status:404});
 return NextResponse.json({deleted:true});
}
