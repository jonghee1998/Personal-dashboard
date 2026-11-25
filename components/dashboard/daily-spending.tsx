'use client';
import {useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {paymentTime} from '@/lib/transaction-time';
import {amountTier,chartPath,dayRows,dayTotals,installmentLabel,manwon} from '@/lib/finance-view';
import type {Item} from './use-dashboard-data';

const won=(value:number)=>value.toLocaleString('ko-KR')+'원';
const pad=(value:number)=>String(value).padStart(2,'0');
const WIDTH=360,HEIGHT=174,TOP=32,BOTTOM=146,LEFT=43,RIGHT=348;
const weekdays=['일','월','화','수','목','금','토'];
const byTime=(a:Item,b:Item)=>(paymentTime(b)??'').localeCompare(paymentTime(a)??'');

type Props={
 transactions:Item[];
 today:string;
 coverageDay:string|null;
 onSaveMemo:(id:string,memo:string)=>Promise<void>;
};

export default function DailySpending({transactions,today,coverageDay,onSaveMemo}:Props){
 const [month,setMonth]=useState(today.slice(0,7));
 const [selectedDate,setSelectedDate]=useState(coverageDay?.slice(0,7)===month?coverageDay:today);
 const [editingId,setEditingId]=useState<string|null>(null);
 const [draft,setDraft]=useState('');
 const [saving,setSaving]=useState(false);
 const [saveError,setSaveError]=useState('');
 const startEdit=(row:Item)=>{setEditingId(row.id);setDraft(typeof row.metadata.memo==='string'?row.metadata.memo:'');setSaveError('');};
 const cancelEdit=()=>{setEditingId(null);setDraft('');setSaveError('');};
 const submitMemo=async(row:Item)=>{if(saving)return;setSaving(true);setSaveError('');try{await onSaveMemo(row.id,draft);cancelEdit();}catch{setSaveError('메모 저장에 실패했습니다. 다시 시도해 주세요.');}finally{setSaving(false);}};

 const [year,monthNumber]=month.split('-').map(Number);
 const currentMonth=today.slice(0,7);
 const coveredThrough=coverageDay&&coverageDay>today?today:coverageDay;
 const totals=dayTotals(transactions,year,monthNumber,coveredThrough);
 const days=Object.keys(totals).length;
 const firstWeekday=new Date(Date.UTC(year,monthNumber-1,1)).getUTCDay();
 const dateAt=(day:number)=>month+'-'+pad(day);
 const xAt=(day:number)=>LEFT+(day-1)/(days-1)*(RIGHT-LEFT);
 const knownTotals=Object.values(totals).filter(value=>value!==null);
 const yMax=Math.ceil(Math.max(1,...knownTotals)/30_000)*30_000;
 const yMin=Math.floor(Math.min(0,...knownTotals)/30_000)*30_000;
 const yAt=(value:number)=>BOTTOM-(value-yMin)/(yMax-yMin)*(BOTTOM-TOP);
 const points=Object.entries(totals).flatMap(([key,total])=>{
   if(total===null)return [];
   const day=Number(key);
   return [{day,total,x:xAt(day),y:yAt(total)}];
 });
 const segments:typeof points[]=[];
 for(const point of points){
   const last=segments.at(-1);
   if(last?.at(-1)?.day===point.day-1)last.push(point);
   else segments.push([point]);
 }
 const selectedDay=Number(selectedDate.slice(8,10));
 const selected=points.find(point=>point.day===selectedDay);
 const detail=dayRows(transactions,selectedDate,coveredThrough);
 const rows=[
   ...detail.lumpRows.sort(byTime).map(item=>({item,installment:false})),
   ...detail.installmentRows.sort(byTime).map(item=>({item,installment:true})),
 ];
 const selectDay=(date:string)=>{
   if(date===selectedDate)return;
   setSelectedDate(date);
   cancelEdit();
 };
 const shiftMonth=(offset:number)=>{
   const next=new Date(Date.UTC(year,monthNumber-1+offset,1)).toISOString().slice(0,7);
   if(next>currentMonth)return;
   setMonth(next);
   selectDay(next===coverageDay?.slice(0,7)?coverageDay:next===currentMonth?today:next+'-01');
 };

 return <>
   <section className="panel dailySpendingPanel">
     <div className="dailySpendingHeader">
       <h2>일별 지출 추이</h2>
       <div className="dailyMonthNav">
         <button type="button" onClick={()=>shiftMonth(-1)} aria-label="이전 달"><ChevronLeft size={16}/></button>
         <strong>{year}.{pad(monthNumber)}</strong>
         <button type="button" onClick={()=>shiftMonth(1)} aria-label="다음 달" disabled={month===currentMonth}><ChevronRight size={16}/></button>
       </div>
     </div>
     <div className="dailyChart" role="region" aria-label="일별 지출 라인차트">
       <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
         {[1,2/3,1/3,0].map(fraction=>{
           const value=yMin+(yMax-yMin)*fraction,y=yAt(value);
           return <g key={fraction}>
             <line className="dailyGridLine" x1={LEFT} x2={RIGHT} y1={y} y2={y}/>
             <text x={LEFT-6} y={y+3} textAnchor="end">{manwon(value)}</text>
           </g>;
         })}
         {[1,5,10,15,20,25,30].filter(day=>day<=days).map(day=><text key={day} x={xAt(day)} y="165" textAnchor="middle">{day}</text>)}
         {segments.map(segment=><path key={segment[0].day} className="dailyLine" d={chartPath(segment,WIDTH,HEIGHT)}/>)}
         {segments.filter(segment=>segment.length===1).map(([point])=><circle key={point.day} className="dailyPoint" cx={point.x} cy={point.y} r="2.5"/>)}
         {selected&&<>
           <line className="dailyMarker" x1={selected.x} x2={selected.x} y1={TOP} y2={BOTTOM}/>
           <circle className="dailyPoint" cx={selected.x} cy={selected.y} r="4"/>
           <g className="dailyTooltip" transform={`translate(${Math.min(WIDTH-104,Math.max(0,selected.x-52))} 0)`}>
             <rect width="104" height="24" rx="8"/>
             <text x="52" y="16" textAnchor="middle">{selected.day}일 · {manwon(selected.total)}원</text>
           </g>
         </>}
       </svg>
       {points.map(({day,total,x})=><button key={day} className="dailyHit" type="button"
         style={{left:(x/WIDTH*100)+'%',width:((RIGHT-LEFT)/(days-1)/WIDTH*100)+'%'}}
         onClick={()=>selectDay(dateAt(day))} aria-pressed={day===selectedDay}
         aria-label={`${monthNumber}월 ${day}일, 지출 ${won(total)}`}/>)}
     </div>
   </section>

   <section className="panel financeCalendar">
     <h2>지출 달력</h2>
     <div className="financeCalendarGrid">
       {weekdays.map((label,index)=><span className={index===0?'sunday':index===6?'saturday':''} key={label}>{label}</span>)}
       {Object.entries(totals).map(([key,total])=>{
         const day=Number(key),date=dateAt(day),weekday=(firstWeekday+day-1)%7;
         return <button type="button" key={date} className={weekday===0?'sunday':weekday===6?'saturday':undefined}
           style={day===1?{gridColumn:firstWeekday+1}:undefined} data-date={date}
           aria-label={`${monthNumber}월 ${day}일, ${total===null?'미확인':won(total)}`}
           aria-current={date===today?'date':undefined} aria-pressed={date===selectedDate} onClick={()=>selectDay(date)}>
           <span className="financeCalendarDay">{day}</span>
           {total!==null&&<span className={`financeCalendarAmount ${amountTier(total)}`}>{manwon(total)}</span>}
         </button>;
       })}
     </div>
     <div className="financeCalendarLegend"><span className="low">적게</span><span className="mid">보통</span><span className="high">많이</span></div>
     <p className="financeCalendarThresholds">3만 미만 · 3만~7만 · 7만 이상</p>
   </section>

   <section className="panel dailyDetails">
     <div className="dailyDetailsHeader">
       <div><h2>{monthNumber}월 {selectedDay}일 거래내역</h2><small>{rows.length}건</small></div>
       <strong className="dailyDetailsTotal">{detail.lumpTotal===null?'미확인':won(detail.lumpTotal)}</strong>
     </div>
     {detail.status==='no_coverage'&&<p className="empty">수집 확인 전</p>}
     {detail.status==='amount_missing'&&<p className="empty">금액 미등록</p>}
     {detail.status==='ok'&&rows.length===0&&<p className="empty">등록 내역 0건</p>}
     {rows.map(({item:x,installment})=><div className="dailyTransactionWrap" key={x.id}>
       <div className="dailyTransaction">
         <div>
           <strong>{x.title}</strong>
           <small>{x.category??'기타'}{paymentTime(x)?' · '+paymentTime(x):''}</small>
           {installment&&<small className="dailyInstallment">{installmentLabel(x)} · 일 합계 제외</small>}
           {typeof x.metadata.memo==='string'&&x.metadata.memo&&<small className="savedMemo">{x.metadata.memo}</small>}
         </div>
         <div className="dailyTransactionActions">
           <strong>{x.amount===null?'금액 미등록':won(x.amount)}</strong>
           <button type="button" className="memoInlineButton" onClick={()=>editingId===x.id?cancelEdit():startEdit(x)}
             aria-label={x.title+' 메모 '+(x.metadata.memo?'수정':'추가')}>{editingId===x.id?'닫기':x.metadata.memo?'수정':'메모 추가'}</button>
         </div>
       </div>
       {editingId===x.id&&<div className="dailyMemoEditor">
         <textarea aria-label={x.title+' 결제 메모'} value={draft} maxLength={400} rows={3} placeholder="결제 메모를 입력하세요" onChange={e=>setDraft(e.target.value)}/>
         {saveError&&<p className="dailyMemoError" role="alert">{saveError}</p>}
         <div className="dailyMemoActions"><small>{draft.length}/400</small><button type="button" disabled={saving} onClick={cancelEdit}>취소</button><button type="button" className="dailyMemoSave" disabled={saving} onClick={()=>void submitMemo(x)}>{saving?'저장 중…':'저장'}</button></div>
       </div>}
     </div>)}
   </section>
 </>;
}
