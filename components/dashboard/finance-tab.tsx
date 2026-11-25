import type {Dispatch,SetStateAction} from 'react';
import type {Item,useDashboardData} from './use-dashboard-data';
import {amountKnown,card,money} from './dashboard-display';
import DailySpending from './daily-spending';
import {paymentDateLabel} from '@/lib/transaction-time';
import {subscriptionDisplay} from '@/lib/dashboard-display';
import {cycleGroups,cycleSummary,detailRows,isAggregateWithoutDetail} from '@/lib/finance-view';

const won=(amount:number|null)=>amount===null?'미확인':amount.toLocaleString('ko-KR')+'원';

export type MemoPlace='day'|'memoTab';
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
 financeView:'transactions'|'memos';
 setFinanceView:(view:'transactions'|'memos')=>void;
 openExpenseCategories:string[];
 setOpenExpenseCategories:Dispatch<SetStateAction<string[]>>;
 expandedExpenseCategories:string[];
 setExpandedExpenseCategories:Dispatch<SetStateAction<string[]>>;
};

export default function FinanceTab({
 items,transactions,today,coverageDay,month,selectedDate,setMonth,selectDay,updateLabel,statusBusy,change,memoEditor,
 settleTab,setSettleTab,financeView,setFinanceView,
 openExpenseCategories,setOpenExpenseCategories,expandedExpenseCategories,setExpandedExpenseCategories
}:Props){
 const {editingMemo,memoDraft,setMemoDraft,savingMemoIds,cancelMemo,saveMemo}=memoEditor;
 const summary=cycleSummary(transactions,today,coverageDay);
 const emptyPrevious=summary.prevTotal===0&&cycleGroups(transactions,today,coverageDay,2)[1].items.length===0;
 const settlements=items.filter(x=>x.kind==='settlement'),pending=settlements.filter(x=>x.status!=='done'),done=settlements.filter(x=>x.status==='done');
 const pendingAmount=pending.reduce((a,x)=>a+Number(x.amount??0),0);
 const settledAmount=done.reduce((a,x)=>a+Number(x.amount??0),0);
 const getMemo=(x:Item)=>typeof x.metadata.memo==='string'?x.metadata.memo:'';
 const startMemo=(x:Item)=>{setFinanceView('memos');memoEditor.startMemo(x,'memoTab');};
 const settleItem=(x:Item)=> <article className="listitem" key={x.id}><button className={'check '+(x.status==='done'?'checked':'')} onClick={()=>void change(x,x.status==='done'?'pending':'done')} aria-busy={statusBusy.includes(x.id)||undefined} aria-label={x.status==='done'?'정산 복원':'정산 완료'}>{x.status==='done'?'✓':''}</button><div className="itembody"><b>{x.title}</b><small>{x.due_date?'마감 '+x.due_date:'정산'}</small></div><strong>{money(Number(x.amount??0))}</strong></article>;
 const categoryGroups=Object.entries(transactions.reduce<Record<string,{total:number;rows:Item[]}>>((groups,x)=>{
   const category=(x.category??'기타').trim()||'기타';
   if(!groups[category])groups[category]={total:0,rows:[]};
   groups[category].total+=Math.max(0,Number(x.amount??0));
   groups[category].rows.push(x);
   return groups;
 },{})).sort((a,b)=>b[1].total-a[1].total||a[0].localeCompare(b[0],'ko'));
 const barData=categoryGroups.slice(0,7);
 const maxBar=Math.max(1,...barData.map(([,group])=>group.total));
 const orderedTransactions=categoryGroups.flatMap(([,group])=>[...group.rows].sort((a,b)=>Number(b.amount??0)-Number(a.amount??0)||(b.event_date??'').localeCompare(a.event_date??'')));
 const memoCount=transactions.filter(x=>getMemo(x).length>0).length;
 const benefits=items.filter(x=>x.kind==='benefit');
 const subscriptions=benefits.filter(x=>x.category==='ai_subscription').sort((a,b)=>Number(b.amount??0)-Number(a.amount??0));
 const subscriptionTotal=subscriptions.filter(x=>subscriptionDisplay(x).active).reduce((sum,x)=>sum+Number(x.amount??0),0);
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
    <div className="metricgrid">{card('미정산',money(pendingAmount),pending.length+'건')}{card('정산 완료',money(settledAmount),done.length+'건 완료')}</div>
  </div>
  <DailySpending transactions={transactions} today={today} coverageDay={coverageDay}
    month={month} selectedDate={selectedDate} setMonth={setMonth} selectDay={selectDay} memoEditor={memoEditor}/>
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
        const detailedCount=group.rows.reduce((sum,x)=>sum+(detailRows(x).length||1),0);
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
            {detailRows(x).length>0&&<div className="expenseSubItems">{detailRows(x).map((line,i)=><div className="expenseSubItem" key={i}><span>{line.title}{(line.date||line.time)&&<small> · {[line.date?.slice(0,10),line.time].filter(Boolean).join(' · ')}</small>}</span><strong>{line.amount===null?'금액 미등록':money(line.amount)}</strong></div>)}</div>}
            {isAggregateWithoutDetail(x)&&<p className="expenseAggregateNote">합산 거래 · 상세 내역 없음</p>}
          </div>)}
          {categoryOpen&&sorted.length>5&&<button className="expenseCategoryMore" type="button" onClick={()=>setExpandedExpenseCategories(old=>expanded?old.filter(name=>name!==category):[...old,category])}>{expanded?'접기 ↑':`나머지 ${sorted.length-5}건 모두 보기 ↓`}</button>}
        </div>;
      })}
      {!orderedTransactions.length&&<p className="empty">거래 내역이 없어.</p>}
    </div>}
    {financeView==='memos'&&<div>
      {orderedTransactions.map(x=><div className="memoEntry" key={x.id}>
        <div className="memoEntryHeader"><div className="itembody"><b>{x.title}</b><small>{x.category??'기타'} · {paymentDateLabel(x)}</small></div><strong>{money(Number(x.amount??0))}</strong></div>
        {editingMemo?.id===x.id&&editingMemo.place==='memoTab'?
          <div className="memoEditor">
            <textarea aria-label={x.title+' 메모'} value={memoDraft} maxLength={400} placeholder="예: 친구들과 점심, 생일 기념 식사, 출장 중 교통비" rows={3} onChange={e=>setMemoDraft(e.target.value)}/>
            <div className="memoActions"><span>{memoDraft.length}/400</span><button type="button" onClick={cancelMemo}>취소</button><button type="button" className="memoSave" disabled={savingMemoIds.has(x.id)} onClick={()=>void saveMemo(x)}>저장</button></div>
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
</main>;
}
