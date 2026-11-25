import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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

test('shell root keeps old classes and adds uiV2; layout imports ui.css after globals.css',()=>{
 assert.match(shell,/className="shell demoShell designPreview conceptLight uiV2"/);
 const layout=readFileSync(join(root,'app','layout.tsx'),'utf8');
 assert.ok(layout.indexOf("'./globals.css'")>=0&&layout.indexOf("'./ui.css'")>layout.indexOf("'./globals.css'"));
});
