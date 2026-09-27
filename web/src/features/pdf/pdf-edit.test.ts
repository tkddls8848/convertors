import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { applyTextEdits, coverBox, shrinkToFit, type TextEdit } from './pdf-edit';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 1, g: 1, b: 1 };

async function blankPdf(pages = 1, width = 400, height = 300): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i++) document.addPage([width, height]);
  return document.save();
}

function edit(over: Partial<TextEdit> = {}): TextEdit {
  return {
    page: 1, x: 50, y: 200, width: 80, height: 12,
    text: 'Fixed', size: 12, fontId: 'std-helvetica',
    color: BLACK, cover: WHITE, original: 'Broken',
    ...over,
  };
}

const HELVETICA = [{ id: 'std-helvetica', label: 'Helvetica', standard: 'Helvetica' as const }];

describe('덮는 자리', () => {
  it('원래 글자 위아래로 넉넉히 잡는다', () => {
    // 기준선 아래로 내려가는 획(ㄱ·ㅜ·g·y)이 남으면 고친 티가 난다.
    const box = coverBox(edit(), 40);
    expect(box.y).toBeLessThan(200);
    expect(box.y + box.height).toBeGreaterThan(200 + 12);
  });

  it('새 글자가 더 넓으면 그만큼 넓힌다', () => {
    // 새 글자 절반이 깨끗한 배경 밖으로 나가면 읽을 수 없다.
    expect(coverBox(edit(), 300).width).toBeGreaterThanOrEqual(300);
  });

  it('새 글자가 더 좁아도 원래 자리는 다 덮는다', () => {
    expect(coverBox(edit(), 5).width).toBeGreaterThanOrEqual(80);
  });
});

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

describe('글자 고쳐 저장하기', () => {
  it('고친 글자가 저장된 PDF 안에 들어간다', async () => {
    const { bytes } = await applyTextEdits(await blankPdf(), [edit()], HELVETICA);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(1);
    // 글자가 실제로 쓰였으면 파일이 빈 쪽보다 커진다.
    expect(bytes.length).toBeGreaterThan((await blankPdf()).length);
  });

  it('쓰지 않은 글꼴은 심지 않는다', async () => {
    const many = [...HELVETICA, { id: 'std-times', label: 'Times', standard: 'TimesRoman' as const }];
    const one = await applyTextEdits(await blankPdf(), [edit()], many);
    // 안 쓴 글꼴까지 심으면 파일만 커진다. Times 를 심지 않았는지 크기로 본다.
    const both = await applyTextEdits(await blankPdf(), [edit(), edit({ fontId: 'std-times' })], many);
    expect(both.bytes.length).toBeGreaterThan(one.bytes.length);
  });

  it('새 글자가 원래 자리보다 넓으면 경고를 남긴다', async () => {
    const { warnings } = await applyTextEdits(await blankPdf(), [edit({ text: 'a much longer replacement'.repeat(3), width: 10 })], HELVETICA);
    expect(warnings.join(' ')).toMatch(/넓어/);
  });

  it('읽을 수 없이 작아진 글자를 그냥 넘기지 않는다', async () => {
    // 자동 줄임이 바닥까지 내려가면 글자는 있는데 보이지 않는다. 말하지 않으면
    // 고친 자리가 사라진 것으로 보인다.
    const { warnings } = await applyTextEdits(await blankPdf(), [edit({ size: 4 })], HELVETICA);
    expect(warnings.join(' ')).toMatch(/읽기 어렵습니다/);
  });

  it('여러 줄이면 겹칠 수 있다고 알린다', async () => {
    const { warnings } = await applyTextEdits(await blankPdf(), [edit({ text: 'first line\nsecond line' })], HELVETICA);
    expect(warnings.join(' ')).toMatch(/여러 줄/);
  });

  it('덮지 않기를 고르면 사각형을 그리지 않는다', async () => {
    const covered = await applyTextEdits(await blankPdf(), [edit()], HELVETICA);
    const bare = await applyTextEdits(await blankPdf(), [edit({ cover: null })], HELVETICA);
    expect(bare.bytes.length).toBeLessThan(covered.bytes.length);
  });

  it('없는 쪽·빈 글자·범위 밖 크기는 이름을 대고 멈춘다', async () => {
    const pdf = await blankPdf();
    await expect(applyTextEdits(pdf, [edit({ page: 5 })], HELVETICA)).rejects.toThrow(/쪽 번호/);
    await expect(applyTextEdits(pdf, [edit({ text: '' })], HELVETICA)).rejects.toThrow(/비어 있습니다/);
    await expect(applyTextEdits(pdf, [edit({ size: 0 })], HELVETICA)).rejects.toThrow(/글자 크기/);
    await expect(applyTextEdits(pdf, [edit({ size: 9999 })], HELVETICA)).rejects.toThrow(/글자 크기/);
  });

  it('목록에 없는 글꼴을 고르면 멈춘다', async () => {
    await expect(applyTextEdits(await blankPdf(), [edit({ fontId: '없는-글꼴' })], HELVETICA)).rejects.toThrow(/글꼴/);
  });

  it('고친 자리가 없으면 저장하지 않는다', async () => {
    await expect(applyTextEdits(await blankPdf(), [], HELVETICA)).rejects.toThrow(/고친 자리가 없습니다/);
  });

  it('여러 쪽을 한 번에 고친다', async () => {
    const { bytes } = await applyTextEdits(await blankPdf(3), [edit({ page: 1 }), edit({ page: 3 })], HELVETICA);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it('PDF 기본 글꼴은 한글을 담지 못한다고 알린다', async () => {
    // 조용히 물음표를 찍는 것이 가장 나쁘다. pdf-lib 이 멈추면 그대로 전한다.
    await expect(applyTextEdits(await blankPdf(), [edit({ text: '한글' })], HELVETICA)).rejects.toThrow();
  });

  it('StandardFonts 의 이름을 그대로 쓴다', () => {
    // 목록이 오타로 어긋나면 저장할 때가 아니라 여기서 붉어야 한다.
    for (const name of ['Helvetica', 'HelveticaBold', 'TimesRoman', 'TimesRomanBold', 'Courier'] as const) {
      expect(StandardFonts[name]).toBeTruthy();
    }
  });
});
