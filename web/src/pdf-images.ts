/**
 * PDF → 이미지.
 *
 * 쪽을 그려 PNG 또는 JPEG 로 낸다. 여러 장이면 ZIP 하나로 묶는다.
 *
 * **보장하는 것**: 보이는 그대로 그려진다 — 글꼴·배치·그림이 화면과 같다.
 * **보장하지 않는 것**: 글자가 그림이 되므로 검색·복사·편집이 되지 않는다.
 * 그것이 필요하면 PDF → HWPX 텍스트 방식을 쓴다.
 */
import { zipSync, type Zippable } from 'fflate';
import { openPdf, pixelCount, rasterize, RENDER_LIMITS } from './pdf-render';

export const PDF_IMAGE_LIMITS = { ...RENDER_LIMITS, pages: 200 };

export interface PdfImageOptions {
  /** 1부터 세는 쪽 번호. 없으면 전부. */
  pages?: number[];
  dpi: 150 | 200 | 300;
  format: 'png' | 'jpeg';
  rotation: number;
  signal: AbortSignal;
  progress: (message: string) => void;
}

export interface PdfImageFile { name: string; bytes: Uint8Array }

export async function pdfToImages(bytes: Uint8Array, options: PdfImageOptions): Promise<PdfImageFile[]> {
  options.signal.throwIfAborted();
  if (!bytes.length || bytes.length > PDF_IMAGE_LIMITS.inputBytes) throw new Error('PDF 입력은 64MB까지 지원합니다.');
  if (![150, 200, 300].includes(options.dpi) || !Number.isInteger(options.rotation / 90)) throw new Error('해상도 또는 회전값이 올바르지 않습니다.');
  if (options.format !== 'png' && options.format !== 'jpeg') throw new Error('PNG 또는 JPEG 만 만들 수 있습니다.');
  options.progress('PDF 읽는 중…');
  const task = openPdf(bytes);
  const cancel = (): void => { void task.destroy().catch(() => {}); };
  options.signal.addEventListener('abort', cancel, { once: true });
  try {
    const pdf = await task.promise;
    const numbers = options.pages ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    if (!numbers.length || numbers.length > PDF_IMAGE_LIMITS.pages) throw new Error(`이미지는 한 번에 1~${PDF_IMAGE_LIMITS.pages}쪽까지 만들 수 있습니다.`);
    if (numbers.some(n => !Number.isInteger(n) || n < 1 || n > pdf.numPages)) throw new Error(`쪽 번호는 1~${pdf.numPages} 사이여야 합니다.`);
    // 쪽 번호의 자릿수를 맞춰 둬야 파일 탐색기에서 1, 10, 2 로 흩어지지 않는다.
    const digits = String(numbers.length).length;
    const files: PdfImageFile[] = [];
    let pixels = 0, size = 0;
    for (const [index, number] of numbers.entries()) {
      options.signal.throwIfAborted();
      options.progress(`${index + 1}/${numbers.length}쪽 그리는 중…`);
      const page = await pdf.getPage(number);
      try {
        const rotation = ((page.rotate + options.rotation) % 360 + 360) % 360;
        const count = pixelCount(page, rotation, options.dpi);
        pixels += count;
        if (count > PDF_IMAGE_LIMITS.pixels || pixels > PDF_IMAGE_LIMITS.totalPixels) {
          throw new Error('렌더링 픽셀 한도를 초과했습니다. 쪽 수 또는 해상도를 낮춰 주세요.');
        }
        const rendered = await rasterize(page, rotation, options.dpi, `image/${options.format}`, options.signal);
        size += rendered.bytes.length;
        if (size > PDF_IMAGE_LIMITS.outputBytes) throw new Error('그림 합계가 64MB를 초과했습니다. 쪽 수 또는 해상도를 낮춰 주세요.');
        files.push({ name: `page-${String(index + 1).padStart(digits, '0')}.${options.format === 'jpeg' ? 'jpg' : 'png'}`, bytes: rendered.bytes });
      } finally { page.cleanup(); }
      // 한 틱 놓아 준다 — 취소 단추와 진행 표시가 그동안 그려진다.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    options.signal.throwIfAborted();
    return files;
  } catch (error) {
    options.signal.throwIfAborted();
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('암호화된 PDF는 보안을 해제한 사본을 사용하세요.');
    throw error;
  } finally {
    options.signal.removeEventListener('abort', cancel);
    await task.destroy();
  }
}

/** PNG·JPEG 는 이미 압축돼 있다. 다시 줄이려 들면 시간만 쓰고 크기는 그대로다. */
export function packImages(files: PdfImageFile[]): Uint8Array {
  const zippable: Zippable = {};
  for (const file of files) zippable[file.name] = [file.bytes, { level: 0 }];
  return zipSync(zippable);
}
