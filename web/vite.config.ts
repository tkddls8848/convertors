// vitest 의 defineConfig 는 vite 의 것을 그대로 넓힌 것이다. test 항목까지 타입이 선다.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';

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
const pdfAssets = new Map<string, string>();
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  for (const name of readdirSync(at(`./node_modules/pdfjs-dist/${dir}`))) {
    pdfAssets.set(`/pdf-assets/${dir}/${name}`, at(`./node_modules/pdfjs-dist/${dir}/${name}`));
  }
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
  }],
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
