import templateUrl from './assets/Skeleton.hwpx?url';
import { documentToHwpx, type DocumentPage, type ImagePage } from './hwpx-writer';
import { openPdf, pixelCount, rasterize, RENDER_LIMITS } from './pdf-render';
import { reconstructText } from './pdf-text';

export const IMAGE_LIMITS = { ...RENDER_LIMITS, pages: 100 };
export interface ImageOptions {
  page: number; dpi: 150 | 200 | 300; rotation: number;
  signal: AbortSignal; progress: (message: string) => void;
}
export interface HwpxOptions extends Omit<ImageOptions, 'page'> {
  pages?: number[];
  mode: 'image' | 'text';
  emptyText: 'error' | 'image' | 'skip';
  tables: boolean;
}

export async function pdfToHwpx(bytes: Uint8Array, options: HwpxOptions): Promise<{ bytes: Uint8Array; warnings: string[]; pages: number }> {
  options.signal.throwIfAborted();
  if (!bytes.length || bytes.length > IMAGE_LIMITS.inputBytes) throw new Error('PDF 입력은 64MB까지 지원합니다.');
  if (![150, 200, 300].includes(options.dpi) || !Number.isInteger(options.rotation / 90)) throw new Error('해상도 또는 회전값이 올바르지 않습니다.');
  options.progress('PDF 읽는 중…');
  const task = openPdf(bytes);
  const cancel = (): void => { void task.destroy().catch(() => {}); };
  options.signal.addEventListener('abort', cancel, { once: true });
  try {
    const pdf = await task.promise;
    const numbers = options.pages ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    if (!numbers.length || numbers.length > IMAGE_LIMITS.pages) throw new Error('HWPX는 한 번에 1~100쪽까지 변환할 수 있습니다.');
    if (numbers.some(n => !Number.isInteger(n) || n < 1 || n > pdf.numPages)) throw new Error(`쪽 번호는 1~${pdf.numPages} 사이여야 합니다.`);
    const output: DocumentPage[] = [], warnings: string[] = [];
    let pixels = 0, size = 0;
    for (const [index, number] of numbers.entries()) {
      options.signal.throwIfAborted();
      options.progress(`${index + 1}/${numbers.length}쪽 변환 중…`);
      const page = await pdf.getPage(number);
      try {
        const rotation = ((page.rotate + options.rotation) % 360 + 360) % 360;
        const viewport = page.getViewport({ scale: 1, rotation });
        let image = options.mode === 'image';
        if (!image) {
          const content = await page.getTextContent();
          const spans = content.items.flatMap(item => {
            if (!('str' in item)) return [];
            const [x, y] = viewport.convertToViewportPoint(item.transform[4]!, item.transform[5]!);
            return [{ text: item.str, x: x!, y: y!, width: item.width, height: Math.max(item.height, 1) }];
          });
          const blocks = reconstructText(spans, options.tables);
          if (!blocks.length) {
            if (options.emptyText === 'error') throw new Error(`${number}쪽에서 텍스트를 찾지 못했습니다. 스캔 문서라면 이미지 방식을 선택하거나 빈 텍스트 처리 옵션을 바꿔 주세요.`);
            warnings.push(`${number}쪽: 텍스트 없음 → ${options.emptyText === 'image' ? '이미지로 저장' : '사용자 설정에 따라 제외'}`);
            if (options.emptyText === 'skip') continue;
            image = true;
          } else {
            output.push({ width: viewport.width, height: viewport.height, blocks });
            warnings.push(`${number}쪽: 읽는 순서·표를 확인하세요. 그림·수식·글꼴·원본 배치는 재현하지 않습니다.${rotation ? ' 회전된 글의 순서 확인이 필요합니다.' : ''}`);
          }
        }
        if (image) {
          const count = pixelCount(page, rotation, options.dpi);
          pixels += count;
          if (count > IMAGE_LIMITS.pixels || pixels > IMAGE_LIMITS.totalPixels) throw new Error('렌더링 픽셀 한도를 초과했습니다. 쪽 수 또는 해상도를 낮춰 주세요.');
          // HWPX 의 그림은 PNG 로 넣는다. `hwpx-writer` 가 PNG 서명을 확인한다.
          const rendered = await rasterize(page, rotation, options.dpi, 'image/png', options.signal);
          size += rendered.bytes.length;
          if (size > IMAGE_LIMITS.outputBytes) throw new Error('그림 합계가 64MB를 초과했습니다. 쪽 수 또는 해상도를 낮춰 주세요.');
          output.push({ png: rendered.bytes, width: rendered.width, height: rendered.height } satisfies ImagePage);
        }
      } finally { page.cleanup(); }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    options.signal.throwIfAborted();
    options.progress('HWPX 묶는 중…');
    const response = await fetch(templateUrl, { signal: options.signal });
    if (!response.ok) throw new Error('HWPX 템플릿을 읽지 못했습니다.');
    const result = documentToHwpx(new Uint8Array(await response.arrayBuffer()), output);
    options.signal.throwIfAborted();
    if (result.length > IMAGE_LIMITS.outputBytes) throw new Error('출력이 64MB 한도를 초과했습니다.');
    return { bytes: result, warnings, pages: output.length };
  } catch (error) {
    options.signal.throwIfAborted();
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('암호화된 PDF는 보안을 해제한 사본을 사용하세요.');
    throw error;
  } finally {
    options.signal.removeEventListener('abort', cancel);
    await task.destroy();
  }
}

export async function pdfPageToHwpx(bytes: Uint8Array, options: ImageOptions): Promise<Uint8Array> {
  return (await pdfToHwpx(bytes, { ...options, pages: [options.page], mode: 'image', emptyText: 'error', tables: false })).bytes;
}
