import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { readPdf, savePdf, splitRanges, type PdfPageRef } from './pdf';

async function fixture(widths: number[]) {
  const doc = await PDFDocument.create();
  widths.forEach(width => doc.addPage([width, 400]).drawText(`Page ${width}`));
  doc.getPage(0).setRotation(degrees(90));
  return readPdf(await doc.save(), 'source.pdf');
}

describe('PDF 편집', () => {
  it('다른 원본을 병합하고 순서와 기존 회전을 저장 결과에 반영한다', async () => {
    const a = await fixture([200, 300]);
    const b = await fixture([500]);
    const refs: PdfPageRef[] = [
      { source: b, index: 0, rotation: 90 },
      { source: a, index: 1, rotation: 270 },
      { source: a, index: 0, rotation: 270 },
    ];
    const result = await PDFDocument.load(await savePdf(refs));
    expect(result.getPages().map(page => page.getWidth())).toEqual([500, 300, 200]);
    expect(result.getPages().map(page => page.getRotation().angle)).toEqual([180, 270, 0]);
    expect(a.document.getPage(0).getRotation().angle).toBe(90);
    expect(result.getPages().every(page => page.node.Contents() !== undefined)).toBe(true);
  });

  it('분할 결과를 각각 다시 열 수 있고 지정하지 않은 쪽은 빠진다', async () => {
    const source = await fixture([200, 300, 400, 500]);
    const refs = source.document.getPageIndices().map(index => ({ source, index, rotation: 0 }));
    const groups = splitRanges('1-2; 4', refs.length);
    const outputs = await Promise.all(groups.map(group => savePdf(group.map(i => refs[i]!))));
    const docs = await Promise.all(outputs.map(bytes => PDFDocument.load(bytes)));
    expect(docs.map(doc => doc.getPages().map(page => page.getWidth()))).toEqual([[200, 300], [500]]);
  });

  it('범위와 쉼표를 해석하고 입력 순서를 유지한다', () => {
    expect(splitRanges(' 3, 1-2 ; 4 ', 4)).toEqual([[2, 0, 1], [3]]);
  });
  it.each(['', '0', '5', '3-1', '1;', '1,,2', '1-2,2', '1.5', 'a', '1-999999999'])('잘못된 범위 %s를 거부한다', text => {
    expect(() => splitRanges(text, 4)).toThrow();
  });
  it('PDF가 아닌 입력과 빈 저장을 거부한다', async () => {
    await expect(readPdf(new TextEncoder().encode('not a pdf'), 'bad.pdf')).rejects.toThrow(/PDF를 열지 못했습니다/);
    await expect(savePdf([])).rejects.toThrow(/저장할 쪽/);
  });
});
