// vitest 의 defineConfig 는 vite 의 것을 그대로 넓힌 것이다. test 항목까지 타입이 선다.
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * PDF.js 가 런타임에 읽는 자료 — cmap(CJK 인코딩 표), 기본 글꼴, wasm, ICC.
 *
 * 번들러가 손대지 않는 이유는 그것이 코드가 아니라 **런타임이 이름으로 찾아
 * 읽는 자료** 이기 때문이다. 개발 서버에서는 미들웨어가 내주고, 빌드에서는
 * 같은 자리(`/pdf-assets/…`)로 그대로 떨군다.
 *
 * 이 자료가 우리 출처에 있어야 `connect-src 'self'` 를 지킬 수 있다 — CDN 을
 * 가리키면 고른 파일이 브라우저를 벗어나지 않는다는 약속이 흔들린다.
 */
/**
 * 무엇이 실려 나가는가는 `pdf-assets.json` 하나가 정한다.
 *
 * 여기와 `scripts/gen_licenses.mjs` 가 **같은 파일을 읽는다.** 목록을 두 곳에
 * 따로 적으면 배포물과 법적 고지가 조용히 어긋나는데, 고지에서 그것이 제일
 * 나쁜 실패다 — 싣지 않은 것을 고지하거나, 실은 것을 고지하지 않게 된다.
 *
 * 지금 빠지는 것은 Liberation 글꼴(GPLv2 + 글꼴 예외)이다. 이유와 실측값은
 * 그 파일에 적어 두었다.
 */
const assetManifest = JSON.parse(readFileSync(at('./pdf-assets.json'), 'utf8')) as {
  dirs: string[];
  excludePattern: string;
};
const excluded = new RegExp(assetManifest.excludePattern);
const pdfAssets = new Map<string, string>();
for (const dir of assetManifest.dirs) {
  for (const name of readdirSync(at(`./node_modules/pdfjs-dist/${dir}`))) {
    if (excluded.test(name)) continue;
    pdfAssets.set(`/pdf-assets/${dir}/${name}`, at(`./node_modules/pdfjs-dist/${dir}/${name}`));
  }
}

/**
 * 배포 주소를 아는 것은 이 플러그인 하나뿐이다.
 *
 * canonical·og:url·sitemap.xml 은 전부 **절대 주소**여야 뜻이 산다. 상대 경로로
 * 적으면 규약이 읽어 주지 않는다. 그런데 이 저장소는 제가 어디에 올라갈지 모른다 —
 * 스테이징과 프로덕션이 다르고, 앞으로 도메인이 바뀔 수도 있다.
 *
 * 그래서 `VITE_SITE_URL` 로 받고, **없으면 그 셋을 아예 내지 않는다.** 그럴듯한
 * 주소를 지어내면 검색 엔진이 남의 주소를 정본으로 알고, 공유 미리보기가 없는 쪽을
 * 긁는다. 틀린 주소를 내는 것이 빈 것보다 나쁘다 — 조용히 실패하지 않는 것이 이
 * 도구의 규칙이고, 여기서 조용한 실패는 "내긴 냈는데 엉뚱한 곳을 가리킨다" 이다.
 *
 * 값이 있는데 주소로 읽히지 않으면 빌드를 세운다. 오타가 난 주소를 그대로 박아
 * 올리는 것이 제일 나쁜 결말이기 때문이다.
 *
 * 한 군데에 모아 둔 이유 — 셋이 흩어지면 도메인을 바꿀 때 하나가 남는다. 그 하나가
 * 옛 주소를 가리켜도 화면은 멀쩡해서 아무도 모른다.
 */
function siteUrl(): Plugin {
  let site = '';
  let outDir = '';
  let built = false;

  return {
    name: 'converter-site-url',

    configResolved(config) {
      // resolved.env 는 process.env 의 VITE_ 변수와 .env 파일을 합친 것이다.
      // 둘 중 어느 쪽으로 넣어도 같게 읽힌다.
      const raw = String(config.env.VITE_SITE_URL ?? '').trim();
      outDir = resolve(config.root, config.build.outDir);
      if (!raw) return;

      let parsed;
      try { parsed = new URL(raw); } catch { parsed = null; }
      if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
        throw new Error(`VITE_SITE_URL 이 주소가 아니다: ${raw} (예: https://convertors.example.com)`);
      }
      // 뒤 빗금을 떼어 두면 아래에서 붙이는 쪽이 한 가지로 끝난다.
      site = parsed.origin + parsed.pathname.replace(/\/+$/, '');
    },

    transformIndexHtml(html) {
      if (!site) return html;
      return {
        // og:image 는 index.html 에 상대 경로로 있다. 주소를 아는 지금만 절대로 바꾼다.
        html: html.replace('content="/og.png"', `content="${site}/og.png"`),
        tags: [
          { tag: 'link', attrs: { rel: 'canonical', href: `${site}/` }, injectTo: 'head' as const },
          { tag: 'meta', attrs: { property: 'og:url', content: `${site}/` }, injectTo: 'head' as const },
        ],
      };
    },

    // 진짜 빌드였는지 표시해 둔다. vite 는 개발 서버를 닫을 때도 closeBundle 을
    // 부르는데, 그때 아래를 돌리면 굽지도 않은 dist/ 에 sitemap 을 떨구고
    // robots.txt 에 Sitemap 줄을 켤 때마다 하나씩 덧붙이게 된다.
    generateBundle() { built = true; },

    // public/ 을 통째로 베끼는 일이 끝난 뒤라야 robots.txt 에 덧붙일 수 있다.
    // closeBundle 은 빌드의 맨 끝이라 그 순서를 따질 필요가 없다.
    closeBundle() {
      if (!built) return;
      if (!site) {
        this.warn('VITE_SITE_URL 이 없어 canonical·og:url·sitemap.xml 을 내지 않았다. 배포 주소가 정해지면 넣어라.');
        return;
      }

      // 화면이 하나뿐이라 주소도 하나다. lastmod 는 넣지 않는다 — 내용이 그대로인
      // 배포에서도 날짜만 바뀌면 크롤러에게 거짓말을 하는 셈이다.
      writeFileSync(resolve(outDir, 'sitemap.xml'), [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        `    <loc>${site}/</loc>`,
        '  </url>',
        '</urlset>',
        '',
      ].join('\n'));

      const robots = resolve(outDir, 'robots.txt');
      if (existsSync(robots)) appendFileSync(robots, `\nSitemap: ${site}/sitemap.xml\n`);

      this.info(`VITE_SITE_URL=${site} — canonical·og:url·sitemap.xml·robots Sitemap 을 냈다.`);
    },
  };
}

/**
 * 변환기의 빌드 설정.
 *
 * 셸(`index.html` · `src/main.ts`)은 빈 칸을 내주고 `src/panel.ts` 의
 * `mountConverters` 하나만 부른다. 화면 뼈대·스타일·논리는 전부 `src/` 가 갖는다.
 *
 * 별명은 전부 **이 폴더 안의 node_modules** 를 가리킨다. 라이브러리마다 ESM
 * 진입점을 집어 주는 이유는, 자동 해석에 맡기면 CommonJS 번들이 딸려 들어와
 * 워커에서 터지기 때문이다.
 */
export default defineConfig({
  plugins: [{
    name: 'converter-pdf-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = pdfAssets.get((request.url ?? '').split('?')[0]!);
        if (!path) { next(); return; }
        response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        response.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const [name, path] of pdfAssets) this.emitFile({ type: 'asset', fileName: name.slice(1), source: readFileSync(path) });
    },
  }, siteUrl()],
  optimizeDeps: { exclude: ['pdfjs-dist'], include: ['xlsx', 'xlsx/dist/cpexcel.full.mjs'] },
  resolve: {
    alias: {
      'pdf-lib': at('./node_modules/pdf-lib/es/index.js'),
      '@pdf-lib/fontkit': at('./node_modules/@pdf-lib/fontkit/dist/fontkit.es.js'),
      'pdfjs-dist': at('./node_modules/pdfjs-dist'),
      'fflate': at('./node_modules/fflate/esm/browser.js'),
      'qrcode-generator': at('./node_modules/qrcode-generator/dist/qrcode.mjs'),
      'xlsx/dist/cpexcel.full.mjs': at('./node_modules/xlsx/dist/cpexcel.full.mjs'),
      'xlsx': at('./node_modules/xlsx/xlsx.mjs'),
    },
  },
  worker: {
    // 표를 다루는 일꾼은 모듈 워커다. `import.meta.url` 로 만든 URL 을 그대로 쓴다.
    format: 'es',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
