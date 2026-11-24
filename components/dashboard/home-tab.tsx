import type {Dispatch,SetStateAction} from 'react';
import type {Item,useDashboardData} from './use-dashboard-data';
import {amountKnown,card,money} from './dashboard-display';

type Props={
 items:Item[];
 transactions:Item[];
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
};

export default function HomeTab({
 items,transactions,statusBusy,taskBusy,taskRemoving,taskFormOpen,taskDraft,
 setTaskFormOpen,setTaskDraft,addTask,change,removeTask,openFinance,openNewsList
}:Props){
 const transactionAmountsKnown=transactions.length>0&&transactions.every(x=>amountKnown(x.amount));
 const cardTotal=transactions.filter(x=>x.amount!==null&&x.amount>0).reduce((a,x)=>a+Number(x.amount),0);
 const tasks=items.filter(x=>x.kind==='task').filter(x=>x.status!=='archived'),taskComplete=tasks.filter(x=>x.status==='done').length;
 const news=items.filter(x=>x.kind==='news');
 const taskItem=(x:Item)=><article className="listitem taskListItem" key={x.id}><button type="button" className={'check '+(x.status==='done'?'checked':'')} onClick={()=>void change(x,x.status==='done'?'pending':'done')} aria-busy={statusBusy.includes(x.id)||undefined} aria-label={x.title+' '+(x.status==='done'?'완료 취소':'완료 표시')}>{x.status==='done'?'✓':''}</button><div className="itembody"><b className={x.status==='done'?'struck':''}>{x.title}</b>{x.due_date&&<small>{x.due_date}</small>}</div><button type="button" className="taskDeleteButton" onClick={()=>void removeTask(x)} disabled={taskRemoving===x.id} aria-label={x.title+' 삭제'} title="할 일 삭제">×</button></article>;
 return <main>
  <button type="button" className="navCard" onClick={openFinance} aria-label="이번 달 카드 지출 상세 보기, 금융 탭으로 이동">
    {card('이번 달 카드 지출',transactionAmountsKnown?money(cardTotal):'미확인','등록된 카드 거래 합계 · 금융 상세 보기 ↗','primary')}
  </button>
  <section className="panel taskPanel"><div className="sectionTitle taskPanelHeader"><h2>오늘 할 일</h2><div className="taskHeaderActions"><span className="taskCount">{taskComplete}/{tasks.length}</span><button type="button" className="taskOpenButton" aria-expanded={taskFormOpen} aria-controls="home-task-add-form" onClick={()=>setTaskFormOpen(open=>!open)}>{taskFormOpen?"닫기":"+ 추가"}</button></div></div>{taskFormOpen&&<form id="home-task-add-form" className="taskAddForm" onSubmit={e=>{e.preventDefault();void addTask()}}><input type="text" aria-label="새 할 일" placeholder="새로운 할 일 입력" maxLength={200} value={taskDraft} autoFocus onChange={e=>setTaskDraft(e.target.value)}/><button type="submit" disabled={!taskDraft.trim()||taskBusy}>{taskBusy?"저장 중…":"저장"}</button></form>}{tasks.length?tasks.map(taskItem):<p className="empty">할 일 없음</p>}</section>
  <button type="button" className="newsNavCard" onClick={openNewsList} aria-label="오늘의 뉴스 전체 보기, 뉴스 탭으로 이동">
    <div className="sectionTitle"><h2>오늘의 뉴스</h2><span className="linkHint">전체 보기 →</span></div>
    {news.slice(0,3).map(x=><div className="newsPreviewItem" key={x.id}><b>{x.title}</b><small>{x.category??x.source??'오늘의 뉴스'}</small></div>)}
    {!news.length&&<p className="empty">아직 뉴스가 없어.</p>}
  </button>
 </main>;
}
