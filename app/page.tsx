import {redirect} from 'next/navigation';
import {serverDb} from '@/lib/supabase-server';
import Dashboard from '@/components/demo-dashboard';
export default async function Home(){if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return <main style={{padding:40}}>Supabase 환경변수를 설정해 주세요.</main>;const db=await serverDb();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');return <Dashboard/>;}
