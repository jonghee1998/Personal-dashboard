import {Check} from 'lucide-react';
import type {Dispatch,SetStateAction} from 'react';
import type {Item,useDashboardData} from './use-dashboard-data';
import {card} from './dashboard-display';
import DailySpending from './daily-spending';
import {subscriptionDisplay} from '@/lib/dashboard-display';
import {cycleGroups,cycleSummary} from '@/lib/finance-view';
import FinanceActivity,{won} from './finance-activity';

const toggleCategoryKey=(keys:string[],key:string)=>keys.includes(key)?keys.filter(value=>value!==key):[...keys,key];

export type MemoPlace='day'|'search'|'monthly'|'category';
export type MemoEditorProps={
 editingMemo:{id:string;place:MemoPlace;session:number}|null;
 memoDraft:string;
 memoError:string;
 savingMemoIds:ReadonlySet<string>;
 startMemo:(item:Item,place:MemoPlace)=>void;
 cancelMemo:()=>void;
 setMemoDraft:(draft:string)=>void;
 saveMemo:(item:Item)=>Promise<void>;
};

type Props={
 items:Item[];
 transactions:Item[];
 today:string;
 coverageDay:string|null;
 month:string;
 selectedDate:string|null;
 setMonth:(month:string)=>void;
 selectDay:(date:string)=>void;
 updateLabel:(key:string)=>string;
 statusBusy:string[];
 change:ReturnType<typeof useDashboardData>['change'];
 memoEditor:MemoEditorProps;
 settleTab:'pending'|'done';
 setSettleTab:(tab:'pending'|'done')=>void;
 memoQuery:string;
 setMemoQuery:(query:string)=>void;
 openExpenseCategories:string[];
 setOpenExpenseCategories:Dispatch<SetStateAction<string[]>>;
 expandedExpenseCategories:string[];
 setExpandedExpenseCategories:Dispatch<SetStateAction<string[]>>;
};

export default function FinanceTab({
 items,transactions,today,coverageDay,month,selectedDate,setMonth,selectDay,updateLabel,statusBusy,change,memoEditor,
 settleTab,setSettleTab,memoQuery,setMemoQuery,
 openExpenseCategories,setOpenExpenseCategories,expandedExpenseCategories,setExpandedExpenseCategories
}:Props){
 const summary=cycleSummary(transactions,today,coverageDay);
 const cycles=cycleGroups(transactions,today,coverageDay);
 const emptyPrevious=summary.prevTotal===0&&cycles[1].items.length===0;
 const settlements=items.filter(x=>x.kind==='settlement'),pending=settlements.filter(x=>x.status!=='done'),done=settlements.filter(x=>x.status==='done');
 const pendingAmount=pending.reduce((a,x)=>a+Number(x.amount??0),0);
 const settledAmount=done.reduce((a,x)=>a+Number(x.amount??0),0);
 const settleItem=(x:Item)=> <article className="listitem" key={x.id}>
   <button type="button" className={'check '+(x.status==='done'?'checked':'')}
     onClick={()=>void change(x,x.status==='done'?'pending':'done')}
     aria-busy={statusBusy.includes(x.id)||undefined} aria-label={x.status==='done'?'정산 복원':'정산 완료'}>
     {x.status==='done'&&<Check size={14} aria-hidden="true"/>}
   </button>
   <div className="itembody"><b>{x.title}</b><small>{x.due_date?'마감 '+x.due_date:'정산'}</small></div>
   <strong>{won(x.amount)}</strong>
 </article>;
 const subscriptions=items.filter(x=>x.kind==='benefit'&&x.category==='ai_subscription')
   .sort((a,b)=>Number(b.amount??0)-Number(a.amount??0)).map(item=>({item,info:subscriptionDisplay(item)}));
 const activeSubscriptions=subscriptions.filter(({info})=>info.active);
 const subscriptionTotal=subscriptions.length&&activeSubscriptions.every(({item})=>item.amount!==null)
   ?activeSubscriptions.reduce((sum,{item})=>sum+(item.amount??0),0):null;
 const selectTransactionDate=(date:string)=>{
   setMonth(date.slice(0,7));
   selectDay(date);
 };
 return <main>
  <div className="financeSummary">
    <section className="panel financeCycle">
      <h2>이번 결제 주기 사용액</h2>
      <strong className="financeCycleTotal">{won(summary.total)}</strong>
      <p className="financeCycleSplit">(일시불 {won(summary.lumpTotal)} · 할부 {won(summary.installmentTotal)})</p>
      <p>{summary.cycle.payMonth}월 21일 결제 예정 · 주기 마감까지 {summary.daysLeft}일</p>
      {coverageDay&&coverageDay<today&&<p>{Number(coverageDay.slice(5,7))}.{Number(coverageDay.slice(8,10))}까지 확인</p>}
      {summary.status==='no_coverage'&&<p>수집 확인 전</p>}
      {summary.status==='amount_missing'&&<p>금액 미등록 {summary.missingCount}건</p>}
      <div className="financeCycleComparison">
        {summary.progress===null
          ? <p>지난 주기 비교 없음</p>
          : <progress aria-label="지난 주기 대비 사용액" value={summary.progress} max={1}/>}
        {summary.prevStatus==='no_history'
          ? <p>지난 주기 등록 내역 없음</p>
          : <p>지난 주기 같은 날 {won(summary.prevSameDayTotal)}
              {emptyPrevious&&' (등록 내역 0건)'}
              {summary.prevSameDayTotal!==null&&<small>등록 내역 기준</small>}
              {summary.prevSameDayTotal===null&&summary.countedThrough&&summary.prevStatus==='amount_missing'&&' · 금액 미등록'}
            </p>}
      </div>
    </section>
    <div className="metricgrid">{card('미정산',won(pendingAmount),pending.length+'건')}{card('정산 완료',won(settledAmount),done.length+'건 완료')}</div>
  </div>
  <DailySpending transactions={transactions} today={today} coverageDay={coverageDay}
    month={month} selectedDate={selectedDate} setMonth={setMonth} selectDay={selectDay} memoEditor={memoEditor}/>
  <FinanceActivity transactions={transactions} cycles={cycles} editor={memoEditor}
    query={memoQuery} setQuery={setMemoQuery} onSelect={selectTransactionDate}
    openCategories={openExpenseCategories} moreCategories={expandedExpenseCategories}
    toggleCategory={category=>setOpenExpenseCategories(keys=>toggleCategoryKey(keys,category))}
    toggleMoreCategory={category=>setExpandedExpenseCategories(keys=>toggleCategoryKey(keys,category))}/>
  <section className="panel financeSettlements"><h2>정산 트래커</h2>
    <div className="seg">
      <button type="button" className={settleTab==='pending'?'selected':''} aria-pressed={settleTab==='pending'}
        onClick={()=>setSettleTab('pending')}>진행 중 ({pending.length})</button>
      <button type="button" className={settleTab==='done'?'selected':''} aria-pressed={settleTab==='done'}
        onClick={()=>setSettleTab('done')}>완료 ({done.length})</button>
    </div>
    {(settleTab==='pending'?pending:done).map(settleItem)}
    {!(settleTab==='pending'?pending:done).length&&<p className="empty">표시할 정산 내역 없음</p>}
  </section>
  <section className="panel aiSubscriptionPanel">
    <div className="sectionTitle subscriptionSectionTitle"><h2>AI 구독 지출</h2><div className="sectionUpdateMeta"><span>{subscriptions.length}개 서비스</span><small>{updateLabel('subscriptions')}</small></div></div>
    <div className="aiSubscriptionTotal">
      <div className="eyebrow">월 구독료 합계 · 활성 서비스</div>
      <strong>{won(subscriptionTotal)}</strong>
      <small>연간 환산 {won(subscriptionTotal===null?null:subscriptionTotal*12)}</small>
    </div>
    {subscriptions.map(({item:x,info})=>{
      return <div className="aiSubscriptionRow" key={x.id}>
        <div className="itembody aiSubscriptionIdentity"><b>{x.title}</b>{info.plan&&<small className="subscriptionPlan">{info.plan}</small>}
          <div className="subscriptionDates">{info.rows.map(row=><div className="subscriptionDateLine" key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}</div>
        </div>
        <div className="aiSubscriptionPrice"><strong>{won(x.amount)}</strong><span className={info.active?'subscriptionActive':'subscriptionStopped'}>{info.active?'구독 중':'구독 중지'}</span></div>
      </div>;
    })}
    {!subscriptions.length&&<p className="empty">구독 내역 없음</p>}
  </section>
</main>;
}
