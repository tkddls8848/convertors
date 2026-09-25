/**
 * 파비콘·OG 이미지를 만든다.
 *
 * 왜 스크립트로 굽는가 — PNG 를 손으로 그려 두면 색이나 모양을 고칠 때마다
 * 네 파일이 조금씩 어긋난다. 도형은 여기 한 군데에만 두고 나머지는 전부
 * 여기서 나오게 한다. 색도 `src/styles.css` 의 `--bg`·`--accent` 와 같은 값을
 * 적어 둔다 — 탭 아이콘만 다른 색인 것이 제일 눈에 띈다.
 *
 * 굽는 도구는 이미 있는 playwright 의 Chromium 이다. 새로 깔지 않는다 —
 * 이미지 하나 만들자고 의존성을 늘릴 이유가 없고, 검사 스크립트가 이미 같은
 * 브라우저를 쓴다.
 *
 *   node web/scripts/gen-icons.mjs
 *
 * 만드는 것:
 *   public/favicon.svg          32 기준 벡터. 크기를 가리지 않는 쪽이 본체다
 *   public/favicon-32.png       SVG 를 못 읽는 브라우저용 대체
 *   public/apple-touch-icon.png 180×180. iOS 가 제 모서리를 깎으므로 각지게 낸다
 *   public/og.png               1200×630. 공유했을 때 나오는 미리보기
 *
 * OG 이미지의 한글은 이 컴퓨터에 깔린 글꼴로 굽는다. 한글 글꼴이 없는 자리에서
 * 돌리면 글자가 네모로 나오므로, 결과 PNG 를 눈으로 보고 저장소에 넣어야 한다.
 * 그래서 이 스크립트는 빌드가 부르지 않는다 — 사람이 필요할 때만 돌린다.
 */
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const BG = '#12141a';      // styles.css --bg
const ACCENT = '#7aa2f7';  // styles.css --accent

/**
 * 표시. **변환**을 뜻하는 순수 도형 — 접힌 모서리로 문서를 말하고, 오른쪽
 * 화살표로 그것이 다른 것이 된다고 말한다. 어느 회사의 표도 닮지 않았다.
 *
 * 32 격자에 그린 이유는 제일 작게 쓰이는 자리가 32 이기 때문이다. 거기서
 * 뭉개지지 않는 굵기를 먼저 정하고 큰 쪽을 그 비율로 늘린다 — 반대로 하면
 * 큰 데서는 멀쩡하고 탭에서만 뭉갠다.
 *
 * @param {{ rounded?: boolean, bare?: boolean }} options `rounded` 는 모서리를
 *   둥글게 깎을지 — iOS 홈 화면 아이콘은 운영체제가 제 모양으로 깎으므로 각진
 *   것을 줘야 두 번 깎이지 않는다. `bare` 는 바탕 네모를 빼는 쪽으로, 이미 같은
 *   색 바탕 위에 얹는 자리(OG 이미지에서 이름 옆)에서 쓴다.
 */
const mark = ({ rounded = true, bare = false } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="변환기">
  ${bare ? '' : `<rect width="32" height="32" rx="${rounded ? 7 : 0}" fill="${BG}"/>`}
  <!-- 문서. 속을 옅게 채워야 16px 로 줄어도 덩어리로 보인다 -->
  <path d="M6.6 5.6h4.7l4.3 4.3v14.5a2 2 0 0 1-2 2H6.6a2 2 0 0 1-2-2V7.6a2 2 0 0 1 2-2z"
        fill="${ACCENT}" fill-opacity=".22" stroke="${ACCENT}" stroke-width="1.9" stroke-linejoin="round"/>
  <!-- 접힌 모서리 -->
  <path d="M11.3 5.6v4.3h4.3" fill="none" stroke="${ACCENT}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/>
  <!-- 바뀐다 -->
  <path d="M19.2 16h7.6M23.4 12.6 26.8 16l-3.4 3.4" fill="none" stroke="${ACCENT}"
        stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

/** 공유 미리보기. 표시 하나와 한 문장 — 이 도구가 남과 다른 곳은 거기뿐이다. */
const og = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; }
  body {
    background: ${BG};
    color: #e7eaf0;
    font-family: 'Pretendard', 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 96px; box-sizing: border-box; gap: 28px;
  }
  /* 왼쪽 위에서 비스듬히 번지는 강조색. 단색 바탕은 미리보기에서 죽어 보인다 */
  body::before {
    content: ''; position: fixed; inset: 0;
    background: radial-gradient(900px 520px at 12% -10%, rgba(122, 162, 247, .17), transparent 70%);
  }
  .row { display: flex; align-items: center; gap: 28px; position: relative; }
  .row svg { width: 116px; height: 116px; display: block; margin-left: -12px; }
  h1 { font-size: 88px; line-height: 1; margin: 0; letter-spacing: -.02em; font-weight: 800; }
  p { font-size: 40px; line-height: 1.45; margin: 0; color: #99a1b3; position: relative; max-width: 22em; }
  strong { color: ${ACCENT}; font-weight: 700; }
  .rule { height: 6px; width: 132px; background: ${ACCENT}; border-radius: 3px; position: relative; }
</style></head><body>
  <div class="row">${mark({ bare: true })}<h1>변환기</h1></div>
  <div class="rule"></div>
  <p>문서·PDF·이미지·표를 브라우저 안에서 바꾼다.<br><strong>고른 파일은 이 컴퓨터를 벗어나지 않는다.</strong></p>
</body></html>
`;

const out = name => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

// SVG 가 본체다. 브라우저가 이것을 읽으면 어떤 크기로 늘려도 뭉개지지 않는다.
await writeFile(out('favicon.svg'), mark(), 'utf8');

const browser = await chromium.launch({ headless: true });
try {
  /** HTML 한 쪽을 그대로 잘라 PNG 로 낸다. 화면 배율을 1 로 못 박아야 크기가 정확하다. */
  const shoot = async (html, width, height, name) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: out(name), type: 'png' });
    await page.close();
    console.log(`  ${name}  ${width}×${height}`);
  };

  // 표시만 있는 쪽. margin 0 이어야 SVG 가 모서리에 딱 붙는다.
  const sheet = (svg, size) => `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:${BG}} svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`;

  await shoot(sheet(mark(), 32), 32, 32, 'favicon-32.png');
  await shoot(sheet(mark({ rounded: false }), 180), 180, 180, 'apple-touch-icon.png');
  await shoot(og, 1200, 630, 'og.png');
} finally {
  await browser.close();
}

console.log('PASS: favicon.svg · favicon-32.png · apple-touch-icon.png · og.png 를 public/ 에 냈다.');
