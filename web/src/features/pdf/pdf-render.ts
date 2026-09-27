/**
 * PDF.js 로 쪽을 여는 자리.
 *
 * PDF → HWPX(`pdf-hwpx.ts`)와 PDF → 이미지(`pdf-images.ts`)가 같은 방식으로
 * 쪽을 열고 그린다. 두 벌이 되면 한쪽만 고쳐져 결과가 갈리므로 여기 한 벌만 둔다
 * (공유는 이 폴더 안에서만 한다 — 결정 0012).
 */
import { getDocument, GlobalWorkerOptions, type PageViewport, type PDFDocumentLoadingTask, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export const RENDER_LIMITS = {
  inputBytes: 64 * 1024 * 1024,
  /** 쪽 한 장의 픽셀 수. 이 위로는 브라우저가 캔버스를 내주지 않는 일이 잦다. */
  pixels: 20_000_000,
  totalPixels: 120_000_000,
  outputBytes: 64 * 1024 * 1024,
};

export interface RenderedPage {
  bytes: Uint8Array;
  /** PDF point (1/72 inch), 회전을 반영한 값. */
  width: number;
  height: number;
}

/** 배포된 자리에서 cmap·글꼴·wasm 을 찾는다. 네트워크 밖으로는 나가지 않는다. */
export function openPdf(bytes: Uint8Array): PDFDocumentLoadingTask {
  const assets = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, location.origin).href;
  return getDocument({
    data: bytes.slice(), stopAtErrors: true,
    cMapUrl: `${assets}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/`,
  });
}

/** 쪽 한 장을 그려 PNG 또는 JPEG 바이트로 돌려준다. */
export async function rasterize(
  page: PDFPageProxy, rotation: number, dpi: number,
  type: 'image/png' | 'image/jpeg', signal: AbortSignal,
): Promise<RenderedPage> {
  const size = page.getViewport({ scale: 1, rotation });
  const viewport = page.getViewport({ scale: dpi / 72, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  try {
    const task = page.render({ canvas, viewport, background: 'rgb(255,255,255)' });
    const cancel = (): void => task.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try { await task.promise; } finally { signal.removeEventListener('abort', cancel); }
    signal.throwIfAborted();
    // JPEG 품질 0.92 는 글자 가장자리가 뭉개지기 직전이다. 더 낮추지 않는다.
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('그림 생성에 실패했습니다.')), type, 0.92));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: size.width, height: size.height };
  } finally { canvas.width = 0; canvas.height = 0; }
}

/**
 * 쪽을 화면의 캔버스에 그대로 그린다.
 *
 * `rasterize` 와 달리 바이트를 만들지 않는다. 글자 고치기 화면이 쪽을 보여 주고
 * 그 위에서 자리를 고르는 데 쓴다 — 그리는 방법이 두 벌이 되지 않게 여기 둔다.
 */
export async function renderToCanvas(page: PDFPageProxy, canvas: HTMLCanvasElement, viewport: PageViewport): Promise<void> {
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport, background: 'rgb(255,255,255)' }).promise;
}

/** 쪽 하나를 그릴 때 나올 픽셀 수. 한도 검사에 쓴다. */
export function pixelCount(page: PDFPageProxy, rotation: number, dpi: number): number {
  const viewport = page.getViewport({ scale: dpi / 72, rotation });
  return Math.ceil(viewport.width) * Math.ceil(viewport.height);
}
