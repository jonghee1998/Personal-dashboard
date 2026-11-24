import type {Item,useDashboardData} from './use-dashboard-data';
import JournalCalendar from './journal-calendar';
import {pointProvider} from '@/lib/dashboard-visibility';
import {pointChangeDisplay,pointEventAmount} from '@/lib/dashboard-display';

type Props={
 items:Item[];
 change:ReturnType<typeof useDashboardData>['change'];
 openNews:(id:string)=>void;
};

export default function JournalTab({items,change,openNews}:Props){
 const pointEntries=items.filter(x=>x.kind==='benefit'&&x.category==='points');
 const asNumber=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
 const pointReasons=(x:Item,direction:'up'|'down')=>pointChangeDisplay(x)[direction].reasons;
 const pointHistory=pointEntries.flatMap(x=>{
   const provider=pointProvider(x);if(!provider)return [];
   const events=x.metadata.change_events;
   const dated=Array.isArray(events)?events.flatMap((value,index)=>{
     if(!value||typeof value!=='object'||Array.isArray(value))return [] as Array<{id:string;kind:'point';title:string;description:string;status:string;event_date:string;due_date:null;category:string;source:string;amount:number;metadata:Record<string,unknown>}>;
     const event=value as Record<string,unknown>;
     const amount=pointEventAmount(event);
     const rawDate=event.event_date??event.date??event.occurred_at;
     const date=typeof rawDate==='string'?rawDate.slice(0,10):null;
     if(amount===null||amount===0||!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return [];
     return [{id:x.id+'-point-'+index,kind:'point' as const,title:provider,description:typeof event.reason==='string'&&event.reason.trim()?event.reason.trim():'사유 데이터 미등록',status:'active',event_date:date,due_date:null,category:amount>0?'적립':'차감',source:provider,amount,metadata:{}}];
   }):[];
   if(dated.length)return dated;
   const previous=asNumber(x.metadata.previous_balance);
   const current=asNumber(x.amount);
   const delta=previous===null||current===null?null:current-previous;
   if(delta===null||delta===0||!x.event_date)return [];
   const reasons=pointReasons(x,delta>0?'up':'down');
   return [{id:x.id+'-point-net',kind:'point' as const,title:provider,description:reasons.length?reasons.join(' · '):'사유 데이터 미등록',status:'active',event_date:x.event_date,due_date:null,category:delta>0?'순증가':'순감소',source:provider,amount:delta,metadata:{}}];
 });
  return <JournalCalendar entries={[...items.filter(x=>x.kind==='event'||(x.kind==='task'&&x.status!=='archived')||x.kind==='news') as Array<Item & {kind:'event'|'task'|'news'}>,...pointHistory]} onToggleTask={x=>{const item=items.find(y=>y.id===x.id);if(item)void change(item,item.status==='done'?'pending':'done')}} onOpenNews={openNews}/>;
}
