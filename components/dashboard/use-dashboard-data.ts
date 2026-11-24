'use client';
// 운영 대시보드 데이터 훅: /api/dashboard 읽기(60초 주기 + 수동 갱신)와 /api/items 쓰기(상태·할 일·메모), 로그아웃.
// 화면 상태(탭·폼·초안·펼침)는 셸이 갖고, 이 훅은 데이터 상태와 동작만 갖는다.
import {useCallback,useEffect,useRef,useState} from 'react';
import {browserDb} from '@/lib/supabase';
import {beginStatusChange,endStatusChange,revertStatus} from '@/lib/items-state';
import {isDashboardSnapshot} from '@/lib/dashboard-freshness';
import type {SyncHealth} from '@/lib/dashboard-freshness';

export type Kind='transaction'|'settlement'|'news'|'benefit'|'task'|'event'|'journal';
export type Item={id:string;kind:Kind;title:string;description:string|null;amount:number|null;currency:string;status:string;category:string|null;source:string|null;due_date:string|null;event_date:string|null;url:string|null;metadata:Record<string,unknown>;updated_at?:string|null};

export function useDashboardData(){
 const [rawItems,setItems]=useState<Item[]>([]),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[refreshNotice,setRefreshNotice]=useState(''),[error,setError]=useState(''),[userEmail,setUserEmail]=useState(''),[taskBusy,setTaskBusy]=useState(false),[taskRemoving,setTaskRemoving]=useState<string|null>(null),[updates,setUpdates]=useState<Record<string,string|null>>({}),[sourceUpdates,setSourceUpdates]=useState<Record<string,string|null>>({});
 const [hasSnapshot,setHasSnapshot]=useState(false),[syncHealth,setSyncHealth]=useState<Record<string,SyncHealth>>({});
 const readInFlight=useRef(false);
 const statusInFlight=useRef<Set<string>>(new Set()),[statusBusy,setStatusBusy]=useState<string[]>([]);
 // 상태(taskBusy·taskRemoving)가 다시 그려지기 전에 들어온 반복 제출도 막는다.
 const taskInFlight=useRef(false),removeInFlight=useRef(false);
 const refresh=useCallback(async()=>{
   if(readInFlight.current)return false;
   readInFlight.current=true;
   try{
     const res=await fetch('/api/dashboard',{cache:'no-store'});
     if(res.status===401){window.location.href='/login';return false;}
     if(!res.ok)throw new Error('데이터 조회에 실패했습니다.');
     const json:unknown=await res.json();
     if(!isDashboardSnapshot(json))throw new Error('불완전한 조회 응답입니다.');
     setItems(json.items as Item[]);setUpdates(json.updates);setSourceUpdates(json.sourceUpdates);setSyncHealth(json.syncHealth);setHasSnapshot(true);setError('');
     return true;
   }catch(e){setError(e instanceof Error?e.message:'연결 오류');return false;}
   finally{readInFlight.current=false;setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();const id=setInterval(()=>void refresh(),60000);return()=>clearInterval(id)},[refresh]);
 useEffect(()=>{try{void browserDb().auth.getUser().then(r=>setUserEmail(r.data.user?.email??''),()=>setUserEmail(''))}catch{setUserEmail('')}},[]);
 const manualRefresh=async()=>{
   if(refreshing)return;
   setRefreshing(true);setRefreshNotice('');
   try{if(await refresh())setRefreshNotice('DB 조회 완료 · 원본 확인 시각 참고');}
   finally{setRefreshing(false);}
 };
 const change=async(x:Item,status:string)=>{if(!beginStatusChange(statusInFlight.current,x.id))return;setStatusBusy([...statusInFlight.current]);setItems(old=>old.map(y=>y.id===x.id?{...y,status}:y));try{const res=await fetch('/api/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'status',id:x.id,status})});if(!res.ok)throw new Error('저장 실패')}catch{setItems(cur=>revertStatus(cur,x.id,status,x.status));setError('상태 저장에 실패했습니다')}finally{endStatusChange(statusInFlight.current,x.id);setStatusBusy([...statusInFlight.current])}};
 /** 성공하면 true(호출자가 입력을 비운다), 실패·중복이면 false(입력 유지) */
 const addTask=async(draft:string)=>{
   const title=draft.trim();if(!title||taskBusy||taskInFlight.current)return false;
   taskInFlight.current=true;setTaskBusy(true);setError('');
   try{
     const response=await fetch('/api/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});
     if(!response.ok)throw new Error('추가 실패');
     const data=await response.json();
     setItems(old=>[...old,data.item]);
     return true;
   }catch{setError('할 일을 추가하지 못했습니다. 다시 시도해 주세요.');return false;}
   finally{taskInFlight.current=false;setTaskBusy(false)}
 };
 const removeTask=async(x:Item)=>{
   if(taskRemoving||removeInFlight.current)return;
   removeInFlight.current=true;setTaskRemoving(x.id);setError('');
   try{
     const response=await fetch('/api/items',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:x.id})});
     if(!response.ok)throw new Error('삭제 실패');
     setItems(old=>old.map(y=>y.id===x.id?{...y,status:'archived'}:y));
   }catch{setError('할 일을 삭제하지 못했습니다. 다시 시도해 주세요.')}
   finally{removeInFlight.current=false;setTaskRemoving(null)}
 };
 /** 실패하면 오류를 두고 throw 한다(호출자가 초안을 유지한다). */
 const saveMemoValue=async(x:Item,value:string)=>{
   const memo=value.trim();
   try{
     const res=await fetch('/api/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'memo',id:x.id,memo})});
     if(!res.ok)throw new Error('메모 저장 실패');
     const data=await res.json();
     setItems(old=>old.map(y=>y.id===x.id?{...y,metadata:data.item.metadata??{...y.metadata,memo}}:y));
     setError('');
   }catch{
     setError('거래 메모를 저장하지 못했습니다. 다시 시도해 주세요.');
     throw new Error('메모 저장 실패');
   }
 };
 const signOut=async()=>{await browserDb().auth.signOut();window.location.href='/login'};
 return {rawItems,updates,sourceUpdates,syncHealth,hasSnapshot,loading,error,statusBusy,userEmail,refreshing,refreshNotice,taskBusy,taskRemoving,refresh,manualRefresh,change,addTask,removeTask,saveMemoValue,signOut};
}
