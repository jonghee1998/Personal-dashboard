import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.cwd();
const css=readFileSync(join(root,'app','ui.css'),'utf8');
const shell=readFileSync(join(root,'components','dashboard','dashboard-shell.tsx'),'utf8');

test('ui.css declares Pretendard @font-face and uses it first for body',()=>{
 assert.match(css,/@font-face\{font-family:'Pretendard'/);
 const m=css.match(/html,body\{[^}]*font-family:([^;}]+)/);
 assert.ok(m);
 assert.equal(m[1].split(',')[0].trim().replace(/['"]/g,''),'Pretendard');
});

test('ui.css has no gradients or offset shadows',()=>{
 assert.doesNotMatch(css,/gradient\(/);
 for(const m of css.matchAll(/box-shadow:([^;}]+)/g)){
  const v=m[1].trim();
  assert.ok(v==='none'||/^0(px)?\s+0(px)?\s+0(px)?(\s|$)/.test(v),'offset shadow: '+v);
 }
});

test('layout imports ui.css after globals.css',()=>{
 const src=readFileSync(join(root,'app','layout.tsx'),'utf8');
 assert.ok(src.indexOf('./globals.css')>=0&&src.indexOf('./ui.css')>src.indexOf('./globals.css'));
});

test('shell bottom nav uses svg icons for all 6 tabs, no symbol glyphs',()=>{
 assert.doesNotMatch(shell,/[⌂▤▣✦◷]/);
 assert.match(shell,/className="shell demoShell uiTheme"/);
 for(const id of ['home','finance','news','benefits','journal'])assert.match(shell,new RegExp(id+':<svg'));
 assert.match(shell,/architecture:<ArchitectureIcon\/>/);
 assert.match(shell,/\{navIcons\[id\]\}/);
});
