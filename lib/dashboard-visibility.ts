type VisibleRecord={kind:string;category?:string|null;status?:string|null;title?:string|null;source?:string|null;metadata?:Record<string,unknown>|null};
export const stoppedStatuses=['paused','stopped','cancelled','canceled','inactive'] as const;
const invalidLabels=new Set(['archived','deleted','보관','보관된 이전 레코드','더미','미등록','undefined','null']);
const clean=(value:unknown)=>typeof value==='string'?value.trim():'';
export const validLabel=(value:unknown)=>{const label=clean(value);return !!label&&!invalidLabels.has(label.toLowerCase());};
export const pointProvider=(row:VisibleRecord)=>[row.metadata?.provider,row.source,row.title].map(clean).find(validLabel)??null;
export const visibleDashboardItem=(row:VisibleRecord)=>{
 if(row.status==='deleted'||row.status==='archived'||row.metadata?.dashboard_deleted===true)return false;
 if(row.kind==='benefit'&&row.category==='points')return !!pointProvider(row);
 if(row.kind==='benefit'&&row.category==='archived_history')return false;
 return true;
};
export const normalizeIncomingStatus=(status:string,metadata:Record<string,unknown>,isSubscription:boolean)=>{
 if(status==='archived'||status==='deleted')return {status:'archived',metadata:{...metadata,dashboard_deleted:true}};
 if(isSubscription&&(stoppedStatuses as readonly string[]).includes(status))return {status:'active',metadata:{...metadata,subscription_status:status,dashboard_deleted:false}};
 return {status,metadata:{...metadata,dashboard_deleted:false}};
};
