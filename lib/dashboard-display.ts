type Metadata=Record<string,unknown>;
type RecordLike={metadata:Metadata;event_date?:string|null;description?:string|null;amount?:number|null;status?:string};
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():null;
const number=(value:unknown):number|null=>{
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value!=='string'||!value.trim())return null;
 const normalized=value.trim().replace(/,/g,'').replace(/^[−]/,'-');
 return /^[-+]?\d+(?:\.\d+)?$/.test(normalized)&&Number.isFinite(Number(normalized))?Number(normalized):null;
};
const firstText=(metadata:Metadata,keys:string[])=>keys.map(key=>text(metadata[key])).find(Boolean)??null;
const firstNumber=(metadata:Metadata,keys:string[])=>keys.map(key=>number(metadata[key])).find(value=>value!==null)??null;
const part=(parts:Intl.DateTimeFormatPart[],name:string)=>parts.find(p=>p.type===name)?.value??'';
export const dashboardTimestamp=(value:unknown):string|null=>{
 if(typeof value!=='string'||!value)return null;
 const parsed=new Date(value);
 if(Number.isNaN(parsed.valueOf()))return null;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(parsed);
 return part(parts,'year')+'.'+part(parts,'month')+'.'+part(parts,'day')+' '+part(parts,'hour')+':'+part(parts,'minute');
};
const dateLabel=(value:unknown):string|null=>{
 const raw=text(value);if(!raw)return null;
 if(/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(raw)&&/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw))return dashboardTimestamp(raw.replace(' ','T'));
 const match=raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/);
 if(!match)return null;
 const [,y,m,d,h,min]=match;
 const month=Number(m),day=Number(d);
 if(month<1||month>12||day<1||day>new Date(Number(y),month,0).getDate())return null;
 const date=y+'.'+m.padStart(2,'0')+'.'+d.padStart(2,'0');
 return h!==undefined&&Number(h)<24&&Number(min)<60?date+' '+h.padStart(2,'0')+':'+min:date;
};
const firstDate=(metadata:Metadata,keys:string[])=>{
 for(const key of keys){
   const value=metadata[key];
   const direct=dateLabel(value);if(direct)return direct;
   if(value&&typeof value==='object'&&!Array.isArray(value)){
     const entry=value as Metadata;
     for(const sub of ['date','paid_at','approved_at','datetime','at','timestamp']){
       const nested=dateLabel(entry[sub]);if(nested)return nested;
     }
   }
 }
 return null;
};
const labeledDate=(description:string|null|undefined,pattern:RegExp)=>{
 const match=description?.match(pattern);
 return match?.[1]?dateLabel(match[1]):null;
};
const LAST_KEYS=['last_payment_at','last_paid_at','last_payment_date','last_paid_date','last_payment_datetime','last_billing_date','last_billing_at','last_billed_at','last_billed_date','last_charge_date','last_charge_at','last_payment','last_billing','last_paid','final_payment_date','final_paid_at','마지막_결제일','마지막 결제일'];
const NEXT_KEYS=['next_payment_date','next_payment_at','next_billing_date','next_billing_at','next_charge_date','next_renewal_date','next_payment','renewal_date','renewal_at'];
const PAYMENT_KEYS=['billing_date','payment_date','payment_at','paid_at','charge_date','결제일'];
export const subscriptionDisplay=(record:RecordLike)=>{
 const m=record.metadata;
 const stated=firstText(m,['subscription_status','status','billing_status'])?.toLowerCase();
 const active=record.status==='active'&&m.is_active!==false&&!['paused','stopped','cancelled','canceled','inactive','archived','중지','해지','구독 중지'].includes(stated??'');
 const plan=firstText(m,['plan','plan_name','subscription_plan','tier']);
 let recurringDay:number|null=null;
 for(const key of ['billing_day','payment_day','charge_day','renewal_day','결제일']){
   const raw=m[key];
   const day=number(raw)??(typeof raw==='string'?number(raw.trim().match(/^(?:매월\s*)?(\d{1,2})일?$/)?.[1]):null);
   if(day!==null&&Number.isInteger(day)&&day>=1&&day<=31){recurringDay=day;break;}
 }
 const next=firstDate(m,NEXT_KEYS);
 const billing=firstDate(m,PAYMENT_KEYS)??labeledDate(record.description,/결제일(?:자)?\s*[:：]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
 const last=firstDate(m,LAST_KEYS)??labeledDate(record.description,/(?:마지막|최종|최근)\s*결제(?:일자|일시|일)?\s*[:：]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2})?)/);
 const rows:{label:string;value:string}[]=[];
 if(active){
   if(recurringDay!==null)rows.push({label:'결제일',value:'매월 '+recurringDay+'일'});
   else if(billing)rows.push({label:'결제일',value:billing});
   if(next&&next!==billing)rows.push({label:'다음 결제',value:next});
   if(!rows.length)rows.push({label:'결제일',value:'미등록'});
 }else{
   // Do not substitute a next payment or a regular billing day for the last payment.
   rows.push({label:'마지막 결제',value:last??firstDate(m,['last_transaction_date','last_transaction_at','paid_at','payment_at','payment_date'])??'미등록'});
 }
 return {active,plan,rows};
};
const listTexts=(value:unknown):string[]=>Array.isArray(value)?value.flatMap(listTexts):typeof value==='string'&&value.trim()?[value.trim()]:[];
const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
const getEventDate=(event:Metadata)=>{
 const date=event.event_date??event.date??event.occurred_at??event.created_at;
 return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}/.test(date)?date.slice(0,10):null;
};
export const pointEventAmount=(event:Metadata):number|null=>{
 const value=number(event.delta??event.amount??event.points??event.point_amount);
 if(value===null)return null;
 const direction=firstText(event,['direction','type','action','kind','change_type'])?.toLowerCase()??'';
 if(value>0&&['down','decrease','deduction','deduct','debit','spent','use','used','negative','차감','감소','사용'].includes(direction))return -value;
 return value;
};
export const pointToday=()=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return [part(parts,'year'),part(parts,'month'),part(parts,'day')].join('-');};
const snapshotDate=(record:RecordLike)=>firstText(record.metadata,['change_date','snapshot_date','as_of_date'])?.slice(0,10)??record.event_date?.slice(0,10)??null;
const pointEvents=(record:RecordLike,date?:string)=>{
 const raw=[record.metadata.change_events,record.metadata.point_changes,record.metadata.changes].find(Array.isArray);
 if(!Array.isArray(raw))return [] as Metadata[];
 const events=raw.filter((value):value is Metadata=>!!value&&typeof value==='object'&&!Array.isArray(value));
 const snapshot=snapshotDate(record);
 const target=date??snapshot??events.map(getEventDate).filter((v):v is string=>!!v).sort().at(-1);
 return events.filter(event=>getEventDate(event)===target||(!getEventDate(event)&&snapshot===target));
};
type DirectionInfo={amount:number|null;reasons:string[];present:boolean};
export const pointChangeDisplay=(record:RecordLike,date?:string):{up:DirectionInfo;down:DirectionInfo}=>{
 const m=record.metadata;
 // Dated event logs are authoritative; never relabel a past event as today's summary.
 const rawEvents=[m.change_events,m.point_changes,m.changes].find(Array.isArray);
 const hasDatedEvents=Array.isArray(rawEvents)&&rawEvents.some(value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!getEventDate(value as Metadata));
 const includeSummary=!date||(snapshotDate(record)===date&&!hasDatedEvents);
 const empty={amount:null,reasons:[] as string[],present:false};
 const events=pointEvents(record,date).filter(event=>!date||getEventDate(event)===date);
 if(!includeSummary&&!events.length)return {up:empty,down:empty};
 const upReasons=['increase_reason','earning_reason','earned_reason','positive_reason','increase_reasons','earning_reasons','적립사유','증가 사유'].flatMap(key=>includeSummary?listTexts(m[key]):[]);
 const downReasons=['decrease_reason','deduction_reason','usage_reason','spending_reason','negative_reason','decrease_reasons','deduction_reasons','차감사유','감소 사유'].flatMap(key=>includeSummary?listTexts(m[key]):[]);
 const upValues:number[]=[],downValues:number[]=[];
 for(const event of events){
   const amount=pointEventAmount(event);if(amount===null||amount===0)continue;
   const reason=firstText(event,['reason','description','title','name']);
   if(amount>0){upValues.push(amount);if(reason)upReasons.push(reason);}
   else{downValues.push(-amount);if(reason)downReasons.push(reason);}
 }
 let upAmount=includeSummary?firstNumber(m,['increase_amount','earned_amount','earning_amount','positive_delta','point_increase','points_added','earned_points','increase_points','total_earned']):null;
 let downAmount=includeSummary?firstNumber(m,['decrease_amount','deducted_amount','deduction_amount','used_amount','negative_delta','point_decrease','points_used','used_points','decrease_points','total_used']):null;
 const general=['change_reason','reason','point_change_reason','change_description','change_details'].flatMap(key=>includeSummary?listTexts(m[key]):[]);
 // A provider can send two signed explanation lines instead of separate reason keys.
 const signed=[...general,...(includeSummary?listTexts(record.description):[])].flatMap(line=>line.split(/\r?\n|;\s*/));
 const generalOnly:string[]=[];
 let signedUp=0,signedDown=0;
 for(const line of signed){
   const raw=line.trim();if(!raw)continue;
   const prefix=raw.match(/^([+＋\-−])\s*([\d,]+(?:\.\d+)?)?\s*(?:포인트|원|[Pp])?\s*[:：·]?\s*(.*)$/);
   if(prefix){
     const amount=number(prefix[2]);const reason=prefix[3].trim();
     if(prefix[1]==='+'||prefix[1]==='＋'){if(amount!==null)signedUp+=Math.abs(amount);if(reason)upReasons.push(reason);}
     else{if(amount!==null)signedDown+=Math.abs(amount);if(reason)downReasons.push(reason);}
     continue;
   }
   const named=raw.match(/^(증가|적립|감소|차감|사용)(?:\s*사유)?\s*[:：]\s*(.*)$/);
   if(named){if(['증가','적립'].includes(named[1]))upReasons.push(named[2]);else downReasons.push(named[2]);continue;}
   if(general.includes(raw))generalOnly.push(raw);
 }
 if(upAmount===null)upAmount=upValues.length?upValues.reduce((a,b)=>a+b,0):signedUp||null;
 if(downAmount===null)downAmount=downValues.length?downValues.reduce((a,b)=>a+b,0):signedDown||null;
 if(upAmount!==null)upAmount=Math.abs(upAmount);
 if(downAmount!==null)downAmount=Math.abs(downAmount);
 const previous=number(m.previous_balance),current=number(record.amount);
 const delta=!includeSummary||previous===null||current===null?null:current-previous;
 if(delta!==null&&delta>0&&!upReasons.length)upReasons.push(...generalOnly);
 if(delta!==null&&delta<0&&!downReasons.length)downReasons.push(...generalOnly);
 // Some providers embed an old date in their free-text reason (e.g. 11/11).
 // Exclude those lines rather than displaying them under today's heading.
 const isCurrentReason=(reason:string)=>{
   if(!date)return true;
   const [year,month,day]=date.split('-').map(Number);
   const dates=[...reason.matchAll(/(?:\b(\d{4})[-/.]\s*)?\b(\d{1,2})[-/.]\s*(\d{1,2})(?!\d)/g)];
   return dates.every(match=>(!match[1]||Number(match[1])===year)&&Number(match[2])===month&&Number(match[3])===day);
 };
 const up=unique(upReasons.filter(isCurrentReason)),down=unique(downReasons.filter(isCurrentReason));
 const staleUp=!!date&&upReasons.length>0&&!up.length&&!upValues.length;
 const staleDown=!!date&&downReasons.length>0&&!down.length&&!downValues.length;
 return {
   up:staleUp?empty:{amount:upAmount,reasons:up,present:up.length>0||(upAmount??0)>0||(delta??0)>0},
   down:staleDown?empty:{amount:downAmount,reasons:down,present:down.length>0||(downAmount??0)>0||(delta??0)<0}
 };
};
