/**
 * 원본 글꼴 다시 쓰기.
 *
 * 글꼴 사전은 여기서 손으로 짓는다. 실제 PDF 에서 겪은 모양(/W 의 두 가지 꼴,
 * Type3 의 사전형 /Encoding, bfrange)을 그대로 담아 두기 위해서다 — 그 가운데
 * 하나만 어긋나도 화면은 아무 말 없이 "원본 글꼴 없음" 으로 물러난다.
 */
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { applyTextEdits, sourceFontId, type TextEdit } from './pdf-edit';
import { carrySourceFont, closestFont, readSourceFonts, type SourceFont } from './pdf-source-font';

/** ToUnicode CMap 한 벌. 코드 → 글자를 적는다(우리는 그것을 뒤집어 쓴다). */
const cmap = (body: string): string =>
  '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CMapName /X def\n/CMapType 2 def\n'
  + `1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${body}\nendcmap\nend\nend`;

const hex = (value: number): string => value.toString(16).padStart(4, '0');

const bfchar = (pairs: [number, string][]): string =>
  `${pairs.length} beginbfchar\n${pairs.map(([code, letter]) => `<${hex(code)}> <${hex(letter.charCodeAt(0))}>`).join('\n')}\nendbfchar`;

/** 가·나·다와 빈칸. 코드는 1·2·3·4 다. */
const KOREAN = cmap(bfchar([[1, '가'], [2, '나'], [3, '다'], [4, ' ']]));

describe('원본 글꼴 읽기', () => {
  it('Type0·Identity-H 글꼴을 읽어 글자를 코드로 바꾼다', async () => {
    const document = await PDFDocument.load(await makeType0({}));
    const [font] = readSourceFonts(document.getPage(0));

    expect(font?.label).toBe('MalgunGothic');
    expect(font?.resource).toBe('F1');
    expect(font?.missing('가나다')).toEqual([]);
    // 너비는 1000 단위다. 1000 짜리 세 글자를 12pt 로 쓰면 36pt.
    expect(font?.widthOfTextAtSize('가나다', 12)).toBeCloseTo(36, 5);
  });

  it('/W 가 `첫코드 끝코드 너비` 꼴이어도 글꼴을 버리지 않는다', async () => {
    // 이 꼴에서 형을 잘못 다루면 글꼴 하나가 통째로 빠진다. 크로미움이 찍은
    // PDF 가 이 꼴이고, 화면에는 "원본 글꼴 없음" 으로만 보여서 알아채기 어렵다.
    const document = await PDFDocument.load(await makeType0({ w: '[1 3 800]' }));
    const [font] = readSourceFonts(document.getPage(0));

    expect(font).toBeDefined();
    expect(font?.widthOfTextAtSize('가나', 10)).toBeCloseTo(16, 5);
  });

  it('원본에 없는 글자를 미리 짚어 준다', async () => {
    const document = await PDFDocument.load(await makeType0({}));
    const [font] = readSourceFonts(document.getPage(0));

    // 서브셋에 없는 글자는 그려 봐야 빈칸이다. 저장하기 전에 알아야 한다.
    expect(font?.missing('가나라마')).toEqual(['라', '마']);
    expect(font?.missing('가나다')).toEqual([]);
  });

  it('bfrange 로 적은 표도 읽는다', async () => {
    const document = await PDFDocument.load(await makeType0({
      toUnicode: cmap(`1 beginbfrange\n<0010> <0012> <${hex('가'.charCodeAt(0))}>\nendbfrange`),
    }));
    const [font] = readSourceFonts(document.getPage(0));

    // 범위는 마지막 자리가 하나씩 올라간다 — 가·각·갂.
    expect(font?.missing('가각갂')).toEqual([]);
    expect(font?.missing('갃')).toEqual(['갃']);
  });

  it('ToUnicode 가 없으면 내놓지 않는다', async () => {
    // 글자와 코드를 이어 줄 표가 없으면 뒤집을 수 없다. 짐작해서 쓰지 않는다.
    const document = await PDFDocument.load(await makeType0({ toUnicode: null }));
    expect(readSourceFonts(document.getPage(0))).toEqual([]);
  });

  it('세로쓰기와 우리가 모르는 인코딩은 내놓지 않는다', async () => {
    const vertical = await PDFDocument.load(await makeType0({ encoding: 'Identity-V' }));
    expect(readSourceFonts(vertical.getPage(0))).toEqual([]);

    const other = await PDFDocument.load(await makeType0({ encoding: 'UniKS-UCS2-H' }));
    expect(readSourceFonts(other.getPage(0))).toEqual([]);
  });

  it('읽을 수 없는 글꼴이 섞여 있어도 나머지는 내놓는다', async () => {
    // Type3 는 /Encoding 이 이름이 아니라 사전이다. 거기서 멈추면 같은 쪽의
    // 멀쩡한 글꼴까지 함께 사라진다.
    const document = await PDFDocument.load(await makeType0({ withType3: true }));
    expect(readSourceFonts(document.getPage(0)).map(font => font.resource)).toEqual(['F1']);
  });
});

describe('닮은 글꼴 고르기', () => {
  const catalog = [
    { id: 'noto-sans-kr', label: '본고딕', group: '고딕' },
    { id: 'noto-sans-kr-bold', label: '본고딕 굵게', group: '고딕' },
    { id: 'noto-serif-kr', label: '본명조', group: '명조' },
  ];
  const like = (serif: boolean, bold: boolean): SourceFont => ({ serif, bold }) as SourceFont;

  it('세리프면 명조로, 아니면 고딕으로 간다', () => {
    expect(closestFont(like(true, false), catalog)?.id).toBe('noto-serif-kr');
    expect(closestFont(like(false, false), catalog)?.id).toBe('noto-sans-kr');
  });

  it('굵은 글꼴이면 굵은 쪽을 고른다', () => {
    expect(closestFont(like(false, true), catalog)?.id).toBe('noto-sans-kr-bold');
  });
});

describe('원본 글꼴로 고쳐 저장하기', () => {
  // 이 문서에는 그려진 글자가 없다. 지우기 없이 그리는 길(넣기)로 글꼴만 본다.
  // 지운 뒤 원본 글꼴로 다시 쓰는 길은 pdf-edit.test.ts 가 실제 PDFium 으로 본다.
  const edit = (over: Partial<TextEdit> = {}): TextEdit => ({
    kind: 'add', page: 1, x: 30, y: 100,
    text: '가나다', size: 12, fontId: sourceFontId('F1'),
    color: { r: 0, g: 0, b: 0 }, original: '', ...over,
  });
  const redact = (): Promise<Uint8Array> => Promise.reject(new Error('지울 자리가 없어야 합니다.'));

  it('글꼴을 심지 않고 원본 자원을 그대로 가리킨다', async () => {
    const source = await makeType0({});
    const { bytes } = await applyTextEdits(source, [edit()], [], redact);

    // 심었다면 글꼴 파일이 통째로 들어가 파일이 크게 불어난다.
    expect(bytes.length - source.length).toBeLessThan(2048);
    const content = await contentOf(bytes);
    expect(content).toMatch(/\/F1 12 Tf/);
    // 코드는 ToUnicode 를 뒤집은 것 그대로여야 한다 — 가·나·다 = 1·2·3.
    expect(content).toMatch(/<000100020003> Tj/);
  });

  it('원본에 없는 글자는 그리기 전에 멈춘다', async () => {
    // 그려 버리면 빈칸이 찍힌다. 조용히 사라지게 두지 않는다.
    await expect(applyTextEdits(await makeType0({}), [edit({ text: '가라' })], [], redact))
      .rejects.toThrow(/원본 글꼴에 없는 글자/);
  });

  it('없는 자원을 가리키면 이름을 대고 멈춘다', async () => {
    await expect(applyTextEdits(await makeType0({}), [edit({ fontId: sourceFontId('F9') })], [], redact))
      .rejects.toThrow(/원본 글꼴을 찾지 못했습니다/);
  });
});

describe('지운 문서로 원본 글꼴 옮겨 오기', () => {
  // PDFium 은 글자를 지우고 다시 쓰면서 자원 이름을 바꾼다(/F1 → /FXF1). 그 글꼴로
  // 쓰던 글자를 다 지웠으면 쪽 자원에서 빠지기도 한다. 객체 번호는 지킨다.
  const fontsOf = (document: PDFDocument): PDFDict => document.getPage(0).node.normalizedEntries().Font;

  it('같은 문서면 그 이름 그대로 쓴다', async () => {
    const document = await PDFDocument.load(await makeType0({}));
    const font = carrySourceFont(document.getPage(0), 'F1', document.getPage(0));
    expect(font?.resource).toBe('F1');
  });

  it('이름이 바뀌었으면 같은 객체를 가리키는 새 이름을 찾는다', async () => {
    const source = await makeType0({});
    const renamed = await PDFDocument.load(source);
    const fonts = fontsOf(renamed);
    fonts.set(PDFName.of('FXF1'), fonts.get(PDFName.of('F1'))!);
    fonts.delete(PDFName.of('F1'));
    const before = renamed.context.largestObjectNumber;

    const font = carrySourceFont((await PDFDocument.load(source)).getPage(0), 'F1', renamed.getPage(0));
    expect(font?.resource).toBe('FXF1');
    expect(renamed.context.largestObjectNumber).toBe(before);
  });

  it('쪽 자원에서 빠졌어도 객체가 남아 있으면 이름만 붙인다', async () => {
    const source = await makeType0({});
    const dropped = await PDFDocument.load(source);
    const ref = fontsOf(dropped).get(PDFName.of('F1')) as PDFRef;
    fontsOf(dropped).delete(PDFName.of('F1'));
    const before = dropped.context.largestObjectNumber;

    const font = carrySourceFont((await PDFDocument.load(source)).getPage(0), 'F1', dropped.getPage(0));
    expect(font?.missing('가나다')).toEqual([]);
    expect(fontsOf(dropped).get(PDFName.of(font!.resource))).toBe(ref);
    // 복사하지 않았다 — 글꼴 파일이 두 벌이 되면 파일만 불어난다.
    expect(dropped.context.largestObjectNumber).toBe(before);
  });

  it('객체가 없으면 복사해 온다', async () => {
    const elsewhere = await PDFDocument.create();
    elsewhere.addPage([300, 200]);
    const font = carrySourceFont((await PDFDocument.load(await makeType0({}))).getPage(0), 'F1', elsewhere.getPage(0));
    expect(font?.label).toBe('MalgunGothic');
    expect(readSourceFonts(elsewhere.getPage(0)).map(found => found.resource)).toContain(font!.resource);
  });

  it('원본에 없는 이름이면 없음을 돌려준다', async () => {
    const document = await PDFDocument.load(await makeType0({}));
    expect(carrySourceFont(document.getPage(0), 'F9', document.getPage(0))).toBeUndefined();
  });
});

/** 본문 스트림을 글자로 돌려준다. */
async function contentOf(bytes: Uint8Array): Promise<string> {
  const document = await PDFDocument.load(bytes);
  const contents = document.getPage(0).node.normalizedEntries().Contents;
  const parts: string[] = [];
  for (const entry of contents?.asArray() ?? []) {
    const stream = document.context.lookup(entry);
    if (stream instanceof PDFRawStream) parts.push(new TextDecoder().decode(decodePDFRawStream(stream).decode()));
  }
  return parts.join('\n');
}

/** 한글 PDF 한 쪽. 글꼴 사전을 실제 문서에서 오는 모양대로 세운다. */
async function makeType0(options: {
  toUnicode?: string | null;
  encoding?: string;
  w?: string;
  withType3?: boolean;
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 200]);
  const context = document.context;

  const font = context.obj({
    Type: 'Font', Subtype: 'Type0',
    BaseFont: 'ABCDEF+MalgunGothic',
    Encoding: options.encoding ?? 'Identity-H',
  });
  const toUnicode = options.toUnicode === undefined ? KOREAN : options.toUnicode;
  if (toUnicode !== null) font.set(PDFName.of('ToUnicode'), context.register(context.stream(toUnicode)));

  const descendant = context.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'ABCDEF+MalgunGothic', DW: 1000 });
  descendant.set(PDFName.of('W'), context.obj(widthsOf(options.w ?? '[1 [1000 1000 1000] 4 4 500]')));
  descendant.set(PDFName.of('FontDescriptor'), context.register(context.obj({
    Type: 'FontDescriptor', FontName: 'ABCDEF+MalgunGothic', Flags: 4,
  })));
  font.set(PDFName.of('DescendantFonts'), context.obj([context.register(descendant)]));

  const fonts = page.node.normalizedEntries().Font;
  fonts.set(PDFName.of('F1'), context.register(font));
  if (options.withType3) {
    const type3 = context.obj({ Type: 'Font', Subtype: 'Type3' });
    type3.set(PDFName.of('Encoding'), context.obj({ Type: 'Encoding', Differences: [0, 'g0'] }));
    type3.set(PDFName.of('ToUnicode'), context.register(context.stream(KOREAN)));
    fonts.set(PDFName.of('F2'), context.register(type3));
  }
  return document.save();
}

/** `[1 [1000 1000 1000] 4 4 500]` 처럼 적은 /W 를 배열로 바꾼다. */
function widthsOf(source: string): (number | number[])[] {
  const out: (number | number[])[] = [];
  // 바깥 괄호를 먼저 벗긴다. 그대로 두면 안쪽 묶음이 없는 `[1 3 800]` 이 통째로
  // 한 묶음으로 잡혀 엉뚱한 표가 된다.
  for (const [, group, single] of source.trim().replace(/^\[|\]$/g, '').matchAll(/\[([^[\]]*)\]|(-?\d+)/g)) {
    if (group !== undefined) out.push(group.trim().split(/\s+/).map(Number));
    else out.push(Number(single));
  }
  return out;
}
