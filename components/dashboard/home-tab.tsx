import type {Dispatch,SetStateAction} from 'react';
import type {Item,useDashboardData} from './use-dashboard-data';
import {cycleSummary} from '@/lib/finance-view';
import {won} from './finance-activity';

type Props={
 items:Item[];
 transactions:Item[];
 today:string;
 coverageDay:string|null;
 statusBusy:string[];
 taskBusy:boolean;
 taskRemoving:string|null;
 taskFormOpen:boolean;
 taskDraft:string;
 setTaskFormOpen:Dispatch<SetStateAction<boolean>>;
 setTaskDraft:(draft:string)=>void;
 addTask:()=>Promise<void>;
 change:ReturnType<typeof useDashboardData>['change'];
 removeTask:ReturnType<typeof useDashboardData>['removeTask'];
 openFinance:()=>void;
 openNewsList:()=>void;
 openNews:(id:string)=>void;
};

const Icon=({d,size=16}:{d:string;size?:number})=><svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
const ICON={check:'M5 12.5l4.5 4.5L19 7.5',close:'M6 6l12 12M18 6 6 18',plus:'M12 5v14M5 12h14',chevron:'M9 6l6 6-6 6'};

export default function HomeTab({
 items,transactions,today,coverageDay,statusBusy,taskBusy,taskRemoving,taskFormOpen,taskDraft,
 setTaskFormOpen,setTaskDraft,addTask,change,removeTask,openFinance,openNewsList,openNews
}:Props){
 // 금융 탭 결제 주기 카드와 같은 계산(cycleSummary·registeredCoverageDay)을 쓴다.
 const summary=cycleSummary(transactions,today,coverageDay);
 const tasks=items.filter(x=>x.kind==='task').filter(x=>x.status!=='archived'),taskComplete=tasks.filter(x=>x.status==='done').length;
 const news=items.filter(x=>x.kind==='news');
 const taskItem=(x:Item)=><article className="listitem taskListItem" key={x.id}>
   <button type="button" className={'check '+(x.status==='done'?'checked':'')} onClick={()=>void change(x,x.status==='done'?'pending':'done')}
     aria-busy={statusBusy.includes(x.id)||undefined} aria-label={x.title+' '+(x.status==='done'?'완료 취소':'완료 표시')}>
     {x.status==='done'&&<Icon d={ICON.check} size={14}/>}
   </button>
   <div className="itembody"><b className={x.status==='done'?'struck':''}>{x.title}</b>{x.due_date&&<small>{x.due_date}</small>}</div>
   <button type="button" className="taskDeleteButton" onClick={()=>void removeTask(x)} disabled={taskRemoving===x.id} aria-label={x.title+' 삭제'} title="할 일 삭제">
     <Icon d={ICON.close}/>
   </button>
 </article>;
 return <main>
  <button type="button" className="panel homeCycleCard" onClick={openFinance} aria-label={'이번 결제 주기 사용액 '+won(summary.total)+', 금융 탭으로 이동'}>
    <span className="homeCycleHeading"><span>이번 결제 주기 사용액</span><Icon d={ICON.chevron}/></span>
    <strong className="homeCycleTotal">{won(summary.total)}</strong>
    {summary.status==='ok'&&<small className="homeCycleSplit">(일시불 {won(summary.lumpTotal)} · 할부 {won(summary.installmentTotal)})</small>}
    <small className="homeCycleMeta">{summary.cycle.payMonth}월 21일 결제 예정 · 주기 마감까지 {summary.daysLeft}일</small>
  </button>
  <section className="panel taskPanel">
    <div className="sectionTitle taskPanelHeader"><h2>오늘 할 일</h2>
      <div className="taskHeaderActions"><span className="taskCount">{taskComplete}/{tasks.length}</span>
        <button type="button" className="taskOpenButton" aria-expanded={taskFormOpen} aria-controls="home-task-add-form" onClick={()=>setTaskFormOpen(open=>!open)}>
          {taskFormOpen?'닫기':<><Icon d={ICON.plus} size={14}/>추가</>}
        </button>
      </div>
    </div>
    {taskFormOpen&&<form id="home-task-add-form" className="taskAddForm" onSubmit={e=>{e.preventDefault();void addTask()}}><input type="text" aria-label="새 할 일" placeholder="새로운 할 일 입력" maxLength={200} value={taskDraft} autoFocus onChange={e=>setTaskDraft(e.target.value)}/><button type="submit" disabled={!taskDraft.trim()||taskBusy}>{taskBusy?'저장 중…':'저장'}</button></form>}
    {tasks.length?tasks.map(taskItem):<p className="empty">할 일 없음</p>}
  </section>
  <section className="panel homeNewsPanel">
    <div className="sectionTitle homeNewsHeader"><h2>오늘의 뉴스</h2>
      <button type="button" className="homeNewsAll" onClick={openNewsList} aria-label="오늘의 뉴스 전체 보기, 뉴스 탭으로 이동">전체 보기<Icon d={ICON.chevron} size={14}/></button>
    </div>
    {news.slice(0,3).map(x=><button type="button" className="homeNewsItem" key={x.id} onClick={()=>openNews(x.id)}>
      <small>{x.category??x.source??'오늘의 뉴스'}</small><b>{x.title}</b>
    </button>)}
    {!news.length&&<p className="empty">아직 뉴스가 없어.</p>}
  </section>
 </main>;
}
