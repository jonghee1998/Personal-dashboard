# PM 인수인계

_마지막 갱신: 2026-11-24 09시_

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
- #1 엔진 설치: 완료.
- #2 전체 구조 화면: 감사 3/3 OK. PR #4 반영 후 `orch:go`.
- ai-orchestrator #303: 진행 중.

## 다음 할 일
1. 사용자: PR #4 반영 → #2 `orch:go`. Vercel `ORCH_REPOS`에 이 저장소 추가.
2. PM: #2 결과 확인 후 roadmap 0.5·0.7~0.9·0.15·0.20 갱신, 진단 계획(6.1) 작성.
3. 개발용 Supabase 생성은 6.3 계획 때 사용자와 진행.
