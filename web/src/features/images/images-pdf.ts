/**
 * 이미지 → PDF.
 *
 * 사진·스캔 여러 장을 한 PDF 로 묶는다. pdf-lib 이 PNG·JPEG 를 **다시 압축하지
 * 않고 그대로 심으므로** 화질이 떨어지지 않고, 그래서 캔버스를 거치지 않는다 —
 * 이 파일이 브라우저 없이도 도는 이유이고, 그래서 테스트가 붙는다.
 *
 * **보장하는 것**: 원본 화질 그대로, 고른 순서대로, 비율을 지켜 배치한다.
 * **보장하지 않는 것**: OCR 을 하지 않으므로 글자를 찾거나 복사할 수 없다.
 */
import { PDFDocument } from 'pdf-lib';

export const IMAGES_PDF_LIMITS = { totalBytes: 64 * 1024 * 1024, count: 200 };

/** 쪽 크기. 'image' 는 그림 한 장이 곧 한 쪽이다(여백 없음). */
export type PageFit = 'image' | 'a4' | 'a4-landscape' | 'letter';

export interface ImageInput { name: string; bytes: Uint8Array }
export interface ImagesPdfOptions {
  fit: PageFit;
  /** a4·letter 에서만 쓰는 여백. PDF point(1/72 inch). */
  margin: number;
}

const PAPER: Record<Exclude<PageFit, 'image'>, [number, number]> = {
  a4: [595.28, 841.89],
  'a4-landscape': [841.89, 595.28],
  letter: [612, 792],
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 확장자는 거짓말을 한다. 바이트를 본다. */
export function imageKind(bytes: Uint8Array): 'png' | 'jpeg' | undefined {
  if (bytes.length > 8 && PNG.every((byte, i) => bytes[i] === byte)) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return undefined;
}

/** 비율을 지켜 칸 안에 맞추고 가운데에 놓는다. */
export function fitBox(
  image: { width: number; height: number },
  box: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

export async function imagesToPdf(images: ImageInput[], options: ImagesPdfOptions): Promise<Uint8Array> {
  if (!images.length) throw new Error('묶을 그림이 없습니다.');
  if (images.length > IMAGES_PDF_LIMITS.count) throw new Error(`그림은 한 번에 ${IMAGES_PDF_LIMITS.count}장까지 묶을 수 있습니다.`);
  const total = images.reduce((sum, image) => sum + image.bytes.length, 0);
  if (total > IMAGES_PDF_LIMITS.totalBytes) throw new Error('그림은 합계 64MB까지 묶을 수 있습니다.');
  if (!Number.isFinite(options.margin) || options.margin < 0 || options.margin > 400) throw new Error('여백은 0~400pt 사이여야 합니다.');

  const pdf = await PDFDocument.create();
  for (const image of images) {
    const kind = imageKind(image.bytes);
    if (!kind) throw new Error(`${image.name}: PNG 또는 JPEG 가 아닙니다.`);
    // 같은 그림을 두 번 골라도 한 번만 담긴다 — pdf-lib 이 내부에서 묶어 준다.
    const embedded = kind === 'png' ? await pdf.embedPng(image.bytes) : await pdf.embedJpg(image.bytes);
    if (options.fit === 'image') {
      // 픽셀 하나를 1pt 로 본다. 200 DPI 로 스캔한 A4 라면 쪽이 그만큼 커지지만,
      // 인쇄할 때 축소되므로 화질은 그대로다.
      const page = pdf.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
      continue;
    }
    const [width, height] = PAPER[options.fit];
    const page = pdf.addPage([width, height]);
    const inner = { width: width - options.margin * 2, height: height - options.margin * 2 };
    if (inner.width <= 0 || inner.height <= 0) throw new Error('여백이 쪽보다 큽니다.');
    const box = fitBox(embedded, inner);
    page.drawImage(embedded, { x: options.margin + box.x, y: options.margin + box.y, width: box.width, height: box.height });
  }
  return pdf.save();
}
