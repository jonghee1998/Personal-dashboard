# PM 인수인계

_마지막 갱신: 2026-11-25 04시_

## 현재 상태
- 진행 단계 1~7 완료. 지금은 8단계(배포 분리)다. 디자인은 사용자 요청으로 미뤘고, 11단계 '디자인 개선(나중)'으로 옮겼다.
- 7단계 완료: #56(화면 검사를 로그인한 / 로 이전), #57(데모 삭제), #58·#60(useDashboardData 훅·셸·탭 분리, 이름 정리), #61(최종 반영). 7-6 조회 최적화는 선택이라 미뤘다(화면이 느리다는 보고가 있을 때 측정).
- 6단계는 계획 다섯 개로 나눠 반영했다.
  - ① #23: 수집기 토큰 검사 공통화(`lib/collector-auth.ts`), 401·5xx 원인 로그(`lib/api-log.ts`, 값 없이 코드만).
  - ② #28: v2 규격(`docs/INGEST_V2.md`, `lib/ingest-v2.ts`), 수신 커밋 DB 함수(`20261124000000_ingest_commit.sql`).
  - ③ #32: `/api/ingest` v1·v2가 함수로만 저장(`lib/ingest-service.ts`). 메모는 원자적으로 갱신하고, 조회는 RPC 페이지로 하며, 원천 ID 공백을 정규화(`20261124000100_ingest_support.sql`). v1도 이제 행별로 "보낸 키만 갱신"한다.
  - ④ #37: `/api/items` 옛 형식 삭제, 상태 수정은 정산·할 일의 pending/done만. `/api/sync-runs` GET 삭제. 예시 v1·v2(`examples/`).
  - ⑤ #42: 일회성 API 4개 삭제. `tests/db/90`이 백필 마이그레이션 없이도 나머지가 동작하는지 확인한다.
- 엔진: 자동 모드(`ORCH_AUTO`)가 켜져 있다. 시작·감사 지적 반영·최종 반영·다음 계획 작성(`plan-next`)을 모두 자동으로 한다. Claude 사용량 한도에 걸리면 풀리는 시각까지 기다린다. 사람만 할 수 있는 일은 "사람 할 일 (자동 모드)" Issue(`orch:human`)에 쌓는다.

## 운영 상태 (중요)
- 운영 배포는 아직 옛 저장소 private_dashboard에 연결된 Vercel 프로젝트에서 된다. 6단계 변경은 운영에 들어가지 않았다.
- 피클AI는 v1으로 `/api/ingest`에 직접 POST한다. 2026-11-24에 토큰을 교체한 뒤 200을 확인했다.
- 운영 Supabase는 무료 플랜이라 일주일 쓰지 않으면 일시정지된다. 계정 전체에서 활성 프로젝트는 2개까지다(ai-orchestrator, 운영). 개발용 프로젝트는 일시정지 상태다.
- 2026-11-24 확인: 운영 DB에 `dashboard_backfill_batches` 표가 없었다. `BACKFILL_APPLY_ENABLED`는 없다. 피클AI는 일회성 4개 경로를 부르지 않는다.

## 지금 진행 중 (2026-11-25 13:20, Codex PM 인수인계)

- **Run #104 (11단계 새 디자인, 7스텝)** — https://github.com/jonghee1998/Personal-dashboard/issues/104
  - 사용자가 디자인 캔버스에서 시안·톤(화이트·블루)을 확정했다. 세부 사양은 #104 계획 JSON 의 context 에 전부 있다.
  - 사용자 결정: 최종 반영은 **자동 배포**(자동 모드 유지). 계획 안의 '자동 모드 끄기·수동 승인' 문구는 따르지 않는다.
  - 13:15 Step 1 시도 4로 재개. 앞서 막힌 것: 글꼴 파일 반입(#105 로 해결), 기준선 명령 제한(#106 `npm run screens:baseline`), 옛 테마 클래스 제거로 다른 탭이 깨짐(계획 Step 1 에 'conceptLight 유지 + uiV2 로 덮어쓰기' 지시 추가).
- 이제 **main 반영 = 운영 배포**(Vercel 이 새 저장소 main 에 연결됨). 되돌리기는 Vercel Deployments → Instant Rollback(사람).

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
  - 8단계 운영 배포도 같다(2026-11-24 사용자 전권 위임, 자동 모드는 끄지 않는다). 배포·배포 후 확인·8단계 done 표시는 사람 할 일이다. PM 은 8단계를 done 으로 바꾸지 않지만 8단계 계획을 더 만들지 않고 9·10단계 AI 몫으로 넘어간다.

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
→ 그래서 자동 모드의 다음 계획은 **쓰지 않는다**(남은 일이 사람 몫뿐). 사람이 8·9단계를 끝냈다고 말하면 PM 이 done PR 을 올리고, 11단계(디자인)는 사용자가 요청할 때 시작한다.
4. 11단계(디자인) 이어서 할 일 — 자동 모드가 #104 다음에 차례로 계획한다:
   - (a) #104 가 끝나면 단계 통합 검수: 시안 사양(#104 계획 context)과 6개 탭 화면 대조, 빠진 것 보완.
   - (b) app/globals.css 정리: 새 화면에서 쓰이지 않는 옛 테마 규칙(conceptLight·demoShell·designPreview·orbit·marine·refined 등)과 .demoBanner 를 지우고, 셸에서 옛 클래스를 뗀다. 화면 검사·기준선으로 바뀐 게 없음을 확인.
   - (c) 이게 끝나면 11단계를 done 으로 바꾸고, 남은 일이 없으면 다음 계획은 쓰지 않는다.
   - 하지 않는 것(사용자와 정할 때만): v1 수신·/api/sync-runs 제거, 백필 마이그레이션·dashboard-qa.yml 백필 잡 정리(.github 변경).
