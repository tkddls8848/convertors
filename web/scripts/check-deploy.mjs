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
 *   npm --prefix web run preview:cf -- --port 18700
 *   node web/scripts/check-deploy.mjs
 *
 * 배포 주소를 넣고 빌드했다면 검사에도 같은 값을 넘겨라. 그래야 canonical·og:url·
 * sitemap.xml 이 실제로 실렸는지까지 본다. 빈 채로 돌리면 반대로 **그 셋이 없는지**
 * 를 본다 — 주소를 모르는 채 무언가 나왔다면 그것이 틀린 주소라는 뜻이다.
 *
 *   VITE_SITE_URL=https://convertors.example.com node web/scripts/check-deploy.mjs
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

// 포트를 18xxx 대에서 고른다. 윈도우는 Hyper-V·WinNAT 용으로 TCP 포트 100개씩을
// 통째로 예약해 두는데(`netsh interface ipv4 show excludedportrange protocol=tcp`)
// 8000~13000 대가 자주 걸린다. 예약된 포트에 묶으면 wrangler 가 EACCES 로 죽고,
// 그 오류는 설정이 틀린 것처럼 보여서 한참 헤매게 된다. 리눅스 CI 는 무관하지만
// 기본값은 **양쪽에서 다 되는 값**이어야 한다.
const base = process.env.DEPLOY_TEST_URL ?? 'http://127.0.0.1:18700';

/**
 * 색인을 막은 배포(스테이징)를 보는가.
 *
 * 스테이징은 프로덕션과 **같은 dist** 를 올린다. 같은 내용이 두 주소에 뜨면 검색
 * 엔진이 그중 하나를 고르는데 하필 스테이징이 뽑히면 쓰는 사람이 낡은 판을 본다.
 * 그래서 스테이징은 `VITE_NOINDEX=1` 로 굽고, 이 검사는 **두 모드에서 서로 반대를
 * 단언한다** — 안 그러면 실수로 프로덕션에 noindex 를 올려도 검사가 통과한다.
 */
const noIndex = /^(1|true|yes)$/i.test((process.env.VITE_NOINDEX ?? '').trim());
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
// 공개 제품이 된 뒤로는 반대를 단언한다. noindex 헤더가 한 줄이라도 남아 있으면
// robots.txt 를 아무리 열어도 색인되지 않는데, 화면은 멀쩡해서 아무도 모른다.
// 스테이징은 반대로 **있어야** 한다.
if (noIndex) {
  assert.match(
    root.headers.get('x-robots-tag') ?? '',
    /noindex/,
    '색인을 막는 배포인데 x-robots-tag 에 noindex 가 없다',
  );
} else {
  assert.doesNotMatch(
    root.headers.get('x-robots-tag') ?? '',
    /noindex/,
    `x-robots-tag 가 색인을 막고 있다: ${root.headers.get('x-robots-tag')}`,
  );
}

// --- 2. 런타임이 이름으로 찾아 읽는 자산이 실렸는가 ---------------------------
// 번들러가 손대지 않는 것들이라 빌드에서 조용히 빠지기 쉽다. 빠지면 PDF 가
// 통째로 죽는데 첫 화면은 멀쩡해서 배포 뒤에야 안다.
const cmap = await fetch(`${base}/pdf-assets/cmaps/UniKS-UCS2-H.bcmap`);
assert.equal(cmap.status, 200, 'PDF.js cmap 이 dist 에 없다 (한글 PDF 가 깨진다)');
const stdFont = await fetch(`${base}/pdf-assets/standard_fonts/FoxitSerif.pfb`);
assert.equal(stdFont.status, 200, 'PDF.js 기본 글꼴이 dist 에 없다');
const wasm = await fetch(`${base}/pdf-assets/wasm/jbig2.wasm`);
assert.equal(wasm.status, 200, 'PDF.js wasm 이 dist 에 없다 (스캔 PDF 가 깨진다)');
// 글꼴은 못 받아도 배포는 선다 (화면이 라틴 글꼴로 물러난다). 있으면 성한지 본다.
const catalog = await fetch(`${base}/fonts/fonts.json`);
const fonts = catalog.status === 200 ? await catalog.json() : [];
if (fonts.length) assert.ok(Array.isArray(fonts) && fonts[0].file, '글꼴 목록 모양이 다르다');

// --- 3. 공개 제품의 자세 — 검색과 공유가 실제로 걸리는가 ----------------------
// 여기서 틀려도 화면은 멀쩡하다. 검색에 안 뜨고 공유 미리보기가 비는 것은 쓰는
// 사람이 아니라 안 쓰는 사람에게만 보이므로, 검사가 대신 봐 주지 않으면 아무도 모른다.
const robots = await fetch(`${base}/robots.txt`);
assert.equal(robots.status, 200, 'robots.txt 가 없다');
const robotsText = await robots.text();
if (noIndex) {
  assert.match(robotsText, /^User-agent: \*\nDisallow: \//m, '색인을 막는 배포인데 robots.txt 가 열려 있다');
} else {
  assert.match(robotsText, /^User-agent: \*\nAllow: \//m, 'robots.txt 의 * 그룹이 열려 있지 않다');
  assert.match(robotsText, /^User-agent: GPTBot\nDisallow: \//m, 'AI 학습용 수집기 차단 목록이 사라졌다');
}

/**
 * PNG 인지 바이트로 본다. 확장자와 Content-Type 은 얼마든지 거짓말을 할 수 있고,
 * 깨진 이미지는 공유하기 전까지 아무 소리도 내지 않는다.
 *
 * 머리 8바이트가 PNG 서명이고, 그 뒤 IHDR 청크에 가로·세로가 큰끝 4바이트씩 들어 있다.
 */
const png = async (path, width, height) => {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, `${path} 가 없다`);
  assert.equal(response.headers.get('content-type'), 'image/png', `${path} 의 Content-Type 이 PNG 가 아니다`);
  const bytes = new DataView(await response.arrayBuffer());
  assert.equal(bytes.getUint32(0), 0x89504e47, `${path} 가 PNG 가 아니다 (서명이 다르다)`);
  assert.equal(bytes.getUint32(16), width, `${path} 의 가로가 ${width} 가 아니다`);
  assert.equal(bytes.getUint32(20), height, `${path} 의 세로가 ${height} 가 아니다`);
};

const favicon = await fetch(`${base}/favicon.svg`);
assert.equal(favicon.status, 200, 'favicon.svg 가 없다 (탭에 아무것도 안 나온다)');
assert.match(favicon.headers.get('content-type') ?? '', /image\/svg\+xml/, 'favicon.svg 의 Content-Type 이 다르다');
assert.match(await favicon.text(), /<svg[\s\S]*<\/svg>/, 'favicon.svg 안이 SVG 가 아니다');
await png('/favicon-32.png', 32, 32);
await png('/apple-touch-icon.png', 180, 180);
await png('/og.png', 1200, 630);

// 미리보기와 검색 결과에 들어가는 문구. 하나라도 빠지면 그 자리가 빈 채로 나간다.
const html = await root.text();
for (const [label, pattern] of [
  ['description', /<meta\s+name="description"\s+content="[^"]{20,}"/],
  ['og:title', /<meta\s+property="og:title"\s+content="[^"]+"/],
  ['og:description', /<meta\s+property="og:description"\s+content="[^"]+"/],
  ['og:type', /<meta\s+property="og:type"\s+content="website"/],
  ['og:locale', /<meta\s+property="og:locale"\s+content="ko_KR"/],
  ['og:image', /<meta\s+property="og:image"\s+content="[^"]*\/og\.png"/],
  ['og:image:width', /<meta\s+property="og:image:width"\s+content="1200"/],
  ['og:image:height', /<meta\s+property="og:image:height"\s+content="630"/],
  ['twitter:card', /<meta\s+name="twitter:card"\s+content="summary_large_image"/],
  ['theme-color', /<meta\s+name="theme-color"\s+content="#12141a"/],
  ['favicon', /<link\s+rel="icon"\s+href="\/favicon\.svg"/],
]) assert.match(html, pattern, `index.html 에 ${label} 이 없다`);
// 사내용 도구 시절의 흔적. 남아 있으면 robots.txt 를 열어도 소용이 없다.
// 스테이징에서는 반대로 있어야 한다 — 헤더를 못 보는 수집기까지 잡는 자리다.
if (noIndex) assert.match(html, /name="robots"[^>]*noindex/, '색인을 막는 배포인데 meta robots 가 없다');
else assert.doesNotMatch(html, /name="robots"/, 'index.html 에 아직 robots 메타가 있다');

// 주소를 아는 경우에만 절대 주소가 나온다. 모르면 지어내지 않는다 — 두 쪽 다 본다.
const site = (process.env.VITE_SITE_URL ?? '').trim().replace(/\/+$/, '');
const sitemap = await fetch(`${base}/sitemap.xml`);
if (site && noIndex) {
  // 색인하지 말라면서 sitemap 을 내미는 것은 앞뒤가 맞지 않는다. 대신 canonical 은
  // 남겨 둔다 — 혹시 긁히더라도 "여기는 저쪽의 사본"이라고 말해 주는 자리다.
  assert.equal(sitemap.status, 404, '색인을 막는 배포인데 sitemap.xml 이 나왔다');
  assert.doesNotMatch(robotsText, /^Sitemap:/m, '색인을 막는 배포인데 robots.txt 에 Sitemap 줄이 있다');
  assert.ok(html.includes(`<link rel="canonical" href="${site}/">`), 'canonical 이 없다');
  assert.ok(html.includes(`<meta property="og:url" content="${site}/">`), 'og:url 이 없다');
} else if (site) {
  assert.equal(sitemap.status, 200, 'VITE_SITE_URL 을 줬는데 sitemap.xml 이 없다');
  assert.ok((await sitemap.text()).includes(`<loc>${site}/</loc>`), 'sitemap.xml 이 다른 주소를 가리킨다');
  assert.ok(robotsText.includes(`Sitemap: ${site}/sitemap.xml`), 'robots.txt 에 Sitemap 줄이 없다');
  assert.ok(html.includes(`<link rel="canonical" href="${site}/">`), 'canonical 이 없다');
  assert.ok(html.includes(`<meta property="og:url" content="${site}/">`), 'og:url 이 없다');
  assert.ok(html.includes(`content="${site}/og.png"`), 'og:image 가 절대 주소가 아니다');
} else {
  assert.equal(sitemap.status, 404, 'VITE_SITE_URL 없이 sitemap.xml 이 나왔다 — 주소를 지어냈다는 뜻이다');
  assert.doesNotMatch(robotsText, /^Sitemap:/m, 'VITE_SITE_URL 없이 robots.txt 에 Sitemap 줄이 있다');
  assert.doesNotMatch(html, /rel="canonical"/, 'VITE_SITE_URL 없이 canonical 이 나왔다');
  assert.doesNotMatch(html, /property="og:url"/, 'VITE_SITE_URL 없이 og:url 이 나왔다');
}

// --- 4. 없는 주소는 404 로 답한다 (멀쩡한 화면을 내주지 않는다) ---------------
const missing = await fetch(`${base}/없는-주소`);
assert.equal(missing.status, 404, `없는 주소가 ${missing.status} 로 답했다 — not_found_handling 을 보라`);

// --- 5. CSP 를 켠 채로 실제 화면이 서고, 변환이 끝까지 도는가 -----------------
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

const 색인 = noIndex
  ? 'noindex 켬(robots Disallow·X-Robots-Tag·meta)'
  : 'noindex 없음';
const 주소 = !site
  ? '배포 주소 없음 — canonical·og:url·sitemap 안 냄'
  : noIndex
    ? `배포 주소 ${site} — canonical·og:url 만, sitemap 안 냄`
    : `배포 주소 ${site} — canonical·og:url·sitemap 실림`;

console.log(
  `PASS: 보안 헤더(CSP connect-src 'self', ${색인}), /pdf-assets·robots.txt 실림, ` +
  `글꼴 목록 ${fonts.length}종, 파비콘·OG 이미지 성함, 메타 태그 갖춤, ` +
  `${주소}, 없는 주소 404, CSP 켠 채 문서→HWPX 왕복, 바깥 요청 없음.`,
);
