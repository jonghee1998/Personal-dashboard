import {timingSafeEqual} from 'node:crypto';

// Shared Bearer token check for collector (Pickle) APIs. Pure module: no next/* imports.
export type CollectorAuthFailure='server_secret_missing'|'server_secret_short'|'no_bearer'|'mismatch';
export type CollectorAuthResult={ok:true}|{ok:false;reason:CollectorAuthFailure};

const reasons:readonly string[]=['server_secret_missing','server_secret_short','no_bearer','mismatch'];
const routePattern=/^\/api\/[a-z\/-]{1,60}$/;

export function checkCollectorToken(authorization:string|null,secret:string|undefined):CollectorAuthResult{
 if(!secret)return {ok:false,reason:'server_secret_missing'};
 if(secret.length<32)return {ok:false,reason:'server_secret_short'};
 if(authorization===null||!authorization.startsWith('Bearer '))return {ok:false,reason:'no_bearer'};
 const a=Buffer.from(authorization.slice(7)),b=Buffer.from(secret);
 if(a.length!==b.length||!timingSafeEqual(a,b))return {ok:false,reason:'mismatch'};
 return {ok:true};
}

// One JSON line for server logs. Never includes header values, secrets, or lengths.
export function collectorAuthFailureLog(route:string,reason:string):string{
 return JSON.stringify({
  event:'collector_auth_failed',
  route:routePattern.test(route)?route:'invalid',
  reason:reasons.includes(reason)?reason:'invalid'
 });
}
