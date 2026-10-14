import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, rgb } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { applyTextEdits, shrinkToFit, sourceFontId, type Redactor, type TextEdit } from './pdf-edit';
import { pageText } from './pdf-redact-core';
import { nodeEngine, nodeRedact } from './pdf-redact-node';
import { readSourceFonts } from './pdf-source-font';
import { stripLayoutTables } from './sfnt';

import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

const BLACK = { r: 0, g: 0, b: 0 };
const NANUM = fileURLToPath(new URL('../../../public/fonts/nanum-gothic.ttf', import.meta.url));
const HELVETICA = [{ id: 'std-helvetica', label: 'Helvetica', standard: 'Helvetica' as const }];

let engine: WrappedPdfiumModule;
let broken: { pdf: Uint8Array; span: { x: number; y: number; width: number; size: number } };

beforeAll(async () => {
  engine = await nodeEngine();
  // 노란 띠 위의 ‘Broken’ 과 그 아래 ‘Keep’. 띠는 지운 자리에 자국이 남는지 보려고 깐다.
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([400, 300]);
  page.drawRectangle({ x: 20, y: 185, width: 360, height: 40, color: rgb(1, 0.9, 0.6) });
  page.drawText('Broken', { x: 50, y: 200, size: 12, font });
  page.drawText('Keep', { x: 50, y: 150, size: 12, font });
  broken = { pdf: await document.save(), span: { x: 50, y: 200, width: font.widthOfTextAtSize('Broken', 12), size: 12 } };
});

async function blankPdf(pages = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i++) document.addPage([400, 300]);
  return document.save();
}

function replace(over: Partial<TextEdit> = {}): TextEdit {
  return {
    kind: 'replace', page: 1, span: broken.span, x: 50, y: 200,
    text: 'Fixed', size: 12, fontId: 'std-helvetica', color: BLACK, original: 'Broken',
    ...over,
  };
}

function add(over: Partial<TextEdit> = {}): TextEdit {
  return { kind: 'add', page: 1, x: 50, y: 100, text: 'Added', size: 12, fontId: 'std-helvetica', color: BLACK, original: '', ...over };
}

/** 넣기만 하는 경우에 쓰는 지우개. 불리면 그것이 잘못이다. */
const never: Redactor = () => Promise.reject(new Error('지울 자리가 없어야 합니다.'));

/** 파일 안 모든 내용 스트림. 무엇을 그렸는지는 크기가 아니라 명령으로 본다. */
async function streams(bytes: Uint8Array): Promise<string> {
  const document = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      try { parts.push(new TextDecoder('latin1').decode(decodePDFRawStream(object).decode())); } catch { /* 글꼴 등 */ }
    }
  }
  return parts.join('\n');
}

/** 칠하기(`f`) 명령의 수. 원본의 노란 띠 하나뿐이어야 한다 — 덮는 사각형이 없다. */
const fills = (content: string): number => content.match(/(^|\s)f(?=\s|$)/g)?.length ?? 0;

async function fontsNamed(bytes: Uint8Array, base: string): Promise<number> {
  const document = await PDFDocument.load(bytes);
  let count = 0;
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.get(PDFName.of('BaseFont'))?.toString().includes(base)) count++;
  }
  return count;
}

describe('자리에 맞게 줄이기', () => {
  const measure = (size: number): number => size * 10;

  it('이미 들어가면 크기를 건드리지 않는다', () => {
    expect(shrinkToFit(measure, 200, 12)).toBe(12);
  });

  it('넘치면 들어가는 첫 크기를 찾는다', () => {
    expect(shrinkToFit(measure, 100, 12)).toBe(10);
  });

  it('아무리 줄여도 안 들어가면 바닥에서 멈춘다', () => {
    expect(shrinkToFit(measure, 1, 12, 4)).toBe(4);
  });
});

describe('바꾸기 — 지우고 다시 쓴다', () => {
  it('원래 글자는 사라지고 새 글자가 들어간다', async () => {
    const { bytes } = await applyTextEdits(broken.pdf, [replace()], HELVETICA, nodeRedact);
    expect(pageText(engine, bytes, 1)).toBe('KeepFixed');
  });

  it('덮는 사각형을 그리지 않는다', async () => {
    const { bytes } = await applyTextEdits(broken.pdf, [replace()], HELVETICA, nodeRedact);
    expect(fills(await streams(bytes))).toBe(1);
  });

  it('옮긴 자리에 쓴다', async () => {
    const { bytes } = await applyTextEdits(broken.pdf, [replace({ x: 200, y: 250 })], HELVETICA, nodeRedact);
    expect(await streams(bytes)).toMatch(/1 0 0 1 200 250 Tm/);
  });

  it('새 글자가 원래 자리보다 넓으면 경고를 남긴다', async () => {
    const { warnings } = await applyTextEdits(broken.pdf, [replace({ text: 'a much longer replacement' })], HELVETICA, nodeRedact);
    expect(warnings.join(' ')).toMatch(/넓어/);
  });

  it('지우지 못하면 그리지도 저장하지도 않는다', async () => {
    const failing: Redactor = () => Promise.reject(new Error('1번째(1쪽): 원래 글자 일부를 지우지 못했습니다'));
    await expect(applyTextEdits(broken.pdf, [replace()], HELVETICA, failing)).rejects.toThrow(/지우지 못했습니다/);
  });

  it('지울 글자가 없는 자리면 이름을 대고 멈춘다', async () => {
    const nowhere = replace({ span: { x: 300, y: 50, width: 40, size: 12 } });
    await expect(applyTextEdits(broken.pdf, [nowhere], HELVETICA, nodeRedact)).rejects.toThrow(/1번째\(1쪽\).*찾지 못했습니다/);
  });

  it('지울 조각이 없는 바꾸기는 받지 않는다', async () => {
    const bare = replace();
    delete bare.span;
    await expect(applyTextEdits(broken.pdf, [bare], HELVETICA, nodeRedact)).rejects.toThrow(/지울 원래 글자가 없습니다/);
  });

  it.skipIf(!existsSync(NANUM))('지운 뒤에도 원본 글꼴로 다시 쓴다', async () => {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    const nanum = await document.embedFont(stripLayoutTables(new Uint8Array(readFileSync(NANUM))), { subset: true });
    const page = document.addPage([400, 300]);
    page.drawText('가나다', { x: 40, y: 200, size: 18, font: nanum });
    page.drawText('라마바', { x: 40, y: 150, size: 18, font: nanum });
    const source = await document.save();
    const [font] = readSourceFonts((await PDFDocument.load(source)).getPage(0));

    const span = { x: 40, y: 150, width: nanum.widthOfTextAtSize('라마바', 18), size: 18 };
    const { bytes } = await applyTextEdits(source, [replace({ span, x: 40, y: 150, text: '다나가', size: 18, fontId: sourceFontId(font!.resource) })], [], nodeRedact);
    expect(pageText(engine, bytes, 1)).toBe('가나다다나가');
    // 가리켰을 뿐 복사하지 않았다. 글꼴이 두 벌이면 파일이 글꼴 크기만큼 불어난다.
    expect(await fontsNamed(bytes, 'NanumGothic')).toBe(await fontsNamed(source, 'NanumGothic'));
  });
});

describe('지우기', () => {
  const erase = (over: Partial<TextEdit> = {}): TextEdit => replace({ kind: 'erase', text: '', ...over });

  it('원래 글자만 사라지고 아무것도 그리지 않는다', async () => {
    const { bytes } = await applyTextEdits(broken.pdf, [erase()], HELVETICA, nodeRedact);
    expect(pageText(engine, bytes, 1)).toBe('Keep');
    expect(fills(await streams(bytes))).toBe(1);
  });

  it('글자 칸에 무엇이 남아 있어도 쓰지 않는다', async () => {
    const { bytes } = await applyTextEdits(broken.pdf, [erase({ text: 'leftover' })], HELVETICA, nodeRedact);
    expect(pageText(engine, bytes, 1)).toBe('Keep');
  });

  it('글꼴을 심지 않는다', async () => {
    // 쓰지 않을 글자를 위해 글꼴을 심으면 파일만 커진다. 원본의 Helvetica 하나뿐이어야 한다.
    const { bytes } = await applyTextEdits(broken.pdf, [erase({ fontId: '없는-글꼴' })], HELVETICA, nodeRedact);
    expect(await fontsNamed(bytes, 'Helvetica')).toBe(await fontsNamed(broken.pdf, 'Helvetica'));
  });
});

describe('빈 곳에 넣기', () => {
  it('지우지 않고 글자만 그린다', async () => {
    const redact = vi.fn(never);
    const { bytes } = await applyTextEdits(broken.pdf, [add()], HELVETICA, redact);
    expect(redact).not.toHaveBeenCalled();
    expect(pageText(engine, bytes, 1)).toBe('BrokenKeepAdded');
  });

  it('원래 자리가 없으니 넓다는 경고를 내지 않는다', async () => {
    const { warnings } = await applyTextEdits(await blankPdf(), [add()], HELVETICA, never);
    expect(warnings.join(' ')).not.toMatch(/넓어/);
  });

  it('읽을 수 없이 작은 글자를 그냥 넘기지 않는다', async () => {
    const { warnings } = await applyTextEdits(await blankPdf(), [add({ size: 4 })], HELVETICA, never);
    expect(warnings.join(' ')).toMatch(/읽기 어렵습니다/);
  });

  it('여러 줄이면 겹칠 수 있다고 알린다', async () => {
    const { warnings } = await applyTextEdits(await blankPdf(), [add({ text: 'first line\nsecond line' })], HELVETICA, never);
    expect(warnings.join(' ')).toMatch(/여러 줄/);
  });

  it('쓰지 않은 글꼴은 심지 않는다', async () => {
    const many = [...HELVETICA, { id: 'std-times', label: 'Times', standard: 'TimesRoman' as const }];
    const one = await applyTextEdits(await blankPdf(), [add()], many, never);
    const both = await applyTextEdits(await blankPdf(), [add(), add({ fontId: 'std-times' })], many, never);
    expect(both.bytes.length).toBeGreaterThan(one.bytes.length);
  });
});

describe('받지 않는 것', () => {
  it('없는 쪽·빈 글자·범위 밖 크기는 이름을 대고 멈춘다', async () => {
    const pdf = await blankPdf();
    await expect(applyTextEdits(pdf, [add({ page: 5 })], HELVETICA, never)).rejects.toThrow(/쪽 번호/);
    await expect(applyTextEdits(pdf, [add({ text: '' })], HELVETICA, never)).rejects.toThrow(/비어 있습니다/);
    await expect(applyTextEdits(pdf, [add({ size: 0 })], HELVETICA, never)).rejects.toThrow(/글자 크기/);
    await expect(applyTextEdits(pdf, [add({ size: 9999 })], HELVETICA, never)).rejects.toThrow(/글자 크기/);
  });

  it('지우기 전에 따져 본다 — 틀린 자리가 있으면 지우개를 부르지 않는다', async () => {
    const redact = vi.fn(nodeRedact);
    await expect(applyTextEdits(broken.pdf, [replace(), add({ text: '' })], HELVETICA, redact)).rejects.toThrow(/비어 있습니다/);
    expect(redact).not.toHaveBeenCalled();
  });

  it('목록에 없는 글꼴을 고르면 멈춘다', async () => {
    await expect(applyTextEdits(await blankPdf(), [add({ fontId: '없는-글꼴' })], HELVETICA, never)).rejects.toThrow(/글꼴/);
  });

  it('고친 자리가 없으면 저장하지 않는다', async () => {
    await expect(applyTextEdits(await blankPdf(), [], HELVETICA, never)).rejects.toThrow(/고친 자리가 없습니다/);
  });

  it('여러 쪽을 한 번에 고친다', async () => {
    const { bytes } = await applyTextEdits(await blankPdf(3), [add({ page: 1 }), add({ page: 3 })], HELVETICA, never);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it('PDF 기본 글꼴은 한글을 담지 못한다고 알린다', async () => {
    // 조용히 물음표를 찍는 것이 가장 나쁘다. pdf-lib 이 멈추면 그대로 전한다.
    await expect(applyTextEdits(await blankPdf(), [add({ text: '한글' })], HELVETICA, never)).rejects.toThrow();
  });

  it('StandardFonts 의 이름을 그대로 쓴다', () => {
    // 목록이 오타로 어긋나면 저장할 때가 아니라 여기서 붉어야 한다.
    for (const name of ['Helvetica', 'HelveticaBold', 'TimesRoman', 'TimesRomanBold', 'Courier'] as const) {
      expect(StandardFonts[name]).toBeTruthy();
    }
  });
});
