# PM 인수인계

_마지막 갱신: 2026-11-24 10시_

## 현재 상태
- private_dashboard(비공개)에서 코드만 기록 없이 이사 완료. 실데이터 문서 제외, 테스트 실명 교체.
- 엔진 설치 완료(PR #3): scripts/orch, 워크플로 7개, ci.yml(타입·테스트 100개·빌드·개인정보 검사), Secrets 3개, Codex 로그인.
- CI 화면 테스트 잡 PR #4 대기(사용자 반영 필요).
- 기존 문제: Dashboard data QA의 atomic-backfill 잡이 이사 전부터 실패(`tests/atomic-backfill.test.sql:42` integer "metadata") → 진단(6.1)에서 다룸.

## 결정한 것
- 저장소 Personal-dashboard 공개, 실데이터는 Supabase에만. AI는 운영 DB 접근 금지.
- 화면 구성 유지, 디자인 변경 가능. 개발은 PM(Claude)이 엔진으로.
- 기존 private_dashboard는 보관하지 않음. 이사 확인 후 사용자가 삭제.
- 상황판에는 데이터 없이 홈에 에이전트별 작업만 표시(ai-orchestrator #303 진행 중).
- 계획 → 감사 → 승인(orch:go) → 작업 순서를 지킴. Codex 감사 불가 시 Opus.

## 계획
- #1 엔진 설치: 완료. #2 구조 탭(지금 앱 상세 01~08 + 화면 테스트 도구): 반영 완료(PR #7).
- #8 구조 탭에 목표 구조 상세판(01 목표 구조, 기존 02~09): 감사 OK, `orch:go` 대기.
- ai-orchestrator #303(지금 일하는 AI·카드 접기·화면 링크) 완료, #308(프로젝트 카드에 진행 단계 할 일/전체 + 연결 Issue 자동 완료) 진행 중.
- 진행 단계 10개는 `docs/roadmap.json` `phases`(ref = 계획 Issue 번호). 연결 안 된 단계는 PM이 상태 갱신.
- 사용자 원칙: 화면·구조는 먼저 보여주고 검사받은 뒤 작업.

## 다음 할 일
1. 사용자: #8 `orch:go`, Vercel `ORCH_REPOS`에 이 저장소 추가.
2. PM: #2 끝났으니 phases 3단계 done 반영(#308 반영 후엔 자동), 4단계 코드 진단 계획 작성 → 감사 → 승인 요청.
3. Codex 리뷰 한도 소진 상태 → 검수는 Opus 대체 중.
