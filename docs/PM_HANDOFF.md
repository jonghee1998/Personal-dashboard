# PM 인수인계

_마지막 갱신: 2026-11-25 (Run #119 Step 4, 11단계 완료 표시)_

## 현재 상태
- 진행 단계 1~11단계 완료. 11단계(디자인)는 #104(화이트·블루 새 디자인)와 Run #119(통합 검수·옛 CSS 정리)로 끝냈다. 진행 중인 run 은 없다.
- 7단계 완료: #56(화면 검사를 로그인한 / 로 이전), #57(데모 삭제), #58·#60(useDashboardData 훅·셸·탭 분리, 이름 정리), #61(최종 반영). 7-6 조회 최적화는 선택이라 미뤘다(화면이 느리다는 보고가 있을 때 측정).
- 6단계는 계획 다섯 개로 나눠 반영했다.
  - ① #23: 수집기 토큰 검사 공통화(`lib/collector-auth.ts`), 401·5xx 원인 로그(`lib/api-log.ts`, 값 없이 코드만).
  - ② #28: v2 규격(`docs/INGEST_V2.md`, `lib/ingest-v2.ts`), 수신 커밋 DB 함수(`20261124000000_ingest_commit.sql`).
  - ③ #32: `/api/ingest` v1·v2가 함수로만 저장(`lib/ingest-service.ts`). 메모는 원자적으로 갱신하고, 조회는 RPC 페이지로 하며, 원천 ID 공백을 정규화(`20261124000100_ingest_support.sql`). v1도 이제 행별로 "보낸 키만 갱신"한다.
  - ④ #37: `/api/items` 옛 형식 삭제, 상태 수정은 정산·할 일의 pending/done만. `/api/sync-runs` GET 삭제. 예시 v1·v2(`examples/`).
  - ⑤ #42: 일회성 API 4개 삭제. `tests/db/90`이 백필 마이그레이션 없이도 나머지가 동작하는지 확인한다.
- 엔진: 자동 모드(`ORCH_AUTO`)가 켜져 있다. 시작·감사 지적 반영·최종 반영·다음 계획 작성(`plan-next`)을 모두 자동으로 한다. Claude 사용량 한도에 걸리면 풀리는 시각까지 기다린다. 사람만 할 수 있는 일은 "사람 할 일 (자동 모드)" Issue(`orch:human`)에 쌓는다.

## 운영 상태 (중요)
- 운영 배포는 새 저장소 main 에 연결된 Vercel 에서 된다(2026-11-25 8단계 완료). **main 반영이 곧 운영 배포**이고, 6단계 이후 변경도 운영에 들어갔다. 되돌리기는 Vercel Deployments → Instant Rollback(사람).
- 피클AI 는 2026-11-25 부터 v2 본문으로 `/api/ingest` 에 보낸다(9단계, 첫 v2 수신 200 확인, `/api/sync-runs` 보고 끔). 서버는 v1 수신과 `/api/sync-runs` 를 호환용으로 남겨 두었다(지우는 건 사용자와 정할 때). 수집기 토큰은 2026-11-24 에 교체했다.
- 운영 Supabase는 무료 플랜이라 일주일 쓰지 않으면 일시정지된다. 계정 전체에서 활성 프로젝트는 2개까지다(ai-orchestrator, 운영). 개발용 프로젝트는 일시정지 상태다.
- 2026-11-24 확인: 운영 DB에 `dashboard_backfill_batches` 표가 없었다. `BACKFILL_APPLY_ENABLED`는 없다. 피클AI는 일회성 4개 경로를 부르지 않는다.

## 지금 진행 중

- **#104·11단계 마무리 완료, 진행 중인 run 없음.**
  - #104(11단계 새 디자인): 사용자가 디자인 캔버스에서 시안·톤(화이트·블루)을 확정했고, 운영에 반영됐다. 사양 대조표는 `docs/DESIGN_V2.md`.
  - Run #119(11단계 마무리): Step 1 통합 검수·보완, Step 2 화면 비교 도구, Step 3 옛 테마 CSS 정리(화면 비교 통과), Step 4 done 표시·이 문서 정리.
- 사용자 결정: 최종 반영은 **자동 배포**(자동 모드 유지). 계획 안의 '자동 모드 끄기·수동 승인' 문구는 따르지 않는다.
- 되돌리기: Vercel Deployments → Instant Rollback(사람). main 반영 = 운영 배포라는 점은 위 '운영 상태' 참고.

### 막혔을 때 푸는 법 (PM)
1. Issue 상태 확인: 본문 끝 `<!-- orch-state:v1 {...} -->` 의 status·reason, 최근 `orch:log` 댓글, 스텝 PR 의 리뷰 지적.
2. 원인별:
   - 구현 AI 명령 제한(허용: npm·npx·node·ls·cat·mkdir·git status/diff/log/add/rm/commit) → 필요한 일을 `package.json` 스크립트로 만드는 PR 을 main 에 올리고, 통합 브랜치 `orch/run-<n>` 에 main 을 merge 해서 push.
   - 같은 스텝 검수 3회 실패 → 지적들의 공통 원인을 찾아 계획 JSON 의 해당 스텝 task 끝에 `[PM 지시]` 문장을 더한다(Issue 본문 수정).
   - 파일·자산이 없어 BLOCKED → PM 이 main 에 PR 로 넣고 통합 브랜치에 merge.
3. Issue 에 `<!-- orch:pm-resume -->` 로 원인 한두 줄 댓글 → `orch:go` 라벨 → 재개(같은 스텝 새로 구현).
4. Claude 사용량 한도: 엔진이 Codex 로 구현을 넘기고(ORCH_CODEX_DEV), 그 스텝은 최종 반영 전 **Claude(Opus) 재검수**를 기다린다(status `rechecking`, 한도 풀리는 시각에 자동 재개). Opus 가 꺼져 있으면 재검수가 멈추니 상황판에서 Opus 를 켠다.

### 하지 말 것
- `.github/`·`scripts/orch/` 를 통합 브랜치에서 고치지 않는다(PR 로 main 에, 두 저장소 엔진은 같게 유지: ai-orchestrator 와 Personal-dashboard).
- 운영 DB·운영 키 접근, 실데이터(실명·금액·가맹점)를 코드·Issue·PR 에 쓰기.
- ORCH_* 스위치 변경(사용자 몫).

## 결정한 것
- 공개 저장소다. 실데이터는 Supabase에만 둔다. AI는 운영 DB에 접근하지 않는다. 화면 구성은 유지하고 디자인은 바꿀 수 있다.
- **디자인(DIAGNOSIS 7-5)은 사용자가 요청할 때 한다.** 자동 모드는 11단계를 고르지 않는다. 7단계는 화면 모양을 바꾸지 않는 코드 정리만 한다.
- 5단계의 개발 DB는 CI Postgres로 대체했다(무료 한도 때문). 2026-11-25: 개발 Supabase 는 계속 쓰지 않고 CI Postgres 를 개발 DB 확인 근거로 삼는다.
- 보호 경로(`.github/`, `scripts/orch/`) 변경은 PM이 브랜치 → PR로 올리고 사용자가 Merge한다.
- private_dashboard는 8단계(Vercel 새 저장소 연결) 전까지 지우지 않는다. 2026-11-25 연결 완료 후 사용자가 삭제함(10단계 완료).
- 사람만 할 수 있는 일(운영 배포, 비밀값, Vercel·Supabase 콘솔, 피클AI 설정)은 자동 모드에서 끝났다고 가정하고, 사람 할 일 Issue에 적는다.
  - 8단계 운영 배포도 이렇게 사람이 했고(2026-11-24 사용자 전권 위임, 자동 모드는 끄지 않는다), 2026-11-25 배포·배포 후 확인까지 끝나 done 이다.

## 계획 작성 체크리스트
- 실제 코드 확인: 계획에 쓴 파일·함수·줄 번호를 직접 열어 확인한다.
- 기존 테스트 충돌: 바꾸는 동작을 단언하는 기존 테스트를 찾아 함께 고치도록 적는다.
- 기계로 확인할 수 있는 done_when: 명령·테스트·grep으로 적는다.
- 실패·경계 경우: 빈 값·권한 없음·형식 오류를 적는다.
- 보호 경로: `.github/`·`scripts/orch/` 변경은 PM PR로 한다.
- 보안·공개 저장소: 실데이터·운영 주소·키 금지, 운영 DB 접근 금지.

## 다음 할 일
1. 8단계(배포 분리): **완료(2026-11-25).** 운영 DB에 마이그레이션 4→5 적용·정의/권한 확인 통과, 백필 표 없음, BACKFILL_APPLY_ENABLED 없음, 운영 Vercel(private-dashboard 프로젝트)을 새 저장소 main 에 연결해 배포. 배포 후 확인 통과: 무로그인 / → 로그인, 탭 6개(구조 포함), 메모 저장, 피클AI v1 수집 200·upserted ≥ 1. check-env --compare 는 개발 Vercel 프로젝트가 없어 생략. 이제 main 반영이 곧 운영 배포다.
2. 9단계(피클AI 전환): **완료(2026-11-25).** 피클AI가 v2 본문으로 전송(별도 /api/sync-runs 보고 끔), 첫 v2 수신(transactions) 200·idempotent false·upserted = 항목 수·run success 확인. 다른 dataset 은 밤 동기화에서 처음 v2 로 온다. 서버의 v1·/api/sync-runs 는 호환용으로 남아 있다(지우는 건 사용자와 정할 때).
3. 10단계(옛 저장소 정리): **완료(2026-11-25).** 사용자가 private_dashboard 저장소를 삭제했다.
4. 11단계(디자인): **완료(2026-11-25).** #104 로 화이트·블루 새 디자인을 반영했고, Run #119 에서 사양 대조표(`docs/DESIGN_V2.md`)로 통합 검수·보완, 옛 테마 CSS 정리(셸 className `shell uiV2 uiTheme`, demoBanner·orbit·marine·refined 등 삭제), 커밋별 화면 비교 도구(`npm run screens:ref`·`npm run screens:compare`·`node scripts/screens/verify-same.mjs`)를 만들었다. 옛 CSS 정리 전후 화면 비교 통과.
→ 1~11단계가 모두 끝나 자동 모드의 다음 계획은 **쓰지 않는다**. 남은 일은 사용자와 정할 때만 한다:
   - v1 수신·`/api/sync-runs` 제거(피클AI v2 전환이 안정된 뒤).
   - 백필 마이그레이션·dashboard-qa.yml 백필 잡 정리(.github 변경이라 PM PR).
