'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {browserDb} from '@/lib/supabase';
import DemoCalendar from '@/components/demo-calendar';
import DemoDailySpending from '@/components/demo-daily-spending';
import ArchitectureScreen,{ArchitectureIcon} from '@/components/architecture-screen';
import {paymentDateLabel,paymentTime} from '@/lib/transaction-time';
import {visibleDashboardItem,pointProvider} from '@/lib/dashboard-visibility';
import {dashboardTimestamp,subscriptionDisplay,pointChangeDisplay,pointEventAmount,pointToday} from '@/lib/dashboard-display';
import {isDashboardSnapshot,monitoredSources,registeredCoverageDay} from '@/lib/dashboard-freshness';
import type {SyncHealth} from '@/lib/dashboard-freshness';
type Kind='transaction'|'settlement'|'news'|'benefit'|'task'|'event'|'journal';
type Item={id:string;kind:Kind;title:string;description:string|null;amount:number|null;currency:string;status:string;category:string|null;source:string|null;due_date:string|null;event_date:string|null;url:string|null;metadata:Record<string,unknown>;updated_at?:string|null};
const money=(n:number)=>'₩'+Math.round(n).toLocaleString('ko-KR');
const SAMPLE_UPDATED_AT='2026-11-12T08:00:00+09:00';
const tabs=[['home','홈','⌂'],['finance','금융','▤'],['news','뉴스','▣'],['benefits','혜택','✦'],['journal','기록','◷'],['architecture','구조','']] as const;
export default function DemoDashboard({demoData}:{demoData?: readonly Item[]}){
 const isDemo=demoData !== undefined;
 const [rawItems,setItems]=useState<Item[]>(()=>demoData ? demoData.map(item=>({...item})) : []),[tab,setTab]=useState('home'),[selectedNewsId,setSelectedNewsId]=useState<string|null>(null),[expandedNewsCategory,setExpandedNewsCategory]=useState<string|null>(null),[openNewsCategories,setOpenNewsCategories]=useState<string[]>([]),[openExpenseCategories,setOpenExpenseCategories]=useState<string[]>([]),[expandedExpenseCategories,setExpandedExpenseCategories]=useState<string[]>([]),[settleTab,setSettleTab]=useState<'pending'|'done'>('pending'),[financeView,setFinanceView]=useState<'transactions'|'memos'>('transactions'),[editingMemo,setEditingMemo]=useState<string|null>(null),[memoDraft,setMemoDraft]=useState(''),[loading,setLoading]=useState(!isDemo),[refreshing,setRefreshing]=useState(false),[refreshNotice,setRefreshNotice]=useState(''),[error,setError]=useState(''),[userEmail,setUserEmail]=useState(''),[taskDraft,setTaskDraft]=useState(''),[taskFormOpen,setTaskFormOpen]=useState(false),[taskBusy,setTaskBusy]=useState(false),[taskRemoving,setTaskRemoving]=useState<string|null>(null),[updates,setUpdates]=useState<Record<string,string|null>>({}),[sourceUpdates,setSourceUpdates]=useState<Record<string,string|null>>({});
 const [hasSnapshot,setHasSnapshot]=useState(isDemo),[syncHealth,setSyncHealth]=useState<Record<string,SyncHealth>>({});
 const readInFlight=useRef(false);
 const refresh=useCallback(async()=>{
   if(isDemo||readInFlight.current)return false;
   readInFlight.current=true;
   try{
     const res=await fetch('/api/dashboard',{cache:'no-store'});
     if(res.status===401){window.location.href='/login';return false;}
     if(!res.ok)throw new Error('데이터 조회에 실패했습니다.');
     const json:unknown=await res.json();
     if(!isDashboardSnapshot(json))throw new Error('불완전한 조회 응답입니다.');
     setItems(json.items);setUpdates(json.updates);setSourceUpdates(json.sourceUpdates);setSyncHealth(json.syncHealth);setHasSnapshot(true);setError('');
     return true;
   }catch(e){setError(e instanceof Error?e.message:'연결 오류');return false;}
   finally{readInFlight.current=false;setLoading(false);}
 },[isDemo]);
 useEffect(()=>{if(isDemo)return;void refresh();const id=setInterval(()=>void refresh(),60000);return()=>clearInterval(id)},[refresh,isDemo]);
 useEffect(()=>{if(isDemo)return;void browserDb().auth.getUser().then(r=>setUserEmail(r.data.user?.email??''))},[isDemo]);
 const items=useMemo(()=>rawItems.filter(visibleDashboardItem),[rawItems]);
 const by=(k:Kind)=>items.filter(x=>x.kind===k);
 const updateTime=(key:string)=>dashboardTimestamp(isDemo?SAMPLE_UPDATED_AT:updates[key]);
 const updateLabel=(key:string)=>updateTime(key)??(loading?'조회 중':'미등록');
 const sourceLabel=(key:string)=>dashboardTimestamp(isDemo?SAMPLE_UPDATED_AT:sourceUpdates[key])??(loading?'조회 중':'미확인');
 const sourceAlerts=monitoredSources.filter(spec=>!isDemo&&hasSnapshot&&(tab==='home'&&['transactions','news'].includes(spec.key)||tab==='finance'&&spec.key==='transactions'||tab==='benefits'&&['samsungPoints','naverPoints'].includes(spec.key)||tab==='news'&&spec.key==='news')&&syncHealth[spec.key]?.state!=='current');
 const healthText=(key:string)=>{const h=syncHealth[key];return h?.state==='failed'?'최근 수집 실패/불완전 · 기존 저장값 유지':h?.state==='delayed'?'오늘 원본 확인 지연 · 마지막 저장값 유지':'원본 확인 시각 미확인';};
 const amountKnown=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value));
 const transactions=useMemo(()=>items.filter(x=>x.kind==='transaction'),[items]);
 const transactionAmountsKnown=transactions.length>0&&transactions.every(x=>amountKnown(x.amount));
 const coverageDay=registeredCoverageDay(isDemo?SAMPLE_UPDATED_AT:syncHealth.transactions?.last_source_at??null,transactions.map(x=>x.event_date));
 const settlements=by('settlement'),pending=settlements.filter(x=>x.status!=='done'),done=settlements.filter(x=>x.status==='done');
 const cardTotal=transactions.filter(x=>x.amount!==null&&x.amount>0).reduce((a,x)=>a+Number(x.amount),0);
 const pendingAmount=pending.reduce((a,x)=>a+Number(x.amount??0),0);
 const settledAmount=done.reduce((a,x)=>a+Number(x.amount??0),0);
 const points=by('benefit').filter(x=>x.category==='points').reduce((a,x)=>a+Number(x.amount??0),0);
 const tasks=by('task').filter(x=>x.status!=='archived'),taskComplete=tasks.filter(x=>x.status==='done').length;
 const change=async(x:Item,status:string)=>{if(isDemo){setItems(old=>old.map(y=>y.id===x.id?{...y,status}:y));return;}const prev=items;setItems(old=>old.map(y=>y.id===x.id?{...y,status}:y));try{const res=await fetch('/api/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:x.id,status})});if(!res.ok)throw new Error('저장 실패')}catch{setItems(prev);setError('상태 저장에 실패했습니다')}};
 const addTask=async()=>{
   const title=taskDraft.trim();if(!title||taskBusy)return;
   setTaskBusy(true);setError('');
   if(isDemo){
     const id='demo-manual-'+Date.now()+'-'+Math.random().toString(36).slice(2);
     setItems(old=>[...old,{id,kind:'task',title,description:null,amount:null,currency:'KRW',status:'pending',category:'할 일',source:'직접 추가',due_date:null,event_date:null,url:null,metadata:{created_manually:true}}]);
     setTaskDraft('');setTaskFormOpen(false);setTaskBusy(false);return;
   }
   try{
     const response=await fetch('/api/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});
     if(!response.ok)throw new Error('추가 실패');
     const data=await response.json();
     setItems(old=>[...old,data.item]);setTaskDraft('');setTaskFormOpen(false);
   }catch{setError('할 일을 추가하지 못했습니다. 다시 시도해 주세요.')}
   finally{setTaskBusy(false)}
 };
 const removeTask=async(x:Item)=>{
   if(taskRemoving)return;
   setTaskRemoving(x.id);setError('');
   if(isDemo){setItems(old=>old.filter(y=>y.id!==x.id));setTaskRemoving(null);return;}
   try{
     const response=await fetch('/api/items',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:x.id})});
     if(!response.ok)throw new Error('삭제 실패');
     setItems(old=>old.map(y=>y.id===x.id?{...y,status:'archived'}:y));
   }catch{setError('할 일을 삭제하지 못했습니다. 다시 시도해 주세요.')}
   finally{setTaskRemoving(null)}
 };
 const signOut=async()=>{if(isDemo){window.location.href='/';return;}await browserDb().auth.signOut();window.location.href='/login'};
 const resetDemo=()=>{if(demoData)setItems(demoData.map(item=>({...item,metadata:{...item.metadata}})));setEditingMemo(null);setMemoDraft('');setFinanceView('transactions');setSelectedNewsId(null);};
 const manualRefresh=async()=>{
   if(refreshing)return;
   setRefreshing(true);setRefreshNotice('');
   if(isDemo){resetDemo();setRefreshNotice('샘플 데이터 초기화 완료');setRefreshing(false);return;}
   try{if(await refresh())setRefreshNotice('DB 조회 완료 · 원본 확인 시각 참고');}
   finally{setRefreshing(false);}
 };
 const getMemo=(x:Item)=>typeof x.metadata.memo==='string'?x.metadata.memo:'';
 const startMemo=(x:Item)=>{setFinanceView('memos');setEditingMemo(x.id);setMemoDraft(getMemo(x));};
 const saveMemoValue=async(x:Item,value:string)=>{
   const memo=value.trim();
   if(isDemo){setItems(old=>old.map(y=>y.id===x.id?{...y,metadata:{...y.metadata,memo}}:y));return;}
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
 const saveMemo=async(x:Item)=>{
   try{await saveMemoValue(x,memoDraft);setEditingMemo(null);setMemoDraft('');}catch{}
 };
 const card=(title:string,value:string,sub:string,cls='')=><section className={'metric '+cls}><div className="eyebrow">{title}</div><strong>{value}</strong><small>{sub}</small></section>;
 const linkItem=(x:Item)=> <article className="listitem" key={x.id}><div className="itembody"><b>{x.title}</b><small>{x.description??x.category??x.source??''}</small>{x.event_date&&<small>{x.event_date}</small>}</div>{x.amount!==null&&<strong>{money(Number(x.amount))}</strong>}{x.url&&<a href={x.url} target="_blank" rel="noopener noreferrer" className="external">↗</a>}</article>;
 const settleItem=(x:Item)=> <article className="listitem" key={x.id}><button className={'check '+(x.status==='done'?'checked':'')} onClick={()=>void change(x,x.status==='done'?'pending':'done')} aria-label={x.status==='done'?'정산 복원':'정산 완료'}>{x.status==='done'?'✓':''}</button><div className="itembody"><b>{x.title}</b><small>{x.due_date?'마감 '+x.due_date:'정산'}</small></div><strong>{money(Number(x.amount??0))}</strong></article>;
 const taskItem=(x:Item)=><article className="listitem taskListItem" key={x.id}><button type="button" className={'check '+(x.status==='done'?'checked':'')} onClick={()=>void change(x,x.status==='done'?'pending':'done')} aria-label={x.title+' '+(x.status==='done'?'완료 취소':'완료 표시')}>{x.status==='done'?'✓':''}</button><div className="itembody"><b className={x.status==='done'?'struck':''}>{x.title}</b>{x.due_date&&<small>{x.due_date}</small>}</div><button type="button" className="taskDeleteButton" onClick={()=>void removeTask(x)} disabled={taskRemoving===x.id} aria-label={x.title+' 삭제'} title="할 일 삭제">×</button></article>;
 const categoryGroups=Object.entries(transactions.reduce<Record<string,{total:number;rows:Item[]}>>((groups,x)=>{
   const category=(x.category??'기타').trim()||'기타';
   if(!groups[category])groups[category]={total:0,rows:[]};
   groups[category].total+=Math.max(0,Number(x.amount??0));
   groups[category].rows.push(x);
   return groups;
 },{})).sort((a,b)=>b[1].total-a[1].total||a[0].localeCompare(b[0],'ko'));
 const detailRowsFor=(item:Item)=>{
   const candidates=[item.metadata.line_items,item.metadata.transactions,item.metadata.items,item.metadata.details];
   const raw=candidates.find(Array.isArray);
   if(!Array.isArray(raw))return [] as Array<{title:string;amount:number|null;date:string|null;time:string|null}>;
   return raw.filter((value):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)).map(value=>({
     title:String(value.title??value.merchant??value.name??value.description??'거래 항목'),
     amount:typeof value.amount==='number'?value.amount:typeof value.amount==='string'&&value.amount.trim()!==''&&Number.isFinite(Number(value.amount))?Number(value.amount):null,
     date:typeof value.event_date==='string'?value.event_date:typeof value.date==='string'?value.date:null,
     time:paymentTime({event_date:typeof value.event_date==='string'?value.event_date:typeof value.date==='string'?value.date:null,metadata:value})
   }));
 };
 const barData=categoryGroups.slice(0,7);
 const maxBar=Math.max(1,...barData.map(([,group])=>group.total));
 const orderedTransactions=categoryGroups.flatMap(([,group])=>[...group.rows].sort((a,b)=>Number(b.amount??0)-Number(a.amount??0)||(b.event_date??'').localeCompare(a.event_date??'')));
 const memoCount=transactions.filter(x=>getMemo(x).length>0).length;
 const benefits=by('benefit');
 const subscriptions=benefits.filter(x=>x.category==='ai_subscription').sort((a,b)=>Number(b.amount??0)-Number(a.amount??0));
 const subscriptionTotal=subscriptions.filter(x=>subscriptionDisplay(x).active).reduce((sum,x)=>sum+Number(x.amount??0),0);
 const allNews=by('news');
 const newsGroups=Object.entries(allNews.reduce<Record<string,Item[]>>((groups,x)=>{
   const category=x.category?.trim()||'기타 뉴스';
   (groups[category]??=[]).push(x);
   return groups;
 },{})).sort((a,b)=>{
   const rank=(category:string)=>{const k=category.toLowerCase().replace(/\s+/g,'');if(/그외|그밖|기타|etc|other/.test(k))return 99;if(k.includes('ai')||k.includes('인공지능')||k.includes('다이제스트'))return 0;if(k.includes('기술')||k.includes('테크')||k.includes('개발')||k.includes('it'))return 1;if(k.includes('경제')||k.includes('금융')||k.includes('시장'))return 2;if(k.includes('산업')||k.includes('기업')||k.includes('비즈니스'))return 3;if(k.includes('국제')||k.includes('해외')||k.includes('세계'))return 4;if(k.includes('정책')||k.includes('사회'))return 5;if(k.includes('생활')||k.includes('문화')||k.includes('건강'))return 6;return 7};
   return rank(a[0])-rank(b[0])||a[0].localeCompare(b[0],'ko');
 })
   .map(([category,articles])=>[category,[...articles].sort((a,b)=>(b.event_date??'').localeCompare(a.event_date??''))] as const);
 const newsCategoryEmoji=(category:string)=>/AI|인공지능|다이제스트/i.test(category)?'✦':/기술|테크|개발|IT/i.test(category)?'⌘':/경제|금융|시장/.test(category)?'↗':/국제|세계/.test(category)?'◎':'▣';
 const pointEntries=benefits.filter(x=>x.category==='points');
 const pointLogDate=isDemo?'2026-11-12':pointToday();
 const asNumber=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
 const pointReasons=(x:Item,direction:'up'|'down')=>pointChangeDisplay(x)[direction].reasons;
 const pointHistory=pointEntries.flatMap(x=>{
   const provider=pointProvider(x);if(!provider)return [];
   const events=x.metadata.change_events;
   const dated=Array.isArray(events)?events.flatMap((value,index)=>{
     if(!value||typeof value!=='object'||Array.isArray(value))return [] as Array<{id:string;kind:'point';title:string;description:string;status:string;event_date:string;due_date:null;category:string;source:string;amount:number;metadata:Record<string,unknown>}>;
     const event=value as Record<string,unknown>;
     const amount=pointEventAmount(event);
     const rawDate=event.event_date??event.date??event.occurred_at;
     const date=typeof rawDate==='string'?rawDate.slice(0,10):null;
     if(amount===null||amount===0||!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return [];
     return [{id:x.id+'-point-'+index,kind:'point' as const,title:provider,description:typeof event.reason==='string'&&event.reason.trim()?event.reason.trim():'사유 데이터 미등록',status:'active',event_date:date,due_date:null,category:amount>0?'적립':'차감',source:provider,amount,metadata:{}}];
   }):[];
   if(dated.length)return dated;
   const previous=asNumber(x.metadata.previous_balance);
   const current=asNumber(x.amount);
   const delta=previous===null||current===null?null:current-previous;
   if(delta===null||delta===0||!x.event_date)return [];
   const reasons=pointReasons(x,delta>0?'up':'down');
   return [{id:x.id+'-point-net',kind:'point' as const,title:provider,description:reasons.length?reasons.join(' · '):'사유 데이터 미등록',status:'active',event_date:x.event_date,due_date:null,category:delta>0?'순증가':'순감소',source:provider,amount:delta,metadata:{}}];
 });
 type PointGroup={hasCurrent:boolean;current:number;previous:number;hasPrevious:boolean;upReasons:string[];downReasons:string[];upAmount:number;downAmount:number;upAmountKnown:boolean;downAmountKnown:boolean;upPresent:boolean;downPresent:boolean};
 const pointGroups=Object.entries(pointEntries.reduce<Record<string,PointGroup>>((acc,x)=>{
   const provider=pointProvider(x);if(!provider)return acc;
   if(!acc[provider])acc[provider]={hasCurrent:true,current:0,previous:0,hasPrevious:true,upReasons:[],downReasons:[],upAmount:0,downAmount:0,upAmountKnown:false,downAmountKnown:false,upPresent:false,downPresent:false};
   const entry=acc[provider];
   if(amountKnown(x.amount))entry.current+=Number(x.amount);else entry.hasCurrent=false;
   const previous=asNumber(x.metadata.previous_balance);
   if(previous!==null)entry.previous+=previous;else entry.hasPrevious=false;
   const {up,down}=pointChangeDisplay(x,pointLogDate);
   entry.upPresent=entry.upPresent||up.present;entry.downPresent=entry.downPresent||down.present;
   if(up.amount!==null){entry.upAmount+=up.amount;entry.upAmountKnown=true;}
   if(down.amount!==null){entry.downAmount+=down.amount;entry.downAmountKnown=true;}
   for(const reason of up.reasons)if(!entry.upReasons.includes(reason))entry.upReasons.push(reason);
   for(const reason of down.reasons)if(!entry.downReasons.includes(reason))entry.downReasons.push(reason);
   return acc;
 },{})).sort((a,b)=>b[1].current-a[1].current);
 const pointAmountsKnown=pointGroups.length>0&&pointGroups.every(([,entry])=>entry.hasCurrent);
 const pointsToday=pointGroups.reduce((sum,[,entry])=>sum+entry.current,0);
 const pointsYesterdayKnown=pointAmountsKnown&&pointGroups.every(([,entry])=>entry.hasPrevious);
 const pointsYesterday=pointGroups.reduce((sum,[,entry])=>sum+entry.previous,0);
 const pointDelta=pointsToday-pointsYesterday;
 const applications=benefits.filter(x=>x.category!=='points'&&x.category!=='ai_subscription');
 const applicationStatus=(x:Item)=>{
   const outcome=typeof x.metadata.application_status==='string'?x.metadata.application_status:x.status;
   return ['accepted','approved','won','selected'].includes(outcome)?'합격':['rejected','failed','lost'].includes(outcome)?'불합격':'대기 중';
 };
 const sortedApplications=[...applications].sort((a,b)=>((b.metadata.applied_at as string|undefined)??b.event_date??'').localeCompare(((a.metadata.applied_at as string|undefined)??a.event_date??'')));
 const displayDelta=(delta:number)=>(delta>0?'+':delta<0?'−':'±')+money(Math.abs(delta));

 const selectedNews=by('news').find(x=>x.id===selectedNewsId);
 const openNews=(id:string)=>{setSelectedNewsId(id);setTab('news');window.scrollTo({top:0,behavior:'smooth'});};
 const closeNews=()=>{setSelectedNewsId(null);window.scrollTo({top:0,behavior:'smooth'});};
 const getNewsBody=(x:Item)=>typeof x.metadata.full_body==='string'?x.metadata.full_body:(x.description??'기사 본문이 아직 제공되지 않았습니다.');
 return <div className="shell demoShell designPreview conceptLight">{isDemo&&<aside className="demoBanner"><strong>🧪 DEVELOPMENT · 가상 데이터</strong><span>Supabase와 피클AI에 연결되지 않습니다. 체크 상태도 저장되지 않아요.</span><button type="button" onClick={resetDemo}>샘플 초기화 ↻</button></aside>}<header className="top"><div className="topIdentity"><span className="brand"><span className="brandMark" aria-hidden="true">◈</span> PERSONAL OS <span className="brandEdition">/ STUDIO</span></span><h1>{tab==='home'?'대시보드':tabs.find(x=>x[0]===tab)?.[1]}</h1>{tab!=='architecture'&&<small className="pageUpdateTime" title={isDemo?'가상 데이터의 예시 갱신 시각':'DB에 마지막 저장된 시각 · 한국 시간'}>{isDemo?'샘플 업데이트':'DB 저장'} · {updateLabel(tab)}<br/>{isDemo?'샘플 기준':'원본 기준'} · {sourceLabel(tab)}</small>}</div><div className="topActions">{tab!=='architecture'&&<button type="button" className={"refreshButton"+(refreshing?" refreshing":"")} onClick={()=>void manualRefresh()} disabled={refreshing||loading} aria-label={refreshing?"새로고침 중":"새로고침"} title="새로고침"><span aria-hidden="true">↻</span></button>}<button className="profile" onClick={signOut} aria-label={isDemo?'운영 대시보드로 이동':'로그아웃'} title={isDemo?'운영 대시보드로 이동':userEmail+' 로그아웃'}>↗</button></div></header>{refreshNotice&&<p className="refreshNotice" role="status">{refreshNotice}</p>}{error&&<aside className="error">{error}{hasSnapshot?' · 마지막 조회값 유지 중':''}</aside>}{!error&&sourceAlerts.length>0&&<aside className="error" role="status">{sourceAlerts.map(spec=><div key={spec.key}>{spec.label} · {healthText(spec.key)}{syncHealth[spec.key]?.last_source_at?' ('+dashboardTimestamp(syncHealth[spec.key].last_source_at)+')':''}</div>)}</aside>}
 {tab==='architecture'?<ArchitectureScreen/>:loading?<div className="loading">데이터 불러오는 중…</div>:!hasSnapshot?<div className="loading">정상 데이터를 불러오지 못했습니다. 새로고침하면 다시 확인할 수 있습니다.</div>:<>
 {tab==='home'&&<main>
  <button type="button" className="navCard" onClick={()=>setTab('finance')} aria-label="이번 달 카드 지출 상세 보기, 금융 탭으로 이동">
    {card('이번 달 카드 지출',transactionAmountsKnown?money(cardTotal):'미확인','등록된 카드 거래 합계 · 금융 상세 보기 ↗','primary')}
  </button>
  <section className="panel taskPanel"><div className="sectionTitle taskPanelHeader"><h2>오늘 할 일</h2><div className="taskHeaderActions"><span className="taskCount">{taskComplete}/{tasks.length}</span><button type="button" className="taskOpenButton" aria-expanded={taskFormOpen} aria-controls="home-task-add-form" onClick={()=>setTaskFormOpen(open=>!open)}>{taskFormOpen?"닫기":"+ 추가"}</button></div></div>{taskFormOpen&&<form id="home-task-add-form" className="taskAddForm" onSubmit={e=>{e.preventDefault();void addTask()}}><input type="text" aria-label="새 할 일" placeholder="새로운 할 일 입력" maxLength={200} value={taskDraft} autoFocus onChange={e=>setTaskDraft(e.target.value)}/><button type="submit" disabled={!taskDraft.trim()||taskBusy}>{taskBusy?"저장 중…":"저장"}</button></form>}{tasks.length?tasks.map(taskItem):<p className="empty">할 일 없음</p>}</section>
  <button type="button" className="newsNavCard" onClick={()=>{setSelectedNewsId(null);setTab('news')}} aria-label="오늘의 뉴스 전체 보기, 뉴스 탭으로 이동">
    <div className="sectionTitle"><h2>오늘의 뉴스</h2><span className="linkHint">전체 보기 →</span></div>
    {by('news').slice(0,3).map(x=><div className="newsPreviewItem" key={x.id}><b>{x.title}</b><small>{x.category??x.source??'오늘의 뉴스'}</small></div>)}
    {!by('news').length&&<p className="empty">아직 뉴스가 없어.</p>}
  </button>
 </main>} {tab==='finance'&&<main>
  <div className="financeSummary">
    <div className="financeTotal">{card('등록 지출 합계',transactionAmountsKnown?money(cardTotal):'미확인',transactions.length+'건')}</div>
    <div className="metricgrid">{card('미정산',money(pendingAmount),pending.length+'건')}{card('정산 완료',money(settledAmount),done.length+'건 완료')}</div>
  </div>
  <DemoDailySpending transactions={transactions} coverageDay={coverageDay} onSaveMemo={async(id,memo)=>{const item=items.find(x=>x.id===id&&x.kind==='transaction');if(!item)throw new Error('거래 내역을 찾을 수 없습니다');await saveMemoValue(item,memo);}}/>
  <section className="panel">
    <h2>카테고리별 지출 분석</h2>
    {barData.length?barData.map(([label,group],i)=><div className="barrow" key={label}>
      <div className="barheading"><span>{i+1}. {label}</span><b>{money(group.total)}</b></div>
      <div className="track"><div style={{width:(group.total/maxBar*100)+'%'}}/></div>
    </div>):<p className="empty">지출 내역이 아직 없어.</p>}
  </section>
  <section className="panel"><h2>정산 트래커 · N분의 1</h2>
    <div className="seg"><button className={settleTab==='pending'?'selected':''} onClick={()=>setSettleTab('pending')}>진행 중 ({pending.length})</button><button className={settleTab==='done'?'selected':''} onClick={()=>setSettleTab('done')}>완료 · 백데이터 ({done.length})</button></div>
    {(settleTab==='pending'?pending:done).map(settleItem)}{!(settleTab==='pending'?pending:done).length&&<p className="empty">표시할 정산 내역이 없어.</p>}
  </section>
  <section className="panel">
    <h2>카드 거래 내역</h2>
    <div className="seg financeSeg">
      <button className={financeView==='transactions'?'selected':''} onClick={()=>setFinanceView('transactions')}>거래내역 ({transactions.length})</button>
      <button className={financeView==='memos'?'selected':''} onClick={()=>setFinanceView('memos')}>메모 ({memoCount})</button>
    </div>
    {financeView==='transactions'&&<div>
      {categoryGroups.map(([category,group])=>{
        const expanded=expandedExpenseCategories.includes(category);
        const categoryOpen=openExpenseCategories.includes(category);
        const sorted=[...group.rows].sort((a,b)=>(b.event_date??'').localeCompare(a.event_date??'')||Number(b.amount??0)-Number(a.amount??0));
        const visible=expanded?sorted:sorted.slice(0,5);
        const detailedCount=group.rows.reduce((sum,x)=>sum+(detailRowsFor(x).length||1),0);
        return <div className="categorySection" key={category}>
          <button type="button" className="categoryHeading expenseCategoryToggle" aria-expanded={categoryOpen} aria-label={category+' 거래내역 '+(categoryOpen?'접기':'펼치기')} onClick={()=>setOpenExpenseCategories(old=>old.includes(category)?old.filter(name=>name!==category):[...old,category])}>
            <b>{category}</b><span className="expenseCategoryMeta">{money(group.total)} · {detailedCount}건 <span className={'expenseCategoryChevron '+(!categoryOpen?'collapsed':'')} aria-hidden="true">⌄</span></span>
          </button>
          {categoryOpen&&visible.map(x=><div className="expenseItemWrap" key={x.id}>
            <article className="listitem">
              <div className="itembody"><b>{x.title}</b><small>{paymentDateLabel(x)}{!x.event_date&&x.source?' · '+x.source:''}</small>
                {getMemo(x)&&<small className="savedMemo">📝 {getMemo(x)}</small>}
              </div>
              <strong>{money(Number(x.amount??0))}</strong>
              <button className="memoInlineButton" onClick={()=>startMemo(x)} aria-label={x.title+' 메모 '+(getMemo(x)?'수정':'추가')}>{getMemo(x)?'수정':'메모 +'}</button>
            </article>
            {detailRowsFor(x).length>0&&<div className="expenseSubItems">{detailRowsFor(x).map((line,i)=><div className="expenseSubItem" key={i}><span>{line.title}{(line.date||line.time)&&<small> · {[line.date?.slice(0,10),line.time].filter(Boolean).join(' · ')}</small>}</span><strong>{line.amount===null?'금액 미등록':money(line.amount)}</strong></div>)}</div>}
            {detailRowsFor(x).length===0&&(/합산|\d+\s*건/.test(x.title)||Number(x.metadata.transaction_count??0)>1)&&<p className="expenseAggregateNote">합산 거래 · 상세 내역 없음</p>}
          </div>)}
          {categoryOpen&&sorted.length>5&&<button className="expenseCategoryMore" type="button" onClick={()=>setExpandedExpenseCategories(old=>expanded?old.filter(name=>name!==category):[...old,category])}>{expanded?'접기 ↑':`나머지 ${sorted.length-5}건 모두 보기 ↓`}</button>}
        </div>;
      })}
      {!orderedTransactions.length&&<p className="empty">거래 내역이 없어.</p>}
    </div>}
    {financeView==='memos'&&<div>
      {orderedTransactions.map(x=><div className="memoEntry" key={x.id}>
        <div className="memoEntryHeader"><div className="itembody"><b>{x.title}</b><small>{x.category??'기타'} · {paymentDateLabel(x)}</small></div><strong>{money(Number(x.amount??0))}</strong></div>
        {editingMemo===x.id?
          <div className="memoEditor">
            <textarea aria-label={x.title+' 메모'} value={memoDraft} maxLength={400} placeholder="예: 친구들과 점심, 생일 기념 식사, 출장 중 교통비" rows={3} onChange={e=>setMemoDraft(e.target.value)}/>
            <div className="memoActions"><span>{memoDraft.length}/400</span><button type="button" onClick={()=>{setEditingMemo(null);setMemoDraft('')}}>취소</button><button type="button" className="memoSave" onClick={()=>void saveMemo(x)}>저장</button></div>
          </div>
          :<button type="button" className="memoRead" onClick={()=>startMemo(x)}>{getMemo(x)?<span>{getMemo(x)}</span>:<span className="memoPlaceholder">+ 누구와 함께했는지 메모 추가</span>}<span className="memoEditHint">{getMemo(x)?'수정 ↗':''}</span></button>
        }
      </div>)}
      {!transactions.length&&<p className="empty">메모를 남길 거래가 없어.</p>}
    </div>}
  </section>
  <section className="panel aiSubscriptionPanel">
    <div className="sectionTitle subscriptionSectionTitle"><h2>AI 구독료 관리</h2><div className="sectionUpdateMeta"><span>{subscriptions.length}개 서비스</span><small>{updateLabel('subscriptions')}</small></div></div>
    <div className="aiSubscriptionTotal"><div className="eyebrow">월 구독료 합계 · 활성 서비스</div><strong>{subscriptions.length&&subscriptions.every(x=>amountKnown(x.amount))?money(subscriptionTotal):'미확인'}</strong><small>연간 환산 {subscriptions.length&&subscriptions.every(x=>amountKnown(x.amount))?money(subscriptionTotal*12):'미확인'} · 카드 지출 합계 제외</small></div>
    {subscriptions.map(x=>{
      const info=subscriptionDisplay(x);
      return <div className="aiSubscriptionRow" key={x.id}>
        <div className="itembody aiSubscriptionIdentity"><b>{x.title}</b>{info.plan&&<small className="subscriptionPlan">{info.plan}</small>}
          <div className="subscriptionDates">{info.rows.map(row=><div className="subscriptionDateLine" key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}</div>
        </div>
        <div className="aiSubscriptionPrice"><strong>{money(Number(x.amount??0))}</strong><span className={info.active?'subscriptionActive':'subscriptionStopped'}>{info.active?'구독 중':'구독 중지'}</span></div>
      </div>;
    })}
    {!subscriptions.length&&<p className="empty">구독 내역 없음</p>}
  </section>
</main>}
 {tab==='news'&&<main>
  {selectedNews?
    <article className="newsDetail">
      <button type="button" className="newsBack" onClick={closeNews} aria-label="뉴스 목록으로 돌아가기">← 뉴스 목록</button>
      <div className="newsDetailCategory">{selectedNews.category??'뉴스'} · {selectedNews.source??'브리핑'}</div>
      <h2 className="newsDetailHeadline">{selectedNews.title}</h2>
      <div className="newsDetailDate">{selectedNews.event_date??''}</div>
      {selectedNews.description&&<p className="newsDetailSummary">{selectedNews.description}</p>}
      <div className="newsDetailBody">{getNewsBody(selectedNews).split(/\n\s*\n/).map((paragraph,i)=><p key={i}>{paragraph}</p>)}</div>
      {selectedNews.url&&<a className="newsOriginal" href={selectedNews.url} target="_blank" rel="noopener noreferrer">원문 기사 보기 ↗</a>}
      <button type="button" className="newsBack newsBackBottom" onClick={closeNews}>← 뉴스 목록으로</button>
    </article>:
    <>
      {newsGroups.map(([category,articles])=><section className={'panel newsCategoryPanel '+(category==='AI 테크 다이제스트'?'digestPanel':'')} key={category}>
        <div className="newsCategoryHeading">
          <button type="button" className="newsCategoryToggle" aria-expanded={openNewsCategories.includes(category)} aria-label={category+' 카테고리 '+(openNewsCategories.includes(category)?'접기':'펼치기')} onClick={()=>setOpenNewsCategories(old=>old.includes(category)?old.filter(name=>name!==category):[...old,category])}>
            <span className="newsCategoryLabel"><span className="newsCategorySymbol">{newsCategoryEmoji(category)}</span><span><strong className="newsCategoryName">{category}</strong><small>{articles.length}개 기사 · 최신순</small></span></span>
            <span className={'newsCategoryChevron '+(!openNewsCategories.includes(category)?'collapsed':'')} aria-hidden="true">⌄</span>
          </button>
          {openNewsCategories.includes(category)&&articles.length>3&&<button type="button" className="newsCategoryMore" onClick={()=>setExpandedNewsCategory(old=>old===category?null:category)}>{expandedNewsCategory===category?'3개만 보기 ↑':'전체 보기 →'}</button>}
        </div>
        {openNewsCategories.includes(category)&&(expandedNewsCategory===category?articles:articles.slice(0,3)).map(x=><button type="button" className="newsListButton" key={x.id} onClick={()=>openNews(x.id)}>
          <span className="newsListText"><small>{x.event_date??'날짜 미등록'} · {x.source??category}</small><strong>{x.title}</strong><span>{x.description??''}</span></span>
          <span className="newsListArrow" aria-hidden="true">›</span>
        </button>)}
      </section>)}
      {!newsGroups.length&&<section className="panel"><p className="empty">뉴스 없음</p></section>}
    </>
  }
</main>}
 {tab==='benefits'&&<main>
  <section className="panel">
    <div className="sectionTitle"><h2>보유 포인트</h2><div className="sectionUpdateMeta"><span>출처별 현황</span><small>{updateLabel('points')}</small></div></div>
    <div className="pointOverview"><div className="eyebrow">총 보유 포인트</div><strong>{pointAmountsKnown?money(pointsToday):'미확인'}</strong>
      <small className={pointsYesterdayKnown?(pointDelta>0?'deltaUp':pointDelta<0?'deltaDown':'deltaFlat'):'deltaFlat'}>
        {pointsYesterdayKnown?'어제 대비 '+displayDelta(pointDelta):'어제 잔액 데이터 없음'}
      </small>
    </div>
    <div className="pointProviderHeading"><span>적립처</span><span>현재 잔액 / 전일 대비</span></div>
    {pointGroups.map(([provider,entry])=><div className="pointProvider" key={provider}>
      <div className="itembody pointProviderIdentity"><b>{provider}</b></div>
      <div className="pointAmounts"><strong>{entry.hasCurrent?money(entry.current):'미확인'}</strong><small className={entry.hasPrevious?(entry.current>entry.previous?'deltaUp':entry.current<entry.previous?'deltaDown':'deltaFlat'):'deltaFlat'}>{entry.hasCurrent&&entry.hasPrevious?displayDelta(entry.current-entry.previous):'전일 데이터 없음'}</small></div>
      {(entry.upPresent||entry.downPresent)&&<div className="pointReasonLines"><small className="pointLogDate">{pointLogDate.replace(/-/g,'.')}</small>
        {entry.upPresent&&<div className="pointReasonLine pointIncreaseReason"><span className="pointReasonValue">{entry.upAmountKnown?displayDelta(entry.upAmount):'+ 증가'}</span><span className="pointReasonText">{entry.upReasons.length?entry.upReasons.join(' · '):'사유 미등록'}</span></div>}
        {entry.downPresent&&<div className="pointReasonLine pointDecreaseReason"><span className="pointReasonValue">{entry.downAmountKnown?displayDelta(-entry.downAmount):'− 감소'}</span><span className="pointReasonText">{entry.downReasons.length?entry.downReasons.join(' · '):'사유 미등록'}</span></div>}
      </div>}
    </div>)}
    {!pointGroups.length&&<p className="empty">포인트 내역 없음</p>}
  </section>
  <section className="panel">
    <div className="sectionTitle"><h2>혜택 신청 현황</h2><div className="sectionUpdateMeta"><span>{applications.length}건</span><small>{updateLabel('applications')}</small></div></div>
    <div className="applicationCounts">
      <div><strong>{applications.filter(x=>applicationStatus(x)==='대기 중').length}</strong><span>대기 중</span></div>
      <div><strong>{applications.filter(x=>applicationStatus(x)==='합격').length}</strong><span>합격</span></div>
      <div><strong>{applications.filter(x=>applicationStatus(x)==='불합격').length}</strong><span>불합격</span></div>
    </div>
    <div className="applicationsScroll" role="region" aria-label="혜택 신청 내역 가로 스크롤 표" tabIndex={0}>
      <table className="applicationsTable">
        <thead><tr><th scope="col">결과</th><th scope="col">신청 항목</th><th scope="col">신청처</th><th scope="col">신청일</th><th scope="col">발표일</th></tr></thead>
        <tbody>{sortedApplications.map(x=><tr key={x.id}>
          <td><span className={'applicationStatus '+(applicationStatus(x)==='합격'?'statusAccepted':applicationStatus(x)==='불합격'?'statusRejected':'statusPending')}>{applicationStatus(x)}</span></td>
          <td><b>{x.title}</b></td>
          <td>{typeof x.metadata.provider==='string'?x.metadata.provider:(x.source??'미등록')}</td>
          <td>{typeof x.metadata.applied_at==='string'?x.metadata.applied_at:(x.event_date??'미등록')}</td>
          <td>{typeof x.metadata.announcement_date==='string'?x.metadata.announcement_date:(x.due_date??'미정')}</td>

        </tr>)}</tbody>
      </table>
    </div>
    {!applications.length&&<p className="empty">신청 내역 없음</p>}
  </section>
</main>}
 {tab==='journal'&&<DemoCalendar entries={[...items.filter(x=>x.kind==='event'||(x.kind==='task'&&x.status!=='archived')||x.kind==='news') as Array<Item & {kind:'event'|'task'|'news'}>,...pointHistory]} onToggleTask={x=>{const item=items.find(y=>y.id===x.id);if(item)void change(item,item.status==='done'?'pending':'done')}} onOpenNews={openNews}/>}
 </>}
 <nav className="bottom">{tabs.map(([id,label,emoji])=><button key={id} className={tab===id?'active':''} onClick={()=>{setTab(id);setSelectedNewsId(null)}}><span className="navicon">{id==='architecture'?<ArchitectureIcon/>:emoji}</span><span>{label}</span></button>)}</nav></div>
}
