// 커밋별 화면 비교(compare.mjs)에서 짝지어 볼 예상 스크린샷 이름 목록.
// 폴더에 실제로 있는 파일로 목록을 만들지 않는다(빠진 파일도 실패로 잡기 위해 고정 목록).
// run.mjs 가 찍는 이름과 맞춰야 한다: 탭 진입 화면 tab-<id>-<폭>.png, 상태 화면 state-*-390.png.

export const EXPECTED_TABS = ['home', 'finance', 'news', 'benefits', 'journal', 'architecture'];
export const EXPECTED_WIDTHS = [360, 390, 430];
export const EXPECTED_STATES = [
  'state-finance-category-open-390.png',
  'state-finance-day-390.png',
  'state-news-detail-390.png',
  'state-journal-day-390.png',
];

/** 비교할 예상 파일 22개(탭 6 × 폭 3 + 상태 4) */
export const EXPECTED_SCREENS = Object.freeze([
  ...EXPECTED_TABS.flatMap(id => EXPECTED_WIDTHS.map(w => `tab-${id}-${w}.png`)),
  ...EXPECTED_STATES,
]);
