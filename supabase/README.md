# supabase/

DB 스키마는 `supabase/migrations/` 의 파일만이 기준이다. 파일 이름 앞의 버전(`YYYYMMDDHHMMSS`)은 서로 겹치지 않고, **이름순이 곧 적용 순서**다.

| 순서 | 파일 | 내용 |
|---|---|---|
| 1 | `migrations/20261112000000_baseline.sql` | 기준선(예전 `supabase/schema.sql` 과 같은 내용). `dashboard_items`, `set_updated_at` 트리거, RLS 정책 2개 |
| 2 | `migrations/20261112000100_sync_runs.sql` | `dashboard_sync_runs` 실행 기록 표와 읽기 정책 (예전 `20261112_sync_runs.sql`, 내용 그대로) |
| 3 | `migrations/20261112000200_atomic_backfill.sql` | 일회성 메타데이터 백필 표·함수 (예전 `20261112_atomic_backfill.sql`, 내용 그대로). `dashboard_items` 행 타입을 쓰므로 1 뒤여야 한다 |
| 4 | `migrations/20261124000000_ingest_commit.sql` | `dashboard_sync_runs.commit_source` 열(기존 행·`/api/sync-runs` 기록은 `report`) + 수신 커밋 함수 `dashboard_ingest_commit`(service_role 전용). 계획 ③에서 API 가 사용한다. `/api/sync-runs` GET(`select('*')` 응답)은 6단계 ④에서 삭제(405)됐다. 실행 기록 요약은 `/api/dashboard` 응답의 `syncHealth`(대시보드 상태 요약, `app/api/dashboard/route.ts` 47~54행)로 본다 |
| 5 | `migrations/20261124000100_ingest_support.sql` | 메모 원자 갱신 `dashboard_item_set_memo`(authenticated·service_role, RLS 그대로, `/api/items` 메모 수정이 사용), 원천 거래ID 정규화 `dashboard_norm_id`(양끝의 JS `trim()` 공백 집합 제거), 키셋 페이지 조회 `dashboard_ingest_existing`·`dashboard_ingest_candidates`(jsonb `{rows, next_after}`, service_role 전용), `dashboard_ingest_commit` 재정의(후보 비교만 `dashboard_norm_id` 규칙으로). 4 뒤여야 한다 |

## 개발 DB

빈 DB 에 처음부터 위 순서대로 **전부** 적용한다. CI 의 `db` 잡이 같은 일을 한다: 일회용 PostgreSQL 에 `tests/db/auth-stub.sql`(Supabase 의 auth 스키마·역할·기본 권한을 흉내 내는 테스트 전용 파일, Supabase 에 적용 금지) → `supabase/migrations/*.sql` 이름순 → `supabase/seed.sql` → `tests/db/*.test.sql` 순서로 실행한다.

- `seed.sql` 은 **개발·테스트 DB 전용 가짜 데이터**다(운영 DB 적용 금지). 고정 사용자 A(`…0000a1`)·B(`…0000b1`), kind 별 1~2개의 `dashboard_items`(`친구A`·`합성가맹점A` 등, `metadata.environment='development'`, `is_synthetic=true`), `dashboard_sync_runs` 1행. 모든 insert 가 충돌 시 do nothing 이라 재실행해도 성공한다.
- `tests/db/10~60_*.test.sql` 은 RLS, 클라이언트 쓰기 권한, upsert, `updated_at` 트리거, 체크 제약, 시드 재적용을 확인한다. 데이터를 바꾸는 테스트는 `begin … rollback` 안에서만 바꾼다.
- `tests/db/70_ingest_commit.test.sql` 은 수신 커밋 함수의 계약(재전송·충돌 판정, 기대 상태 확인, 부분 갱신, 입력 오류 22023, 권한)을 한 세션에서, `75_ingest_concurrency.test.sql` 은 `dblink` 로 연 다른 연결과의 잠금 대기·동시 제출을 확인한다. 75 는 다른 연결이 커밋한 test-only 행을 파일 끝에서 지우고 남지 않았음을 단언한다.
- `tests/db/80_ingest_support.test.sql` 은 5번 파일의 함수(메모 원자 갱신, 원천ID 정규화, 페이지 조회, 커밋 후보 비교)를 한 트랜잭션에서, 메모 갱신이 커밋 함수의 표 잠금을 기다리는지를 `dblink` 다른 연결로 확인한다.
- `tests/db/90_no_backfill_dependency.test.sql` 은 3번 백필 파일을 뺀 나머지 마이그레이션만 새로 만든 DB 에 적용해, 백필 표가 없고 수신 함수 5개가 있으며 수신 커밋·메모 갱신이 동작하는지 확인한 뒤 그 DB 를 지운다. **90 은 일회용 CI DB(`app_test`)에서만 동작**한다(`GITHUB_ACTIONS` 가 `true` 가 아니면 아무것도 만들지 않고 건너뜀, CI 에서 DB 이름이 `app_test` 가 아니면 실패).

## 운영 DB — 적용 상태 미확인

- 운영 DB 에 어떤 SQL 이 언제 적용됐는지는 **기록이 없어 미확인**이다. 이번 파일 정리(기준선 추가, 버전 이름 변경)는 운영 DB 에 아무것도 하지 않았다.
- 기존 DB 에 새 버전 파일을 **자동으로 재적용하지 말 것** (`supabase db push` 등). 버전 이름이 바뀌어서 이미 적용된 내용도 "새 마이그레이션" 으로 보일 수 있다.
- 4번 `20261124000000_ingest_commit.sql` 은 **③(API 가 수신 커밋 함수를 쓰는 변경) 배포 전에 운영자가 적용해야 한다(8단계에서 함께 결정)**. 적용 전에 ③을 배포하면 함수가 없어 수신이 실패한다.
- 5번 `20261124000100_ingest_support.sql` 도 같은 시점에 4번 뒤에 적용해야 한다. 적용 전에 배포하면 `/api/items` 메모 저장이 함수가 없어 400 으로 실패한다.
- 3번 백필 파일(`20261112000200_atomic_backfill.sql`, 백필 API 는 6단계 ⑤에서 삭제됨):
  - 확인된 사실: 2026-11-24 사용자 확인: 그 시점 운영 DB 에 `dashboard_backfill_batches` 표가 없었다(42P01).
  - 검증된 사실: 백필 파일 없이도 뒤 마이그레이션이 적용되고 동작함(`tests/db/90`).
  - 결정은 아직: 과거 적용 이력과 8단계에 적용할 파일 목록은 운영자가 아래 읽기 전용 쿼리로 대조한 뒤 정한다.
- 적용 내역 대조와 마이그레이션 이력 정합화(예: 이미 적용된 버전을 적용됨으로 표시)는 **운영자가 따로 판단**한다. AI 는 운영 DB 에 접근하지 않는다.

### 대조 절차 (운영자용, 읽기만)

운영자가 Supabase SQL Editor 에서 아래처럼 객체가 있는지 읽어 보고, 각 파일이 만든 객체가 이미 있는지 판단한다.

```sql
select to_regclass('public.dashboard_items')            as baseline_table,
       to_regclass('public.dashboard_sync_runs')        as sync_runs_table,
       to_regclass('public.dashboard_backfill_batches') as backfill_table;
select tgname from pg_trigger where tgrelid = 'public.dashboard_items'::regclass and not tgisinternal;
select polrelid::regclass, polname from pg_policy where polrelid::regclass::text like 'dashboard_%';
-- 4·5번 마이그레이션 판단용
select column_name from information_schema.columns
 where table_schema='public' and table_name='dashboard_sync_runs' and column_name='commit_source';
select to_regprocedure('public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)'),
       to_regprocedure('public.dashboard_ingest_existing(uuid,text[],uuid,integer)'),
       to_regprocedure('public.dashboard_ingest_candidates(uuid,text[],uuid,integer)'),
       to_regprocedure('public.dashboard_item_set_memo(uuid,text)'),
       to_regprocedure('public.dashboard_norm_id(text)');
```

객체가 있다는 것과 그 마이그레이션 적용 이력은 별개다. 이력은 운영자가 따로 대조한다.

없는 객체에 해당하는 파일만, 내용을 확인한 뒤 필요할 때 적용한다. 있는 객체의 정의가 파일과 다르면 덮어쓰지 말고 먼저 차이를 확인한다.

배포할 때는 [docs/DEPLOY.md](../docs/DEPLOY.md) 의 배포 전 점검표를 따른다.
