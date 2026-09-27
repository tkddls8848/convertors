import { degrees, PDFDocument, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { A4, cellRects, chooseLayout, fitInCell, inkRatio, isBlank, nupPdf, placeRotated, removePages } from './pdf-nup';
import { rotate, type Quarter } from './pdf-stamp';

const PORTRAIT = { width: 595, height: 842 };

describe('칸 나눔', () => {
  it('원본이 가장 크게 앉는 방향을 고른다', () => {
    expect(chooseLayout(2, PORTRAIT, 20, 10)).toMatchObject({ cols: 2, rows: 1, sheet: { width: A4.height } });
    expect(chooseLayout(4, PORTRAIT, 20, 10)).toMatchObject({ cols: 2, rows: 2, sheet: { width: A4.width } });
    expect(chooseLayout(6, PORTRAIT, 20, 10)).toMatchObject({ cols: 3, rows: 2, sheet: { width: A4.height } });
    expect(chooseLayout(9, PORTRAIT, 20, 10)).toMatchObject({ cols: 3, rows: 3, sheet: { width: A4.width } });
    // 가로 원본 두 쪽은 세로 용지에 위아래로.
    expect(chooseLayout(2, { width: 842, height: 595 }, 20, 10)).toMatchObject({ cols: 1, rows: 2, sheet: { width: A4.width } });
    expect(() => chooseLayout(4, PORTRAIT, 400, 10)).toThrow(/여백/);
  });

  it('칸을 읽는 순서대로 늘어놓는다', () => {
    const layout = { sheet: { width: 200, height: 300 }, cols: 2, rows: 3 };
    const byRow = cellRects(layout, 10, 0, 'row');
    const byColumn = cellRects(layout, 10, 0, 'column');
    // 첫 칸은 왼쪽 위.
    expect(byRow[0]).toEqual({ x: 10, y: 300 - 10 - 280 / 3, width: 90, height: 280 / 3 });
    // 줄 먼저: 둘째 칸은 오른쪽. 칸 먼저: 둘째 칸은 아래.
    expect(byRow[1]!.x).toBeGreaterThan(byRow[0]!.x);
    expect(byRow[1]!.y).toBe(byRow[0]!.y);
    expect(byColumn[1]!.x).toBe(byColumn[0]!.x);
    expect(byColumn[1]!.y).toBeLessThan(byColumn[0]!.y);
    // 마지막 칸은 오른쪽 아래, 여백에 붙는다.
    expect(byRow[5]!.y).toBeCloseTo(10);
    expect(byRow[5]!.x + byRow[5]!.width).toBeCloseTo(190);
  });

  it('비율을 지켜 칸 가운데에 앉힌다', () => {
    const fitted = fitInCell({ width: 100, height: 200 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(fitted).toEqual({ x: 25, y: 0, width: 50, height: 100, scale: 0.5 });
  });

  it.each([0, 90, 180, 270] as Quarter[])('%i 도 쪽을 바로 세워 칸에 넣는다', rotation => {
    const size = { width: 100, height: 200 };
    const scale = 0.5;
    const target = { x: 30, y: 40 };
    const at = placeRotated(size, rotation, scale, target);
    // 네 모서리를 돌려 본 테두리 상자가 목표 네모와 같아야 한다.
    const corners = [[0, 0], [size.width, 0], [0, size.height], [size.width, size.height]]
      .map(([x, y]) => rotate({ x: x! * scale, y: y! * scale }, at.rotate))
      .map(point => ({ x: point.x + at.x, y: point.y + at.y }));
    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);
    const swapped = rotation % 180 !== 0;
    expect(Math.min(...xs)).toBeCloseTo(target.x);
    expect(Math.min(...ys)).toBeCloseTo(target.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo((swapped ? size.height : size.width) * scale);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo((swapped ? size.width : size.height) * scale);
  });
});

describe('inkRatio', () => {
  it('흰 쪽은 0, 검은 점만큼 올라간다', () => {
    const white = new Uint8ClampedArray(4 * 100).fill(255);
    expect(inkRatio(white)).toBe(0);
    white.set([0, 0, 0, 255], 0);
    white.set([240, 240, 240, 255], 4); // 옅은 얼룩은 잉크가 아니다
    expect(inkRatio(white)).toBeCloseTo(0.01);
    // 투명한 검정은 흰 종이 위에서 보이지 않는다.
    expect(inkRatio(new Uint8ClampedArray([0, 0, 0, 0]))).toBe(0);
    expect(inkRatio(new Uint8ClampedArray(0))).toBe(0);
  });

  it('글자가 있으면 빈 쪽이 아니다', () => {
    expect(isBlank(0, false, 0.002)).toBe(true);
    expect(isBlank(0, true, 0.002)).toBe(false);
    expect(isBlank(0.01, false, 0.002)).toBe(false);
  });
});

async function sample(count: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let n = 0; n < count; n++) {
    const page = document.addPage([595, 842]);
    page.drawRectangle({ x: 100, y: 100, width: 200, height: 300, color: rgb(0, 0, 0) });
    if (n === 1) page.setRotation(degrees(90));
  }
  return document.save();
}

describe('nupPdf', () => {
  it('쪽 수를 한 장 칸 수로 나눠 올림한 만큼 A4 를 만든다', async () => {
    for (const [perSheet, sheets] of [[2, 4], [4, 2], [6, 2], [9, 1]] as const) {
      const result = await nupPdf(await sample(7), { perSheet, order: 'row', margin: 20, gap: 10, border: true });
      expect(result.sheets).toBe(sheets);
      const reloaded = await PDFDocument.load(result.bytes);
      expect(reloaded.getPageCount()).toBe(sheets);
      const { width, height } = reloaded.getPage(0).getSize();
      expect([width, height].sort()).toEqual([A4.width, A4.height].sort());
    }
  });

  it('내용이 없는 쪽은 칸만 비우고 건너뛴다', async () => {
    const document = await PDFDocument.load(await sample(2));
    document.addPage([595, 842]);
    const result = await nupPdf(await document.save(), { perSheet: 4, order: 'column', margin: 0, gap: 0, border: false });
    expect(result.skipped).toEqual([2]);
    expect(result.sheets).toBe(1);
  });
});

describe('removePages', () => {
  it('고른 쪽만 빼고, 전부는 못 뺀다', async () => {
    const result = await removePages(await sample(5), [1, 3]);
    expect(result.pages).toBe(3);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(3);
    await expect(removePages(await sample(2), [0, 1])).rejects.toThrow(/모든 쪽/);
  });
});
