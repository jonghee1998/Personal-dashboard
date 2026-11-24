# supabase/

DB 스키마는 `supabase/migrations/` 의 파일만이 기준이다. 파일 이름 앞의 버전(`YYYYMMDDHHMMSS`)은 서로 겹치지 않고, **이름순이 곧 적용 순서**다.

| 순서 | 파일 | 내용 |
|---|---|---|
| 1 | `migrations/20261112000000_baseline.sql` | 기준선(예전 `supabase/schema.sql` 과 같은 내용). `dashboard_items`, `set_updated_at` 트리거, RLS 정책 2개 |
| 2 | `migrations/20261112000100_sync_runs.sql` | `dashboard_sync_runs` 실행 기록 표와 읽기 정책 (예전 `20261112_sync_runs.sql`, 내용 그대로) |
| 3 | `migrations/20261112000200_atomic_backfill.sql` | 일회성 메타데이터 백필 표·함수 (예전 `20261112_atomic_backfill.sql`, 내용 그대로). `dashboard_items` 행 타입을 쓰므로 1 뒤여야 한다 |

## 개발 DB

빈 DB 에 처음부터 위 순서대로 **전부** 적용한다. CI 의 `db` 잡이 같은 일을 한다: 일회용 PostgreSQL 에 `tests/db/auth-stub.sql`(Supabase 의 auth 스키마·역할·기본 권한을 흉내 내는 테스트 전용 파일, Supabase 에 적용 금지) → `supabase/migrations/*.sql` 이름순 → `supabase/seed.sql` → `tests/db/*.test.sql` 순서로 실행한다.

- `seed.sql` 은 **개발·테스트 DB 전용 가짜 데이터**다(운영 DB 적용 금지). 고정 사용자 A(`…0000a1`)·B(`…0000b1`), kind 별 1~2개의 `dashboard_items`(`친구A`·`합성가맹점A` 등, `metadata.environment='development'`, `is_synthetic=true`), `dashboard_sync_runs` 1행. 모든 insert 가 충돌 시 do nothing 이라 재실행해도 성공한다.
- `tests/db/10~60_*.test.sql` 은 RLS, 클라이언트 쓰기 권한, upsert, `updated_at` 트리거, 체크 제약, 시드 재적용을 확인한다. 데이터를 바꾸는 테스트는 `begin … rollback` 안에서만 바꾼다.

## 운영 DB — 적용 상태 미확인

- 운영 DB 에 어떤 SQL 이 언제 적용됐는지는 **기록이 없어 미확인**이다. 이번 파일 정리(기준선 추가, 버전 이름 변경)는 운영 DB 에 아무것도 하지 않았다.
- 기존 DB 에 새 버전 파일을 **자동으로 재적용하지 말 것** (`supabase db push` 등). 버전 이름이 바뀌어서 이미 적용된 내용도 "새 마이그레이션" 으로 보일 수 있다.
- 적용 내역 대조와 마이그레이션 이력 정합화(예: 이미 적용된 버전을 적용됨으로 표시)는 **운영자가 따로 판단**한다. AI 는 운영 DB 에 접근하지 않는다.

### 대조 절차 (운영자용, 읽기만)

운영자가 Supabase SQL Editor 에서 아래처럼 객체가 있는지 읽어 보고, 각 파일이 만든 객체가 이미 있는지 판단한다.

```sql
select to_regclass('public.dashboard_items')            as baseline_table,
       to_regclass('public.dashboard_sync_runs')        as sync_runs_table,
       to_regclass('public.dashboard_backfill_batches') as backfill_table;
select tgname from pg_trigger where tgrelid = 'public.dashboard_items'::regclass and not tgisinternal;
select polrelid::regclass, polname from pg_policy where polrelid::regclass::text like 'dashboard_%';
```

없는 객체에 해당하는 파일만, 내용을 확인한 뒤 필요할 때 적용한다. 있는 객체의 정의가 파일과 다르면 덮어쓰지 말고 먼저 차이를 확인한다.
