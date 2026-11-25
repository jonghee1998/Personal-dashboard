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

test('ui.css re-colors descendants whose old readable colors needed .conceptLight',()=>{
 // 부모 color 만으론 자식의 명시 글자색이 바뀌지 않으므로 각 자식 선택자에 새 팔레트 색이 있어야 한다
 const rule=sel=>{
  const esc=sel.replace(/[.*+?^${}()|[\]\\>]/g,'\\$&');
  const m=css.match(new RegExp('(?:^|[,}\\n])\\.shell\\.uiTheme '+esc+'(?:,[^{]*)?\\{([^}]*)\\}'));
  return m?m[1]:null;
 };
 for(const sel of ['.calendarDay','.calendarDay.chosen','.calendarSearchPanel>label','.calendarSearchResult','.calendarSearchResultText strong','.calendarSearchResultText small','.newsDetailBody','.newsCategoryName','.dailyTotal strong','.barheading']){
  const body=rule(sel);
  assert.ok(body,'missing .shell.uiTheme '+sel);
  assert.match(body,/(^|;)color:(var\(--ui-|#FFFFFF)/,sel+' has no new-palette color');
 }
 assert.match(rule('.pointOverview'),/background-image:none/);
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
