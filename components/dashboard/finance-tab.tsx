import type {Dispatch,SetStateAction} from 'react';
import type {Item,useDashboardData} from './use-dashboard-data';
import {amountKnown,card,money} from './dashboard-display';
import DailySpending from './daily-spending';
import {paymentDateLabel,paymentTime} from '@/lib/transaction-time';
import {subscriptionDisplay} from '@/lib/dashboard-display';
import {registeredCoverageDay} from '@/lib/dashboard-freshness';

type Props={
 items:Item[];
 transactions:Item[];
 lastTransactionSourceAt:string|null;
 updateLabel:(key:string)=>string;
 statusBusy:string[];
 change:ReturnType<typeof useDashboardData>['change'];
 saveMemoValue:ReturnType<typeof useDashboardData>['saveMemoValue'];
 saveMemo:(item:Item)=>Promise<void>;
 settleTab:'pending'|'done';
 setSettleTab:(tab:'pending'|'done')=>void;
 financeView:'transactions'|'memos';
 setFinanceView:(view:'transactions'|'memos')=>void;
 editingMemo:string|null;
 setEditingMemo:(id:string|null)=>void;
 memoDraft:string;
 setMemoDraft:(draft:string)=>void;
 openExpenseCategories:string[];
 setOpenExpenseCategories:Dispatch<SetStateAction<string[]>>;
 expandedExpenseCategories:string[];
 setExpandedExpenseCategories:Dispatch<SetStateAction<string[]>>;
};

export default function FinanceTab({
 items,transactions,lastTransactionSourceAt,updateLabel,statusBusy,change,saveMemoValue,saveMemo,
 settleTab,setSettleTab,financeView,setFinanceView,editingMemo,setEditingMemo,memoDraft,setMemoDraft,
 openExpenseCategories,setOpenExpenseCategories,expandedExpenseCategories,setExpandedExpenseCategories
}:Props){
 const transactionAmountsKnown=transactions.length>0&&transactions.every(x=>amountKnown(x.amount));
 const coverageDay=registeredCoverageDay(lastTransactionSourceAt,transactions.map(x=>x.event_date));
 const settlements=items.filter(x=>x.kind==='settlement'),pending=settlements.filter(x=>x.status!=='done'),done=settlements.filter(x=>x.status==='done');
 const cardTotal=transactions.filter(x=>x.amount!==null&&x.amount>0).reduce((a,x)=>a+Number(x.amount),0);
 const pendingAmount=pending.reduce((a,x)=>a+Number(x.amount??0),0);
 const settledAmount=done.reduce((a,x)=>a+Number(x.amount??0),0);
 const getMemo=(x:Item)=>typeof x.metadata.memo==='string'?x.metadata.memo:'';
 const startMemo=(x:Item)=>{setFinanceView('memos');setEditingMemo(x.id);setMemoDraft(getMemo(x));};
 const settleItem=(x:Item)=> <article className="listitem" key={x.id}><button className={'check '+(x.status==='done'?'checked':'')} onClick={()=>void change(x,x.status==='done'?'pending':'done')} aria-busy={statusBusy.includes(x.id)||undefined} aria-label={x.status==='done'?'정산 복원':'정산 완료'}>{x.status==='done'?'✓':''}</button><div className="itembody"><b>{x.title}</b><small>{x.due_date?'마감 '+x.due_date:'정산'}</small></div><strong>{money(Number(x.amount??0))}</strong></article>;
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
 const benefits=items.filter(x=>x.kind==='benefit');
 const subscriptions=benefits.filter(x=>x.category==='ai_subscription').sort((a,b)=>Number(b.amount??0)-Number(a.amount??0));
 const subscriptionTotal=subscriptions.filter(x=>subscriptionDisplay(x).active).reduce((sum,x)=>sum+Number(x.amount??0),0);
 return <main>
  <div className="financeSummary">
    <div className="financeTotal">{card('등록 지출 합계',transactionAmountsKnown?money(cardTotal):'미확인',transactions.length+'건')}</div>
    <div className="metricgrid">{card('미정산',money(pendingAmount),pending.length+'건')}{card('정산 완료',money(settledAmount),done.length+'건 완료')}</div>
  </div>
  <DailySpending transactions={transactions} coverageDay={coverageDay} onSaveMemo={async(id,memo)=>{const item=items.find(x=>x.id===id&&x.kind==='transaction');if(!item)throw new Error('거래 내역을 찾을 수 없습니다');await saveMemoValue(item,memo);}}/>
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
</main>;
}
