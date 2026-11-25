// 교차 테스트: scripts/ingest_gate.py 가 실제로 보내는 바이트가 lib/ingest-v2.ts 의 v2 파서를 통과하는지 본다.
// python3 를 저장소 루트에서 실행해 transmit_gated_ingest 를 요청을 잡아두는 가짜 opener 와 함께 부르고(네트워크 없음),
// 잡힌 요청 data 바이트를 stdout(base64)으로 받는다. 값은 모두 가짜다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseIngestV2} from '../lib/ingest-v2.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUN_ID = '00000000-0000-4000-8000-0000000000e1';
const AS_OF = '2026-11-12T10:00:00+09:00';
const NOW = Date.parse('2026-11-13T00:00:00+09:00');

const manifest = {
  provider: 'samsungcard', previous_balance: 10000, increase_amount: 500, decrease_amount: 200, // pii-allow
  current_balance: 10300, verified_at: AS_OF, as_of: AS_OF, // pii-allow
};
const items = [{
  kind: 'benefit', category: 'points', external_id: 'benefit-pt-000001', title: '합성포인트A', source: 'samsungcard',
  amount: 10300, currency: 'KRW', event_date: '2026-11-12', // pii-allow
  metadata: {
    environment: 'production', is_synthetic: false, source_system: 'samsungcard', verification_source: 'monimo_session',
    as_of: AS_OF, verified_at: AS_OF, run_id: RUN_ID, provider: '삼성카드', source_record_id: 'pt-000001',
  },
}];
const run = {run_id: RUN_ID, dataset: 'points', source_system: 'samsungcard', source_as_of: AS_OF, collected_at: '2026-11-12T10:05:00+09:00'};

const PY = `
import base64, json, sys
from unittest.mock import MagicMock
from scripts.ingest_gate import transmit_gated_ingest
args = json.loads(sys.stdin.read())
captured = []
class Resp:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return b'{"version":2}'
opener = MagicMock()
def fake_open(req):
    captured.append(req.data)
    return Resp()
opener.open.side_effect = fake_open
transmit_gated_ingest("https://dashboard.example.invalid/api/ingest", "synthetic-token", "points",
                      args["manifest"], args["items"], validate_only=False, opener=opener, run=args["run"])
assert len(captured) == 1
sys.stdout.write(base64.b64encode(captured[0]).decode("ascii"))
`;

function gateBytes() {
  const out = execFileSync('python3', ['-c', PY], {
    cwd: ROOT,
    input: JSON.stringify({manifest, items, run}),
    env: {...process.env, DASHBOARD_INGEST_BASE_URL: 'https://dashboard.example.invalid'},
    encoding: 'utf8',
  });
  return Buffer.from(out.trim(), 'base64');
}

test('ingest_gate 가 보낸 바이트는 parseIngestV2 를 통과한다(ok, violations·itemViolations 없음)', () => {
  const bytes = gateBytes();
  const body = JSON.parse(bytes.toString('utf8'));
  assert.equal(body.version, 2);
  assert.equal(typeof body.version, 'number');
  assert.ok(!Object.hasOwn(body, 'validate_only'));
  assert.deepEqual(body.manifest, {item_count: 1, amount_total: 10300}); // pii-allow
  const parsed = parseIngestV2(body, NOW);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.violations));
  assert.equal(parsed.violations, undefined);
  assert.deepEqual(parsed.itemViolations, []);
  assert.equal(parsed.run.run_id, RUN_ID);
  assert.equal(parsed.items.length, 1);
});
