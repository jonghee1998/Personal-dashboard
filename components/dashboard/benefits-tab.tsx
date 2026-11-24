import type {Item} from './use-dashboard-data';
import {amountKnown,money} from './dashboard-display';
import {pointProvider} from '@/lib/dashboard-visibility';
import {pointChangeDisplay,pointToday} from '@/lib/dashboard-display';

type Props={items:Item[];updateLabel:(key:string)=>string};

export default function BenefitsTab({items,updateLabel}:Props){
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
 const displayDelta=(delta:number)=>(delta>0?'+':delta<0?'−':'±')+money(Math.abs(delta));
 return <main>
  <section className="panel">
    <div className="sectionTitle"><h2>보유 포인트</h2><div className="sectionUpdateMeta"><span>출처별 현황</span><small>{updateLabel('points')}</small></div></div>
    <div className="pointOverview"><div className="eyebrow">총 보유 포인트</div><strong>{pointAmountsKnown?money(pointsToday):'미확인'}</strong>
      <small className={pointsYesterdayKnown?(pointDelta>0?'deltaUp':pointDelta<0?'deltaDown':'deltaFlat'):'deltaFlat'}>
        {pointsYesterdayKnown?'어제 대비 '+displayDelta(pointDelta):'어제 잔액 데이터 없음'}
      </small>
    </div>
    <div className="pointProviderHeading"><span>적립처</span><span>현재 잔액 / 전일 대비</span></div>
    {pointGroups.map(([provider,entry])=><div className="pointProvider" key={provider}>
      <div className="itembody pointProviderIdentity"><b>{provider}</b></div>
      <div className="pointAmounts"><strong>{entry.hasCurrent?money(entry.current):'미확인'}</strong><small className={entry.hasPrevious?(entry.current>entry.previous?'deltaUp':entry.current<entry.previous?'deltaDown':'deltaFlat'):'deltaFlat'}>{entry.hasCurrent&&entry.hasPrevious?displayDelta(entry.current-entry.previous):'전일 데이터 없음'}</small></div>
      {(entry.upPresent||entry.downPresent)&&<div className="pointReasonLines"><small className="pointLogDate">{pointLogDate.replace(/-/g,'.')}</small>
        {entry.upPresent&&<div className="pointReasonLine pointIncreaseReason"><span className="pointReasonValue">{entry.upAmountKnown?displayDelta(entry.upAmount):'+ 증가'}</span><span className="pointReasonText">{entry.upReasons.length?entry.upReasons.join(' · '):'사유 미등록'}</span></div>}
        {entry.downPresent&&<div className="pointReasonLine pointDecreaseReason"><span className="pointReasonValue">{entry.downAmountKnown?displayDelta(-entry.downAmount):'− 감소'}</span><span className="pointReasonText">{entry.downReasons.length?entry.downReasons.join(' · '):'사유 미등록'}</span></div>}
      </div>}
    </div>)}
    {!pointGroups.length&&<p className="empty">포인트 내역 없음</p>}
  </section>
  <section className="panel">
    <div className="sectionTitle"><h2>혜택 신청 현황</h2><div className="sectionUpdateMeta"><span>{applications.length}건</span><small>{updateLabel('applications')}</small></div></div>
    <div className="applicationCounts">
      <div><strong>{applications.filter(x=>applicationStatus(x)==='대기 중').length}</strong><span>대기 중</span></div>
      <div><strong>{applications.filter(x=>applicationStatus(x)==='합격').length}</strong><span>합격</span></div>
      <div><strong>{applications.filter(x=>applicationStatus(x)==='불합격').length}</strong><span>불합격</span></div>
    </div>
    <div className="applicationsScroll" role="region" aria-label="혜택 신청 내역 가로 스크롤 표" tabIndex={0}>
      <table className="applicationsTable">
        <thead><tr><th scope="col">결과</th><th scope="col">신청 항목</th><th scope="col">신청처</th><th scope="col">신청일</th><th scope="col">발표일</th></tr></thead>
        <tbody>{sortedApplications.map(x=><tr key={x.id}>
          <td><span className={'applicationStatus '+(applicationStatus(x)==='합격'?'statusAccepted':applicationStatus(x)==='불합격'?'statusRejected':'statusPending')}>{applicationStatus(x)}</span></td>
          <td><b>{x.title}</b></td>
          <td>{typeof x.metadata.provider==='string'?x.metadata.provider:(x.source??'미등록')}</td>
          <td>{typeof x.metadata.applied_at==='string'?x.metadata.applied_at:(x.event_date??'미등록')}</td>
          <td>{typeof x.metadata.announcement_date==='string'?x.metadata.announcement_date:(x.due_date??'미정')}</td>

        </tr>)}</tbody>
      </table>
    </div>
    {!applications.length&&<p className="empty">신청 내역 없음</p>}
  </section>
</main>;
}
