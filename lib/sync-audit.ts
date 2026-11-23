export const datasets=['transactions','settlements','news','points','applications','subscriptions','tasks','events','journal'] as const;
export type Dataset=typeof datasets[number];
export const datasetFor=(row:{kind:string;category?:string|null}):Dataset|null=>{
 switch(row.kind){
 case 'transaction':return 'transactions';
 case 'settlement':return 'settlements';
 case 'news':return 'news';
 case 'task':return 'tasks';
 case 'event':return 'events';
 case 'journal':return 'journal';
 case 'benefit':return row.category==='points'?'points':row.category==='ai_subscription'?'subscriptions':'applications';
 default:return null;
 }
};
export function latestSourceTime(rows:{metadata?:Record<string,unknown>|null}[]){
 const values=rows.map(row=>row.metadata?.as_of).filter((v):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v)));
 return values.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
}
