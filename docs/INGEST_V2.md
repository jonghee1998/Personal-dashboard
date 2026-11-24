# 피클AI 수신 규격 v2

상태: 규격·검증 lib(`lib/ingest-v2.ts`)만 있음. API 연결은 계획 ③이며, ③ 배포 전까지 피클AI 는 v1 을 쓴다.
모든 예시는 가짜 값이다(실제 가맹점·이름·금액 아님).

## ① 경로·인증·버전 구분

- 경로·인증은 v1 과 같다: `POST /api/ingest`, `Authorization: Bearer <PICKLE_INGEST_TOKEN>`, `Content-Type: application/json`.
- 본문 최상위에 `"version": 2` 가 있으면 v2, 없으면 v1 이다.
- v1(`{items, validate_only}`)은 9단계 완료까지 그대로 받는다. 유지 범위는 [DIAGNOSIS 의 호환성 표](DIAGNOSIS.md#9단계-전환-전까지-유지할-호환성)를 따른다.

## ② 본문 형식과 검사 규칙

```text
{
  version: 2,                         // 리터럴 2
  run: {
    run_id: uuid,
    dataset: transactions | settlements | news | points | applications | subscriptions | tasks | events | journal,
    source_system: 문자열 1~100자,
    source_as_of: ISO 시각(오프셋 포함) | null,
    collected_at: ISO 시각(오프셋 포함),
    status: "success" | "failed",     // 생략 시 success
    error_code: /^[A-Z0-9_:-]{1,100}$/ | null   // 생략 시 null
  },
  items: [ v1 과 같은 항목 스키마 ],   // 0~500개
  manifest: { item_count: 정수 ≥ 0, amount_total: 숫자 | null }
}
```

- 모든 객체는 strict: 알 수 없는 키가 있으면 형식 오류.
- 항목 스키마는 v1 과 같다(`kind` 7종, `external_id` 1~180자, `title` 1~400자, `currency` 기본 `KRW`, `status` 기본 `active`, 구독 중단 상태는 `benefit`+`ai_subscription` 만, `metadata` 기본 `{}`).
- dataset → 항목 kind 대응: transactions→transaction, settlements→settlement, news→news, points→benefit+category `points`, subscriptions→benefit+category `ai_subscription`, applications→benefit+category 가 null 이거나 `points`·`ai_subscription` 이 아님, tasks→task, events→event, journal→journal.

아래 규칙은 모두 모아서 한 번에 돌려준다. 하나라도 걸리면 422 이고 아무것도 쓰지 않는다.

<!-- codes:start -->
| code | 조건 | field |
|---|---|---|
| `INVALID_FORMAT` | 형식(zod strict) 오류. version 없음·1, 항목 501개 이상 포함 | zod 경로 |
| `RUN_ID_MISMATCH` | `item.metadata.run_id` ≠ `run.run_id` | `metadata.run_id` |
| `SOURCE_SYSTEM_MISMATCH` | `item.metadata.source_system` ≠ `run.source_system` | `metadata.source_system` |
| `KIND_DATASET_MISMATCH` | 항목 kind·category 가 dataset 대응과 다름 | `kind` |
| `ITEM_COUNT_MISMATCH` | `manifest.item_count` ≠ 항목 수 | `manifest.item_count` |
| `AMOUNT_TOTAL_MISMATCH` | `amount_total` 이 null 이 아니고, amount 가 숫자인 항목 합과 소수 둘째 자리 반올림 값이 다름 | `manifest.amount_total` |
| `RUN_TIME_ORDER` | `source_as_of` > `collected_at`, 또는 `collected_at` > 서버 시각 + 5분 | `run.source_as_of` / `run.collected_at` |
| `ERROR_CODE_REQUIRED` | `status` failed 인데 `error_code` 없음 | `run.error_code` |
| `ITEMS_NOT_ALLOWED_FOR_FAILED` | `status` failed 인데 항목 1개 이상 | `items` |
| `ITEMS_REQUIRED` | `status` success 인데 항목 0개 | `items` |
| `DUPLICATE_BATCH_ID` | 같은 `kind:external_id` 가 두 번 | `external_id` |
<!-- codes:end -->

항목 관련 code 에는 `index`(items 배열 위치)가 붙는다. 위 규칙을 통과하면 항목마다 v1 과 같은 운영 무결성 검사(`lib/ingest-integrity.ts` 의 `validateProductionRecord`: `ENVIRONMENT_REQUIRED`, `SOURCE_NOT_ALLOWED`, `TIMESTAMP_ORDER` 등)를 돌리고, 위반이 있으면 422 다.

## ③ 처리: 전부 받거나 전부 거부

- 성공(`success`)하면 항목 upsert 와 `dashboard_sync_runs` 행을 **한 트랜잭션**에 쓴다. 일부만 쓰이는 일은 없다.
- `failed` 는 항목 없이 실행 기록만 남긴다.
- 검사할 때 본 행이 그사이 다른 쓰기로 바뀌었으면 아무것도 쓰지 않고 `409 CONCURRENT_CHANGE` 를 돌려준다. 같은 본문을 다시 보내면 된다.
- DB 함수가 `dashboard_items` 에 표 잠금(share row exclusive)을 잡으므로 v1 upsert·`/api/items` 수정·백필 등 다른 쓰기 경로와도 DB 가 순서를 정한다.

## ④ 실행 식별

- 실행 키는 `(run_id, dataset, source_system)` 이다. v1 `/api/sync-runs` 와 같은 키다.
- 같은 `run_id` 라도 `dataset`·`source_system` 이 다르면 별개 실행이다.

## ⑤ 재전송

- v2 커밋이 만든 실행 기록에는 `commit_source = 'ingest_v2'` 가 붙는다(계획 ②의 마이그레이션).
- 같은 키의 실행 기록이 있으면, `commit_source` 가 `ingest_v2` 이고 `status`·`error_code`·`expected_count`(= `manifest.item_count`)·`payload_digest` 가 **모두 같을 때만** 재전송으로 본다. 다시 쓰지 않고 `200 {idempotent:true, upserted:0, items:[], run:<기록된 실행 요약>}` 을 돌려준다.
- 하나라도 다르면 `409 RUN_ID_CONFLICT`. 개수·금액 합이 같아도 항목 내용이 다르면 digest 가 달라 409 다.
- v1 `/api/sync-runs` 로 기록된 실행(`commit_source = 'report'`)과 키가 겹치면 digest 가 같아도 409 다.
- 재전송 판정은 항목 상태 검사(`STALE_REPLAY`·`DELETE_TARGET_NOT_FOUND`·원천 거래 중복)보다 **먼저** 한다. 그래서 성공한 실행의 항목이 뒤 실행으로 바뀐 뒤 원본을 다시 보내도 200 idempotent(빈 items, upserted 0)다.
- 응답이 유실돼 다시 보내도 위 규칙으로 200 idempotent 다.
- 같은 run 을 동시에 보내면 DB 잠금으로 하나가 먼저 쓰고, 나머지는 재전송 규칙을 따른다.

`payload_digest` 계산: 받은 항목 배열(`rawItems`, 기본값을 채우지 않은 원본)을 정규화 JSON(객체 키를 재귀적으로 정렬, 배열 순서 유지, 공백 없음)으로 만든 UTF-8 의 sha256 hex(소문자 64자). 그래서 `currency` 를 생략한 항목과 `"currency":"KRW"` 를 명시한 항목은 digest 가 다르다.

## ⑥ 응답

| 상태 | 본문 |
|---|---|
| 200 | `{version:2, upserted, items:[{id,kind,external_id}], run:{run_id,dataset,source_system,status,accepted_count}, idempotent:false}` (재전송이면 `idempotent:true, upserted:0, items:[]`) |
| 400 | `Invalid JSON` |
| 401 | 토큰 없음·불일치 |
| 409 | `STALE_REPLAY`, `DUPLICATE_SOURCE_TRANSACTION`, `DELETE_TARGET_NOT_FOUND`, `CONCURRENT_CHANGE`, `RUN_ID_CONFLICT` |
| 422 | ②의 code 와 항목 검증 code(`violations: [{index?, code, field}]`) |
| 503 | 서버 설정 없음·DB 사용 불가 |

## ⑦ 필드 갱신

- 항목 JSON 에 **있는 키만** 갱신하고, 없는 키는 기존 값을 유지한다(새 행은 열 기본값).
- 명시적 `null` 은 null 로 쓴다.
- v1 의 PostgREST 일괄 upsert 와 결과가 다를 수 있다(v1 은 배치 안 키 집합 기준으로 열을 채운다).

## ⑧ 운영 반영 조건(계획 ③ 인수 기준)

- (가) ②의 마이그레이션이 운영 DB 에 적용되고 ③이 배포된 뒤에만 v2 를 받는다. 그 전의 v2 요청은 v1 의 strict 스키마에 걸려 `400 Invalid payload` 가 난다.
- (나) ③에서 v1 수신도 이 DB 함수(`p_run` NULL)로만 쓴다. PostgREST 직접 upsert 는 금지한다.
- (다) `/api/items` 메모 수정은 v2 활성화 전에 현재 행에서 그 키만 바꾸는 원자적 갱신(`jsonb_set` 한 번의 UPDATE)으로 바꾼다(6-6).
- (라) v2 요청은 형식·인증 검사 뒤, 항목 상태 검사 전에 실행 기록으로 재전송·충돌을 먼저 판정하고, 기록이 없을 때만 항목 검사와 함수 호출을 한다. 함수도 잠금 안에서 같은 판정을 다시 한다.
- (마) ③ 인수 테스트: 성공한 실행 → 뒤 실행이 같은 항목 변경 → 원본 재요청 → 200·빈 items·upserted 0.
- (바) 행 만들기: `rawItems` 는 digest 와 '키가 왔는지'의 기준으로만 쓰고, 함수에 보내는 행은 지금 v1 과 같은 업무 변환을 거친다 — `normalizeIncomingStatus` 로 상태 정규화(deleted·구독 중단 상태를 DB 허용 상태로), 기존 거래 메모 보존, 정산·할 일의 완료 상태 보존, 보관(archived) 대상은 기존 업무 필드 유지(`app/api/ingest/route.ts` 59~73행 규칙). `metadata` 는 받은 metadata 에 보존할 키(memo 등)를 합친 값으로 보낸다. 인수 테스트: 기존 거래 메모 보존, status 생략 시 기존 상태 유지, deleted 요청 → archived 와 업무 필드 유지, 구독 중단 상태 정규화.
- (사) 항목 상태 충돌(`STALE_REPLAY`·`DELETE_TARGET_NOT_FOUND`·`DUPLICATE_SOURCE_TRANSACTION`)을 409 로 돌려주기 직전에 실행 기록을 한 번 더 조회해 (라)의 재전송·충돌 규칙을 먼저 적용한다. 인수 테스트: 첫 조회에 기록 없음 → 그사이 같은 실행 커밋과 후속 갱신이 커밋됨 → 200 idempotent.
- (아) 원천 거래 중복 검사(`strongTransactionKey`)는 실제로 저장될 유효 값으로 한다: `currency` 를 생략하면 기존 행의 통화(없으면 `KRW`), `status` 도 같은 방식. 인수 테스트: 기존 비KRW 행에 currency 를 생략해 갱신할 때 중복 판정이 저장 결과와 같은 키를 씀.

## ⑨ 예시

성공(거래 2건):

<!-- example:success -->
```json
{
  "version": 2,
  "run": {
    "run_id": "00000000-0000-4000-8000-000000000001",
    "dataset": "transactions",
    "source_system": "samsungcard",
    "source_as_of": "2026-01-01T09:00:00+09:00",
    "collected_at": "2026-01-01T09:10:00+09:00",
    "status": "success",
    "error_code": null
  },
  "items": [
    {
      "kind": "transaction",
      "external_id": "txn-000001",
      "title": "합성가맹점A",
      "amount": 1000,
      "event_date": "2026-01-01",
      "metadata": {
        "environment": "production",
        "is_synthetic": false,
        "source_system": "samsungcard",
        "verification_source": "card_approval_ledger",
        "source_record_id": "apv-000001",
        "as_of": "2026-01-01T09:00:00+09:00",
        "verified_at": "2026-01-01T09:05:00+09:00",
        "run_id": "00000000-0000-4000-8000-000000000001"
      }
    },
    {
      "kind": "transaction",
      "external_id": "txn-000002",
      "title": "합성가맹점B",
      "amount": 2500,
      "event_date": "2026-01-01",
      "metadata": {
        "environment": "production",
        "is_synthetic": false,
        "source_system": "samsungcard",
        "verification_source": "card_approval_ledger",
        "source_record_id": "apv-000002",
        "as_of": "2026-01-01T09:00:00+09:00",
        "verified_at": "2026-01-01T09:05:00+09:00",
        "run_id": "00000000-0000-4000-8000-000000000001"
      }
    }
  ],
  "manifest": {"item_count": 2, "amount_total": 3500}
}
```

실패 보고(항목 없음):

<!-- example:failed -->
```json
{
  "version": 2,
  "run": {
    "run_id": "00000000-0000-4000-8000-000000000002",
    "dataset": "transactions",
    "source_system": "samsungcard",
    "source_as_of": null,
    "collected_at": "2026-01-01T09:10:00+09:00",
    "status": "failed",
    "error_code": "SOURCE_TIMEOUT"
  },
  "items": [],
  "manifest": {"item_count": 0, "amount_total": null}
}
```

충돌 응답(409, 같은 실행 키에 다른 내용):

<!-- example:conflict-response -->
```json
{
  "version": 2,
  "error": "Run id conflict",
  "violations": [{"code": "RUN_ID_CONFLICT", "field": "run.run_id"}]
}
```

## ⑩ 관련 문서

- [AI_COLLABORATION.md](AI_COLLABORATION.md) Integration API 절(v1)
- [DIAGNOSIS.md](DIAGNOSIS.md) (2)절 — 읽기·쓰기 사이 경쟁 문제
- [SYNC_AUDIT_CONTRACT.md](SYNC_AUDIT_CONTRACT.md) — v1 실행 보고
