# 코드 진단 보고서 (4단계)

> 대상: 현재 `main` 의 코드 전체. 근거는 `파일:줄` 로 적었다. 단계 번호는 `docs/roadmap.json` 의 `phases` 를 따른다
> (5 개발 DB 연결 · 6 데이터 수신 재설계 · 7 화면 정리·디자인 · 8 배포 분리 · 9 피클AI 전환).
> `docs/PROJECT_PLAN.md` 의 옛 단계 표와 번호가 다르면 roadmap 이 맞다.
> 이 문서는 공개 저장소에 있다. 실제 주소·키·금액·가맹점은 적지 않고 이름과 경로만 적는다.

판정 말뜻: **살릴** = 거의 그대로 둔다 · **다시** = 남기되 고쳐 만들거나 다른 곳에 합친다 · **지울** = 없앤다(조건이 있으면 적음).

---

## (1) 한 줄 결론과 요약

**한 줄 결론:** 검증 로직(lib/)과 RLS 기본 틀은 튼튼하니 살리고, 수신 경로는 `/api/ingest` 하나로 모아 트랜잭션으로 다시 만들고, 일회성 백필·대조 API 4개와 데모 화면·죽은 컴포넌트는 지운다. 단 이미 적용된 백필 배치의 되돌리기 수단은 DB 안에 남긴 채로 지운다.

| 영역 | 살릴 | 다시 | 지울 | 대상 수 |
|---|---|---|---|---|
| API (경로 8개 · 메서드 단위 14개) | 3 | 4 | 7 | 14 |
| DB (테이블 3 · 함수 4 · 정책 3) | 4 | 2 | 4 | 10 |
| lib/ (13개 모듈) | 7 | 3 | 3 | 13 |
| 화면 (app 페이지 3 · components 5) | 3 | 3 | 2 | 8 |
| 테스트 (Node 7 · Python 4 · SQL 1) | 5 | 5 | 2 | 12 |
| scripts/*.py (2개) | 1 | 1 | 0 | 2 |
| **합계** | **23** | **18** | **18** | **59** |

가장 급한 것 세 가지:
1. `tests/atomic-backfill.test.sql:37` 연산자 우선순위 버그 → dashboard-qa 가 매일 실패한다 (5절).
2. 운영 배포 주소가 코드·테스트·문서에 박혀 있다 (`scripts/ingest_gate.py:32-34,156` 등, 6절). 8단계 배포 분리 전에 빼야 한다.
3. 운영 화면이 `components/demo-dashboard.tsx` 하나에 데모와 섞여 있다 (4절). 7단계에서 나눈다.

---

## (2) API 8개

공통 사항:
- 수집기용 API 5개(ingest, sync-runs POST, reconcile, preview, stage)는 `PICKLE_INGEST_TOKEN` Bearer 토큰을 쓰고, 비교 함수를 **각 파일에 복사**해 두었다 (`app/api/ingest/route.ts:14`, `app/api/sync-runs/route.ts:25-31`, `app/api/reconcile/transactions/route.ts:16-20`, `app/api/backfill/preview/route.ts:12-16`, `app/api/backfill/stage/route.ts:14-16`).
- 수집기 API는 사용자 대신 `DASHBOARD_USER_ID` 환경변수로 주인을 정하고 `adminDb()`(service role, RLS 우회)로 쓴다.
- **API 라우트 자체를 실행하는 테스트는 하나도 없다.** `tests/architecture-content.test.mjs:34-46` 은 파일 목록과 export 된 메서드 이름만 본다.

### 메서드별 판정 표

| 경로 · 메서드 | 누가 쓰나 | 인증 | 입력 검증 | 중복 처리 | 트랜잭션 | 테스트 | 판정 |
|---|---|---|---|---|---|---|---|
| `/api/ingest` POST | 피클AI(수집기) | Bearer 토큰 | zod strict + 출처 검사 | 키 upsert + 원천ID 중복 검사 | 없음 | lib 만 | **다시** |
| `/api/items` PATCH (status) | 화면: 정산·할 일 체크 | 세션 + RLS | zod, 옛 형식도 받음 | 해당 없음 | 단일 UPDATE | 없음 | **다시** |
| `/api/items` PATCH (memo) | 화면: 거래 메모 | 세션 + RLS | zod (400자) | 해당 없음 | 읽고-쓰기 2번 | 없음 | **다시** |
| `/api/items` POST | 화면: 할 일 추가 | 세션 → admin 쓰기 | zod strict | 매번 새 ID | 단일 INSERT | 없음 | **살릴** |
| `/api/items` DELETE | 화면: 할 일 삭제 | 세션 + RLS | zod strict | 보관(archived) 처리 | 단일 UPDATE | 없음 | **살릴** |
| `/api/dashboard` GET | 화면: 전체 조회 | 세션 + RLS | 없음(입력 없음) | 해당 없음 | 읽기만 | 없음 | **살릴** |
| `/api/sync-runs` POST | 피클AI(수집기) | Bearer 토큰 | zod strict + 규칙 | run_id 멱등 | 읽고-세고-쓰기 3번 | 없음 | **다시(통합)** |
| `/api/sync-runs` GET | 호출자 없음 | 세션 + RLS | 없음 | 해당 없음 | 읽기만 | 없음 | **지울** |
| `/api/reconcile/transactions` POST | 수집기(일회성) | Bearer 토큰 | zod strict | 해당 없음 | 읽기만 | lib 만 | **지울** |
| `/api/backfill/preview` POST | 수집기(일회성) | Bearer 토큰 | zod strict | 해당 없음 | 읽기만 | lib 만 | **지울** |
| `/api/backfill/stage` POST | 수집기(일회성) | Bearer 토큰 | zod strict + 다이제스트 | plan_digest 유니크 | 단일 INSERT | lib 만 | **지울** |
| `/api/backfill/control` GET | 소유자(수동) | 세션 + 소유자 UUID | 없음 | 해당 없음 | 읽기만 | 없음 | **지울** |
| `/api/backfill/control` POST apply | 소유자(수동) | 세션 + 소유자 + 같은 출처 + 스위치 | zod + 확인 문구 | 배치 상태 검사 | DB 함수 1회 | SQL(실패 중) | **지울** |
| `/api/backfill/control` POST rollback | 소유자(수동) | 위와 같음 | zod + 확인 문구 | 배치 상태 검사 | DB 함수 1회 | SQL(실패 중) | **지울(조건부)** |

### 경로별 근거와 이유

**`/api/ingest` POST — 다시 (6단계의 유일한 수신 API로 키운다)**
- 좋은 점: 토큰 길이 32자 미만이면 거부, `timingSafeEqual` 비교 (`app/api/ingest/route.ts:14`). 항목 최대 100개, `.strict()` (`:12-13`). 출처·시각·run_id 검사 (`lib/ingest-integrity.ts:47-91`). 같은 배치 안 중복 거부 (`:23-24`). 과거 데이터 재전송 거부 (`:36`). 원천 거래ID 중복 거부 (`:42-55`). 정산·할 일의 완료 상태와 거래 메모는 수신이 덮어쓰지 않는다 (`:64-67`).
- 문제: 읽기(`:29`) → 검사 → upsert(`:75`) 가 **한 트랜잭션이 아니다**. 그 사이에 다른 요청이 끼면 중복 검사가 뚫린다. 또 `sync-runs` 를 따로 보내야 해서 "항목은 들어갔는데 실행 기록은 없음" 상태가 생긴다.
- 문제: 기존 행 조회가 `kind` 없이 `external_id` 만으로 한다 (`:30`). 다른 kind 의 같은 ID까지 읽는다(맵에서 걸러지긴 함).
- 문제: `examples/pickle-payload.json` 은 지금 규칙(environment, run_id, as_of 등)을 지키지 않아 그대로 보내면 422 가 난다. 예시가 낡았다.
- 방향: 검사+upsert+실행 기록을 DB 함수(RPC) 하나로 묶고, 규격 v2(아래 7절)로 manifest 를 함께 받는다.

**`/api/items` — 메서드별**
- PATCH status — 다시: 옛 형식 `{id,status}` 를 아직 받는다 (`app/api/items/route.ts:9,17-18`). 지금 화면이 그 옛 형식을 보낸다 (`components/demo-dashboard.tsx:55`). 또 kind 와 상관없이 아무 행이나 `archived` 로 바꿀 수 있다 (`:6,22`). → 화면을 `action:'status'` 로 바꾼 **뒤** 옛 형식을 지우고, kind 별 허용 상태(정산·할 일만 pending/done)를 둔다.
- PATCH memo — 다시: 메타데이터를 읽고(`:26`) 합쳐서 다시 쓴다(`:29`). 그 사이 수신이 들어오면 한쪽이 사라질 수 있다. → `jsonb_set` 한 번으로 쓰는 DB 함수나 조건부 UPDATE 로 바꾼다.
- POST — 살릴: 사용자 ID는 세션에서만 가져온다 (`:37-41,47`). 단 INSERT 정책이 없어서 `adminDb()` 를 쓴다 (`:46`). 5단계에서 "자기 할 일만 insert" 정책을 만들면 `serverDb()` 로 바꿀 수 있다(RLS 변경이므로 지시가 있을 때만).
- DELETE — 살릴: 실제 삭제가 아니라 `archived` 로 바꿔서 재수신 때 다시 살아나지 않는다 (`:56,64`, 수신 쪽 `app/api/ingest/route.ts:64`).

**`/api/dashboard` GET — 살릴**
- 세션 + RLS 로만 읽는다 (`app/api/dashboard/route.ts:10-12`). 거래는 키셋 페이지로 전부 읽고(`:22-35`), 나머지는 묶음별 500개 (`:15-20`). 동기화 상태 읽기가 실패해도 화면 값은 지킨다 (`:50-52`).
- 아쉬운 점: 요청 한 번에 쿼리가 10개 이상(묶음 9 + 감시 출처 4)이다. 7단계에서 필요하면 뷰나 RPC 로 줄인다. 판정은 바꾸지 않는다.

**`/api/sync-runs` — 메서드별**
- POST — 다시(통합): 검증은 좋다. 성공이면 개수가 맞아야 하고(`app/api/sync-runs/route.ts:21`), 같은 run_id 재전송은 멱등(`:52-58`), 저장된 항목 수와 대조(`:61-67`). 하지만 항목 전송과 따로 놀고, 세고(`:65`) 쓰기(`:69`) 사이에 경쟁이 있으며, 동시 INSERT 충돌(23505)이 멱등 응답이 아니라 503 으로 나간다 (`:70`).
  - **대체 경로:** `/api/ingest` v2 요청의 `run` 블록(run_id, dataset, source_system, source_as_of, collected_at, expected_count …)을 같은 트랜잭션에서 `dashboard_sync_runs` 에 기록.
  - **대체 호출자:** 피클AI 가 v2 로 보낼 때부터. 9단계 전까지는 지금 POST 를 그대로 받는다(7절 호환성).
- GET — 지울: 저장소 안에 부르는 곳이 없다(화면은 `/api/dashboard` 의 `syncHealth` 를 쓴다, `app/api/dashboard/route.ts:47-53`). **대체 경로:** `/api/dashboard` GET. **대체 호출자:** 없음(사람이 볼 땐 Supabase 대시보드나 개발 DB SQL).

**`/api/reconcile/transactions` POST — 지울**
- 읽기 전용 대조(`app/api/reconcile/transactions/route.ts:21`). 카드사 1곳으로 고정된 리터럴(`:12`)과 월·계정 범위를 받는 일회성 도구다. 구조 탭에서도 정리 대상으로 표시했다 (`lib/architecture-content.ts:95`).
- **대체 경로:** v2 수신의 manifest(expected_count, expected_total)를 서버가 같은 트랜잭션에서 검사. 필요하면 개발 DB 에서 SQL 로 대조.
- **대체 호출자:** 피클AI 는 대조를 보내지 않고 v2 manifest 에 숫자를 담는다.
- 살릴 부분: `strongTransactionKey`, `duplicateConflicts` (`lib/transaction-reconciliation.ts:6-23`) 는 ingest 가 쓰므로 남긴다. `reconcileStatement`·`matchesScope` (`:24-58`) 만 지운다.

**`/api/backfill/preview` POST, `/api/backfill/stage` POST — 지울**
- 예전 거래에 원천ID 메타데이터를 덧붙이는 **한 번짜리 백필** 도구 (`docs/ATOMIC_BACKFILL.md`). preview 는 DB 쓰기 없음(`app/api/backfill/preview/route.ts:17`), stage 는 배치를 저장(`app/api/backfill/stage/route.ts:29`). 새 수신은 처음부터 원천ID를 받으므로 다시 쓸 일이 없다.
- **대체 경로/호출자:** 없음(기능 종료). 새 데이터는 v2 수신이 원천ID를 필수로 받는다 (`lib/ingest-integrity.ts:74-77` 규칙 유지).

**`/api/backfill/control` — 메서드별**
- GET — 지울: 소유자만 배치 목록 20개를 본다 (`app/api/backfill/control/route.ts:14-21`). 화면에서 부르는 곳이 없다. **대체:** Supabase SQL 편집기에서 `dashboard_backfill_batches` 조회(서비스 권한).
- POST apply — 지울: `BACKFILL_APPLY_ENABLED` 가 `true` 일 때만 동작 (`:26`). 새 배치를 만들 stage 가 사라지면 쓸 일이 없다.
- POST rollback — **지울(조건부)**. 아래 조건을 지킨다.

#### `/api/backfill/control` 되돌리기를 없앨 때 이미 적용된 배치의 롤백 보장

되돌리기는 DB 함수 `dashboard_backfill_rollback` 이 한다 (`supabase/migrations/20261112000200_atomic_backfill.sql:82-103`). 이 함수는 배치 행의 `after_rows` 에 저장된 바뀌기 전 메타데이터(`before`)로 되돌린다(`:95-98`). 단 적용 뒤에 그 행이 한 번이라도 바뀌었으면 `BACKFILL_ROLLBACK_STALE` 로 멈춘다(`:91-94`). 즉 **API 를 지워도 롤백 정보는 DB 에 있다.** 그래서 이렇게 한다.

**대체 수단 (API 삭제 뒤에도 남김):**
1. 테이블 `dashboard_backfill_batches` 와 함수 `dashboard_backfill_rollback` 은 **API 를 지우는 6단계에서 DROP 하지 않는다.** 소유자가 Supabase SQL 편집기(서비스 권한)에서 `select public.dashboard_backfill_rollback('<사용자UUID>','<배치UUID>','<plan_digest>');` 로 직접 부를 수 있다(값은 예시 자리표시).
2. 롤백 함수가 STALE 로 멈춘 행은 `after_rows[*].before.metadata` 를 보고 사람이 메모 등 이후 변경을 확인한 뒤 수동 SQL 로 되돌린다. 이 절차를 6단계 Issue 에 문서로 남긴다(실데이터 없이).

**폐기 전 충족 조건 (6단계에서 API 파일을 `git rm` 하기 전에 모두 확인):**
- [ ] 운영 DB 에서 `status='staged'` 배치가 0건이거나, 남은 것은 적용하지 않기로 사용자가 결정함.
- [ ] `status='applied'` 배치마다 사용자가 "유지(확정)" 또는 "되돌림" 을 결정하고, 되돌림이면 API 가 있을 때 먼저 실행함.
- [ ] 적용된 배치의 `after_rows` 를 운영 DB 밖(개인 보관소, **저장소 아님**)에 백업함.
- [ ] Vercel 환경변수 `BACKFILL_APPLY_ENABLED` 를 끄거나 지움.
- [ ] 위 확인은 사용자가 운영 DB 에서 직접 한다. AI 는 운영 DB 를 보지 않는다.

테이블·함수의 최종 DROP 은 위 조건 확인 후, 9단계(피클AI 전환)가 끝나고 별도 마이그레이션으로 한다.

---

## (3) DB

### 선언된 것 목록

| 종류 | 이름 | 위치 | 판정 | 이유 |
|---|---|---|---|---|
| 테이블 | `dashboard_items` | `supabase/migrations/20261112000000_baseline.sql:2-9` | **다시** | 본 데이터. 그대로 쓰되 상태 체크·정책을 손본다 |
| 테이블 | `dashboard_sync_runs` | `supabase/migrations/20261112000100_sync_runs.sql:3-23` | **살릴** | 실행 기록. v2 수신이 같은 트랜잭션에서 쓴다 |
| 테이블 | `dashboard_backfill_batches` | `supabase/migrations/20261112000200_atomic_backfill.sql:2-17` | **지울(조건부)** | 일회성. 롤백 정보 보관 때문에 9단계 뒤 DROP |
| 함수 | `set_updated_at` + 트리거 | `supabase/migrations/20261112000000_baseline.sql:11-13` | **살릴** | 수정 시각 자동 기록 |
| 함수 | `dashboard_backfill_inventory` | `…atomic_backfill.sql:24-30` | **지울** | 백필 전용 |
| 함수 | `dashboard_backfill_apply` | `…atomic_backfill.sql:32-80` | **지울** | 백필 전용. 표 전체 잠금(`:41`) |
| 함수 | `dashboard_backfill_rollback` | `…atomic_backfill.sql:82-103` | **지울(조건부)** | 2절 조건 충족 전까지 남김 |
| 정책 | "read own items" (select) | `supabase/migrations/20261112000000_baseline.sql:17` | **살릴** | 자기 행만 읽기 |
| 정책 | "update own items" (update) | `supabase/migrations/20261112000000_baseline.sql:18` | **다시** | 모든 컬럼 수정 허용(6절) |
| 정책 | "read own sync runs" (select) | `…sync_runs.sql:27` | **살릴** | 쓰기는 revoke(`:29`) |

기타: 인덱스 `dashboard_items_user_kind_date`(`schema.sql:10`), `dashboard_sync_runs_latest`(`sync_runs.sql:24`) 는 살린다. `dashboard_backfill_batches` 는 RLS 를 켜고 정책 없이 모든 권한을 revoke 한 뒤 service_role 에만 줬다(`atomic_backfill.sql:18-20`). 백필 함수 3개도 service_role 만 실행할 수 있다(`:29-30,79-80,102-103`).

### 눈에 띄는 문제
- `dashboard_items.status` 체크는 4개 값만 허용한다(`schema.sql:6`). ingest 는 `deleted` 와 구독 중지 상태를 받아 `archived`/`active` 로 바꿔 저장하므로(`lib/dashboard-visibility.ts:13-17`) 지금은 맞는다. 하지만 데모 데이터의 `accepted`·`rejected`(`lib/demo-data.ts:21-22`)는 DB 에 넣을 수 없다. 혜택 신청 결과 상태가 필요하면 7단계 전에 정해야 한다.
- INSERT 정책이 없어 할 일 추가가 service role 을 쓴다(`app/api/items/route.ts:46`).
- `metadata->>source_record_id`, `metadata->>run_id` 로 찾는 쿼리(`app/api/ingest/route.ts:47`, `app/api/sync-runs/route.ts:61`)에 맞는 인덱스가 없다. 데이터가 늘면 느려진다.

### 개발 DB(5단계)에 그대로 적용 가능한가
- `schema.sql` → 가능. Supabase 의 `auth.users` 를 참조하므로 Supabase 프로젝트에서 바로 돈다.
- `20261112_sync_runs.sql` → 가능. `auth.users` 만 필요.
- `20261112_atomic_backfill.sql` → 돌긴 하지만 **개발 DB 에는 넣지 않는 것을 권한다.** 6단계에서 지울 기능이고, 표 전체 잠금 함수가 생긴다.

### 마이그레이션 순서 문제
1. `schema.sql` 은 `migrations/` 밖에 있어 Supabase CLI(`supabase db push`)가 적용하지 않는다. 기준선 마이그레이션이 없다.
2. 두 마이그레이션의 버전 앞자리가 똑같이 `20261112` 다. Supabase CLI 는 파일 이름의 숫자 앞부분을 버전으로 쓰므로 두 파일이 같은 버전으로 겹친다(정적 판단, 실행 안 함).
3. 이름순으로는 `atomic_backfill` 이 `sync_runs` 보다 먼저다. 둘 사이 의존은 없지만, `atomic_backfill` 은 `dashboard_items` 행 타입을 쓰므로(`atomic_backfill.sql:36`) **반드시 schema.sql 뒤**여야 한다.
4. 운영 DB 에 무엇이 적용됐는지 기록이 저장소에 없다(파일 주석상 "SQL 편집기에서 직접 적용", `sync_runs.sql:2`).
- 고칠 방향(5단계): `supabase/migrations/<시각>_baseline.sql`(= 지금 schema.sql), `<시각+1>_sync_runs.sql` 처럼 **버전이 겹치지 않게** 다시 나열한다. 운영 DB 는 사용자가 이미 적용된 것으로 표시만 하고(AI 는 운영 DB 접근 안 함), 개발 DB 는 처음부터 순서대로 적용한다.

---

## (4) lib/ · components/ · app/

### lib/ 모듈

| 모듈 | 역할 | 구분 | 판정 |
|---|---|---|---|
| `supabase.ts` | 브라우저 클라이언트(공개 키만) | 운영 공용 | 살릴 |
| `supabase-server.ts` | 서버 세션 클라이언트 + service role 클라이언트 | 운영(서버 전용) | 살릴 |
| `dashboard-visibility.ts` | 숨김 규칙, 수신 상태 정규화 | 운영 공용 | 살릴 |
| `dashboard-display.ts` | 시각·구독·포인트 표시 계산 | 운영 공용 | 살릴 |
| `dashboard-freshness.ts` | 출처별 최신 여부, 응답 형태 검사 | 운영 공용 | 다시 |
| `sync-audit.ts` | dataset 목록·매핑 | 운영 공용 | 살릴 |
| `ingest-integrity.ts` | 운영 수신 검증 규칙 | 운영(서버) | 다시 |
| `transaction-time.ts` | 결제 시각 추출 | 운영 공용 | 살릴 |
| `transaction-reconciliation.ts` | 원천ID 중복 키 + 명세서 대조 | 운영(서버) | 다시 |
| `transaction-backfill.ts` | 백필 미리보기·지문 | 일회성 | 지울 |
| `backfill-plan-schema.ts` | 백필 계획 zod 스키마 | 일회성 | 지울 |
| `demo-data.ts` | 가짜 데이터 | 데모 전용 | 지울 |
| `architecture-content.ts` | 구조 탭 내용 | 운영 공용(정적) | 살릴 |

- `dashboard-freshness.ts` 다시: 감시 출처 4개가 코드에 박혀 있다(`:2-7`). 화면 문구에 서비스 이름이 들어가 있다. 6단계에서 v2 규격의 출처 목록과 한곳에서 관리한다.
- `ingest-integrity.ts` 다시: 출처·검증 출처 허용 목록이 코드에 박혀 있다(`:20-41`). 알려진 가짜 ID 목록(`:8-11`)은 옛 사고 대응용이다. v2 에서 규칙을 정리하고 테스트를 함께 옮긴다.
- `transaction-reconciliation.ts` 다시: 2절처럼 앞 절반은 살리고 `reconcileStatement` 는 지운다.

### components/ · app/

| 파일 | 역할 | 구분 | 판정 |
|---|---|---|---|
| `app/page.tsx` | 로그인 확인 후 운영 화면 | 운영 | 살릴 (가리키는 컴포넌트만 바꿈) |
| `app/login/page.tsx` | 이메일 로그인 | 운영 | 살릴 |
| `app/demo/page.tsx` | 가짜 데이터 화면 | 데모 전용 | 지울 |
| `components/architecture-screen.tsx` | 구조 탭 | 운영 공용 | 살릴 |
| `components/demo-dashboard.tsx` | **운영+데모 화면 전체** (374줄) | 섞임 | 다시 |
| `components/demo-calendar.tsx` | 기록 탭 달력 | 이름만 데모, 실제 운영 공용 | 다시(이름 변경) |
| `components/demo-daily-spending.tsx` | 일별 지출·메모 | 이름만 데모, 실제 운영 공용 | 다시(이름 변경) |
| `components/dashboard.tsx` | 옛 화면 | **아무도 import 안 함** | 지울 |

### demo-dashboard.tsx 가 운영 화면을 겸하는 문제
- 운영 첫 화면이 `@/components/demo-dashboard` 를 쓴다(`app/page.tsx:3-4`). 데모 페이지도 같은 컴포넌트에 `demoData` 만 넘긴다(`app/demo/page.tsx:1-6`).
- `isDemo` 가 나오는 줄이 19줄이다(`components/demo-dashboard.tsx:18,19,20,23,35,36,37,40,42,43,48,55,59,75,83,88,96,152,208`). 운영 코드를 고칠 때마다 데모 분기를 같이 건드려야 하고, 데모 전용 동작(샘플 초기화 `:84`, 고정 날짜 `:15,152`)이 운영 번들에 들어간다.
- 탭은 6개다: 다섯 탭 + 구조 탭(`:16`). 구조 탭은 데이터 로딩과 상관없이 먼저 그린다(`:209`). 이 구조는 유지한다.
- 연결된 것: 화면 테스트가 `/demo` 를 연다(`scripts/screens/run.mjs:1,30,45`). 구조 탭 테스트가 `demo-dashboard.tsx` 파일을 직접 읽는다(`tests/architecture-content.test.mjs:76-82`). **데모를 지우면 이 둘을 먼저 옮겨야 한다.**

**7단계 분리안**
1. `components/dashboard/` 폴더로 나눈다: `DashboardShell`(헤더·하단 탭·새로고침), 탭별 `HomeTab`·`FinanceTab`·`NewsTab`·`BenefitsTab`·`JournalTab`, 기존 `ArchitectureScreen`.
2. 데이터 읽기·쓰기(`/api/dashboard`, `/api/items` 호출)는 `useDashboardData` 훅 하나로 모은다. 화면 컴포넌트에는 `isDemo` 가 없게 한다.
3. `demo-calendar` → `journal-calendar`, `demo-daily-spending` → `daily-spending` 으로 이름을 바꾼다.
4. 화면 테스트용 가짜 데이터는 운영 번들이 아닌 테스트 쪽에 둔다(예: Playwright 에서 `/api/dashboard` 응답을 가짜 JSON 으로 가로채기). 그다음 `app/demo/`, `lib/demo-data.ts` 를 `git rm` 한다.
5. 구조 탭 테스트는 새 파일 경로를 보도록 바꾼다.

### 죽은 코드
- `components/dashboard.tsx` 전체(38줄): import 하는 곳 없음(전체 검색 결과 0건).
- `/api/items` 의 옛 형식 처리(`app/api/items/route.ts:9,17`): 화면을 바꾸면 죽는다.
- `/api/backfill/preview` 의 RPC 없을 때 대비 경로(`app/api/backfill/preview/route.ts:30-38`): 마이그레이션 적용 전 호환용. API 와 함께 지운다.
- `tests/test_stage_envelope.py` 는 저장소 코드를 하나도 import 하지 않고 자기 안의 mock 만 검사한다(`:12-16,134-143`). 존재하지 않는 `/api/ingest/publish` 를 가정한다.

---

## (5) 테스트

### 종류별 개수 (`npm test` 대상 기준, `scripts/orch/*.test.mjs` 는 엔진용이라 제외)

| 종류 | 파일 | 테스트 수 | 무엇을 보나 |
|---|---|---|---|
| Node `tests/*.test.mjs` | 7 | 51 | lib 순수 함수(검증·숨김·대조·백필·신선도) + 구조 탭 내용 |
| Python `tests/test_*.py` | 4 | 39 | `scripts/ingest_gate.py`, `scripts/verify_report_invariants.py` (mock 네트워크) |
| SQL `tests/atomic-backfill.test.sql` | 1 | DO 블록 2개 | 백필 apply/rollback 원자성 (dashboard-qa 의 PostgreSQL 잡에서만) |

파일별: architecture-content 10, dashboard-freshness 4, dashboard-visibility 6, ingest-integrity 9, sync-audit 4, transaction-backfill 9, transaction-reconciliation 9 / test_daily_recovery_pipeline 3, test_ingest_gate 13, test_report_invariants 20, test_stage_envelope 3.

판정: 살릴 5(freshness, visibility, ingest-integrity, sync-audit, report_invariants) · 다시 5(architecture-content: 파일 경로 결합, transaction-reconciliation: 대조 부분 제거, test_ingest_gate·test_daily_recovery_pipeline: 운영 주소 제거, atomic-backfill.test.sql: 버그 수정 후 기능과 함께 정리) · 지울 2(transaction-backfill.test, test_stage_envelope).

### 빠진 것
- **실제 DB 연동 테스트 없음.** RLS(다른 사용자 행 못 읽기), upsert 충돌 키, 트리거, sync_runs 체크 제약을 진짜 Postgres 에서 확인하는 테스트가 없다. SQL 테스트는 백필만 보고, `sync_runs` 마이그레이션은 아예 불러오지 않는다(`tests/atomic-backfill.test.sql:9-10`).
- **API 라우트 테스트 없음.** 토큰 없음/틀림 → 401, 세션 없음 → 401, `DASHBOARD_USER_ID` 불일치, 같은 출처 검사(`app/api/backfill/control/route.ts:24`), 422/409 응답 형태를 확인하는 테스트가 없다.
- 화면 테스트(`npm run screens`)는 `/demo` 만 본다. 로그인 후 운영 화면은 안 본다.

### dashboard-qa `atomic-backfill` 잡 실패 원인 — 정적 분석(실행 안 함, 실제 실행은 dashboard-qa 의 PostgreSQL 잡)

증상: `invalid input syntax for type integer: "metadata"`, 위치는 42행 근처(첫 번째 `DO $$ … $$` 블록이 끝나는 줄, `tests/atomic-backfill.test.sql:42`). psql 은 DO 블록 오류를 블록 끝 줄로 알려 주므로 실제 원인은 그 블록 안에 있다.

원인 줄 (`tests/atomic-backfill.test.sql:37`):
```sql
if (public.dashboard_backfill_inventory(u)->0-'metadata'-'updated_at')<>(before1-'metadata'-'updated_at') then ...
```
- PostgreSQL 에서 산술 `-` 는 `->` 같은 일반 연산자보다 **우선순위가 높다.** 그래서 왼쪽은 `inventory(u) -> ((0 - 'metadata') - 'updated_at')` 로 읽힌다.
- `0 - 'metadata'` 에서 `'metadata'` 는 타입이 정해지지 않은 문자열이라 왼쪽 `0` 에 맞춰 integer 로 바꾸려 하고, 거기서 위 오류가 난다. 오류 메시지의 `"metadata"` 와 정확히 맞는다.
- 오른쪽 `before1-'metadata'-'updated_at'` 은 `before1` 이 jsonb 변수라 `jsonb - text` 로 정상 해석된다. 같은 패턴인 마이그레이션 `:71` 도 괄호 안 변수라 문제없다.
- 같은 파일의 다른 줄(`:34,38,39,41,59,68`)은 `->`/`->>` 뒤에 비교 연산자(`<>`)만 있어 괜찮다. 비교 연산자는 `->` 보다 우선순위가 낮다.
- 이 잡은 pull request 가 아니라 main 푸시·매일 스케줄에만 돈다(`.github/workflows/dashboard-qa.yml:2-21`). 그래서 이 버그가 PR 검사에서 걸리지 않았다.

고칠 방향 (5단계 Issue, 이번 스텝에서는 고치지 않음):
```sql
if ((public.dashboard_backfill_inventory(u)->0)-'metadata'-'updated_at')<>(before1-'metadata'-'updated_at') then ...
```
- `->0` 을 괄호로 묶어 jsonb 를 먼저 꺼낸 뒤 키를 뺀다. 고친 뒤 같은 잡에서 두 번째 DO 블록(`:43-69`)까지 통과하는지 확인한다(정적으로는 문제 없어 보임).
- 백필 기능을 6단계에서 지우면 이 테스트도 같이 지우거나, 개발 DB 연동 테스트(5단계)로 대체한다. 롤백 함수를 남겨 두는 동안에는 rollback 부분 검사는 남길 가치가 있다.

---

## (6) 보안 · 공개 저장소 점검

**service role 키 사용 위치** — `SUPABASE_SERVICE_ROLE_KEY` 는 `lib/supabase-server.ts:27` 에서만 읽는다. 이 파일은 `next/headers` 를 import 하므로 클라이언트 컴포넌트에서 쓸 수 없다. `adminDb()` 호출 위치: `app/api/ingest/route.ts:27`, `app/api/items/route.ts:46`(POST), `app/api/sync-runs/route.ts:48`, `app/api/reconcile/transactions/route.ts:29`, `app/api/backfill/preview/route.ts:25`, `app/api/backfill/stage/route.ts:22`, `app/api/backfill/control/route.ts:17,31`. 클라이언트(`lib/supabase.ts:5-6`)는 `NEXT_PUBLIC_` 값만 쓴다. ✅

**ingest 토큰 비교** — 다섯 곳 모두 비밀값 32자 미만 거부 + 길이 비교 후 `timingSafeEqual`. 문제는 없지만 **복사본 5개**라 한 곳만 고쳐지는 위험이 있다. 6단계에서 `lib/collector-auth.ts` 하나로 모은다. 길이가 다르면 바로 false 라 토큰 길이는 시간으로 드러날 수 있지만, 길이는 비밀이 아니므로 허용 범위다.

**RLS 우회 경로**
- service role 쓰는 모든 경로(위 목록)는 RLS 를 우회한다. 이 경로들은 `DASHBOARD_USER_ID`(수집기) 또는 세션 사용자 ID(items POST, control)로 `user_id` 를 직접 넣어서 막는다.
- "update own items" 정책(`supabase/migrations/20261112000000_baseline.sql:18`)은 **모든 컬럼** 수정을 허용한다. 로그인한 사용자는 공개 키 + 세션으로 PostgREST 에 직접 요청해 자기 행의 금액·kind·메타데이터를 바꿀 수 있다. 1인용이라 위험은 낮지만, 수신 데이터 무결성 규칙(`lib/ingest-integrity.ts`)을 건너뛰는 길이다. → 6단계에서 화면 수정은 API 만 쓰게 하고, 정책을 상태·메모만 바꾸는 함수로 좁힐지 결정(RLS 변경이라 지시 필요).
- 백필 함수는 `security invoker` + service_role 만 실행(`atomic_backfill.sql:25,29-30` 등). 클라이언트 실행 불가를 SQL 테스트가 확인한다(`tests/atomic-backfill.test.sql:19-20`).
- control 은 같은 출처 검사(`app/api/backfill/control/route.ts:24`) + 소유자 UUID 일치(`:12`) + 실행 스위치(`:26`). 지울 때까지 유지.

**로그 출력**
- `app/`·`lib/`·`components/` 에 `console.*` 출력이 없다(검색 0건). ✅
- 422 응답이 zod 오류 상세를 그대로 돌려준다(`app/api/ingest/route.ts:21`, `app/api/sync-runs/route.ts:45`, `app/api/reconcile/transactions/route.ts:27`, `app/api/backfill/preview/route.ts:23`). 토큰을 가진 수집기만 받으므로 괜찮지만, 입력값 일부가 오류 메시지에 들어갈 수 있으니 수집기 쪽 로그에 남기지 않게 v2 규격에 적는다.
- `scripts/ingest_gate.py:57` 은 오류 메시지에 허용 주소 목록 전체를 넣는다. 이 오류가 Actions 로그에 찍히면 운영 주소가 공개된다.
- `scripts/verify_report_invariants.py:310-315` 는 검증 로그를 표준출력에 찍는다. 실데이터로 CI 에서 돌리면 숫자가 공개 로그에 남는다. CI 에서는 가짜 데이터만 쓴다.

**남은 개인정보 위험 (값은 여기 옮기지 않음)**
- 운영 배포 주소가 박혀 있음: `scripts/ingest_gate.py:32-34,156`, `tests/test_ingest_gate.py:72,132,147,164,195`, `tests/test_daily_recovery_pipeline.py:53,142`, `docs/AI_COLLABORATION.md:24`. → 8단계 전에 환경변수(`DASHBOARD_INGEST_URL` 같은 이름)와 가짜 주소로 바꾼다.
- 실제처럼 보이는 포인트 잔액 숫자와 서비스명 조합: `tests/test_daily_recovery_pipeline.py:22-31`. → `합성포인트A` 같은 가짜 값으로 바꾼다.
- 개인 일정이 드러나는 지명 예시: `scripts/verify_report_invariants.py:9` 주석. → 일반 문구로 바꾼다.
- 실제 백필 결과 건수: `docs/ATOMIC_BACKFILL.md:8`. → 숫자를 지운다.
- 어떤 카드사·포인트 서비스를 쓰는지가 코드 리터럴로 드러난다(`lib/dashboard-freshness.ts:3-6`, `lib/ingest-integrity.ts:20-39`, `app/api/reconcile/transactions/route.ts:12`, `lib/backfill-plan-schema.ts:3`). 개인 식별 정보는 아니지만, v2 에서 출처 이름을 설정으로 빼면 노출이 줄어든다.
- 개인정보 검사(`scripts/orch/pii-scan.mjs`)는 **추가된 줄만** 본다. 위 항목은 이사 때 이미 들어간 줄이라 검사에 안 걸린다.

---

## (7) 단계별 할 일 (roadmap 번호 기준)

위험도: 낮음 = 문서·테스트만 · 중간 = 코드 변경, 운영 영향 없음 · 높음 = 운영 데이터·수신 경로에 영향.

### 5단계 · 개발 DB 연결

| # | 제목 | 범위 (한 줄) | 위험도 |
|---|---|---|---|
| 5-1 | atomic-backfill SQL 테스트 고치기 | `tests/atomic-backfill.test.sql:37` 에 괄호 추가, dashboard-qa 통과 확인 | 낮음 |
| 5-2 | 마이그레이션 기준선 정리 | schema.sql 을 baseline 마이그레이션으로, 버전 겹침 해소, 적용 순서 README | 중간 |
| 5-3 | 개발 DB 적용 | 사용자가 만든 개발 Supabase 에 baseline + sync_runs 만 적용(백필 제외) | 중간 |
| 5-4 | 가짜 데이터 시드 | `supabase/seed.sql` 에 `친구A`·`합성가맹점A` 같은 가짜 행, 데모 데이터 대신 사용 | 낮음 |
| 5-5 | DB 연동 테스트 | 개발 DB(또는 CI Postgres)에서 RLS·upsert 키·트리거·sync_runs 제약 검사 | 중간 |
| 5-6 | API 라우트 인증 테스트 | 토큰·세션 없음 401, 소유자 불일치, 같은 출처 403 을 라우트 단위로 검사 | 낮음 |
| 5-7 | 운영 주소·실데이터 흔적 제거 | 6절 목록의 주소·숫자·지명을 환경변수·가짜 값으로 교체 | 중간 |

### 6단계 · 데이터 수신 재설계

| # | 제목 | 범위 (한 줄) | 위험도 |
|---|---|---|---|
| 6-1 | 피클AI 규격 v2 문서 | `docs/` 에 v2 요청 형식(run 블록 + items + manifest), v1 과의 차이, 예시는 가짜 값 | 낮음 |
| 6-2 | 수신 트랜잭션 함수 | 검사·upsert·sync_runs 기록을 DB 함수 하나로, `/api/ingest` 가 v1·v2 둘 다 받음 | 높음 |
| 6-3 | 수집기 인증 공통화 | 토큰 비교 5벌을 `lib/collector-auth.ts` 하나로 | 중간 |
| 6-4 | `/api/sync-runs` POST 를 ingest 로 통합 | v2 는 ingest 가 기록, 옛 POST 는 9단계까지 호환으로만 유지, GET 은 삭제 | 중간 |
| 6-5 | 일회성 API 4개 정리 | reconcile·backfill preview/stage/control 과 전용 lib·테스트 `git rm` (2절 롤백 조건 확인 후) | 높음 |
| 6-6 | `/api/items` 정리 | 화면을 `action:'status'` 로 바꾼 뒤 옛 형식 삭제, kind 별 상태 제한, 메모 원자적 저장 | 중간 |
| 6-7 | 예시 페이로드 갱신 | `examples/pickle-payload.json` 을 v2 가짜 예시로, 테스트로 검증 | 낮음 |

### 7단계 · 화면 정리·디자인

| # | 제목 | 범위 (한 줄) | 위험도 |
|---|---|---|---|
| 7-1 | 화면 테스트를 데모에서 떼기 | `scripts/screens/run.mjs` 가 가짜 `/api/dashboard` 응답으로 운영 화면을 보게 | 중간 |
| 7-2 | demo-dashboard 분리 | 셸 + 탭 5개 + 구조 탭 + `useDashboardData` 훅으로 나누고 `isDemo` 제거 | 중간 |
| 7-3 | 데모 삭제 | `app/demo/`, `lib/demo-data.ts`, `components/dashboard.tsx` `git rm` | 낮음 |
| 7-4 | 이름 정리 | `demo-calendar`·`demo-daily-spending` 이름 변경, 구조 탭 테스트 경로 갱신 | 낮음 |
| 7-5 | 디자인 개선 | 다섯 탭 구성은 유지한 채 스타일 정리, 사용자 화면 확인 | 중간 |
| 7-6 | 대시보드 읽기 줄이기(선택) | `/api/dashboard` 쿼리 10여 개를 뷰/RPC 로 줄일지 측정 후 결정 | 낮음 |

### 8단계로 넘길 조건 (배포 분리 전제)
- **환경:** 개발계와 운영계가 다른 Vercel 프로젝트(또는 환경)이고, 개발계 배포가 운영 DB 를 가리킬 수 없다.
- **DB:** 개발 Supabase 에 마이그레이션이 순서대로 적용되고(5-2·5-3), DB 연동 테스트가 개발 DB/CI Postgres 에서 통과한다(5-5). 운영 DB 에 남은 백필 배치 결정이 끝났다(2절 체크리스트).
- **비밀값:** `SUPABASE_SERVICE_ROLE_KEY`, `PICKLE_INGEST_TOKEN`, `DASHBOARD_USER_ID` 가 개발·운영에서 **서로 다른 값**이다. 개발 토큰으로 운영 수신이 안 된다. `BACKFILL_APPLY_ENABLED` 는 운영에서 꺼져 있거나 없다.
- **코드:** 저장소 어디에도 운영 주소가 없다(5-7). 수신 주소는 환경변수로만 정한다. dashboard-qa 가 초록이다(5-1).

### 9단계 전환 전까지 유지할 호환성
지금 피클AI 가 쓰는 경로·형식(저장소 근거: `scripts/ingest_gate.py:31-35,139-190`, `docs/AI_COLLABORATION.md`)은 **9단계에서 사용자가 피클AI 설정을 v2 로 바꾸고, 새 규격 수신이 확인될 때까지** 그대로 받는다.

| 지금 쓰는 것 | 유지 내용 | 언제까지 |
|---|---|---|
| `POST /api/ingest` v1 본문 `{items, validate_only}` | 필드·검증 규칙·응답(`upserted`, `violations`, 401/400/409/422) 그대로 | 9단계 완료 + v2 수신 확인 후 v1 제거 Issue |
| `Authorization: Bearer <PICKLE_INGEST_TOKEN>` | 같은 헤더·같은 비밀값 | 8단계에서 운영 값 유지, 9단계 뒤 교체 가능 |
| upsert 키 `user_id,kind,external_id` | 같은 `external_id` 재전송 = 갱신 | 계속(v2 도 같은 키) |
| `metadata` 필수 키 (environment, is_synthetic, source_system, verification_source, as_of, verified_at, run_id) | v1 에선 계속 필수 | 9단계 완료까지 |
| `POST /api/sync-runs` 실행 보고 | 형식·멱등·409 규칙 그대로(6-4 에서 내부만 바꿈) | 9단계 완료까지, 이후 삭제 |
| `X-Payload-Digest`, `X-Request-Body-SHA256` 헤더 | 서버는 지금도 읽지 않음. 보내도 오류 없게 유지 | v2 에서 서버 검증 여부 결정 |
| `/api/backfill/preview` | 수집기 허용 목록에 있지만 6단계에 삭제. 삭제 전 피클AI 가 더 부르지 않는지 사용자 확인 | 6-5 전까지 |

v2 를 추가할 때 v1 요청이 계속 통과하는지 확인하는 회귀 테스트를 6-2 에 반드시 넣는다.
