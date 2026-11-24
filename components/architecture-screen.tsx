import type {ReactNode} from 'react';
import {architectureSections,targetDiagram,targetRows,summaryLines,vercelEnv,githubSecrets,flowSteps,screenRows,apiRows,safeguardRows,devLines} from '@/lib/architecture-content';

// Static architecture overview. Reads no data, so it renders even while the dashboard is loading or failing.

export function Section({no,kicker,title,children}:{no:string;kicker:string;title:string;children:ReactNode}){
 return <section className="archSection" aria-label={kicker}>
  <div className="archHead"><small className="archKicker">{no} · {kicker}</small><h2 className="archTitle">{title}</h2></div>
  <div className="panel archBody">{children}</div>
 </section>;
}

type BoxProps={x:number;y:number;w:number;h:number;lines:readonly string[];tone?:'plain'|'accent'|'deep'};
function Box({x,y,w,h,lines,tone='plain'}:BoxProps){
 const cy=y+h/2;
 return <g className={'archBox '+tone}>
  <rect x={x} y={y} width={w} height={h} rx={9}/>
  {lines.map((line,i)=><text key={i} x={x+w/2} y={cy+(i-(lines.length-1)/2)*14} dominantBaseline="middle" textAnchor="middle" className={i===0?'archBoxMain':'archBoxSub'}>{line}</text>)}
 </g>;
}
function Arrow({id,x1,y1,x2,y2}:{id:string;x1:number;y1:number;x2:number;y2:number}){
 return <line className="archArrow" x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={`url(#${id})`}/>;
}
/** Bent arrow through the given points (x1,y1,x2,y2,...). Same style and marker as Arrow. */
function ElbowArrow({id,points}:{id:string;points:readonly number[]}){
 const d=points.reduce((acc,n,i)=>acc+(i%2===0?(i===0?'M':' L')+n:' '+n),'');
 return <path className="archArrow" d={d} fill="none" markerEnd={`url(#${id})`}/>;
}
function ArrowHead({id}:{id:string}){
 return <defs><marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="archArrowHead"/></marker></defs>;
}

function TargetDiagram(){
 const id='archArrowTarget';
 const t=targetDiagram;
 // Columns: 개발 (left), 운영 (middle), users outside the arrow paths (right).
 const DX=4,OX=100,UX=216,CW=88,UW=80,H=54,ROW1=102,ROW2=186;
 const GX=58,GW=136,TW=31,TGAP=(GW-4*TW)/3;
 const devC=DX+CW/2,opsC=OX+CW/2,elbowX=202;
 return <figure className="archFigure">
  <svg className="archSvg" viewBox="0 0 300 246" role="img" aria-label={t.ariaLabel}>
   <ArrowHead id={id}/>
   <Box x={GX} y={4} w={GW} h={40} lines={t.github} tone="accent"/>
   {t.team.map((name,i)=><Box key={name} x={GX+i*(TW+TGAP)} y={52} w={TW} h={24} lines={[name]}/>)}
   <text x={DX} y={93} className="archColLabel">{t.devLabel}</text>
   <text x={OX} y={93} className="archColLabel">{t.opsLabel}</text>
   <Box x={DX} y={ROW1} w={CW} h={H} lines={t.devApp}/>
   <Box x={DX} y={ROW2} w={CW} h={H} lines={t.devDb}/>
   <Box x={OX} y={ROW1} w={CW} h={H} lines={t.opsApp}/>
   <Box x={OX} y={ROW2} w={CW} h={H} lines={t.opsDb} tone="deep"/>
   <Box x={UX} y={ROW1} w={UW} h={H} lines={t.users}/>
   <ElbowArrow id={id} points={[GX,24,devC,24,devC,ROW1-1]}/>
   <ElbowArrow id={id} points={[GX+GW,24,elbowX,24,elbowX,ROW1+16,OX+CW+1,ROW1+16]}/>
   <Arrow id={id} x1={UX} y1={ROW1+40} x2={OX+CW+1} y2={ROW1+40}/>
   <Arrow id={id} x1={devC} y1={ROW1+H} x2={devC} y2={ROW2-1}/>
   <Arrow id={id} x1={opsC} y1={ROW1+H} x2={opsC} y2={ROW2-1}/>
  </svg>
  <figcaption className="archLegend">{t.legend}</figcaption>
 </figure>;
}

function SystemDiagram(){
 const id='archArrowSystem';
 const L=8,R=162,W=130,H=44;
 return <figure className="archFigure">
  <svg className="archSvg" viewBox="0 0 300 214" role="img" aria-label="아키텍처: 피클AI 수집기가 /api/ingest 로 Supabase dashboard_items 에 쓰고, 사용자 폰은 로그인 후 /api/dashboard 로 같은 테이블을 읽어 대시보드에 보여준다">
   <ArrowHead id={id}/>
   <text x={L+W/2} y={10} textAnchor="middle" className="archColLabel">쓰기</text>
   <text x={R+W/2} y={10} textAnchor="middle" className="archColLabel">읽기</text>
   <Box x={L} y={20} w={W} h={H} lines={['피클AI','수집기']}/>
   <Box x={L} y={90} w={W} h={H} lines={['POST /api/ingest','Bearer 토큰']}/>
   <Box x={L} y={160} w={W} h={H} lines={['Supabase','dashboard_items']} tone="deep"/>
   <Box x={R} y={20} w={W} h={H} lines={['사용자 폰','브라우저']}/>
   <Box x={R} y={90} w={W} h={H} lines={['/login','Supabase Auth 세션']}/>
   <Box x={R} y={160} w={W} h={H} lines={['대시보드','GET /api/dashboard']} tone="accent"/>
   <Arrow id={id} x1={L+W/2} y1={64} x2={L+W/2} y2={89}/>
   <Arrow id={id} x1={L+W/2} y1={134} x2={L+W/2} y2={159}/>
   <Arrow id={id} x1={R+W/2} y1={64} x2={R+W/2} y2={89}/>
   <Arrow id={id} x1={R+W/2} y1={134} x2={R+W/2} y2={159}/>
   <Arrow id={id} x1={L+W} y1={182} x2={R-1} y2={182}/>
  </svg>
  <figcaption className="archLegend">→ 데이터 이동 · 왼쪽은 토큰으로 쓰기, 오른쪽은 로그인 세션으로 읽기 · 진한 상자는 DB</figcaption>
 </figure>;
}

function FlowDiagram(){
 const id='archArrowFlow';
 const X=8,W=284,H=44,GAP=20;
 return <figure className="archFigure">
  <svg className="archSvg" viewBox={`0 0 300 ${8+flowSteps.length*H+(flowSteps.length-1)*GAP+8}`} role="img" aria-label="데이터 흐름: 수신, 검증, 저장, 화면 갱신 순서. 저장 시 중복 판정 키는 user_id, kind, external_id">
   <ArrowHead id={id}/>
   {flowSteps.map((s,i)=>{
    const y=8+i*(H+GAP);
    return <g key={s.step}>
     <Box x={X} y={y} w={W} h={H} lines={[s.step+' · '+s.line1,s.line2]} tone={i===2?'deep':i===3?'accent':'plain'}/>
     {i<flowSteps.length-1&&<Arrow id={id} x1={X+W/2} y1={y+H} x2={X+W/2} y2={y+H+GAP-1}/>}
    </g>;
   })}
  </svg>
  <figcaption className="archLegend">↓ 처리 순서 · 검증 실패 시 저장하지 않음 · validate_only 요청은 검증만</figcaption>
 </figure>;
}

function Table({head,rows,className}:{head:readonly string[];rows:readonly (readonly ReactNode[])[];className?:string}){
 return <table className={className?'archTable '+className:'archTable'}>
  <thead><tr>{head.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
  <tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=>j===0?<th key={j} scope="row">{cell}</th>:<td key={j}>{cell}</td>)}</tr>)}</tbody>
 </table>;
}

const Lines=({lines}:{lines:readonly string[]})=><div className="archLines">{lines.map(line=><p key={line}>{line}</p>)}</div>;
const Tag=({children}:{children:ReactNode})=><span className="archTag">{children}</span>;

export default function ArchitectureScreen(){
 // Section 01 is the target structure; s1..s8 keep their original content and show as 02..09.
 const [target,s1,s2,s3,s4,s5,s6,s7,s8]=architectureSections;
 return <main className="archScreen">
  <Section {...target}>
   <TargetDiagram/>
   <Table className="archTargetTable" head={['영역','지금','목표','단계']} rows={targetRows.map(r=>[r.area,r.now,r.target,r.phase])}/>
  </Section>
  <Section {...s1}><Lines lines={summaryLines}/></Section>
  <Section {...s2}><SystemDiagram/></Section>
  <Section {...s3}>
   <Table head={['Vercel 환경변수','용도']} rows={vercelEnv.map(e=>[<code key="n">{e.name}</code>,<>{e.use} {e.scope==='서버 전용'&&<Tag>서버 전용</Tag>}{e.note&&<small className="archNote"> {e.note}</small>}</>])}/>
   <Table head={['GitHub Secrets','용도']} rows={githubSecrets.map(s=>[<code key="n">{s.name}</code>,s.use])}/>
   <p className="archNote">NEXT_PUBLIC_ 값은 브라우저에 노출되는 공개값이다. GitHub Actions 에는 Supabase 키를 두지 않는다.</p>
  </Section>
  <Section {...s4}><FlowDiagram/></Section>
  <Section {...s5}><Table head={['탭','보여주는 것']} rows={screenRows.map(r=>[r.tab,r.shows])}/></Section>
  <Section {...s6}><Table head={['경로','호출 주체','인증']} rows={apiRows.map(r=>[<><code>{r.path}</code><small className="archMethods">{r.methods}</small></>,r.caller,r.auth])}/></Section>
  <Section {...s7}><Table head={['장치','내용']} rows={safeguardRows.map(r=>[r.name,r.desc])}/></Section>
  <Section {...s8}><Lines lines={devLines}/></Section>
 </main>;
}

/** Small inline icon for the '구조' tab in the bottom nav. */
export function ArchitectureIcon(){
 return <svg className="archNavIcon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
  <rect x="3" y="3" width="7" height="6" rx="1.5"/><rect x="14" y="3" width="7" height="6" rx="1.5"/><rect x="8.5" y="15" width="7" height="6" rx="1.5"/>
  <path d="M6.5 9v3h11V9M12 12v3"/>
 </svg>;
}
