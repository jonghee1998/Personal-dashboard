#!/usr/bin/env node
// 배포 전 환경 변수 점검 (Node 표준 라이브러리만, 네트워크 접속 없음).
//
// 사용:
//   npm run check-env -- <env 파일>                          그 파일 하나를 점검
//   npm run check-env -- --compare <개발 env 파일> <운영 env 파일>  두 파일을 각각 점검한 뒤 서로 비교
//   npm run check-env                                        process.env 를 점검
//
// --compare 비교 대상: NEXT_PUBLIC_SUPABASE_URL(정규화 후), SUPABASE_SERVICE_ROLE_KEY, PICKLE_INGEST_TOKEN,
//   DASHBOARD_USER_ID(양쪽 모두 UUID 형식일 때만, 대소문자 무시). 개발과 운영이 같으면 위반.
//
// 필수 이름 목록과 예시(자리표시자) 값은 저장소의 .env.example 에서 'NAME=' 줄을 읽어 정한다.
//
// 지원하는 env 파일 문법:
//   - 빈 줄, '#' 로 시작하는 주석 줄(앞 공백 허용), 'NAME=값' 줄만 허용한다.
//   - NAME 은 /^[A-Z_][A-Z0-9_]*$/ ('export ' 접두사는 허용하지 않음).
//   - 값은 따옴표 없이(앞뒤 공백 제거) 쓰거나, 전체를 큰따옴표 한 쌍 또는 작은따옴표 한 쌍으로 감싼다.
//     따옴표 안의 이스케이프(\")는 지원하지 않는다. 값 안의 '=' 는 허용. 따옴표 없는 값의 '#' 는 값의 일부다.
//   - 파싱 오류: '=' 가 없는 줄, 이름 형식 오류, 닫히지 않은 따옴표, 닫는 따옴표 뒤에 남은 글자,
//     따옴표 없는 값이나 큰따옴표 값 안의 '$'(변수 확장 구문이라 실제 배포 값을 점검할 수 없음),
//     같은 이름이 두 번 나옴.
//
// 출력: '변수 이름(또는 줄 번호) + 규칙 설명'만 쓴다. 값·값의 일부·길이·원문 줄·파일 경로·예외 메시지는 쓰지 않는다.
// 종료 코드: 0 = OK, 1 = 점검 규칙 위반, 2 = 파일 읽기 실패·인자 오류·파싱 오류.
//
// 한계(오프라인 비교): DNS 별칭·사용자 지정 도메인이 같은 Supabase 프로젝트를 가리키는지,
// 키가 실제로 어느 프로젝트 소속인지, 파일 값이 실제 Vercel 설정과 같은지는 확인할 수 없다.
// 이 대조는 운영자가 직접 한다(docs/DEPLOY.md).
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const NAME_RE=/^[A-Z_][A-Z0-9_]*$/;
const URL_RE=/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?\/?$/;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVER_NAMES=['SUPABASE_SERVICE_ROLE_KEY','PICKLE_INGEST_TOKEN'];

/** env 파일 텍스트 → {env, errors:[{line, rule}]} */
export function parseEnvFile(text){
 const env={},errors=[];
 const lines=String(text).split(/\r?\n/);
 lines.forEach((raw,i)=>{
  const line=i+1,t=raw.trim();
  if(t===''||t.startsWith('#'))return;
  const eq=raw.indexOf('=');
  if(eq<0){errors.push({line,rule:"'=' 가 없는 줄"});return;}
  const name=raw.slice(0,eq).trim();
  if(!NAME_RE.test(name)){errors.push({line,rule:'이름 형식 오류(대문자·숫자·_ 만, export 접두사 불가)'});return;}
  let v=raw.slice(eq+1).trim();
  const q=v[0];
  if(q==='"'||q==="'"){
   const end=v.indexOf(q,1);
   if(end<0){errors.push({line,rule:'닫히지 않은 따옴표'});return;}
   if(end!==v.length-1){errors.push({line,rule:'닫는 따옴표 뒤에 남은 글자'});return;}
   v=v.slice(1,end);
   if(q==='"'&&v.includes('$')){errors.push({line,rule:"큰따옴표 값 안의 '$'(변수 확장 구문은 점검 불가)"});return;}
  }else if(v.includes('$')){errors.push({line,rule:"따옴표 없는 값 안의 '$'(변수 확장 구문은 점검 불가)"});return;}
  if(Object.prototype.hasOwnProperty.call(env,name)){errors.push({line,rule:'같은 이름이 두 번 나옴'});return;}
  env[name]=v;
 });
 return {env,errors};
}

/** .env.example 텍스트 → {names, examples} ('NAME=' 줄만) */
export function readExample(text){
 const names=[],examples={};
 for(const raw of String(text).split(/\r?\n/)){
  const m=/^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(raw.trim());
  if(!m||names.includes(m[1]))continue;
  names.push(m[1]);examples[m[1]]=m[2].trim();
 }
 return {names,examples};
}

/** Supabase URL → 정규화 origin, 형식이 엄격하게 맞지 않으면 null */
export function normalizeSupabaseUrl(s){
 if(typeof s!=='string'||!URL_RE.test(s))return null;
 let u;
 try{u=new URL(s);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;
 return u.origin;
}

function isServiceRoleJwt(v){
 const parts=v.split('.');
 if(parts.length!==3)return false;
 try{
  const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  return !!payload&&typeof payload==='object'&&payload.role==='service_role';
 }catch{return false;}
}

const has=(env,n)=>typeof env[n]==='string'&&env[n]!=='';

/** 단일 점검 → [{name, rule}] */
export function checkEnv(env,requiredNames,examples={}){
 const out=[];
 const add=(name,rule)=>out.push({name,rule});
 for(const n of requiredNames){
  if(!has(env,n)){add(n,'없거나 비어 있음');continue;}
  if(env[n]===examples[n]||env[n].includes('YOUR_'))add(n,'자리표시자 값(.env.example 예시 그대로)');
 }
 const url='NEXT_PUBLIC_SUPABASE_URL';
 if(has(env,url)&&normalizeSupabaseUrl(env[url])===null)add(url,'https://호스트[:포트][/] 형식이 아님(경로·쿼리·프래그먼트·사용자 정보 불가)');
 if(has(env,'PICKLE_INGEST_TOKEN')&&env.PICKLE_INGEST_TOKEN.length<32)add('PICKLE_INGEST_TOKEN','32자 미만');
 if(has(env,'DASHBOARD_USER_ID')&&!UUID_RE.test(env.DASHBOARD_USER_ID))add('DASHBOARD_USER_ID','UUID 형식이 아님');
 const serverVals=SERVER_NAMES.filter(n=>has(env,n)).map(n=>env[n]);
 for(const n of Object.keys(env).sort()){
  if(!n.startsWith('NEXT_PUBLIC_'))continue;
  if(/SERVICE_ROLE|SECRET|TOKEN/.test(n))add(n,'NEXT_PUBLIC_ 이름에 SERVICE_ROLE·SECRET·TOKEN 포함');
  if(!has(env,n))continue;
  const v=env[n];
  if(v.startsWith('sb_secret_'))add(n,'공개 변수에 서버 비밀키(sb_secret_) 형식');
  else if(isServiceRoleJwt(v))add(n,'공개 변수에 service_role JWT');
  if(serverVals.includes(v))add(n,'공개 변수 값이 서버 키 또는 수신 토큰과 같음');
 }
 if(has(env,SERVER_NAMES[0])&&has(env,SERVER_NAMES[1])&&env[SERVER_NAMES[0]]===env[SERVER_NAMES[1]])add(SERVER_NAMES[1],'SUPABASE_SERVICE_ROLE_KEY 와 같은 값');
 return out;
}

/** 개발·운영 비교 → [{name, rule}] */
export function compareEnvs(devEnv,opsEnv){
 const out=[];
 const a=normalizeSupabaseUrl(devEnv.NEXT_PUBLIC_SUPABASE_URL),b=normalizeSupabaseUrl(opsEnv.NEXT_PUBLIC_SUPABASE_URL);
 if(a!==null&&a===b)out.push({name:'NEXT_PUBLIC_SUPABASE_URL',rule:'개발과 운영이 같은 주소'});
 for(const n of SERVER_NAMES)if(has(devEnv,n)&&has(opsEnv,n)&&devEnv[n]===opsEnv[n])out.push({name:n,rule:'개발과 운영이 같은 값'});
 const id='DASHBOARD_USER_ID';
 if(has(devEnv,id)&&has(opsEnv,id)&&UUID_RE.test(devEnv[id])&&UUID_RE.test(opsEnv[id])&&devEnv[id].toLowerCase()===opsEnv[id].toLowerCase())out.push({name:id,rule:'개발과 운영이 같은 값'});
 return out;
}

const USAGE='사용법: npm run check-env -- [<env 파일> | --compare <개발 env 파일> <운영 env 파일>]';

function main(argv){
 const fail2=(msg)=>{console.error(msg);return 2;};
 let example;
 try{example=readExample(readFileSync(new URL('../.env.example',import.meta.url),'utf8'));}
 catch{return fail2('.env.example 을 읽을 수 없음');}
 let targets;
 if(argv.length===0)targets=null;
 else if(argv[0]==='--compare'){
  if(argv.length!==3||argv.slice(1).some(a=>a.startsWith('--')))return fail2(USAGE);
  targets=[{role:'개발',path:argv[1]},{role:'운영',path:argv[2]}];
 }else if(argv.length===1&&!argv[0].startsWith('--'))targets=[{role:'점검',path:argv[0]}];
 else return fail2(USAGE);

 const problems=[];
 if(targets===null){
  const env={};
  for(const [k,v] of Object.entries(process.env))if(typeof v==='string')env[k]=v;
  for(const p of checkEnv(env,example.names,example.examples))problems.push(`${p.name}: ${p.rule}`);
 }else{
  const envs=[];
  let parseFailed=false;
  for(const t of targets){
   let text;
   try{text=readFileSync(t.path,'utf8');}catch{return fail2(`${t.role} 파일을 읽을 수 없음`);}
   const {env,errors}=parseEnvFile(text);
   for(const e of errors)console.error(`${t.role} 파일 ${e.line}번째 줄: ${e.rule}`);
   if(errors.length)parseFailed=true;
   envs.push(env);
  }
  if(parseFailed)return 2;
  const label=targets.length>1;
  targets.forEach((t,i)=>{for(const p of checkEnv(envs[i],example.names,example.examples))problems.push(`${label?t.role+' ':''}${p.name}: ${p.rule}`);});
  if(label)for(const p of compareEnvs(envs[0],envs[1]))problems.push(`비교 ${p.name}: ${p.rule}`);
 }
 if(problems.length){for(const p of problems)console.error(p);return 1;}
 console.log('OK');
 return 0;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=main(process.argv.slice(2));
