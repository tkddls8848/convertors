/**
 * 배포할 모양 그대로 검사한다.
 *
 * 다른 check-*.mjs 는 개발 서버(vite)를 본다. 거기에는 CSP 가 없고 자산이
 * 번들되기 전이라, **배포에서만 깨지는 것**을 잡지 못한다 — 헤더가 안 붙거나,
 * /pdf-assets 가 dist 에 안 실렸거나, CSP 가 제 코드를 막거나, 없는 주소가
 * 멀쩡한 화면을 내주거나.
 *
 * 그래서 이 검사는 wrangler 가 dist 를 내주는 자리를 본다.
 *
 *   npm --prefix web run build
 *   npm --prefix web run preview:cf -- --port 8791
 *   node web/scripts/check-deploy.mjs
 *
 * 바이트를 확인할 때 `fetch(a.href)` 를 쓰지 않는다. 내려받기 링크는 blob: 인데
 * 우리 CSP 는 `connect-src 'self'` 라 그것을 막는다 — 막는 것이 맞다. 대신
 * 브라우저가 실제로 내려받은 파일을 디스크에서 읽는다. 쓰는 사람이 겪는 길과
 * 같은 길이다.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const { unzipSync, strFromU8 } = require('fflate');

const base = process.env.DEPLOY_TEST_URL ?? 'http://127.0.0.1:8791';
const out = new URL('../../.cache/deploy-check/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// --- 1. 보안 헤더 — public/_headers 가 실제로 붙는가 --------------------------
const root = await fetch(base);
assert.equal(root.status, 200, '첫 화면이 200 이 아니다');
const csp = root.headers.get('content-security-policy');
assert.ok(csp, 'CSP 헤더가 없다 — _headers 가 dist 에 실리지 않았다');
// 이 도구의 약속이 걸린 줄이다. 파일이 밖으로 나갈 길을 열지 않는다.
assert.match(csp, /connect-src 'self'/, `connect-src 가 'self' 가 아니다: ${csp}`);
assert.match(csp, /default-src 'none'/, 'default-src 가 none 이 아니다');
assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/, 'script-src 가 기대와 다르다');
for (const [header, expected] of [
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'DENY'],
  ['referrer-policy', 'no-referrer'],
]) assert.equal(root.headers.get(header), expected, `${header} 가 다르다`);
assert.match(root.headers.get('x-robots-tag') ?? '', /noindex/, 'x-robots-tag 가 없다');

// --- 2. 런타임이 이름으로 찾아 읽는 자산이 실렸는가 ---------------------------
// 번들러가 손대지 않는 것들이라 빌드에서 조용히 빠지기 쉽다. 빠지면 PDF 가
// 통째로 죽는데 첫 화면은 멀쩡해서 배포 뒤에야 안다.
const cmap = await fetch(`${base}/pdf-assets/cmaps/UniKS-UCS2-H.bcmap`);
assert.equal(cmap.status, 200, 'PDF.js cmap 이 dist 에 없다 (한글 PDF 가 깨진다)');
const stdFont = await fetch(`${base}/pdf-assets/standard_fonts/FoxitSerif.pfb`);
assert.equal(stdFont.status, 200, 'PDF.js 기본 글꼴이 dist 에 없다');
const wasm = await fetch(`${base}/pdf-assets/wasm/jbig2.wasm`);
assert.equal(wasm.status, 200, 'PDF.js wasm 이 dist 에 없다 (스캔 PDF 가 깨진다)');
const robots = await fetch(`${base}/robots.txt`);
assert.equal(robots.status, 200, 'robots.txt 가 없다');

// 글꼴은 못 받아도 배포는 선다 (화면이 라틴 글꼴로 물러난다). 있으면 성한지 본다.
const catalog = await fetch(`${base}/fonts/fonts.json`);
const fonts = catalog.status === 200 ? await catalog.json() : [];
if (fonts.length) assert.ok(Array.isArray(fonts) && fonts[0].file, '글꼴 목록 모양이 다르다');

// --- 3. 없는 주소는 404 로 답한다 (멀쩡한 화면을 내주지 않는다) ---------------
const missing = await fetch(`${base}/없는-주소`);
assert.equal(missing.status, 404, `없는 주소가 ${missing.status} 로 답했다 — not_found_handling 을 보라`);

// --- 4. CSP 를 켠 채로 실제 화면이 서고, 변환이 끝까지 도는가 -----------------
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const violations = [];
  const external = [];
  page.on('pageerror', error => violations.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const text = message.text();
    if (/Content Security Policy|Refused to/i.test(text)) violations.push(`csp: ${text}`);
  });
  page.on('request', request => {
    const url = request.url();
    if (/^https?:/.test(url) && !url.startsWith(`${base}/`) && url !== base) external.push(url);
  });

  await page.goto(base);
  await page.locator('.conv-intro h1').waitFor();
  const tools = await page.locator('.conv-choice').count();
  assert.ok(tools >= 20, `도구가 ${tools}개뿐이다`);
  // 고르기 전에는 도구가 하나도 서 있지 않다.
  assert.equal(await page.locator('.conv-tool').count(), 0);

  // 문서 변환 — 늦게 받아 오는 청크가 CSP 아래에서 실제로 돌아야 한다.
  await page.locator('[data-choice="document"]').click();
  await page.locator('#conv-document-file').setInputFiles({
    name: '한글.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 제목\n\n본문 한글\n'),
  });
  await page.locator('.format-target').selectOption('hwpx');
  await page.locator('.format-run').click();
  await page.waitForFunction(() => document.querySelector('.conv-document .conv-status')?.dataset.tone === 'ok');

  // 링크를 눌러 브라우저가 실제로 내려받게 하고, 그 파일을 디스크에서 읽는다.
  const link = page.locator('.format-outputs a').last();
  await link.waitFor();
  const pending = page.waitForEvent('download');
  await link.click();
  const path = fileURLToPath(new URL('result.hwpx', out));
  await (await pending).saveAs(path);
  const hwpx = unzipSync(new Uint8Array(await readFile(path)));
  assert.match(strFromU8(hwpx['Contents/section0.xml']), /본문 한글/, 'HWPX 안에 본문이 없다');

  // PDF — pdfjs 가 wasm 과 /pdf-assets 를 CSP 아래에서 읽을 수 있어야 한다.
  await page.locator('[data-choice="pdf"]').click();
  await page.locator('#conv-pdf-file').waitFor();

  await page.waitForTimeout(1000);
  assert.deepEqual(external, [], `바깥으로 나간 요청이 있다: ${external.join(', ')}`);
  assert.deepEqual(violations, [], `CSP 위반·오류: ${violations.join(' | ')}`);
} finally {
  await browser.close();
}

console.log(
  `PASS: 보안 헤더(CSP connect-src 'self'), /pdf-assets·robots.txt 실림, ` +
  `글꼴 목록 ${fonts.length}종, 없는 주소 404, CSP 켠 채 문서→HWPX 왕복, ` +
  `바깥 요청 없음.`,
);
