// Playwright Chromium 준비. 실행 파일이 없으면 'npx playwright install chromium' 을 실행하고, 그래도 없으면 실패한다.
// 사용: node scripts/screens/ensure-chromium.mjs (npm run screens:chromium)
// 다른 스크립트(snap-ref·verify-same)는 ensureChromium() 을 불러 쓴다.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

async function executablePath() {
  const {chromium} = await import('@playwright/test');
  return chromium.executablePath();
}

/** Chromium 이 준비되면 true, 설치 후에도 없으면 false */
export async function ensureChromium({log = console.log} = {}) {
  if (existsSync(await executablePath())) return true;
  log('chromium 이 없어 npx playwright install chromium 을 실행합니다');
  const r = spawnSync('npx', ['playwright', 'install', 'chromium'], {stdio: 'inherit'});
  if (r.status !== 0) log(`npx playwright install chromium 종료 코드 ${r.status}`);
  return existsSync(await executablePath());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (await ensureChromium()) {
    console.log(`chromium 준비됨: ${await executablePath()}`);
  } else {
    console.error('chromium 을 설치하지 못했습니다. npx playwright install --with-deps chromium 으로 다시 시도하세요');
    process.exit(1);
  }
}
