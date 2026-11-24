// /api/items 메모 수정은 DB 함수 한 번으로 metadata.memo 만 원자적으로 바꾼다(읽고 다시 쓰지 않음).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../app/api/items/route.ts', import.meta.url), 'utf8');
const patch = src.slice(src.indexOf('export async function PATCH'), src.indexOf('export async function POST'));
const memo = patch.slice(patch.indexOf("if(input.action==='status')"));
const memoBranch = memo.slice(memo.indexOf('}\n') + 2);

test('memo branch is a single rpc call to dashboard_item_set_memo', () => {
  assert.equal((memoBranch.match(/db\.rpc\(/g) || []).length, 1);
  assert.match(memoBranch, /db\.rpc\('dashboard_item_set_memo',\{p_id:input\.id,p_memo:input\.memo\.trim\(\)\}\)/);
  assert.doesNotMatch(memoBranch, /\.from\('dashboard_items'\)/);
  assert.doesNotMatch(memoBranch, /\.update\(|\.select\(/);
});

test('memo branch keeps response codes and bodies', () => {
  assert.match(memoBranch, /if\(error\)return NextResponse\.json\(\{error:'Memo save failed'\},\{status:400\}\)/);
  assert.match(memoBranch, /if\(data==null\)return NextResponse\.json\(\{error:'Transaction not found'\},\{status:404\}\)/);
  assert.match(memoBranch, /return NextResponse\.json\(\{item:data\}\)/);
});

test('migration defines the memo function with RLS-respecting invoker rights', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261124000100_ingest_support.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.dashboard_item_set_memo\(p_id uuid, p_memo text\)\s+returns jsonb language sql security invoker/);
  assert.match(sql, /revoke all on function public\.dashboard_item_set_memo\(uuid,text\) from public,anon;/);
  assert.doesNotMatch(sql, /\b(create|alter|drop) policy\b/i);
});
