# 오케스트레이터 운영 매뉴얼

이 저장소는 [ai-orchestrator](https://github.com/jonghee1998/ai-orchestrator) 엔진을 그대로 씁니다. 운영 방법(계획 Issue, `orch:go`, ON/OFF, 승인, 멈췄을 때)은 원본 매뉴얼을 따릅니다: https://github.com/jonghee1998/ai-orchestrator/blob/main/docs/ORCH_MANUAL.md

이 저장소만의 차이: 공개 저장소라 실데이터 금지(CLAUDE.md), CI에 개인정보 검사(`scripts/orch/pii-scan.mjs`), 사용량 측정·아이디어함은 ai-orchestrator에서만 합니다.

## 자동 모드 (`ORCH_AUTO`)

상황판(ai-orchestrator) AI 팀 탭의 **자동 모드** 스위치로 켜고 끕니다. 켜면 계획 감사 OK → 바로 시작, 수정 필요 → PM(Claude)이 자동 반영(마지막 라운드는 반영 뒤 바로 시작), 최종 PR → 위험 등급과 상관없이 CI 통과 후 자동 반영입니다. 자세한 규칙은 [ai-orchestrator 매뉴얼 5장 '자동 모드'](https://github.com/jonghee1998/ai-orchestrator/blob/main/docs/ORCH_MANUAL.md#자동-모드-orch_auto-상황판-ai-팀-탭-스위치)를 따릅니다.

## Codex 개발 대체 (`ORCH_CODEX_DEV`)

상황판 AI 팀 탭 **Codex 개발 대체** 스위치(기본 on). Claude 사용량 한도면 기다리지 않고 Codex가 같은 스텝의 구현·수정과 계획 작성(PM)을 이어서 합니다. Codex가 만든 스텝은 한도가 풀리면 Claude가 검수합니다. 같은 스텝이 2번 떨어지면 Codex가 근본 원인을 먼저 분석합니다. 자세한 내용은 [ai-orchestrator 매뉴얼 6장](https://github.com/jonghee1998/ai-orchestrator/blob/main/docs/ORCH_MANUAL.md#6-멈췄을-때).
