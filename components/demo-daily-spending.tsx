'use client';
import {useMemo,useState} from 'react';
import {paymentTime} from '@/lib/transaction-time';

type Transaction={id:string;title:string;description:string|null;amount:number|null;category:string|null;event_date:string|null;source:string|null;metadata:Record<string,unknown>};
const money=(value:number)=>'₩'+Math.round(value).toLocaleString('ko-KR');
const pad=(value:number)=>String(value).padStart(2,'0');
const isInstallment=(row:Transaction)=>{
 const m=row.metadata??{};
 const flags=[m.is_installment,m.installment];
 if(flags.some(v=>v===true||v===1||typeof v==='string'&&/^(true|yes|y|1)$/i.test(v.trim())))return true;
 const months=[m.installment_months,m.installment_total_months,m.installment_count,m.total_installments];
 if(months.some(v=>Number.isFinite(Number(v))&&Number(v)>1))return true;
 const fields=[row.category,row.title,row.description,m.payment_type,m.payment_method,m.payment_plan,m.installment_type,m.installment,m.installment_info];
 return fields.some(v=>typeof v==='string'&&!/^(일시불|single|lump.sum|false|no|0)$/i.test(v.trim())&&(/할부|installment/i.test(v)||/\b\d+\s*\/\s*\d+\s*회차\b/.test(v)));
};
const seoulToday=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const num=(name:string)=>Number(parts.find(p=>p.type===name)?.value??0);return {year:num('year'),index:num('month')-1,day:num('day')}};
const CHART_HEIGHT=186,TOP=25,BOTTOM=149,LEFT=20;
export default function DemoDailySpending({transactions,coverageDay,onSaveMemo}:{transactions:Transaction[];coverageDay?:string|null;onSaveMemo:(id:string,memo:string)=>Promise<void>}){
 const [month,setMonth]=useState(()=>{const {year,index}=seoulToday();return {year,index}});
 const [selectedDate,setSelectedDate]=useState<string|null>(()=>coverageDay??null);
 const [editingId,setEditingId]=useState<string|null>(null);
 const [draft,setDraft]=useState('');
 const [saving,setSaving]=useState(false);
 const [saveError,setSaveError]=useState('');
 const startEdit=(row:Transaction)=>{setEditingId(row.id);setDraft(typeof row.metadata.memo==='string'?row.metadata.memo:'');setSaveError('');};
 const cancelEdit=()=>{setEditingId(null);setDraft('');setSaveError('');};
 const submitMemo=async(row:Transaction)=>{if(saving)return;setSaving(true);setSaveError('');try{await onSaveMemo(row.id,draft);cancelEdit();}catch{setSaveError('메모 저장에 실패했습니다. 다시 시도해 주세요.');}finally{setSaving(false);}};
 const today=seoulToday();
 const currentMonth=month.year===today.year&&month.index===today.index;
 const futureMonth=month.year>today.year||(month.year===today.year&&month.index>today.index);
 const monthKey=`${month.year}-${pad(month.index+1)}`;
 const days=futureMonth||!coverageDay||monthKey>coverageDay.slice(0,7)?0:Math.min(currentMonth?today.day:new Date(month.year,month.index+1,0).getDate(),monthKey===coverageDay.slice(0,7)?Number(coverageDay.slice(8,10)):31);
 // The chart ends at today's point, not at the last day of the month.
 const chartWidth=Math.max(320,LEFT+Math.max(0,days-1)*27+20);
 const chartRight=chartWidth-20;
 const prefix=`${month.year}-${pad(month.index+1)}-`;
 const monthRows=useMemo(()=>transactions.filter(x=>x.event_date?.slice(0,7)===prefix.slice(0,7)&&Number(x.amount??0)>0&&(!currentMonth||x.event_date.slice(0,10)<=`${prefix}${pad(days)}`)),[transactions,prefix,currentMonth,days]);
 const installmentTotal=monthRows.filter(isInstallment).reduce((sum,x)=>sum+Number(x.amount??0),0);
 const monthTotal=monthRows.reduce((sum,x)=>sum+Number(x.amount??0),0);
 const daily=useMemo(()=>Array.from({length:days},(_,i)=>{
   const day=i+1,date=`${prefix}${pad(day)}`;
   const rows=transactions.filter(x=>x.event_date?.slice(0,10)===date&&Number(x.amount??0)>0&&!isInstallment(x)).sort((a,b)=>(paymentTime(b)??'').localeCompare(paymentTime(a)??''));
   return {day,date,rows,total:rows.reduce((sum,x)=>sum+Number(x.amount??0),0)};
 }),[days,prefix,transactions]);
 const max=Math.max(1,...daily.map(x=>x.total));
 const yMax=Math.ceil(max/10000)*10000;
 const xAt=(index:number)=>LEFT+(index/(Math.max(1,daily.length-1)))*(chartRight-LEFT);
 const yAt=(value:number)=>BOTTOM-(value/yMax)*(BOTTOM-TOP);
 const coords=daily.map((x,i)=>({x:xAt(i),y:yAt(x.total),...x}));
 const path=coords.map((p,i)=>(i===0?'M':'L')+` ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
 const area=path+` L ${chartRight} ${BOTTOM} L ${LEFT} ${BOTTOM} Z`;
 const selected=daily.find(x=>x.date===selectedDate)??null;
 const shiftMonth=(n:number)=>{const date=new Date(month.year,month.index+n,1);const today=seoulToday();if(date.getFullYear()>today.year||(date.getFullYear()===today.year&&date.getMonth()>today.index))return;setMonth({year:date.getFullYear(),index:date.getMonth()});setSelectedDate(null);cancelEdit()};
 return <section className="panel dailySpendingPanel">
   <div className="dailySpendingHeader">
     <div><h2>일별 지출 추이</h2></div>
     <div className="dailyMonthNav"><button type="button" onClick={()=>shiftMonth(-1)} aria-label="이전 달">‹</button><strong>{month.year}.{pad(month.index+1)}</strong><button type="button" onClick={()=>shiftMonth(1)} aria-label="다음 달" disabled={currentMonth||futureMonth}>›</button></div>
   </div>
   <div className="dailyTotal"><span>선택 월 지출 합계</span><div className="dailyTotalAmounts"><strong>{monthRows.length?money(monthTotal):'미확인'}</strong><small className="dailyInstallmentTotal">(할부: {monthRows.length?money(installmentTotal):'미확인'})</small></div></div>
   {days>0&&monthRows.length>0?<><div className="dailyLineScroller" role="region" aria-label="일별 지출 라인차트, 가로 스크롤 가능" tabIndex={0}>
     <div className="dailyLineCanvas" style={{width:chartWidth}}>
       <svg viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`} width={chartWidth} height={CHART_HEIGHT} aria-hidden="true">
         <defs><linearGradient id="dailyLineFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8eb4ff" stopOpacity=".27"/><stop offset="100%" stopColor="#8eb4ff" stopOpacity="0"/></linearGradient></defs>
         {[0,.5,1].map((fraction)=><g key={fraction}><line x1={LEFT} x2={chartRight} y1={yAt(yMax*fraction)} y2={yAt(yMax*fraction)} stroke="#3a465a" strokeDasharray="3 5"/><text x={LEFT} y={yAt(yMax*fraction)-5} fontSize="9" fill="#8496af">{fraction===0?'0':Number((yMax*fraction/10000).toFixed(1)).toLocaleString('ko-KR')+'만'}</text></g>)}
         <path d={area} fill="url(#dailyLineFill)"/>
         <path d={path} fill="none" stroke="#9dbdff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
         {coords.map(p=><circle key={p.date} cx={p.x} cy={p.y} r={selectedDate===p.date?5.3:3.3} fill={selectedDate===p.date?'#f9d69a':'#9dbdff'} stroke="#1b2432" strokeWidth="1.5"/>)}
         {coords.filter(p=>p.day===1||p.day%5===0||p.day===days).map(p=><text key={p.date} x={p.x} y="173" textAnchor="middle" fontSize="11" fill="#a4b5ce">{p.day}일</text>)}
       </svg>
       {coords.map(p=><button key={p.date} className={'dailyHit '+(selectedDate===p.date?'active':'')} type="button" style={{left:(p.x/chartWidth*100)+'%',top:(p.y/CHART_HEIGHT*100)+'%'}} onClick={()=>{setSelectedDate(p.date);cancelEdit()}} aria-pressed={selectedDate===p.date} aria-label={`${month.index+1}월 ${p.day}일, 지출 ${money(p.total)}`} title={`${p.day}일 · ${money(p.total)}`}/>)}
     </div>
   </div>
   {selected?<div className="dailyDetails">
     <div className="dailyDetailsHeader"><div><strong>{month.index+1}월 {selected.day}일 거래내역</strong><small>{selected.rows.length}건</small></div><strong>{money(selected.total)}</strong></div>
     {selected.rows.length?selected.rows.map(x=><div className="dailyTransactionWrap" key={x.id}>
       <div className="dailyTransaction">
         <div><strong>{x.title}</strong><small>{x.category??'기타'} · {x.source??'카드'}{paymentTime(x)?' · '+paymentTime(x):''}</small>
           {typeof x.metadata.memo==='string'&&x.metadata.memo&&<small className="savedMemo">📝 {x.metadata.memo}</small>}
         </div>
         <div className="dailyTransactionActions"><strong>{money(Number(x.amount??0))}</strong>
           <button type="button" className="memoInlineButton" onClick={()=>editingId===x.id?cancelEdit():startEdit(x)} aria-label={x.title+' 메모 '+(x.metadata.memo?'수정':'추가')}>{editingId===x.id?'닫기':x.metadata.memo?'메모 수정':'메모 +'}</button>
         </div>
       </div>
       {editingId===x.id&&<div className="dailyMemoEditor">
         <textarea aria-label={x.title+' 결제 메모'} value={draft} maxLength={400} rows={3} placeholder="결제 메모를 입력하세요" onChange={e=>setDraft(e.target.value)}/>
         {saveError&&<p className="dailyMemoError" role="alert">{saveError}</p>}
         <div className="dailyMemoActions"><small>{draft.length}/400</small><button type="button" disabled={saving} onClick={cancelEdit}>취소</button><button type="button" className="dailyMemoSave" disabled={saving} onClick={()=>void submitMemo(x)}>{saving?'저장 중…':'저장'}</button></div>
       </div>}
     </div>):<p className="empty">이날 등록된 카드 지출은 없어.</p>}
   </div>:<div className="dailyDetailsEmpty">날짜 선택</div>}</>:<p className="empty">선택 월의 확인된 지출 내역이 없습니다.</p>}
   {currentMonth&&coverageDay&&coverageDay.slice(0,7)===monthKey&&days<today.day&&<p className="empty">등록 내역 기준 {coverageDay.slice(5).replace('-','/')}까지 · 이후 원본 확인 대기</p>}
 </section>;
}
