/**
 * 첫 화면이 받는 JS 를 잰다.
 *
 * 이 앱의 설계는 한 줄로 요약된다 — **고른 도구만 받아 온다** (`panel.ts` 의
 * `import()`). 그것이 깨지면 QR 하나 만들려고 들른 사람이 PDF 렌더러와 글꼴
 * 손질기와 스프레드시트 엔진까지 내려받는다. 그런데 이 실패는 **화면에 아무
 * 자국도 남기지 않는다.** 기능은 전부 멀쩡히 돌고, 느려진 것은 처음 온 사람만
 * 겪으며, 그 사람은 다시 오지 않으므로 아무도 제보하지 않는다. 그래서 사람 눈이
 * 아니라 검사가 봐야 한다.
 *
 * 재는 방법은 실제 브라우저의 네트워크다. 번들러가 낸 파일 목록을 세지 않는다 —
 * 파일이 있다는 것과 첫 화면이 그것을 받는다는 것은 다른 이야기이고, 우리가
 * 약속한 것은 뒤쪽이다.
 *
 *   node web/scripts/check-bundle.mjs
 *
 * 스스로 굽고 스스로 내준다. `.cache/bundle-check/dist` 로 빌드하므로 `web/dist`
 * 를 건드리지 않는다 — 다른 사람이 거기에 올릴 물건을 두고 있을 수 있다.
 * 이미 떠 있는 서버를 재려면 주소를 넘긴다.
 *
 *   BUNDLE_TEST_URL=http://127.0.0.1:18593 node web/scripts/check-bundle.mjs
 *   CHECK_BROWSER=firefox node web/scripts/check-bundle.mjs
 *
 * 예산을 넘기면 0 이 아닌 값으로 죽는다. 경고만 하면 아무도 안 고친다.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize, sep } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../package.json', import.meta.url));
const browserName = process.env.CHECK_BROWSER ?? 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName), `지원하지 않는 검사 브라우저입니다: ${browserName}`);

const webDir = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('../../.cache/bundle-check/dist', import.meta.url));
const port = Number(process.env.BUNDLE_TEST_PORT ?? 18593);

/**
 * 예산 — 첫 화면이 받는 JS 의 **압축하기 전** 합계.
 *
 * 압축 전으로 재는 이유는 그것이 브라우저가 실제로 파싱해야 하는 양이고, 서버
 * 설정(brotli 를 켰는가, 수준이 몇인가)에 흔들리지 않아 재현되기 때문이다.
 * Cloudflare 가 실어 보낼 때는 이보다 훨씬 작다 — 아래에 gzip 환산도 함께 찍는다.
 *
 * 값의 근거: 2026-09-25 실측 첫 화면 합계가 542 KiB 였다(panel 덩어리 540 KiB 가
 * 거의 전부다). 그 덩어리에 pdf-lib 와 fflate 가 들어 있는데, `panel.ts` 가
 * PDF 편집기·ZIP·문서 변환 화면을 정적으로 불러오기 때문이다. 줄일 여지가 있지만
 * 그것은 `web/src` 를 고치는 일이라 여기서 하지 않는다.
 *
 * 그래서 예산은 "지금보다 나빠지지 않는다"로 잡는다 — 실측 + 약 12% 여유인
 * 610 KiB. 여유를 둔 이유는 도구 하나를 더 들이거나 오류 문구를 늘리는 정도로
 * 검사가 울면 사람들이 검사를 꺼 버리기 때문이고, 12% 로 끊은 이유는 무거운
 * 라이브러리 하나(가장 작은 축인 qrcode 도 20 KiB, pdf-render 는 428 KiB)가
 * 첫 화면에 새로 딸려오면 반드시 걸리게 하기 위해서다.
 *
 * 이 값을 올릴 때는 왜 올리는지를 여기 적어라. 말없이 올리면 예산이 아니라
 * 그냥 현재값을 베끼는 칸이 된다.
 */
const FIRST_LOAD_BUDGET = 610 * 1024;

/**
 * 첫 화면에 **절대 오면 안 되는** 덩어리.
 *
 * 이것이 이 검사의 핵심이다. 합계 예산은 조금씩 새는 것을 잡지만, 정작 막고 싶은
 * 것은 무거운 엔진 하나가 통째로 딸려오는 쪽이다. 이름으로 짚어 두면 예산에
 * 여유가 있더라도 걸린다.
 */
const NEVER_ON_FIRST_LOAD = [
  ['fontkit', /fontkit/i],                 // 700 KiB. PDF 에 글꼴 심을 때만 쓴다
  ['pdf-render', /pdf-render/i],           // 428 KiB. PDF.js — 쪽을 그릴 때만 쓴다
  ['qrcode', /qrcode/i],                   // QR 도구 하나만 쓴다
  ['xlsx (표 워커)', /sheet-tools\.worker|spreadsheet\.worker/i], // 각 900 KiB 넘는다
];

/** 도구를 하나 골랐을 때 **그 도구 것만** 오는가. 가벼운 쪽으로 고른다. */
const PICK = { choice: 'qr', label: 'QR 코드 만들기', expect: /qr-panel|qrcode/i, budget: 64 * 1024 };

const mime = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
}));

/** dist 를 그대로 내주는 최소 서버. 압축하지 않는다 — 받은 바이트가 곧 원본이라야 잰 값이 흔들리지 않는다. */
function serve(root) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    // 경로를 거슬러 올라가 root 밖을 읽는 일이 없게 정규화한 뒤 다시 확인한다.
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root + sep) && file !== join(root, 'index.html')) { response.writeHead(403).end(); return; }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('디렉터리');
      response.writeHead(200, { 'content-type': mime.get(extname(file)) ?? 'application/octet-stream', 'content-length': info.size });
      createReadStream(file).pipe(response);
    } catch { response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('없다'); }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const kib = bytes => `${(bytes / 1024).toFixed(1)} KiB`;

// --- 1. 잴 대상을 마련한다 ----------------------------------------------------
let base = process.env.BUNDLE_TEST_URL;
let server = null;
if (!base) {
  // scripts/ 가 web/ 안에 있어서 web/node_modules 의 vite 가 그대로 잡힌다.
  const { build } = await import('vite');
  await build({ root: webDir, logLevel: 'error', build: { outDir, emptyOutDir: true, sourcemap: false } });
  server = await serve(outDir);
  base = `http://127.0.0.1:${port}`;
}

// --- 2. 실제 브라우저로 첫 화면을 받아 본다 -----------------------------------
const browser = await require('playwright')[browserName].launch({ headless: true });
/** @type {{url: string, bytes: number}[]} */
const scripts = [];
let firstLoad = [];

try {
  const page = await browser.newPage();
  const failed = [];
  page.on('pageerror', error => failed.push(error.message));
  page.on('response', async response => {
    const url = response.url();
    // 워커도 JS 다. 첫 화면이 워커를 세우면 그 바이트도 사용자가 문 값이다.
    if (!/\.js(\?|$)/.test(url)) return;
    let bytes = 0;
    try { bytes = (await response.body()).length; } catch { /* 취소된 요청은 몸통이 없다 */ }
    scripts.push({ url, bytes });
  });

  await page.goto(base, { waitUntil: 'load' });
  // 도구 고르기가 서야 첫 화면이 다 온 것이다. main.ts 가 panel 을 늦게 받아 온다.
  await page.locator('.conv-choice').first().waitFor();
  await page.waitForLoadState('networkidle');
  assert.deepEqual(failed, [], `첫 화면에서 오류가 났다: ${failed.join(' | ')}`);

  firstLoad = scripts.splice(0);
  const total = firstLoad.reduce((sum, item) => sum + item.bytes, 0);
  // gzip 은 참고값이다. 예산은 압축 전으로 문다 — 위 주석을 보라.
  const packed = firstLoad.reduce((sum, item) => sum + item.bytes, 0) && gzipSync(Buffer.concat(
    await Promise.all(firstLoad.map(async item => Buffer.from(await (await fetch(item.url)).arrayBuffer()))),
  )).length;

  console.log(`첫 화면 JS ${firstLoad.length}개, 합계 ${kib(total)} (gzip 환산 ${kib(packed)}) / 예산 ${kib(FIRST_LOAD_BUDGET)}`);
  for (const item of [...firstLoad].sort((a, b) => b.bytes - a.bytes)) {
    console.log(`  ${kib(item.bytes).padStart(10)}  ${item.url.slice(base.length)}`);
  }

  for (const [label, pattern] of NEVER_ON_FIRST_LOAD) {
    const hit = firstLoad.find(item => pattern.test(item.url));
    assert.ok(!hit, `${label} 가 첫 화면에 딸려왔다 (${hit ? kib(hit.bytes) : ''}) — 고른 도구만 받아 온다는 약속이 깨졌다: ${hit?.url}`);
  }
  assert.ok(
    total <= FIRST_LOAD_BUDGET,
    `첫 화면 JS 가 예산을 넘었다: ${kib(total)} > ${kib(FIRST_LOAD_BUDGET)}. 무엇이 늘었는지 위 목록을 보고, 늘어야 할 이유가 있다면 check-bundle.mjs 의 FIRST_LOAD_BUDGET 과 그 근거를 함께 고쳐라.`,
  );

  // --- 3. 도구를 하나 고르면 그 도구 것만 오는가 ------------------------------
  await page.locator(`[data-choice="${PICK.choice}"]`).click();
  await page.locator('.conv-tool').first().waitFor();
  await page.waitForLoadState('networkidle');

  const added = scripts.splice(0);
  const addedTotal = added.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`'${PICK.label}' 을 고르니 ${added.length}개, ${kib(addedTotal)} 가 더 왔다 / 예산 ${kib(PICK.budget)}`);
  for (const item of added) console.log(`  ${kib(item.bytes).padStart(10)}  ${item.url.slice(base.length)}`);

  assert.ok(added.length > 0, '도구를 골랐는데 아무것도 받지 않았다 — 첫 화면에 이미 들어 있다는 뜻이다');
  assert.ok(added.some(item => PICK.expect.test(item.url)), `'${PICK.label}' 의 덩어리가 오지 않았다`);
  for (const [label, pattern] of NEVER_ON_FIRST_LOAD) {
    if (PICK.expect.source.includes(pattern.source)) continue;
    const hit = added.find(item => pattern.test(item.url));
    assert.ok(!hit, `'${PICK.label}' 을 골랐는데 ${label} 까지 왔다: ${hit?.url}`);
  }
  assert.ok(
    addedTotal <= PICK.budget,
    `'${PICK.label}' 하나에 ${kib(addedTotal)} 가 따라왔다 (예산 ${kib(PICK.budget)}) — 도구 덩어리에 남의 것이 섞였다`,
  );

  console.log(
    `PASS(${browserName}): 첫 화면 ${kib(total)} ≤ ${kib(FIRST_LOAD_BUDGET)}, ` +
    `fontkit·pdf-render·qrcode·xlsx 워커 없음, '${PICK.label}' 은 ${kib(addedTotal)} 만 더 받는다.`,
  );
} finally {
  await browser.close();
  server?.close();
}
