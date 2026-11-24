// Decision for /api/backfill/stage when the batch insert fails. Pure module: no next/* imports.
export type StageWriteResolution={ok:true;data:unknown}|{ok:false;stage:'existing_lookup'|'write';err:unknown};

// 23505 (same plan already staged): look the existing batch up once and return it.
// Any other write error, or a failed lookup, is a failure. A throwing lookup propagates.
export async function resolveStageWriteError(writeError:{code?:unknown},lookupExisting:()=>PromiseLike<{data:unknown;error:unknown}>):Promise<StageWriteResolution>{
 if(writeError.code!=='23505')return {ok:false,stage:'write',err:writeError};
 const existing=await lookupExisting();
 if(!existing.error)return {ok:true,data:existing.data};
 return {ok:false,stage:'existing_lookup',err:existing.error};
}

export async function stageWriteOutcome(writeError:{code?:unknown},lookupExisting:()=>PromiseLike<{data:unknown;error:unknown}>):Promise<{status:200|503;body:object;log:null|{stage:string;err:unknown}}>{
 const r=await resolveStageWriteError(writeError,lookupExisting);
 if(r.ok)return {status:200,body:{batch:r.data,applied_count:0},log:null};
 return {status:503,body:{error:'Stage unavailable'},log:{stage:r.stage,err:r.err}};
}
