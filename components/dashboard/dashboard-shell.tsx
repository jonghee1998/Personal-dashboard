'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import ArchitectureScreen,{ArchitectureIcon} from '@/components/architecture-screen';
import {visibleDashboardItem} from '@/lib/dashboard-visibility';
import {dashboardTimestamp} from '@/lib/dashboard-display';
import {monitoredSources,registeredCoverageDay,seoulDay} from '@/lib/dashboard-freshness';
import {useDashboardData} from '@/components/dashboard/use-dashboard-data';
import type {Item} from './use-dashboard-data';
import HomeTab from './home-tab';
import FinanceTab,{type MemoEditorProps,type MemoPlace} from './finance-tab';
import NewsTab from './news-tab';
import BenefitsTab from './benefits-tab';
import JournalTab from './journal-tab';

const tabs=[['home','홈',''],['finance','금융',''],['news','뉴스',''],['benefits','혜택',''],['journal','기록',''],['architecture','구조','']] as const;
const navPaths:Record<string,string>={
 home:'M4 11.5 12 4l8 7.5M6 10v9h12v-9',
 finance:'M3 7h18v12H3zM3 11h18M7 15h3',
 news:'M5 4h11v16H5zM16 8h3v10a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h3',
 benefits:'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
 journal:'M5 5h14v15H5zM5 9h14M9 3v4M15 3v4'
};
function NavIcon({id}:{id:string}){return id==='architecture'?<ArchitectureIcon/>:<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d={navPaths[id]}/></svg>}
export default function DashboardShell(){
 const [tab,setTab]=useState('home'),[selectedNewsId,setSelectedNewsId]=useState<string|null>(null),[expandedNewsCategory,setExpandedNewsCategory]=useState<string|null>(null),[openNewsCategories,setOpenNewsCategories]=useState<string[]>([]),[openExpenseCategories,setOpenExpenseCategories]=useState<string[]>([]),[expandedExpenseCategories,setExpandedExpenseCategories]=useState<string[]>([]),[settleTab,setSettleTab]=useState<'pending'|'done'>('pending'),[taskDraft,setTaskDraft]=useState(''),[taskFormOpen,setTaskFormOpen]=useState(false);
 const [financeMonth,setFinanceMonth]=useState<string|null>(null);
 const [memoQuery,setMemoQuery]=useState('');
 const [financeDate,setFinanceDate]=useState<string|null>(null);
 const [memo,setMemo]=useState<{editingMemo:MemoEditorProps['editingMemo'];memoDraft:string;memoError:string}>({
   editingMemo:null,memoDraft:'',memoError:'',
 });
 // 저장 응답은 렌더를 기다리지 않고 마지막 편집 이벤트의 값을 읽는다.
 const latestMemo=useRef(memo);
 const nextMemoSession=useRef(0);
 const pendingMemoIds=useRef(new Set<string>());
 const [savingMemoIds,setSavingMemoIds]=useState<ReadonlySet<string>>(new Set());
 const updateMemo=(next:typeof memo)=>{
   latestMemo.current=next;
   setMemo(next);
 };
 const startMemo=(item:Item,place:MemoPlace)=>updateMemo({
   editingMemo:{id:item.id,place,session:++nextMemoSession.current},
   memoDraft:typeof item.metadata.memo==='string'?item.metadata.memo:'',
   memoError:'',
 });
 const cancelMemo=()=>updateMemo({editingMemo:null,memoDraft:'',memoError:''});
 const setMemoDraft=(memoDraft:string)=>updateMemo({...latestMemo.current,memoDraft});
 const {rawItems,updates,sourceUpdates,syncHealth,hasSnapshot,loading,error,statusBusy,userEmail,refreshing,refreshNotice,taskBusy,taskRemoving,manualRefresh,change,addTask:addTaskTitle,removeTask,saveMemoValue,signOut}=useDashboardData();
 const items=useMemo(()=>rawItems.filter(visibleDashboardItem),[rawItems]);
 const updateTime=(key:string)=>dashboardTimestamp(updates[key]);
 const updateLabel=(key:string)=>updateTime(key)??(loading?'조회 중':'미등록');
 const sourceLabel=(key:string)=>dashboardTimestamp(sourceUpdates[key])??(loading?'조회 중':'미확인');
 const sourceAlerts=monitoredSources.filter(spec=>hasSnapshot&&(tab==='home'&&['transactions','news'].includes(spec.key)||tab==='finance'&&spec.key==='transactions'||tab==='benefits'&&['samsungPoints','naverPoints'].includes(spec.key)||tab==='news'&&spec.key==='news')&&syncHealth[spec.key]?.state!=='current');
 const healthText=(key:string)=>{const h=syncHealth[key];return h?.state==='failed'?'최근 수집 실패/불완전 · 기존 저장값 유지':h?.state==='delayed'?'오늘 원본 확인 지연 · 마지막 저장값 유지':'원본 확인 시각 미확인';};
 const transactions=useMemo(()=>items.filter(x=>x.kind==='transaction'),[items]);
 // 성공하면 입력을 비우고 폼을 닫는다. 실패하면 입력을 남긴다(오류는 훅이 보인다).
 const addTask=async()=>{if(await addTaskTitle(taskDraft)){setTaskDraft('');setTaskFormOpen(false);}};
 const saveMemo=async(item:Item)=>{
   const {editingMemo,memoDraft}=latestMemo.current;
   const pending=pendingMemoIds.current;
   if(editingMemo?.id!==item.id||pending.has(item.id))return;

   pending.add(item.id);
   setSavingMemoIds(new Set(pending));
   updateMemo({...latestMemo.current,memoError:''});
   try{
     await saveMemoValue(item,memoDraft);
     const latest=latestMemo.current;
     if(latest.editingMemo?.session===editingMemo.session&&latest.memoDraft===memoDraft)cancelMemo();
   }catch{
     const latest=latestMemo.current;
     if(latest.editingMemo?.session===editingMemo.session){
       updateMemo({...latest,memoError:'메모 저장에 실패했습니다. 다시 시도해 주세요.'});
     }
   }finally{
     pending.delete(item.id);
     setSavingMemoIds(new Set(pending));
   }
 };
 const memoEditor={...memo,savingMemoIds,startMemo,cancelMemo,setMemoDraft,saveMemo};
 const now=new Date();
 const today=seoulDay(now)!;
 const coverageDay=registeredCoverageDay(syncHealth.transactions?.last_source_at??null,transactions.map(x=>x.event_date),now);
 const currentMonth=today.slice(0,7);
 const initialDate=coverageDay?.slice(0,7)===currentMonth?coverageDay:today;
 useEffect(()=>{
   if(tab==='finance'&&hasSnapshot&&financeMonth===null){
     setFinanceMonth(currentMonth);
     setFinanceDate(initialDate);
   }
 },[tab,hasSnapshot,financeMonth,currentMonth,initialDate]);
 const changeFinanceMonth=(next:string)=>{
   setFinanceMonth(next);
   setFinanceDate(null);
 };

 const openFinance=()=>setTab('finance');
 const openNewsList=()=>{setSelectedNewsId(null);setTab('news');};
 const openNews=(id:string)=>{setSelectedNewsId(id);setTab('news');window.scrollTo({top:0,behavior:'smooth'});};
 const closeNews=()=>{setSelectedNewsId(null);window.scrollTo({top:0,behavior:'smooth'});};
 return <div className="shell demoShell designPreview conceptLight uiV2 uiTheme"><header className="top"><div className="topIdentity"><span className="brand"><svg className="brandMark" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 21 12 12 21 3 12z"/></svg> PERSONAL OS</span><h1>{tab==='home'?'대시보드':tabs.find(x=>x[0]===tab)?.[1]}</h1>{tab!=='architecture'&&<small className="pageUpdateTime" title="DB에 마지막 저장된 시각 · 한국 시간">DB 저장 · {updateLabel(tab)}<br/>원본 기준 · {sourceLabel(tab)}</small>}</div><div className="topActions">{tab!=='architecture'&&<button type="button" className={"refreshButton"+(refreshing?" refreshing":"")} onClick={()=>void manualRefresh()} disabled={refreshing||loading} aria-label={refreshing?"새로고침 중":"새로고침"} title="새로고침"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg></button>}<button className="profile" onClick={signOut} aria-label="로그아웃" title={userEmail+' 로그아웃'}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/></svg></button></div></header>{refreshNotice&&<p className="refreshNotice" role="status">{refreshNotice}</p>}{error&&<aside className="error">{error}{hasSnapshot?' · 마지막 조회값 유지 중':''}</aside>}{!error&&sourceAlerts.length>0&&<aside className="error" role="status">{sourceAlerts.map(spec=><div key={spec.key}>{spec.label} · {healthText(spec.key)}{syncHealth[spec.key]?.last_source_at?' ('+dashboardTimestamp(syncHealth[spec.key].last_source_at)+')':''}</div>)}</aside>}
 {tab==='architecture'?<ArchitectureScreen/>:loading?<div className="loading">데이터 불러오는 중…</div>:!hasSnapshot?<div className="loading">정상 데이터를 불러오지 못했습니다. 새로고침하면 다시 확인할 수 있습니다.</div>:<>
 {tab==='home'&&<HomeTab items={items} transactions={transactions} statusBusy={statusBusy}
   taskBusy={taskBusy} taskRemoving={taskRemoving} taskFormOpen={taskFormOpen} taskDraft={taskDraft}
   setTaskFormOpen={setTaskFormOpen} setTaskDraft={setTaskDraft} addTask={addTask} change={change}
   removeTask={removeTask} openFinance={openFinance} openNewsList={openNewsList}/>}
 {tab==='finance'&&<FinanceTab items={items} transactions={transactions}
   today={today} coverageDay={coverageDay} updateLabel={updateLabel}
   statusBusy={statusBusy} change={change} memoEditor={memoEditor}
   memoQuery={memoQuery} setMemoQuery={setMemoQuery}
   settleTab={settleTab} setSettleTab={setSettleTab}
   month={financeMonth??currentMonth} selectedDate={financeMonth===null?initialDate:financeDate} setMonth={changeFinanceMonth} selectDay={setFinanceDate}
   openExpenseCategories={openExpenseCategories} setOpenExpenseCategories={setOpenExpenseCategories}
   expandedExpenseCategories={expandedExpenseCategories} setExpandedExpenseCategories={setExpandedExpenseCategories}/>}
 {tab==='news'&&<NewsTab items={items} selectedNewsId={selectedNewsId}
   openNewsCategories={openNewsCategories} setOpenNewsCategories={setOpenNewsCategories}
   expandedNewsCategory={expandedNewsCategory} setExpandedNewsCategory={setExpandedNewsCategory}
   openNews={openNews} closeNews={closeNews}/>}
 {tab==='benefits'&&<BenefitsTab items={items} updateLabel={updateLabel}/>}
 {tab==='journal'&&<JournalTab items={items} change={change} openNews={openNews}/>}
 </>}
 <nav className="bottom">{tabs.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>{setTab(id);setSelectedNewsId(null)}}><span className="navicon"><NavIcon id={id}/></span><span>{label}</span></button>)}</nav></div>
}
