import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const components = new URL('../components/', import.meta.url).pathname;
const dashboard = join(components, 'dashboard');
const readDashboard = name => readFileSync(join(dashboard, name + '.tsx'), 'utf8');

function* componentFiles(dir) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* componentFiles(path);
    else if (entry.isFile()) yield path;
  }
}

test('dashboard tab components leave screen state in the shell', () => {
  for (const name of ['home', 'finance', 'news', 'benefits', 'journal']) {
    assert.doesNotMatch(readDashboard(name + '-tab'), /\buseState\b/, name);
  }
});

test('production components omit demo notices and retain the calendar note class', () => {
  for (const path of componentFiles(components)) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /가상 데이터|실제 데이터 저장은 아직 연결되지 않았어/, path);
  }
  assert.match(readDashboard('journal-calendar'), /<p className="calendarDemoNote">/);
});

test('bottom navigation clears the selected news article on every click', () => {
  const bottomNav = readDashboard('dashboard-shell').match(/<nav className="bottom">[\s\S]*?<\/nav>/)?.[0];
  assert.ok(bottomNav);
  assert.match(bottomNav, /onClick=\{\(\)=>\{setTab\(id\);setSelectedNewsId\(null\)\}\}/);
});
