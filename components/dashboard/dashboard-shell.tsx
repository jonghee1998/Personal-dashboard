'use client';
import {useMemo,useState} from 'react';
import ArchitectureScreen,{ArchitectureIcon} from '@/components/architecture-screen';
import {visibleDashboardItem} from '@/lib/dashboard-visibility';
import {dashboardTimestamp} from '@/lib/dashboard-display';
import {monitoredSources} from '@/lib/dashboard-freshness';
import {useDashboardData} from '@/components/dashboard/use-dashboard-data';
import type {Item} from './use-dashboard-data';
import HomeTab from './home-tab';
import FinanceTab from './finance-tab';
import NewsTab from './news-tab';
import BenefitsTab from './benefits-tab';
import JournalTab from './journal-tab';

const tabs=[['home','홈','⌂'],['finance','금융','▤'],['news','뉴스','▣'],['benefits','혜택','✦'],['journal','기록','◷'],['architecture','구조','']] as const;
export default function DashboardShell(){
 const [tab,setTab]=useState('home'),[selectedNewsId,setSelectedNewsId]=useState<string|null>(null),[expandedNewsCategory,setExpandedNewsCategory]=useState<string|null>(null),[openNewsCategories,setOpenNewsCategories]=useState<string[]>([]),[openExpenseCategories,setOpenExpenseCategories]=useState<string[]>([]),[expandedExpenseCategories,setExpandedExpenseCategories]=useState<string[]>([]),[settleTab,setSettleTab]=useState<'pending'|'done'>('pending'),[financeView,setFinanceView]=useState<'transactions'|'memos'>('transactions'),[editingMemo,setEditingMemo]=useState<string|null>(null),[memoDraft,setMemoDraft]=useState(''),[taskDraft,setTaskDraft]=useState(''),[taskFormOpen,setTaskFormOpen]=useState(false);
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
 const saveMemo=async(x:Item)=>{
   try{await saveMemoValue(x,memoDraft);setEditingMemo(null);setMemoDraft('');}catch{}
 };

 const openFinance=()=>setTab('finance');
 const openNewsList=()=>{setSelectedNewsId(null);setTab('news');};
 const openNews=(id:string)=>{setSelectedNewsId(id);setTab('news');window.scrollTo({top:0,behavior:'smooth'});};
 const closeNews=()=>{setSelectedNewsId(null);window.scrollTo({top:0,behavior:'smooth'});};
 return <div className="shell demoShell designPreview conceptLight"><header className="top"><div className="topIdentity"><span className="brand"><span className="brandMark" aria-hidden="true">◈</span> PERSONAL OS <span className="brandEdition">/ STUDIO</span></span><h1>{tab==='home'?'대시보드':tabs.find(x=>x[0]===tab)?.[1]}</h1>{tab!=='architecture'&&<small className="pageUpdateTime" title="DB에 마지막 저장된 시각 · 한국 시간">DB 저장 · {updateLabel(tab)}<br/>원본 기준 · {sourceLabel(tab)}</small>}</div><div className="topActions">{tab!=='architecture'&&<button type="button" className={"refreshButton"+(refreshing?" refreshing":"")} onClick={()=>void manualRefresh()} disabled={refreshing||loading} aria-label={refreshing?"새로고침 중":"새로고침"} title="새로고침"><span aria-hidden="true">↻</span></button>}<button className="profile" onClick={signOut} aria-label="로그아웃" title={userEmail+' 로그아웃'}>↗</button></div></header>{refreshNotice&&<p className="refreshNotice" role="status">{refreshNotice}</p>}{error&&<aside className="error">{error}{hasSnapshot?' · 마지막 조회값 유지 중':''}</aside>}{!error&&sourceAlerts.length>0&&<aside className="error" role="status">{sourceAlerts.map(spec=><div key={spec.key}>{spec.label} · {healthText(spec.key)}{syncHealth[spec.key]?.last_source_at?' ('+dashboardTimestamp(syncHealth[spec.key].last_source_at)+')':''}</div>)}</aside>}
 {tab==='architecture'?<ArchitectureScreen/>:loading?<div className="loading">데이터 불러오는 중…</div>:!hasSnapshot?<div className="loading">정상 데이터를 불러오지 못했습니다. 새로고침하면 다시 확인할 수 있습니다.</div>:<>
 {tab==='home'&&<HomeTab items={items} transactions={transactions} statusBusy={statusBusy}
   taskBusy={taskBusy} taskRemoving={taskRemoving} taskFormOpen={taskFormOpen} taskDraft={taskDraft}
   setTaskFormOpen={setTaskFormOpen} setTaskDraft={setTaskDraft} addTask={addTask} change={change}
   removeTask={removeTask} openFinance={openFinance} openNewsList={openNewsList}/>}
 {tab==='finance'&&<FinanceTab items={items} transactions={transactions}
   lastTransactionSourceAt={syncHealth.transactions?.last_source_at??null} updateLabel={updateLabel}
   statusBusy={statusBusy} change={change} saveMemoValue={saveMemoValue} saveMemo={saveMemo}
   settleTab={settleTab} setSettleTab={setSettleTab} financeView={financeView} setFinanceView={setFinanceView}
   editingMemo={editingMemo} setEditingMemo={setEditingMemo} memoDraft={memoDraft} setMemoDraft={setMemoDraft}
   openExpenseCategories={openExpenseCategories} setOpenExpenseCategories={setOpenExpenseCategories}
   expandedExpenseCategories={expandedExpenseCategories} setExpandedExpenseCategories={setExpandedExpenseCategories}/>}
 {tab==='news'&&<NewsTab items={items} selectedNewsId={selectedNewsId}
   openNewsCategories={openNewsCategories} setOpenNewsCategories={setOpenNewsCategories}
   expandedNewsCategory={expandedNewsCategory} setExpandedNewsCategory={setExpandedNewsCategory}
   openNews={openNews} closeNews={closeNews}/>}
 {tab==='benefits'&&<BenefitsTab items={items} updateLabel={updateLabel}/>}
 {tab==='journal'&&<JournalTab items={items} change={change} openNews={openNews}/>}
 </>}
 <nav className="bottom">{tabs.map(([id,label,emoji])=><button key={id} className={tab===id?'active':''} onClick={()=>{setTab(id);setSelectedNewsId(null)}}><span className="navicon">{id==='architecture'?<ArchitectureIcon/>:emoji}</span><span>{label}</span></button>)}</nav></div>
}
