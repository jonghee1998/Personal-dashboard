import {useState} from 'react';
import {ChevronDown,Search} from 'lucide-react';
import {cycleGroups,detailRows,installmentInfo,installmentLabel,isAggregateWithoutDetail,koreanDate,memoSearch} from '@/lib/finance-view';
import {paymentTime} from '@/lib/transaction-time';
import type {MemoEditorProps,MemoPlace} from './finance-tab';
import type {Item} from './use-dashboard-data';
import TransactionMemoEditor from './transaction-memo-editor';

export const won=(amount:number|null)=>amount===null?'미확인':amount.toLocaleString('ko-KR')+'원';
const PAGE_SIZE=8;
const memoText=(item:Item)=>typeof item.metadata.memo==='string'?item.metadata.memo:'';

function TransactionRow({item,place,editor,onSelect}:{
 item:Item;
 place:Exclude<MemoPlace,'day'>;
 editor:MemoEditorProps;
 onSelect?:(date:string)=>void;
}){
 const memo=memoText(item);
 const editing=editor.editingMemo?.id===item.id&&editor.editingMemo.place===place;
 const date=item.event_date?koreanDate(item.event_date):null;
 const dateLabel=date?[date,paymentTime(item)].filter(Boolean).join(' · '):['날짜 없음',item.source].filter(Boolean).join(' · ');
 const identity=<><strong>{item.title}</strong><small>{dateLabel}</small>{memo&&<small className="financeSavedMemo">{memo}</small>}</>;
 const details=place==='category'?detailRows(item):[];

 return <article className="financeTransaction">
   <div className="financeTransactionRow">
     {onSelect&&date
       ? <button type="button" className="financeSearchResult" onClick={()=>onSelect(date)}>{identity}</button>
       : <div className="financeTransactionIdentity">{identity}</div>}
     <div className="financeTransactionAmount">
       <strong>{item.amount===null?'금액 미등록':won(item.amount)}</strong>
       <small className={installmentInfo(item).installment?'financeInstallment':undefined}>{installmentLabel(item)}</small>
       <button type="button" className="financeAction" aria-label={item.title+' 메모 '+(memo?'수정':'추가')}
         onClick={()=>editing?editor.cancelMemo():editor.startMemo(item,place)}>{editing?'닫기':memo?'수정':'메모 추가'}</button>
     </div>
   </div>
   {editing&&<TransactionMemoEditor item={item} editor={editor} label={item.title+' 메모'}/>}
   {details.length>0&&<ul className="financeSubItems">
     {details.map((line,index)=><li key={index}>
       <div><span>{line.title}</span>
         {(line.date||line.time)&&<small>{[line.date?.slice(0,10),line.time].filter(Boolean).join(' · ')}</small>}
       </div>
       <strong>{line.amount===null?'금액 미등록':won(line.amount)}</strong>
     </li>)}
   </ul>}
   {place==='category'&&isAggregateWithoutDetail(item)&&<p className="financeAggregateNote">합산 거래 · 상세 내역 없음</p>}
 </article>;
}

function ExpenseGroup({title,subtitle,amount,amountNote,registered,emptyMessage,ratio,open,toggle,more,toggleMore,items,place,editor}:{
 title:string;
 subtitle:string;
 amount:string;
 amountNote?:string;
 ratio:number;
 registered?:boolean;
 emptyMessage?:string;
 open:boolean;
 toggle:()=>void;
 more:boolean;
 toggleMore:()=>void;
 items:Item[];
 place:'monthly'|'category';
 editor:MemoEditorProps;
}){
 return <div className="financeExpenseGroup">
   <button type="button" className="financeGroupToggle" aria-expanded={open} onClick={toggle}>
     <span className="financeGroupHeading">
       <span><b>{title}</b><small>{subtitle}</small></span>
       <span className="financeGroupAmount">
         <b>{amount}</b>
         {amountNote&&<small>{amountNote}</small>}
         {registered&&<small>등록 내역 기준</small>}
       </span>
       <ChevronDown size={16} aria-hidden="true"/>
     </span>
     <span className="financeGroupTrack" aria-hidden="true"><span style={{width:Math.min(100,Math.max(0,ratio*100))+'%'}}/></span>
   </button>
   {open&&items.length>0&&<div className="financeGroupItems">
     {items.slice(0,more?items.length:PAGE_SIZE).map(item=><TransactionRow key={item.id} item={item} place={place} editor={editor}/>)}
     {items.length>PAGE_SIZE&&<button type="button" className="financeAction" onClick={toggleMore}>
       {more?'간단히 보기':`외 ${items.length-PAGE_SIZE}건 더 보기`}
     </button>}
   </div>}
   {open&&emptyMessage&&<p className="empty">{emptyMessage}</p>}
 </div>;
}

const toggleKey=(keys:string[],key:string)=>keys.includes(key)?keys.filter(value=>value!==key):[...keys,key];

type Props={
 transactions:Item[];
 cycles:ReturnType<typeof cycleGroups<Item>>;
 editor:MemoEditorProps;
 query:string;
 setQuery:(query:string)=>void;
 onSelect:(date:string)=>void;
 openCategories:string[];
 toggleCategory:(category:string)=>void;
 moreCategories:string[];
 toggleMoreCategory:(category:string)=>void;
};

export default function FinanceActivity({transactions,cycles,editor,query,setQuery,onSelect,
 openCategories,toggleCategory,moreCategories,toggleMoreCategory}:Props){
 const [toggledCycles,setToggledCycles]=useState<string[]>([]);
 const [moreCycles,setMoreCycles]=useState<string[]>([]);
 const result=memoSearch(transactions,query);
 const groups=new Map<string,{items:Item[];total:number;count:number}>();
 for(const item of transactions){
   const category=item.category?.trim()||'기타';
   const group=groups.get(category)??{items:[],total:0,count:0};
   group.items.push(item);
   group.total+=item.amount??0;
   group.count+=detailRows(item).length||1;
   groups.set(category,group);
 }
 const categories=[...groups].sort((a,b)=>b[1].total-a[1].total||a[0].localeCompare(b[0],'ko'));
 const categoryTotal=categories.reduce((total,[,group])=>total+group.total,0);
 const maxCycle=Math.max(1,...cycles.map(group=>group.total??0));

 return <>
   <section className="panel financeMemoSearch">
     <h2>메모 검색</h2>
     <label className="financeSearchField">
       <Search size={16} aria-hidden="true"/>
       <input type="search" aria-label="메모 검색" placeholder="거래 메모 검색" value={query} onChange={event=>setQuery(event.target.value)}/>
     </label>
     <div className="financeSearchChips">
       {['정산','경비','선물'].map(chip=><button type="button" key={chip} className="financeAction"
         aria-pressed={query===chip} onClick={()=>setQuery(query===chip?'':chip)}>{chip}</button>)}
     </div>
     {query.trim()&&<>
       <p className="financeSearchSummary" role="status">"{query.trim()}" 메모 {result.items.length}건 · 합계 {won(result.total)}</p>
       {result.items.map(item=><TransactionRow key={item.id} item={item} place="search" editor={editor} onSelect={onSelect}/>)}
     </>}
   </section>

   <section className="panel financeMonthly">
     <h2>월별 지출</h2>
     {cycles.map(group=>{
       const key=group.label;
       const empty=group.total===0&&group.items.length===0;
       const amount=group.status==='no_history'?'등록 내역 없음':group.status==='amount_missing'
         ?`미확인 · 금액 미등록 ${group.missingCount}건`:won(group.total);
       const open=group.live!==toggledCycles.includes(key);
       return <ExpenseGroup key={key} title={group.label} subtitle={group.range} amount={amount}
         amountNote={empty&&!group.live?'(등록 내역 0건)':group.installmentTotal===null?undefined:`(할부 ${won(group.installmentTotal)})`}
         ratio={(group.total??0)/maxCycle} open={open} toggle={()=>setToggledCycles(keys=>toggleKey(keys,key))}
         more={moreCycles.includes(key)} toggleMore={()=>setMoreCycles(keys=>toggleKey(keys,key))}
         items={group.items} place="monthly" editor={editor}
         registered={group.total!==null&&!group.live} emptyMessage={empty&&group.live?'등록 내역 0건':undefined}/>;
     })}
   </section>

   <section className="panel financeCategories">
     <h2>카테고리별 지출</h2>
     {categories.map(([category,group])=>{
       const ratio=categoryTotal?group.total/categoryTotal:0;
       group.items.sort((a,b)=>(b.amount??-Infinity)-(a.amount??-Infinity)||(b.event_date??'').localeCompare(a.event_date??''));
       return <ExpenseGroup key={category} title={category} subtitle={group.count+'건'}
         amount={won(group.total)} amountNote={new Intl.NumberFormat('ko-KR',{style:'percent',maximumFractionDigits:1}).format(ratio)}
         ratio={ratio} open={openCategories.includes(category)} toggle={()=>toggleCategory(category)}
         more={moreCategories.includes(category)} toggleMore={()=>toggleMoreCategory(category)}
         items={group.items} place="category" editor={editor}/>;
     })}
     {!categories.length&&<p className="empty">지출 내역 없음</p>}
   </section>
 </>;
}
