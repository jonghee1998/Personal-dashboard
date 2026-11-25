import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

const root=new URL('..',import.meta.url).pathname;
const css=readFileSync(join(root,'app','ui.css'),'utf8');
const shell=readFileSync(join(root,'components','dashboard','dashboard-shell.tsx'),'utf8');

test('ui.css declares Pretendard and uses it first for body',()=>{
 assert.match(css,/@font-face\{font-family:'Pretendard'[^}]*font-display:swap/);
 const body=css.match(/html,body\{[^}]*\}/);
 assert.ok(body);
 assert.match(body[0],/font-family:'Pretendard'/);
});

test('ui.css has no offset box-shadow and no gradient',()=>{
 assert.doesNotMatch(css,/gradient\(/);
 for(const m of css.matchAll(/box-shadow:([^;}]*)/g)) assert.equal(m[1].trim(),'none');
});

test('bottom nav buttons use svg icons and the shell has no symbol glyphs',()=>{
 assert.doesNotMatch(shell,/[⌂▤▣✦◷]/);
 assert.match(shell,/<nav className="bottom">\{tabs\.map\(\(\[id,label\]\)=><button[^]*<NavIcon id=\{id\}\/>/);
 const fn=shell.match(/function NavIcon[^\n]*/)[0];
 assert.match(fn,/<ArchitectureIcon\/>/);
 assert.match(fn,/<svg /);
 for(const id of ['home','finance','news','benefits','journal']) assert.match(shell,new RegExp(`\\s${id}:'M`));
});

test('no symbol glyph icons anywhere in components/dashboard',()=>{
 const dir=join(root,'components','dashboard');
 const files=readdirSync(dir,{recursive:true}).filter(f=>/\.(tsx?|css)$/.test(String(f)));
 assert.ok(files.length>5);
 for(const f of files) assert.doesNotMatch(readFileSync(join(dir,String(f)),'utf8'),/[⌂▤▣✦◷]/,String(f));
});

test('shell root keeps existing classes and adds uiTheme; layout imports ui.css after globals.css',()=>{
 assert.match(shell,/className="shell uiV2 uiTheme"/);
 const layout=readFileSync(join(root,'app','layout.tsx'),'utf8');
 assert.ok(layout.indexOf("'./globals.css'")>=0&&layout.indexOf("'./ui.css'")>layout.indexOf("'./globals.css'"));
});

// 11단계 통합 검수(docs/DESIGN_V2.md) 보완
const comp=name=>readFileSync(join(root,'components','dashboard',name),'utf8');

test('installment label on every transaction row is 10px in --ui-installment',()=>{
 assert.match(css,/\.dailyTransaction \.dailyInstallment\{font-size:10px;color:var\(--ui-installment\)\}/);
 assert.match(css,/\.financeTransactionAmount small\{font-size:10px\}/);
 assert.match(css,/\.financeTransactionAmount \.financeInstallment\{color:var\(--ui-installment\)\}/);
 assert.match(comp('daily-spending.tsx'),/<small className="dailyInstallment">\{installmentLabel\(x\)\}\{installment\?' · 일 합계 제외':''\}<\/small>/);
 assert.match(comp('finance-activity.tsx'),/<small className="financeInstallment">\{installmentLabel\(item\)\}<\/small>/);
});

test('chart tooltip uses manwon format without 원',()=>{
 assert.match(comp('daily-spending.tsx'),/\{selected\.day\}일 · \{manwon\(selected\.total\)\}<\/text>/);
});

test('home cycle total shows (일시불 X · 할부 Y) underneath',()=>{
 assert.match(comp('home-tab.tsx'),/summary\.status==='ok'&&<small className="homeCycleSplit">\(일시불 \{won\(summary\.lumpTotal\)\} · 할부 \{won\(summary\.installmentTotal\)\}\)<\/small>/);
});

test('old !important colors (delta, saved memo) are overridden with theme colors',()=>{
 assert.match(css,/\.pointsPanel \.deltaUp\{color:var\(--ui-accent-dark\)!important\}/);
 assert.match(css,/\.pointsPanel \.deltaDown\{color:var\(--ui-high\)!important\}/);
 assert.match(css,/\.dailyTransaction \.savedMemo\{color:var\(--ui-accent-dark\)!important\}/);
});

test('header line and brand mark use theme colors, architecture tab uses theme palette',()=>{
 assert.match(css,/\.shell\.uiV2 \.top\{[^}]*border-bottom:1px solid var\(--ui-border\)/);
 assert.match(css,/\.shell\.uiV2 \.brandMark\{[^}]*background:none/);
 assert.match(css,/\.archBox rect\{fill:#fff;stroke:var\(--ui-border\)\}/);
 assert.match(css,/\.archBox\.accent rect\{fill:var\(--ui-accent\)/);
 assert.match(css,/\.archBox\.deep rect\{fill:var\(--ui-text\)/);
 assert.match(css,/\.archKicker\{color:var\(--ui-faint\)\}/);
});

function walkFiles(dir,pred,out=[]){
 for(const e of readdirSync(dir,{withFileTypes:true})){
  const p=join(dir,e.name);
  if(e.isDirectory()){ if(e.name!=='node_modules'&&e.name!=='.next') walkFiles(p,pred,out); }
  else if(pred(p)) out.push(p);
 }
 return out;
}
const selfPath=join(root,'tests','ui-theme.test.mjs');
const LEGACY=/conceptLight|demoShell|designPreview|demoBanner|\borbit-|\bmarine-|\brefined-/;

test('legacy theme classes are gone from app, components and scripts/screens',()=>{
 const files=[
  ...walkFiles(join(root,'app'),p=>/\.(css|tsx)$/.test(p)),
  ...walkFiles(join(root,'components'),()=>true),
  ...walkFiles(join(root,'scripts','screens'),()=>true),
 ].filter(p=>p!==selfPath);
 assert.ok(files.length>5);
 for(const f of files) assert.ok(!LEGACY.test(readFileSync(f,'utf8')),f);
});

test('tests do not expect legacy classes as className values',()=>{
 const files=walkFiles(join(root,'tests'),p=>/\.(mjs|ts|js)$/.test(p)).filter(p=>p!==selfPath);
 for(const f of files){
  const src=readFileSync(f,'utf8');
  assert.ok(!/className[\s\S]{0,12}(conceptLight|demoShell|designPreview)/.test(src),f);
 }
});

test('every CSS variable declared in globals.css is used via var()',()=>{
 const g=readFileSync(join(root,'app','globals.css'),'utf8');
 const all=[
  ...walkFiles(join(root,'app'),p=>/\.(css|tsx)$/.test(p)),
  ...walkFiles(join(root,'components'),p=>/\.(css|tsx|ts)$/.test(p)),
 ].map(p=>readFileSync(p,'utf8')).join('\n');
 const names=[...new Set([...g.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map(m=>m[1]))];
 const unused=names.filter(n=>!all.includes('var('+n));
 assert.deepEqual(unused,[]);
});
