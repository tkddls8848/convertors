import { decodePDFRawStream, degrees, PDFArray, PDFDocument, PDFRawStream, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  centered, formatPageNumber, isWinAnsi, MAX_TILES, needsFont, numberPlacement, parsePageRange, placeOnPage,
  quarter, rotate, stampPdf, toUser, toVisual, visualSize, watermarkPlacements, type Quarter, type StampOptions,
} from './pdf-stamp';

const BOX = { x: 10, y: 20, width: 600, height: 800 };
const ROTATIONS: Quarter[] = [0, 90, 180, 270];

describe('보이는 틀', () => {
  it('/Rotate 를 90 단위로 바로잡는다', () => {
    expect(quarter(-90)).toBe(270);
    expect(quarter(450)).toBe(90);
    expect(quarter(360)).toBe(0);
  });

  it.each(ROTATIONS)('%i 도: 사용자 공간과 보이는 틀을 오간다', rotation => {
    for (const point of [{ x: 0, y: 0 }, { x: 123, y: 45 }, { x: 599, y: 799 }]) {
      const back = toVisual(toUser(point, BOX, rotation), BOX, rotation);
      expect(back.x).toBeCloseTo(point.x);
      expect(back.y).toBeCloseTo(point.y);
    }
  });

  it('시계방향으로 돈 쪽의 모서리가 제자리에 간다', () => {
    // 90도: 원래 왼쪽 아래가 보이는 왼쪽 위로 간다.
    expect(toVisual({ x: 10, y: 20 }, BOX, 90)).toEqual({ x: 0, y: 600 });
    // 270도: 원래 왼쪽 아래가 보이는 오른쪽 아래로 간다.
    expect(toVisual({ x: 10, y: 20 }, BOX, 270)).toEqual({ x: 800, y: 0 });
    expect(toVisual({ x: 10, y: 20 }, BOX, 180)).toEqual({ x: 600, y: 800 });
    expect(visualSize(BOX, 90)).toEqual({ width: 800, height: 600 });
  });

  it('보이는 아래 가운데 쪽번호가 돌린 쪽의 아래 가장자리에 붙는다', () => {
    const frame = visualSize(BOX, 90);
    const at = placeOnPage(numberPlacement(frame, 20, 10, 'bottom-center', 30), BOX, 90);
    // 90도 쪽의 "보이는 아래" 는 원래 오른쪽 가장자리다. 글자는 위로(+y) 읽힌다.
    expect(at.x).toBeCloseTo(BOX.x + BOX.width - 30);
    expect(at.y).toBeCloseTo(BOX.y + 390);
    expect(at.angle).toBe(90);
  });

  it('가운데 워터마크는 돌려도 글자 가운데가 쪽 가운데다', () => {
    const [placed] = watermarkPlacements({ width: 600, height: 800 }, 300, 40, 45, 'center');
    const middle = rotate({ x: 150, y: 40 * 0.72 / 2 }, 45);
    expect(placed!.x + middle.x).toBeCloseTo(300);
    expect(placed!.y + middle.y).toBeCloseTo(400);
    const plain = centered({ x: 0, y: 0 }, 100, 10, 0);
    expect(plain.x).toBeCloseTo(-50);
    expect(plain.y).toBeCloseTo(-3.6);
  });

  it('바둑판은 쪽을 덮되 한도를 넘지 않는다', () => {
    const tiles = watermarkPlacements({ width: 600, height: 800 }, 120, 24, 45, 'tile');
    expect(tiles.length).toBeGreaterThan(4);
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES);
    // 아주 작은 글자도 한도 안이다.
    expect(watermarkPlacements({ width: 3000, height: 3000 }, 10, 4, 0, 'tile').length).toBeLessThanOrEqual(MAX_TILES);
  });
});

describe('입력', () => {
  it('쪽 범위를 읽는다', () => {
    expect(parsePageRange('', 3)).toEqual([0, 1, 2]);
    expect(parsePageRange('1-3,5', 6)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange(' 5 , 2-3 ,2', 6)).toEqual([1, 2, 4]);
    expect(parsePageRange('4-', 6)).toEqual([3, 4, 5]);
    expect(() => parsePageRange('0-2', 6)).toThrow(/1~6/);
    expect(() => parsePageRange('3-1', 6)).toThrow(/오름차순/);
    expect(() => parsePageRange('7', 6)).toThrow();
    expect(() => parsePageRange('a', 6)).toThrow(/읽지 못했습니다/);
  });

  it('쪽번호 모양을 채운다', () => {
    expect(formatPageNumber('{n}', 3, 9)).toBe('3');
    expect(formatPageNumber('{n} / {total}', 3, 9)).toBe('3 / 9');
    expect(formatPageNumber('- {n} -', 12, 20)).toBe('- 12 -');
    expect(formatPageNumber('{n}쪽', 1, 1)).toBe('1쪽');
    expect(() => formatPageNumber('쪽', 1, 1)).toThrow(/\{n\}/);
  });

  it('기본 글꼴로 적을 수 있는 글자를 가린다', () => {
    expect(isWinAnsi('CONFIDENTIAL © 2026 – “draft”')).toBe(true);
    expect(isWinAnsi('대외비')).toBe(false);
    expect(isWinAnsi('{n}쪽')).toBe(false);
    const options: StampOptions = { range: '', numbers: numbers('{n}쪽') };
    expect(needsFont(options, 3)).toBe(true);
    expect(needsFont({ range: '', numbers: numbers('{n} / {total}') }, 3)).toBe(false);
  });
});

function numbers(template: string): NonNullable<StampOptions['numbers']> {
  return { template, position: 'bottom-center', margin: 30, size: 10, start: 1, skipFirst: false, color: { r: 0, g: 0, b: 0 } };
}

async function sample(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const rotation of ROTATIONS) {
    const page = document.addPage([600, 800]);
    page.drawRectangle({ x: 50, y: 50, width: 100, height: 100, color: rgb(0.5, 0.5, 0.5) });
    page.setRotation(degrees(rotation));
  }
  // 잘라 보이는 쪽. 원점이 0 이 아니다.
  const cropped = document.addPage([600, 800]);
  cropped.drawRectangle({ x: 50, y: 50, width: 10, height: 10 });
  cropped.setCropBox(100, 200, 300, 400);
  return document.save();
}

async function contents(bytes: Uint8Array, index: number): Promise<string> {
  const document = await PDFDocument.load(bytes);
  const array = document.getPage(index).node.Contents();
  const streams = array instanceof PDFArray ? array.asArray().map(ref => document.context.lookup(ref)) : [array];
  return streams.map(stream => stream instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()) : '').join('\n');
}

const hex = (text: string): string => [...text].map(c => c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()).join('');

/** 찍힌 글자가 **보이는** 쪽에서 어디에 오는지 PDF.js 로 되읽는다. */
async function visualPositions(bytes: Uint8Array, text: string): Promise<{ x: number; y: number; width: number; height: number }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  try {
    const document = await task.promise;
    const found = [];
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const item = content.items.find(entry => 'str' in entry && entry.str === text);
      if (!item || !('str' in item)) throw new Error(`${n}쪽에서 ${text} 를 찾지 못했습니다`);
      const [x, y] = viewport.convertToViewportPoint(item.transform[4] as number, item.transform[5] as number);
      found.push({ x: x!, y: y!, width: viewport.width, height: viewport.height });
    }
    return found;
  } finally { await task.destroy(); }
}

describe('stampPdf', () => {
  it('쪽 수를 지키고 글자를 글자로 찍는다', async () => {
    const source = await sample();
    const result = await stampPdf(source, {
      range: '',
      watermark: { text: 'CONFIDENTIAL', size: 40, opacity: 0.2, angle: 45, color: { r: 1, g: 0, b: 0 }, layout: 'center' },
      numbers: numbers('{n} / {total}'),
    });
    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getPageCount()).toBe(5);
    expect(result.numbered).toBe(5);
    const first = await contents(result.bytes, 0);
    expect(first).toContain(`<${hex('CONFIDENTIAL')}> Tj`);
    expect(first).toContain(`<${hex('1 / 5')}> Tj`);
    expect(await contents(result.bytes, 4)).toContain(`<${hex('5 / 5')}> Tj`);
  });

  it('돌린 쪽·잘린 쪽에서도 쪽번호가 보이는 아래 가운데에 온다', async () => {
    const result = await stampPdf(await sample(), { range: '', numbers: { ...numbers('- {n} -'), margin: 20, size: 10 } });
    // 번호가 쪽마다 다르니 한 쪽씩 떼어 되읽는다.
    for (let n = 1; n <= 5; n++) {
      const [at] = await visualPositions(await firstPageOnly(result.bytes, n - 1), `- ${n} -`);
      // 화면 좌표(왼쪽 위 원점)에서 기준선이 아래 가장자리에서 20pt 위, 가운데 근처다.
      expect(at!.y).toBeCloseTo(at!.height - 20, 0);
      expect(Math.abs(at!.x - at!.width / 2)).toBeLessThan(20);
    }
  });

  it('범위와 첫 쪽 건너뛰기를 지킨다', async () => {
    const result = await stampPdf(await sample(), { range: '2-4', numbers: { ...numbers('{n}/{total}'), skipFirst: true, start: 1 } });
    expect(result.pages).toBe(3);
    expect(result.numbered).toBe(2);
    expect(await contents(result.bytes, 0)).not.toContain(' Tj');
    expect(await contents(result.bytes, 1)).not.toContain(' Tj');
    expect(await contents(result.bytes, 2)).toContain(`<${hex('1/2')}> Tj`);
    expect(await contents(result.bytes, 3)).toContain(`<${hex('2/2')}> Tj`);
  });

  it('한글인데 글꼴이 없으면 물음표를 찍지 않고 멈춘다', async () => {
    await expect(stampPdf(await sample(), {
      range: '',
      watermark: { text: '대외비', size: 40, opacity: 0.3, angle: 0, color: { r: 0, g: 0, b: 0 }, layout: 'tile' },
    })).rejects.toThrow(/글꼴/);
  });

  it('아무것도 켜지 않으면 거절한다', async () => {
    await expect(stampPdf(await sample(), { range: '' })).rejects.toThrow(/하나는/);
  });
});

/** 한 쪽만 남긴 사본. PDF.js 로 쪽마다 따로 되읽는 데 쓴다. */
async function firstPageOnly(bytes: Uint8Array, index: number): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  const output = await PDFDocument.create();
  const [page] = await output.copyPages(source, [index]);
  output.addPage(page!);
  return output.save();
}
