import type {Item} from './use-dashboard-data';
import {amountKnown} from './dashboard-display';
import {pointProvider} from '@/lib/dashboard-visibility';
import {pointChangeDisplay,pointToday} from '@/lib/dashboard-display';

type Props={items:Item[];updateLabel:(key:string)=>string;openProviders:readonly string[];toggleProvider:(name:string)=>void};

export default function BenefitsTab({items,updateLabel,openProviders,toggleProvider}:Props){
 const benefits=items.filter(x=>x.kind==='benefit');
 const pointEntries=benefits.filter(x=>x.category==='points');
 const pointLogDate=pointToday();
 const asNumber=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
 type PointGroup={hasCurrent:boolean;current:number;previous:number;hasPrevious:boolean;upReasons:string[];downReasons:string[];upAmount:number;downAmount:number;upAmountKnown:boolean;downAmountKnown:boolean;upPresent:boolean;downPresent:boolean};
 const pointGroups=Object.entries(pointEntries.reduce<Record<string,PointGroup>>((acc,x)=>{
   const provider=pointProvider(x);if(!provider)return acc;
   if(!acc[provider])acc[provider]={hasCurrent:true,current:0,previous:0,hasPrevious:true,upReasons:[],downReasons:[],upAmount:0,downAmount:0,upAmountKnown:false,downAmountKnown:false,upPresent:false,downPresent:false};
   const entry=acc[provider];
   if(amountKnown(x.amount))entry.current+=Number(x.amount);else entry.hasCurrent=false;
   const previous=asNumber(x.metadata.previous_balance);
   if(previous!==null)entry.previous+=previous;else entry.hasPrevious=false;
   const {up,down}=pointChangeDisplay(x,pointLogDate);
   entry.upPresent=entry.upPresent||up.present;entry.downPresent=entry.downPresent||down.present;
   if(up.amount!==null){entry.upAmount+=up.amount;entry.upAmountKnown=true;}
   if(down.amount!==null){entry.downAmount+=down.amount;entry.downAmountKnown=true;}
   for(const reason of up.reasons)if(!entry.upReasons.includes(reason))entry.upReasons.push(reason);
   for(const reason of down.reasons)if(!entry.downReasons.includes(reason))entry.downReasons.push(reason);
   return acc;
 },{})).sort((a,b)=>b[1].current-a[1].current);
 const pointAmountsKnown=pointGroups.length>0&&pointGroups.every(([,entry])=>entry.hasCurrent);
 const pointsToday=pointGroups.reduce((sum,[,entry])=>sum+entry.current,0);
 const pointsYesterdayKnown=pointAmountsKnown&&pointGroups.every(([,entry])=>entry.hasPrevious);
 const pointsYesterday=pointGroups.reduce((sum,[,entry])=>sum+entry.previous,0);
 const pointDelta=pointsToday-pointsYesterday;
 const applications=benefits.filter(x=>x.category!=='points'&&x.category!=='ai_subscription');
 const applicationStatus=(x:Item)=>{
   const outcome=typeof x.metadata.application_status==='string'?x.metadata.application_status:x.status;
   return ['accepted','approved','won','selected'].includes(outcome)?'합격':['rejected','failed','lost'].includes(outcome)?'불합격':'대기 중';
 };
 const sortedApplications=[...applications].sort((a,b)=>((b.metadata.applied_at as string|undefined)??b.event_date??'').localeCompare(((a.metadata.applied_at as string|undefined)??a.event_date??'')));
 const points=(n:number)=>Math.round(n).toLocaleString('ko-KR')+'P';
 const signed=(delta:number)=>(delta>0?'+':delta<0?'−':'±')+points(Math.abs(delta));
 const count=(label:string)=>applications.filter(x=>applicationStatus(x)===label).length;
 const badgeClass=(x:Item)=>applicationStatus(x)==='합격'?'statusAccepted':applicationStatus(x)==='불합격'?'statusRejected':'statusPending';
 return <main>
  <section className="panel pointsPanel">
    <div className="sectionTitle"><h2>보유 포인트</h2><div className="sectionUpdateMeta"><small>{updateLabel('points')}</small></div></div>
    <div className="pointSummary">
      <strong className="pointSummaryTotal">{pointAmountsKnown?points(pointsToday):'미확인'}</strong>
      <small className={'pointSummaryDelta '+(pointsYesterdayKnown?(pointDelta>0?'deltaUp':pointDelta<0?'deltaDown':'deltaFlat'):'deltaFlat')}>
        {pointsYesterdayKnown?'(어제보다 '+signed(pointDelta)+')':'(어제 잔액 데이터 없음)'}
      </small>
    </div>
    {pointGroups.map(([provider,entry],index)=>{
      const expandable=entry.upPresent||entry.downPresent;
      const open=expandable&&openProviders.includes(provider);
      const panelId='point-detail-'+index;
      const head=<>
        <span className="pointRowName">{provider}</span>
        <span className="pointRowAmounts"><strong>{entry.hasCurrent?points(entry.current):'미확인'}</strong><small className={entry.hasPrevious?(entry.current>entry.previous?'deltaUp':entry.current<entry.previous?'deltaDown':'deltaFlat'):'deltaFlat'}>{entry.hasCurrent&&entry.hasPrevious?signed(entry.current-entry.previous):'전일 데이터 없음'}</small></span>
        {expandable&&<svg className="pointRowChevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>}
      </>;
      return <div className="pointRow" key={provider}>
        {expandable
          ?<button type="button" className="pointRowHead" aria-expanded={open} aria-controls={panelId} onClick={()=>toggleProvider(provider)}>{head}</button>
          :<div className="pointRowHead">{head}</div>}
        {open&&<div className="pointDetail" id={panelId}>
          <small className="pointLogDate">{pointLogDate.replace(/-/g,'.')}</small>
          {entry.upPresent&&<div className="pointReasonLine pointIncreaseReason"><strong className="pointReasonValue">{entry.upAmountKnown?signed(entry.upAmount):'+ 증가'}</strong><span className="pointReasonText">{entry.upReasons.length?entry.upReasons.join(' · '):'사유 미등록'}</span></div>}
          {entry.downPresent&&<div className="pointReasonLine pointDecreaseReason"><strong className="pointReasonValue">{entry.downAmountKnown?signed(-entry.downAmount):'− 감소'}</strong><span className="pointReasonText">{entry.downReasons.length?entry.downReasons.join(' · '):'사유 미등록'}</span></div>}
        </div>}
      </div>;
    })}
    {!pointGroups.length&&<p className="empty">포인트 내역 없음</p>}
  </section>
  <section className="panel applicationsPanel">
    <div className="sectionTitle"><h2>혜택 신청 현황</h2><div className="sectionUpdateMeta"><span>{applications.length}건</span><small>{updateLabel('applications')}</small></div></div>
    <div className="applicationCounts">
      <div><strong>{count('대기 중')}</strong><span>대기</span></div>
      <div><strong>{count('합격')}</strong><span>합격</span></div>
      <div><strong>{count('불합격')}</strong><span>불합격</span></div>
    </div>
    <ul className="applicationList">{sortedApplications.map(x=><li key={x.id} className="applicationItem">
      <div className="applicationInfo"><b>{x.title}</b><small>{typeof x.metadata.provider==='string'?x.metadata.provider:(x.source??'미등록')} · 신청 {typeof x.metadata.applied_at==='string'?x.metadata.applied_at:(x.event_date??'미등록')} · 발표 {typeof x.metadata.announcement_date==='string'?x.metadata.announcement_date:(x.due_date??'미정')}</small></div>
      <span className={'applicationStatus '+badgeClass(x)}>{applicationStatus(x)}</span>
    </li>)}</ul>
    {!applications.length&&<p className="empty">신청 내역 없음</p>}
  </section>
</main>;
}
