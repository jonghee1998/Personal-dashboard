'use client';
import {useMemo,useState} from 'react';

type Entry={
 id:string;
 kind:'event'|'task'|'news'|'point';
 title:string;
 description:string|null;
 status:string;
 event_date:string|null;
 due_date:string|null;
 category:string|null;
 source?:string|null;
 metadata?:Record<string,unknown>;
 amount?:number|null;
};
const pad=(n:number)=>String(n).padStart(2,'0');
const dateKey=(y:number,m:number,d:number)=>`${y}-${pad(m+1)}-${pad(d)}`;
const dateFromKey=(key:string)=>{const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d)};
const koreaToday=()=>{
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const value=(part:string)=>Number(parts.find(x=>x.type===part)?.value??0);
 return dateKey(value('year'),value('month')-1,value('day'));
};
const weekDays=['일','월','화','수','목','금','토'];
const categoryText={event:'일정',task:'할 일',news:'뉴스',point:'포인트'};
const categoryIcon={event:'◷',task:'✓',news:'▤',point:'₩'};
const categoryOrder={event:0,task:1,point:2,news:3};
const dateFor=(x:Entry)=>x.kind==='task'?(x.due_date??x.event_date):(x.event_date??x.due_date);
export default function DemoCalendar({entries,onToggleTask,onOpenNews}:{entries:Entry[];onToggleTask:(x:Entry)=>void;onOpenNews:(id:string)=>void}){
 const [selected,setSelected]=useState(koreaToday);
 const [month,setMonth]=useState(()=>{const date=dateFromKey(koreaToday());return {year:date.getFullYear(),month:date.getMonth()}});
 const [search,setSearch]=useState('');
 const [filter,setFilter]=useState<'all'|Entry['kind']>('all');
 const days=useMemo(()=>{
   const firstDay=new Date(month.year,month.month,1).getDay();
   const count=new Date(month.year,month.month+1,0).getDate();
   return [...Array.from({length:firstDay},()=>null),...Array.from({length:count},(_,i)=>dateKey(month.year,month.month,i+1))];
 },[month]);
 const filteredEntries=useMemo(()=>filter==='all'?entries:entries.filter(x=>x.kind===filter),[entries,filter]);
 const dateEntries=useMemo(()=>filteredEntries.filter(x=>dateFor(x)===selected).sort((a,b)=>categoryOrder[a.kind]-categoryOrder[b.kind]),[filteredEntries,selected]);
 const counts=useMemo(()=>filteredEntries.reduce<Record<string,Set<Entry['kind']>>>((acc,x)=>{const key=dateFor(x);if(key){(acc[key]??=new Set()).add(x.kind)}return acc},{}),[filteredEntries]);
 const term=search.trim().toLocaleLowerCase('ko-KR');
 const results=useMemo(()=>term?filteredEntries.filter(x=>x.kind!=='task').filter(x=>{
   const body=typeof x.metadata?.full_body==='string'?x.metadata.full_body:'';
   return [x.title,x.description,x.category,x.source,body].filter(Boolean).join(' ').toLocaleLowerCase('ko-KR').includes(term);
 }).sort((a,b)=>(dateFor(b)??'').localeCompare(dateFor(a)??'')):[],[filteredEntries,term]);
 const navigate=(delta:number)=>{const next=new Date(month.year,month.month+delta,1);setMonth({year:next.getFullYear(),month:next.getMonth()})};
 const selectDate=(key:string)=>{setSelected(key);setSearch('');const date=dateFromKey(key);setMonth({year:date.getFullYear(),month:date.getMonth()})};
 const returnToday=()=>selectDate(koreaToday());
 const selectedDate=dateFromKey(selected);
 const openResult=(x:Entry)=>x.kind==='news'?onOpenNews(x.id):selectDate(dateFor(x)??selected);
 const renderEntry=(x:Entry)=><article key={x.id} className={'calendarAgendaEntry '+x.kind}>
   <div className="calendarEntryIcon" aria-hidden="true">{categoryIcon[x.kind]}</div>
   <div className="calendarEntryInfo">
     <small>{categoryText[x.kind]}{x.kind==='task'&&x.status==='done'?' · 완료':''}{x.kind==='news'&&x.category?' · '+x.category:''}</small>
     <strong className={x.kind==='task'&&x.status==='done'?'struck':''}>{x.title}</strong>
     {x.kind==='point'&&typeof x.amount==='number'&&<strong className={'calendarPointAmount '+(x.amount>0?'positive':'negative')}>{x.amount>0?'+':'−'}₩{Math.abs(x.amount).toLocaleString('ko-KR')}</strong>}
     {x.description&&<span>{x.description}</span>}
   </div>
   {x.kind==='task'&&<button type="button" className={'calendarTaskToggle '+(x.status==='done'?'checked':'')} aria-label={x.status==='done'?'완료 취소':'할 일 완료'} onClick={()=>onToggleTask(x)}>{x.status==='done'?'✓':'○'}</button>}
   {x.kind==='news'&&<button type="button" className="calendarNewsOpen" onClick={()=>onOpenNews(x.id)} aria-label={x.title+' 상세 읽기'}>읽기 →</button>}
 </article>;
 return <main className="lifeCalendar">
   <section className="calendarSearchPanel">
     <label htmlFor="record-search">통합 기록 검색</label>
     <div className="calendarSearchField">
       <span aria-hidden="true">⌕</span>
       <input id="record-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="뉴스, 일정, 포인트 검색" autoComplete="off"/>
       {search&&<button type="button" onClick={()=>setSearch('')} aria-label="검색어 지우기">×</button>}
     </div>
     <div className="calendarFilters" role="group" aria-label="기록 종류 선택">
       {([['all','전체'],['news','뉴스'],['event','일정'],['point','포인트']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={filter===value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{label}</button>)}
     </div>
   </section>
   {term?<section className="calendarAgenda" aria-live="polite">
     <div className="calendarAgendaHeading"><div><h2>검색 결과</h2><span>제목·설명·뉴스 본문에서 검색</span></div><strong>{results.length}건</strong></div>
     {results.map(x=><button type="button" key={x.id} className="calendarSearchResult" onClick={()=>openResult(x)}>
       <span className={'calendarResultIcon '+x.kind}>{categoryIcon[x.kind]}</span>
       <span className="calendarSearchResultText"><small>{categoryText[x.kind]} · {dateFor(x)??'날짜 없음'}</small><strong>{x.title}</strong><span>{x.description??''}</span></span>
       <span className="calendarResultArrow">›</span>
     </button>)}
     {!results.length&&<div className="calendarNoEntries"><strong>검색 결과 없음</strong></div>}
   </section>:<>
     <section className="calendarPanel">
       <div className="calendarHeader">
         <div><span className="calendarEyebrow">MY LIFE LOG</span><h2>캘린더</h2></div>
         <button type="button" className="calendarToday" onClick={returnToday}>오늘</button>
       </div>
       <div className="calendarMonthNav">
         <strong>{month.year}년 {month.month+1}월</strong>
         <div className="calendarArrows"><button type="button" onClick={()=>navigate(-1)} aria-label="이전 달">‹</button><button type="button" onClick={()=>navigate(1)} aria-label="다음 달">›</button></div>
       </div>
       <div className="calendarGrid" role="group" aria-label="월간 캘린더">
         {weekDays.map((day,i)=><div key={day} className={'calendarWeekday '+(i===0?'sunday':'')}>{day}</div>)}
         {days.map((key,i)=>key?
           <button type="button" key={key} aria-label={`${key} 선택`} aria-pressed={selected===key} className={'calendarDay '+(selected===key?'chosen ':'')+(key===koreaToday()?'today ':'')+(i%7===0?'sunday':'')} onClick={()=>setSelected(key)}>
             <span>{Number(key.slice(-2))}</span>
             <span className="calendarDots" aria-hidden="true">
               {counts[key]?.has('event')&&<i className="calendarDot eventDot"/>}
               {counts[key]?.has('task')&&<i className="calendarDot taskDot"/>}
               {counts[key]?.has('news')&&<i className="calendarDot newsDot"/>}
               {counts[key]?.has('point')&&<i className="calendarDot pointDot"/>}
             </span>
           </button>:<div key={'empty-'+i} className="calendarEmpty"/>)}
       </div>
       <div className="calendarLegend"><span><i className="calendarDot eventDot"/>일정</span><span><i className="calendarDot taskDot"/>할 일</span><span><i className="calendarDot newsDot"/>뉴스</span><span><i className="calendarDot pointDot"/>포인트</span></div>
     </section>
     <section className="calendarAgenda">
       <div className="calendarAgendaHeading"><div><h2>{selectedDate.getMonth()+1}월 {selectedDate.getDate()}일 {weekDays[selectedDate.getDay()]}요일</h2><span>선택한 날짜의 기록</span></div><strong>{dateEntries.length}건</strong></div>
       {dateEntries.length?dateEntries.map(renderEntry):<div className="calendarNoEntries"><strong>기록 없음</strong></div>}
     </section>
   </>}
   <p className="calendarDemoNote">🧪 가상 데이터로 뉴스·일정·포인트 변동을 검색하고 날짜별로 확인할 수 있어. 실제 데이터 저장은 아직 연결되지 않았어.</p>
 </main>
}
