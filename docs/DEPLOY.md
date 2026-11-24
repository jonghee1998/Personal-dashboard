# 배포 전 점검표 (8단계: 개발계/운영계 분리)

> **이 문서의 점검·적용·연결·배포 후 확인은 모두 운영자(사람) 몫이다. AI 는 운영 DB·운영 env·Vercel 콘솔에 접근하지 않는다.**

이 문서에는 운영 주소·실제 키·실제 값을 적지 않는다. 변수 이름과 절차만 적는다. 점검 결과를 기록할 때도 통과 여부만 적고 값은 적지 않는다.

## (0) 자동 모드 멈춤 (먼저 할 일)

- 자동 모드(`ORCH_AUTO`)가 켜져 있으면 최종 PR 은 계획의 `auto_merge` 값과 상관없이 CI 통과 뒤 자동 반영된다.
  - `scripts/orch/main.mjs` 385~387행: 최종 PR 을 열 때 자동 모드면 자동 반영 경로로 정한다.
  - 같은 파일 639~644행: 반영 대기(`awaiting_merge`) 중인 최종 PR 도 스위치가 켜지면 자동 반영 경로(`finalizing`)로 바꾼다.
  - 같은 파일 507~524행(`evaluateFinal`): 그 경로에 들어간 PR 은 스위치를 다시 읽지 않고 CI 통과 뒤 반영한다.
- 자동 모드의 다음 계획 작성(`scripts/orch/plan-next.mjs` 28~44행 gate, 74~82행 프롬프트)도 운영 배포 확인을 검사하지 않고 사람 몫이 끝났다고 가정한다.
- 그래서 운영자는 **8단계 AI 몫 계획이 시작되기 전에(늦어도 최종 PR 이 열리기 전에)** 상황판 AI 팀 탭의 자동 모드 스위치(`ORCH_AUTO`, `docs/ORCH_MANUAL.md` 7~9행)를 끈다.
- 스위치가 꺼져 있고 계획이 `auto_merge: false` 이면 최종 PR 은 '반영 승인 대기'(`awaiting_merge`, `main.mjs` 431행)에서 멈추고, 운영자가 완공 보고서를 보고 수동으로 반영한다.
- 스위치를 끄기 전에 최종 PR 이 이미 자동 반영됐다면 **알아챈 즉시** 끈다.
- 자동 모드는 아래 (2)~(3) 을 마치고, 결과 기록(통과 여부만, 값 없이)과 (5) 의 8단계 done 반영 PR 이 main 에 반영된 뒤에만 다시 켠다.
- 자동 모드가 꺼진 동안 8단계 관련 최종 PR 은 사람이 확인하고 반영한다.
- 이 멈춤을 코드로 강제하려면 `scripts/orch/` 변경(PM PR)이 필요하며, **아직 없다**. 지금은 스위치를 끄는 것 말고 기계적으로 막는 수단이 없다.

## (1) 개발계/운영계 구성

| 구분 | 개발계 | 운영계 |
|---|---|---|
| Vercel 프로젝트 | PR 미리보기(Preview) 배포 | main 배포(Production) |
| Supabase 프로젝트 | 개발용. 가짜 데이터만, `supabase/seed.sql` 허용 | 운영용. 실데이터, `supabase/seed.sql` 적용 금지 |

환경변수 5개(`.env.example` 의 이름):

| 이름 | 쓰는 곳 | 개발·운영 값이 달라야 하나 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 브라우저·서버 | 달라야 함 (`check-env --compare` 가 검사) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저·서버 | 달라야 함 (프로젝트가 다르면 자연히 다름) |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버만 | 달라야 함 (`check-env --compare` 가 검사) |
| `PICKLE_INGEST_TOKEN` | 서버만(수신 API) | 달라야 함 (`check-env --compare` 가 검사) |
| `DASHBOARD_USER_ID` | 서버만(수신 API) | 달라야 함 (`check-env --compare` 가 검사, 각 Supabase 프로젝트의 사용자 ID) |

- 자동 모드가 켜져 있으면 최종 PR 이 사람 확인 없이 main 에 반영된다. 그래서 운영 Vercel 을 새 저장소 main 에 연결하면 **그 시점의 main(6단계 수신 함수를 쓰는 코드 포함)이 바로 운영에 배포**된다. 연결은 (2) 배포 순서의 마지막 단계에서만 한다.
- `lib/supabase.ts` 5~6행과 `lib/supabase-server.ts` 5~6·26~30행은 배포 환경의 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY` 를 그대로 쓴다. 즉 **Vercel 에 실제로 들어간 값이 곧 접속 대상**이다. 파일 값이 맞아도 Vercel 설정이 다르면 다른 DB 에 붙는다.

## (2) 배포 순서 (운영자, 이 순서를 지킨다)

① 운영 Vercel 의 Git 연결을 새 저장소로 옮기는 일과 첫 운영 배포는 아래 ②~⑦ 이 끝날 때까지 **보류**한다(옛 저장소에 연결된 운영을 그대로 둔다).

② CI 초록 확인: typecheck·test·build·screens·db 잡이 모두 통과했는지 본다.

③ env 점검:
- 개발·운영 env 파일 두 개를 **저장소 밖**, 운영자만 읽을 수 있는 경로에 만들고 권한을 `chmod 600` 으로 둔다. 저장소 안에는 env 파일을 만들지 않는다(`.gitignore` 가 `.env.*` 를 막지만 기대지 않는다).
- `npm run check-env -- --compare <개발 env 파일> <운영 env 파일>` 이 `OK` 로 끝나는지 확인한다. 출력에는 이름과 규칙만 나오고 값은 나오지 않는다.
- 이 파일 두 개는 ④ 의 대조가 끝날 때까지 지우지 않는다.
- 한계: 오프라인 비교라 별칭 주소(사용자 지정 도메인 등)가 같은 프로젝트를 가리키는지, 키가 실제로 어느 프로젝트 소속인지, 실제 Vercel 설정이 파일과 같은지는 확인하지 못한다. 그래서 ④ 가 필요하다.

④ Vercel 실제 설정 대조 (Git 연결 전, ③ 의 파일을 기준으로):

| 대상 범위 | 기준 |
|---|---|
| 운영 Vercel 프로젝트의 Production 범위 | 운영 파일 값 5개와 같아야 함 |
| 운영 Vercel 프로젝트에서 실제로 쓰는(활성) Preview·Development 범위 | 개발 파일 값 5개와 같아야 함 |
| 개발 Vercel 프로젝트의 활성 범위 | 개발 파일 값 5개와 같아야 함 |
| 쓰지 않는(미사용) 범위 | 운영 Supabase 주소·운영 서버 키·운영 수신 토큰이 하나도 없어야 함(비어 있거나 개발 값) |

- Supabase 주소·키가 의도한 Supabase 프로젝트(개발/운영)의 것인지 Supabase 콘솔에서도 대조한다.
- 지금 운영에 보내는 수집기(피클AI)에 설정된 토큰이 운영 파일의 `PICKLE_INGEST_TOKEN` 과 같은지 확인한다.
- 값은 화면에서 눈으로만 대조하고 로그·문서·Issue·채팅에 남기지 않는다.
- 하나라도 다르면 배포 보류.
- 마지막 항목: 대조가 성공하든 실패하든(도중에 멈춰도) ③ 의 env 파일 두 개를 바로 삭제한다(성공·실패 모두 삭제).

⑤ 운영 DB 확인:
- `supabase/README.md` 의 '대조 절차' 쿼리(읽기 전용)로 객체를 하나씩 확인하고, 마이그레이션 이력과 객체 정의를 대조해 **필요한 파일만** 정한다.

| 순서 | 파일 | 만드는 객체 |
|---|---|---|
| 4 | `20261124000000_ingest_commit.sql` | `dashboard_sync_runs.commit_source` 열(6~7행) + `dashboard_ingest_commit` 함수(옛 정의) |
| 5 | `20261124000100_ingest_support.sql` | `dashboard_item_set_memo`·`dashboard_norm_id`·`dashboard_ingest_existing`·`dashboard_ingest_candidates` 함수 + `dashboard_ingest_commit` 재정의(76행, `dashboard_norm_id` 사용) |

경우별 판단:
- 4번·5번 객체가 모두 없음 → 4번 다음 5번 순서로 적용한다. 적용 전에 배포하면 수신(`dashboard_ingest_commit` 없음)과 메모 저장(`dashboard_item_set_memo` 없음)이 실패한다.
- 4번 객체 둘(열·함수 옛 정의)이 모두 있고 5번 전용 객체 넷이 모두 없음 → 5번만 적용한다.
- 모두 있고 ⑥ 의 정의·권한 확인을 통과 → 적용하지 않는다.
- 그 밖의 모든 섞인 상태(예: 4번 열과 함수 중 하나만 있음, 5번 객체 일부만 있음, 5번 객체는 있는데 `commit_source` 열이 없음, 있는 객체의 정의가 파일과 다름)는 **부분 적용**으로 본다. 어떤 파일도 일괄 재적용하지 않고 배포 보류, 차이를 먼저 확인한다.
- 5번을 적용한 뒤에는 4번을 다시 적용하지 않는다(5번이 재정의한 `dashboard_ingest_commit` 을 4번의 옛 정의로 덮어쓴다).
- 백필 `20261112000200_atomic_backfill.sql` 은 적용하지 않아도 된다(`tests/db/90_no_backfill_dependency.test.sql` 근거).
- 파일은 하나씩 적용하고, 실패하면 다음 파일로 넘어가지 않는다.

⑥ 최종 정의·권한 확인 (읽기 전용 쿼리):

```sql
-- 1) 함수 5개: 모두 null 이 아니어야 한다 (supabase/README.md 대조 절차와 같음)
select to_regprocedure('public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)'),
       to_regprocedure('public.dashboard_ingest_existing(uuid,text[],uuid,integer)'),
       to_regprocedure('public.dashboard_ingest_candidates(uuid,text[],uuid,integer)'),
       to_regprocedure('public.dashboard_item_set_memo(uuid,text)'),
       to_regprocedure('public.dashboard_norm_id(text)');

-- 2) 열 정의: data_type = text, is_nullable = NO, column_default 가 'report'
select data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema='public' and table_name='dashboard_sync_runs' and column_name='commit_source';

-- 3) CHECK 제약: commit_source 가 'report'·'ingest_v2' 둘만 허용 (4번 파일 7행과 일치)
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid='public.dashboard_sync_runs'::regclass and contype='c';

-- 4) 커밋 함수 정의가 5번 것인지: 결과가 true 여야 한다
select position('dashboard_norm_id' in
       pg_get_functiondef('public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)'::regprocedure)) > 0
       as uses_norm_id;

-- 5) 실행 권한
select f.sig, r.role, has_function_privilege(r.role, f.sig, 'execute') as can_execute
  from (values ('public.dashboard_ingest_commit(uuid,jsonb,jsonb,text[],jsonb,jsonb)'),
               ('public.dashboard_ingest_existing(uuid,text[],uuid,integer)'),
               ('public.dashboard_ingest_candidates(uuid,text[],uuid,integer)'),
               ('public.dashboard_item_set_memo(uuid,text)'),
               ('public.dashboard_norm_id(text)')) as f(sig)
 cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role)
 order by 1, 2;
```

권한 기대값 (`20261124000100_ingest_support.sql` 의 revoke·grant 줄 16~17·27·49~50·72~73·297~298행과 일치해야 함):

| 함수 | anon | authenticated | service_role | 근거 행 |
|---|---|---|---|---|
| `dashboard_ingest_commit` | 불가 | 불가 | 가능 | 297~298 |
| `dashboard_ingest_existing` | 불가 | 불가 | 가능 | 49~50 |
| `dashboard_ingest_candidates` | 불가 | 불가 | 가능 | 72~73 |
| `dashboard_item_set_memo` | 불가 | 가능 | 가능 | 16~17 |
| `dashboard_norm_id` | 가능 | 가능 | 가능 (public 에 실행 권한) | 27 |

⑦ 배포 보류 조건 — 아래 중 하나라도 있으면 배포하지 않고 원인을 먼저 해결한다:
- 부분 적용(섞인 상태, 4번만 적용되고 5번 실패 등)
- 열 정의 불일치(`commit_source` 의 형식·널 허용·기본값·CHECK 제약)
- 함수 정의 불일치(커밋 함수에 `dashboard_norm_id` 없음 등)
- 권한 불일치
- `check-env` 실패
- Vercel 설정 대조 불일치(범위별 기준 위반 포함)
- 수집기 토큰 불일치

⑧ 그 뒤에만 운영 Vercel 의 Git 연결을 새 저장소로 옮기고 새 코드를 배포한다.

## (3) 배포 후 확인 (운영자)

- 로그인하지 않고 `/` 에 들어가면 `/login` 으로 간다.
- 토큰 없이 `POST /api/ingest` 를 보내면 401 이 온다. 이 응답은 `app/api/ingest/route.ts` 30~31행에서 DB 접근 전에 나오므로, 이것만으로는 DB·키 설정을 확인하지 못한다.
- 개발 env 의 `PICKLE_INGEST_TOKEN`(개발 토큰)을 `Authorization: Bearer` 로 붙여 운영 `POST /api/ingest` 를 보내면 401 이 와야 한다. 본문은 비워도 되고 실데이터를 보내지 않는다.
  - 401 만으로는 통과가 아니다. `lib/collector-auth.ts` 10~16행 `checkCollectorToken` 은 운영 토큰이 없거나(`server_secret_missing`) 32자 미만이거나(`server_secret_short`) Bearer 헤더가 앱까지 오지 않아도(`no_bearer`) 똑같이 401 을 주고, 앞단(프록시 등)이 돌려준 401 도 상태 코드로는 구분되지 않는다.
  - 그래서 운영자는 운영 배포의 요청별 로그(배포 플랫폼이 요청 하나마다 요청 ID 를 붙여 그 요청 처리 중 나온 앱 출력을 묶어 보여 주는 로그)에서 이 점검 요청(`POST /api/ingest`, 401)의 항목을 찾고, 같은 요청 ID 에 묶인 `app/api/ingest/route.ts` 31행의 `collector_auth_failed` 줄(`lib/collector-auth.ts` 20~26행 `collectorAuthFailureLog` 가 만드는 JSON, route `'/api/ingest'`)의 reason 을 본다.
  - 앱 로그 JSON 자체에는 event·route·reason 만 있고 요청을 구분하는 값이 없다(`lib/collector-auth.ts` 20~26행). 요청 시각만 맞춰 다른 요청의 로그 줄을 근거로 삼으면 안 된다.
  - 401 이고, 같은 요청 ID 에 묶인 collector_auth_failed 로그의 reason 이 mismatch 여야 통과다.
  - 요청 단위로 연결할 수 없으면(요청 항목·로그 줄이 없거나 시각만 맞는 경우) 통과가 아니다. 즉 요청별 로그에 그 요청 항목이 없거나(앞단에서 막힌 경우 포함), 그 요청에 묶인 `collector_auth_failed` 줄이 없거나, reason 이 `mismatch` 가 아니면 실패로 본다.
  - 401 이 아닌 응답(200·다른 4xx·5xx)은 점검 실패다.
  - 개발·운영 토큰이 같은지는 이 요청으로 추정하지 않는다. 토큰 동일 여부는 (2) 배포 전 확인의 `npm run check-env -- --compare`(`PICKLE_INGEST_TOKEN` 비교) 결과로 확인한다.
  - 결과는 통과 여부만 기록하고 토큰 값·주소·요청 ID·로그 원문은 적지 않는다.
  - 실패하면 이 절 마지막 줄대로 (4) 되돌리기를 하고 8단계는 doing 으로 둔다.
- 로그인한 뒤 다섯 탭(홈·금융·뉴스·혜택·기록)이 보인다.
- 수집 확인: 지금 쓰는 v1 수집기의 다음 정상 요청(또는 수집기에서 수동 실행 1회) 중 `validate_only` 가 아닌 요청이 200 을 받고, 응답 본문의 `upserted`(저장 건수)가 1 이상인지 본다.
  - `lib/ingest-service.ts` 138행에서 v1 은 `validate_only` 요청에도 200(`upserted` 0)을 준다. 그래서 200 만으로는 저장을 확인하지 못한다.
  - 같은 파일 141행에서 v1 저장은 `p_run: null` 로 커밋하므로 그 요청은 수집 실행 기록을 만들지 않는다.
  - 그다음 화면을 새로고침해 그 항목이 들어갈 탭(예: 금융·뉴스·혜택·기록)에 저장 결과가 보이는지 확인한다.
- 수집 실행 기록(기록 탭의 수집 기록)은 수집기가 `/api/sync-runs` 를 따로 호출하는 경우에만 확인한다. 호출하지 않으면 새 기록이 없어도 실패가 아니다.
- 로그인한 뒤 메모 저장 1건이 되는지 확인한다.
- 하나라도 실패하면 (4) 되돌리기를 하고 8단계는 doing 으로 둔다.

## (4) 되돌리기

- 앱: Vercel 운영 프로젝트의 배포 목록(Deployments)에서 직전 정상 배포를 골라 되돌린다(Promote/Rollback). Git 연결을 옛 저장소로 되돌려야 하면 그 뒤에 한다.
- DB: 마이그레이션은 되돌리지 않는다. 먼저 ⑤·⑥ 의 읽기 전용 쿼리로 파일과의 차이를 확인하고, 고칠 방법은 그 뒤에 정한다.

## (5) 단계 완료 조건

- 8단계는 운영자가 위 (2)~(3) 을 마치고 결과(통과 여부만, 값 없이)를 기록할 때까지 진행 중(doing)이다.
- 8단계 done 표시는 운영자가 직접 하는 수동 PR 로 한다. 이 PR 에서 함께 바꾼다:
  - `docs/roadmap.json` 의 8단계 status → `done`
  - `lib/architecture-content.ts` 의 `targetRows` 에서 phase 가 '8단계' 인 행(DB·배포)의 now·phase(예: phase '완료')
  - `docs/architecture.json` 의 같은 행을 똑같이
  - `npm test` 통과 확인(`tests/architecture-content.test.mjs` 는 참조 단계가 done 인데 행이 그대로면 실패한다)
- 9단계 done 때도 같은 방식으로 phase 가 '9단계' 인 행(수신 API·피클AI)을 `targetRows`·`architecture.json` 에서 함께 갱신한다.
- 9단계(피클AI 전환)와 10단계(옛 저장소 삭제)는 이 확인이 끝난 뒤에만 시작하고, 자동 모드는 그때 다시 켠다.
