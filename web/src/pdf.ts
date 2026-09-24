import { PDFDocument, degrees, EncryptedPDFError } from 'pdf-lib';

import { reason } from './errors';

export interface PdfSource { name: string; document: PDFDocument; size: number }
export interface PdfPageRef { source: PdfSource; index: number; rotation: number }
export const MAX_PDF_BYTES = 64 * 1024 * 1024;
export const MAX_PDF_PAGES = 1000;

export async function readPdf(bytes: Uint8Array, name: string): Promise<PdfSource> {
  if (bytes.length > MAX_PDF_BYTES) throw new Error('PDF는 합계 64MB까지 추가할 수 있습니다.');
  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    if (!document.getPageCount()) throw new Error('쪽이 없는 PDF입니다.');
    if (document.getPageCount() > MAX_PDF_PAGES) throw new Error('PDF는 합계 1,000쪽까지 추가할 수 있습니다.');
    return { name, document, size: bytes.length };
  } catch (error) {
    if (error instanceof EncryptedPDFError) throw new Error('암호화된 PDF입니다. 암호와 보안을 해제한 사본을 추가해 주세요.');
    throw new Error(`PDF를 열지 못했습니다: ${reason(error)}`);
  }
}

/** Semicolons separate output files; commas/ranges select current editor positions. */
export function splitRanges(text: string, count: number): number[][] {
  if (!text.trim()) throw new Error('분할 범위를 입력하세요. 예: 1-3; 4-6');
  return text.split(';').map(group => {
    const indices: number[] = [];
    for (const part of group.split(',')) {
      const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
      if (!match) throw new Error('범위 형식을 확인하세요. 예: 1-3; 4,6');
      const first = Number(match[1]);
      const last = Number(match[2] ?? match[1]);
      if (first < 1 || last < first || last > count) throw new Error(`쪽 번호는 1~${count} 사이의 오름차순 범위로 입력하세요.`);
      for (let n = first; n <= last; n++) {
        if (indices.includes(n - 1)) throw new Error('한 분할 파일 안에 같은 쪽을 중복 지정할 수 없습니다.');
        indices.push(n - 1);
      }
    }
    return indices;
  });
}

export async function savePdf(pages: PdfPageRef[]): Promise<Uint8Array> {
  if (!pages.length) throw new Error('저장할 쪽이 없습니다.');
  const output = await PDFDocument.create();
  // Copy each source in one batch so shared fonts/images stay shared.
  const copied = new Map<PdfPageRef, Awaited<ReturnType<PDFDocument['copyPages']>>[number]>();
  for (const source of new Set(pages.map(page => page.source))) {
    const refs = pages.filter(page => page.source === source);
    const batch = await output.copyPages(source.document, refs.map(page => page.index));
    refs.forEach((ref, i) => copied.set(ref, batch[i]!));
  }
  for (const ref of pages) {
    const page = copied.get(ref)!;
    page.setRotation(degrees(((page.getRotation().angle + ref.rotation) % 360 + 360) % 360));
    output.addPage(page);
  }
  return output.save();
}
