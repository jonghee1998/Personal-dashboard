// Server log line for collector API 5xx failures. Pure module: no next/* imports.
// Only fixed allow-listed codes are emitted; message/details/hint/stack/cause are never read.
const allowedCodes:ReadonlySet<string>=new Set([
 // PostgREST
 'PGRST000','PGRST001','PGRST002','PGRST003','PGRST100','PGRST102','PGRST116','PGRST200','PGRST204','PGRST205','PGRST301','PGRST302','PGRST303',
 // Postgres SQLSTATE
 '08001','08006','22P02','23502','23503','23505','23514','28P01','40001','40P01','42501','42703','42883','42P01','53300','57014','57P01','XX000'
]);
const allowedErrorNames:ReadonlySet<string>=new Set(['TypeError','Error','SyntaxError','RangeError','AbortError','TimeoutError']);
const routePattern=/^\/api\/[a-z\/-]{1,60}$/;
const stagePattern=/^[a-z_]{1,40}$/;

function failureCode(err:unknown):string{
 if(err===undefined||err===null)return 'none';
 try{
  if(typeof err!=='object'&&typeof err!=='function')return 'unknown';
  const code=(err as {code?:unknown}).code;
  if(typeof code==='string'&&allowedCodes.has(code))return code;
  if(err instanceof Error){
   const name=err.name;
   if(typeof name==='string'&&allowedErrorNames.has(name))return name;
  }
  return 'unknown';
 }catch{return 'unknown';}
}

export function apiFailureLog(route:string,stage:string,err?:unknown):string{
 let r='invalid',s='invalid';
 try{if(typeof route==='string'&&routePattern.test(route))r=route;}catch{}
 try{if(typeof stage==='string'&&stagePattern.test(stage))s=stage;}catch{}
 return JSON.stringify({event:'api_failure',route:r,stage:s,code:failureCode(err)});
}

export function logApiFailure(route:string,stage:string,err?:unknown):void{
 try{console.error(apiFailureLog(route,stage,err));}catch{}
}
