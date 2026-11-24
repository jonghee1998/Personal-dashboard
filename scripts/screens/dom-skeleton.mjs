// DOM 뼈대({tag, className, children}) 비교. run.mjs 가 dom-baseline.json 과 현재 화면을 비교할 때 쓴다.

/** 형제 중 같은 태그가 둘 이상이면 tag[i] (같은 태그 안 순번), 아니면 tag */
function segment(siblings, index) {
  const tag = siblings[index].tag;
  const same = siblings.filter(x => x.tag === tag);
  return same.length > 1 ? `${tag}[${siblings.slice(0, index).filter(x => x.tag === tag).length}]` : tag;
}

/** 두 뼈대에서 처음 달라진 경로 (같으면 null). 예: 'finance > main > section[2].className' */
export function firstNodeDifference(expected, actual, path) {
  if (expected.tag !== actual.tag) return `${path}.tag (기준 ${expected.tag}, 현재 ${actual.tag})`;
  if (expected.className !== actual.className) return `${path}.className (기준 '${expected.className}', 현재 '${actual.className}')`;
  const a = expected.children ?? [], b = actual.children ?? [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = firstNodeDifference(a[i], b[i], `${path} > ${segment(a, i)}`);
    if (diff) return diff;
  }
  if (a.length !== b.length) return `${path}.children (기준 ${a.length}개, 현재 ${b.length}개)`;
  return null;
}

/** 탭별 뼈대 묶음 비교. tabs 순서대로 처음 달라진 경로 (같으면 null) */
export function firstDomDifference(baseline, current, tabs) {
  for (const tab of tabs) {
    if (!baseline?.[tab]) return `${tab} (기준선에 탭 없음)`;
    if (!current?.[tab]) return `${tab} (현재 화면에 탭 없음)`;
    // 뿌리(.demoShell)는 경로에서 빼고 탭 이름으로 시작한다
    const diff = firstNodeDifference(baseline[tab], current[tab], tab);
    if (diff) return diff;
  }
  return null;
}
