// A failed read is not an empty successful snapshot. Never substitute synthetic zero values.
export const monitoredSources=[
 {key:'transactions',dataset:'transactions',source:'samsungcard',label:'삼성카드 거래'},
 {key:'samsungPoints',dataset:'points',source:'samsungcard',label:'삼성카드 포인트'},
 {key:'naverPoints',dataset:'points',source:'naverpay',label:'네이버페이 포인트'},
 {key:'news',dataset:'news',source:'news_rss',label:'뉴스'}
] as const;
export type SyncHealth={state:'current'|'delayed'|'failed'|'unknown';last_source_at:string|null;last_attempt_at:string|null;last_status:string|null};
type Attempt={status:string;received_at:string;source_as_of?:string|null};
const validTime=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function seoulDay(value:string|Date):string|null{
 const date=new Date(value);if(!Number.isFinite(date.valueOf()))return null;
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const part=(type:string)=>parts.find(p=>p.type===type)?.value??'';
 return part('year')+'-'+part('month')+'-'+part('day');
}
export function sourceHealth(lastSource:unknown,attempt:Attempt|null,now=new Date()):SyncHealth{
 const source=validTime(lastSource)&&Date.parse(lastSource)<=now.valueOf()+300000?lastSource:null;
 const lastAttempt=validTime(attempt?.received_at)?attempt.received_at:null;
 const status=attempt?.status??null;
 // A failed/partial attempt is not a publication. Preserve existing source timestamp.
 const failed=!!lastAttempt&&['failed','partial','quarantined'].includes(status??'');
 const state=failed?'failed':!source?'unknown':seoulDay(source)===seoulDay(now)?'current':'delayed';
 return {state,last_source_at:source,last_attempt_at:lastAttempt,last_status:status};
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const timestampMap=(v:unknown)=>object(v)&&Object.values(v).every(x=>x===null||validTime(x));
export function isDashboardSnapshot(v:unknown):v is {items:any[];updates:Record<string,string|null>;sourceUpdates:Record<string,string|null>;syncHealth:Record<string,SyncHealth>}{
 if(!object(v)||!Array.isArray(v.items)||!timestampMap(v.updates)||!timestampMap(v.sourceUpdates)||!object(v.syncHealth))return false;
 const kinds=['transaction','settlement','news','benefit','task','event','journal'];
 if(!v.items.every(x=>object(x)&&typeof x.id==='string'&&typeof x.title==='string'&&typeof x.kind==='string'&&kinds.includes(x.kind)&&typeof x.status==='string'&&object(x.metadata)))return false;
 return monitoredSources.every(({key})=>{const h=(v.syncHealth as Record<string,unknown>)[key];return object(h)&&['current','delayed','failed','unknown'].includes(String(h.state))&&(h.last_source_at===null||validTime(h.last_source_at))&&(h.last_attempt_at===null||validTime(h.last_attempt_at))&&(h.last_status===null||typeof h.last_status==='string');});
}
export function registeredCoverageDay(sourceAt:string|null,dates:(string|null|undefined)[],now=new Date()){
 const today=seoulDay(now)!;
 const source=sourceAt?seoulDay(sourceAt):null;
 const registered=dates.filter((d):d is string=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=today);
 // Do not conceal already registered transactions even if their source has no provenance.
 return [source&&source<=today?source:null,...registered].filter((d):d is string=>!!d).sort().at(-1)??null;
}
