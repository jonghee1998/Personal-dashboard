import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {adminDb,serverDb} from '@/lib/supabase-server';
import {itemPatchSchema} from '@/lib/items-schema';

export async function PATCH(req:NextRequest){
 const db=await serverDb();
 const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 let json:unknown;
 try{json=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
 const parsed=itemPatchSchema.safeParse(json);
 if(!parsed.success)return NextResponse.json({error:'Invalid payload'},{status:400});
 const input=parsed.data;
 if(input.action==='status'){
   // 정산·할 일의 pending↔done 만. 보관된 행(삭제한 할 일)은 늦게 온 체크로 되살리지 않는다.
   const {data,error}=await db.from('dashboard_items').update({status:input.status}).eq('id',input.id).eq('user_id',user.id).in('kind',['settlement','task']).neq('status','archived').select().single();
   if(error||!data)return NextResponse.json({error:'Update failed'},{status:400});
   return NextResponse.json({item:data});
 }
 // 한 UPDATE 로 metadata.memo 만 바꾼다(읽고 다시 쓰는 사이 다른 쓰기를 덮어쓰지 않음). 본인 거래가 아니면 null.
 const {data,error}=await db.rpc('dashboard_item_set_memo',{p_id:input.id,p_memo:input.memo.trim()});
 if(error)return NextResponse.json({error:'Memo save failed'},{status:400});
 if(data==null)return NextResponse.json({error:'Transaction not found'},{status:404});
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
