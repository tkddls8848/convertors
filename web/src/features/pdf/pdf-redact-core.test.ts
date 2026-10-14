import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fontkit from '@pdf-lib/fontkit';
import { decodePDFRawStream, degrees, PDFDocument, PDFRawStream, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { pageText, redactWith, type RedactArea } from './pdf-redact-core';
import { nodeEngine } from './pdf-redact-node';
import { stripLayoutTables } from './sfnt';

import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

const NANUM = fileURLToPath(new URL('../../../public/fonts/nanum-gothic.ttf', import.meta.url));

let engine: WrappedPdfiumModule;
beforeAll(async () => { engine = await nodeEngine(); });

interface Line { text: string; x: number; y: number; size?: number }

/** 줄마다 따로 그린 PDF. 줄 하나가 PDF.js 의 글자 조각 하나가 된다. */
async function linesPdf(lines: Line[], setup?: (doc: PDFDocument) => Promise<void> | void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  for (const line of lines) page.drawText(line.text, { x: line.x, y: line.y, size: line.size ?? 18, font });
  await setup?.(doc);
  return doc.save();
}

/** Helvetica 로 그린 글자의 폭. 조각 상자를 PDF.js 처럼 잡는 데 쓴다. */
async function area(line: Line, over: Partial<RedactArea> = {}): Promise<RedactArea> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = line.size ?? 18;
  return { page: 1, x: line.x, y: line.y, width: font.widthOfTextAtSize(line.text, size), size, label: `‘${line.text}’`, ...over };
}

/** 파일 안 모든 스트림을 풀어 이은 것. 지운 글자가 어디에라도 남았는지 본다. */
async function everyStream(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      try { parts.push(new TextDecoder('latin1').decode(decodePDFRawStream(object).decode())); } catch { /* 그림 등 */ }
    }
  }
  return parts.join('\n');
}

const hex = (text: string): string => [...text].map(letter => letter.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

describe('PDF 글자 진짜로 지우기', () => {
  const hello: Line = { text: 'HELLO', x: 40, y: 200 };
  const world: Line = { text: 'WORLD', x: 140, y: 200 };
  const keep: Line = { text: 'KEEP THIS', x: 40, y: 150 };

  it('고른 조각만 지우고 나머지는 제자리에 둔다', async () => {
    const out = redactWith(engine, await linesPdf([hello, world, keep]), [await area(world)]);
    const text = pageText(engine, out, 1);
    expect(text).not.toContain('WORLD');
    expect(text).toContain('HELLO');
    expect(text).toContain('KEEPTHIS');
  });

  it('지운 글자는 파일 어디에도 남지 않는다', async () => {
    const source = await linesPdf([hello, world]);
    expect(await everyStream(source)).toContain(hex('WORLD'));
    const out = redactWith(engine, source, [await area(world)]);
    expect(await everyStream(out)).not.toContain(hex('WORLD'));
    // 증분 저장이면 옛 내용이 파일 앞쪽에 그대로 남는다.
    expect(new TextDecoder('latin1').decode(out).match(/%%EOF/g)).toHaveLength(1);
  });

  it('기준선에 붙은 쉼표·마침표도 지운다', async () => {
    const money: Line = { text: '1,000,000.', x: 40, y: 200 };
    const out = redactWith(engine, await linesPdf([money, keep]), [await area(money)]);
    expect(pageText(engine, out, 1)).toBe('KEEPTHIS');
  });

  it('줄 간격이 좁아도 윗줄·아랫줄은 건드리지 않는다', async () => {
    // 글자 크기와 줄 간격이 같은 빽빽한 문서. 윗줄 꼬리와 아랫줄 머리가 거의 닿는다.
    const lines: Line[] = [
      { text: 'gyp above', x: 40, y: 212, size: 12 },
      { text: 'Mid line', x: 40, y: 200, size: 12 },
      { text: 'Tall below', x: 40, y: 188, size: 12 },
    ];
    const out = redactWith(engine, await linesPdf(lines), [await area(lines[1]!)]);
    expect(pageText(engine, out, 1)).toBe('gypaboveTallbelow');
  });

  it('같은 자리를 두 번 넘겨도 한 번만 지운다', async () => {
    const twice = [await area(world), await area(world, { label: '다시' })];
    const out = redactWith(engine, await linesPdf([hello, world]), twice);
    expect(pageText(engine, out, 1)).toBe('HELLO');
  });

  it('지울 글자가 없는 자리는 이름을 대고 멈춘다', async () => {
    const empty = await area({ text: 'NOTHING', x: 40, y: 50 }, { label: '1번째(1쪽)' });
    expect(() => redactWith(engine, linesPdfSync, [empty])).toThrow(/1번째\(1쪽\).*찾지 못했습니다/);
  });

  it('돌린 쪽과 원점이 0이 아닌 쪽에서도 맞는 자리를 지운다', async () => {
    // 좌표는 회전을 적용하지 않은 PDF 사용자 공간이다. PDF.js 가 주는 것도 같다.
    const out = redactWith(engine, await linesPdf([hello, world], doc => {
      const page = doc.getPage(0);
      page.setRotation(degrees(90));
      page.setMediaBox(20, 20, 380, 280);
    }), [await area(world)]);
    expect(pageText(engine, out, 1)).toBe('HELLO');
  });

  it('여러 쪽을 한 번에 지운다', async () => {
    const doc = await PDFDocument.load(await linesPdf([hello, world]));
    const [copy] = await doc.copyPages(doc, [0]);
    doc.addPage(copy);
    const two = await doc.save();
    const out = redactWith(engine, two, [await area(world), await area(hello, { page: 2 })]);
    expect(pageText(engine, out, 1)).toBe('HELLO');
    expect(pageText(engine, out, 2)).toBe('WORLD');
  });

  it('지울 자리가 없으면 원본을 그대로 돌려준다', async () => {
    const source = await linesPdf([hello]);
    expect(redactWith(engine, source, [])).toBe(source);
  });

  it('PDF 가 아니면 멈춘다', () => {
    expect(() => redactWith(engine, new TextEncoder().encode('not a pdf'), [{ page: 1, x: 0, y: 0, width: 10, size: 10, label: 'x' }]))
      .toThrow(/열지 못했습니다/);
  });

  it.skipIf(!existsSync(NANUM))('한글 서브셋 글꼴에서도 한 구절만 지운다', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(stripLayoutTables(new Uint8Array(readFileSync(NANUM))), { subset: true });
    const page = doc.addPage([400, 300]);
    page.drawText('가나다', { x: 40, y: 200, size: 18, font });
    page.drawText('라마바', { x: 120, y: 200, size: 18, font });
    page.drawText('사아', { x: 200, y: 200, size: 18, font });
    const target = { page: 1, x: 120, y: 200, width: font.widthOfTextAtSize('라마바', 18), size: 18, label: '라마바' };
    const out = redactWith(engine, await doc.save(), [target]);
    expect(pageText(engine, out, 1)).toBe('가나다사아');
  });
});

let linesPdfSync: Uint8Array;
beforeAll(async () => { linesPdfSync = await linesPdf([{ text: 'HELLO', x: 40, y: 200 }]); });
