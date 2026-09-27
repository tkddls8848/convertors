/**
 * 원본 PDF 가 이미 심어 둔 글꼴을 **그대로 다시 쓰기**.
 *
 * 고친 글자를 원본과 같은 글꼴로 내려면 길이 둘이다. 같은 글꼴 파일을 새로
 * 심거나, 원본이 이미 갖고 있는 글꼴 자원을 **가리키거나**. 앞의 길은 막혀
 * 있다 — PDF 는 글꼴을 서브셋으로 담아서 원본 파일에는 그 문서에 쓰인 글자의
 * 모양만 있고, 우리에게는 그 글꼴의 원본 파일이 없다.
 *
 * 그래서 가리킨다. 쪽의 자원 목록에서 글꼴을 찾아 `/F1 12 Tf <…> Tj` 를 그대로
 * 적어 넣으면, 심지 않고도 원본과 **같은 글꼴**로 글자가 나온다. 파일도 커지지
 * 않는다.
 *
 * 대신 원본에 없는 글자는 쓸 수 없다. 서브셋에 그 글리프가 없기 때문이고, 이것은
 * 원리상 피할 방법이 없다 — 그래서 `missing()` 으로 **먼저** 알아내 화면이 짚어
 * 준다. 조용히 빈칸을 찍는 것이 가장 나쁘다.
 *
 * 다음은 읽지 않는다. 읽는 척하느니 물러나는 편이 낫다.
 *
 *   - ToUnicode 가 없는 글꼴 — 글자와 코드를 이어 줄 표가 없으면 뒤집을 수 없다
 *   - Identity-H 가 아닌 CID 인코딩, 세로쓰기(-V), Type3
 *   - 너비 표가 없는 단순 글꼴 — 폭을 재지 못하면 자리에 맞출 수 없다
 */
import {
  PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFOperator, PDFOperatorNames as Ops,
  PDFRawStream, decodePDFRawStream, type PDFContext, type PDFObject, type PDFPage,
} from 'pdf-lib';

import type { Rgb } from './pdf-edit';

/** 원본 PDF 안의 글꼴 하나. 심는 것이 아니라 **가리키는** 것이다. */
export interface SourceFont {
  /** 쪽 자원 이름. 고친 자리를 다시 적용할 때 이 이름으로 찾는다. */
  resource: string;
  /** 사람이 읽을 이름. 서브셋 접두사(ABCDEF+)를 뗀 BaseFont 다. */
  label: string;
  serif: boolean;
  bold: boolean;
  /** 이 글꼴로 쓸 수 없는 글자. 빈 배열이면 다 쓸 수 있다. */
  missing(text: string): string[];
  widthOfTextAtSize(text: string, size: number): number;
  /** 내부용 — 그릴 때 쓰는 자원 이름과 코드 표. */
  readonly name: PDFName;
  readonly bytes: 1 | 2;
  readonly codes: Map<string, number>;
}

/** 쪽이 쓰는 글꼴 가운데 **우리가 다시 쓸 수 있는 것** 만 돌려준다. */
export function readSourceFonts(page: PDFPage): SourceFont[] {
  const context = page.doc.context;
  const fonts = context.lookup(page.node.Resources()?.get(PDFName.of('Font')));
  if (!(fonts instanceof PDFDict)) return [];

  const found: SourceFont[] = [];
  for (const [key, value] of fonts.entries()) {
    const dict = context.lookup(value);
    if (!(dict instanceof PDFDict)) continue;
    try {
      const font = read(context, key, dict);
      if (font) found.push(font);
    } catch {
      // 한 글꼴을 못 읽는 것이 화면 전체를 세울 이유는 아니다. 그 글꼴만 빠진다.
    }
  }
  return found;
}

/** 원본 글꼴 자원을 가리켜 한 줄을 그린다. */
export function drawWithSourceFont(
  page: PDFPage, font: SourceFont, line: string,
  place: { x: number; y: number; size: number; color: Rgb },
): void {
  const number = (value: number): PDFNumber => PDFNumber.of(value);
  page.pushOperators(
    PDFOperator.of(Ops.PushGraphicsState),
    PDFOperator.of(Ops.BeginText),
    PDFOperator.of(Ops.NonStrokingColorRgb, [number(place.color.r), number(place.color.g), number(place.color.b)]),
    PDFOperator.of(Ops.SetFontAndSize, [font.name, number(place.size)]),
    PDFOperator.of(Ops.MoveText, [number(place.x), number(place.y)]),
    PDFOperator.of(Ops.ShowText, [PDFHexString.of(encode(font, line))]),
    PDFOperator.of(Ops.EndText),
    PDFOperator.of(Ops.PopGraphicsState),
  );
}

/** 목록에 담을 글꼴 가운데 원본과 가장 닮은 것을 고른다. 굵기까지 맞춘다. */
export function closestFont<T extends { id: string; label: string; group: string }>(font: SourceFont, catalog: T[]): T | undefined {
  const group = catalog.filter(entry => entry.group === (font.serif ? '명조' : '고딕'));
  const pool = group.length ? group : catalog;
  return pool.find(entry => /굵게|bold/i.test(entry.label) === font.bold) ?? pool[0];
}

function encode(font: SourceFont, text: string): string {
  const width = font.bytes * 2;
  return [...text].map(letter => (font.codes.get(letter) ?? 0).toString(16).padStart(width, '0')).join('');
}

/**
 * 형이 다르면 **없는 것으로 친다.**
 *
 * `lookupMaybe` 는 형이 다르면 그 자리에서 던진다. 글꼴 사전의 같은 이름이
 * 문서마다 다른 형으로 오는 일이 흔해서(`/W` 의 두 가지 꼴, Type3 의 사전형
 * `/Encoding`) 그대로 쓰면 글꼴 하나가 통째로 버려진다.
 */
const name = (value: PDFObject | undefined): string | undefined => (value instanceof PDFName ? value.asString() : undefined);
const number = (value: PDFObject | undefined): number | undefined => (value instanceof PDFNumber ? value.asNumber() : undefined);

function read(context: PDFContext, key: PDFName, dict: PDFDict): SourceFont | null {
  const at = (owner: PDFDict, tag: string): PDFObject | undefined => context.lookup(owner.get(PDFName.of(tag)));
  const subtype = name(at(dict, 'Subtype'));
  const composite = subtype === '/Type0';
  if (!composite && subtype !== '/Type1' && subtype !== '/TrueType' && subtype !== '/MMType1') return null;

  // 세로쓰기와 우리가 모르는 CMap 은 코드가 달라진다. 건드리지 않는다.
  if (composite && name(at(dict, 'Encoding')) !== '/Identity-H') return null;

  const codes = readToUnicode(at(dict, 'ToUnicode'), composite ? 2 : 1);
  if (!codes?.size) return null;

  const family = at(dict, 'DescendantFonts');
  const descendant = composite
    ? (family instanceof PDFArray ? context.lookup(family.get(0)) : undefined)
    : dict;
  if (!(descendant instanceof PDFDict)) return null;

  const widths = composite ? compositeWidths(context, descendant) : simpleWidths(context, dict);
  if (!widths) return null;

  const descriptor = at(descendant, 'FontDescriptor');
  const flagged = descriptor instanceof PDFDict ? descriptor : undefined;
  const base = name(at(dict, 'BaseFont'))?.slice(1) ?? '이름 없는 글꼴';
  const label = base.replace(/^[A-Z]{6}\+/, '');
  const flags = number(flagged && at(flagged, 'Flags')) ?? 0;
  const weight = number(flagged && at(flagged, 'FontWeight')) ?? 0;

  const font: SourceFont = {
    resource: key.asString().slice(1),
    label,
    // 플래그 2번 비트가 세리프, 19번 비트가 굵게다. 이름이 더 정확할 때가 많아 둘 다 본다.
    serif: Boolean(flags & (1 << 1)) || /serif|myeongjo|batang|명조|바탕/i.test(label),
    bold: Boolean(flags & (1 << 18)) || weight >= 600 || /bold|굵|heavy|black/i.test(label),
    name: key,
    bytes: composite ? 2 : 1,
    codes,
    missing: (text) => [...new Set([...text])].filter(letter => letter !== '\n' && !codes.has(letter)),
    widthOfTextAtSize: (text, size) => [...text]
      .reduce((sum, letter) => sum + (widths(codes.get(letter) ?? -1) / 1000) * size, 0),
  };
  return font;
}

/** ToUnicode CMap 을 뒤집어 **글자 → 코드** 표를 만든다. */
function readToUnicode(stream: PDFObject | undefined, bytes: 1 | 2): Map<string, number> | null {
  if (!(stream instanceof PDFRawStream)) return null;
  const cmap = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  const codes = new Map<string, number>();

  // 같은 글자가 여러 코드에 걸리면 **먼저 나온 것** 을 쓴다. 나중 것으로 덮으면
  // 문서가 실제로 쓰던 코드가 아닌 쪽이 뽑힐 수 있다.
  const put = (code: number, letter: string | null): void => {
    if (code > 0 && letter && !codes.has(letter)) codes.set(letter, code);
  };

  for (const [, body] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, value] of body.matchAll(/<([\da-fA-F]+)>\s*<([\da-fA-F]*)>/g)) {
      put(Number.parseInt(code, 16), letterOf(value!));
    }
  }
  for (const [, body] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const entry = /<([\da-fA-F]+)>\s*<([\da-fA-F]+)>\s*(?:<([\da-fA-F]*)>|\[([\s\S]*?)\])/g;
    for (const [, low, high, single, list] of body.matchAll(entry)) {
      const first = Number.parseInt(low!, 16);
      const last = Number.parseInt(high!, 16);
      if (last < first || last - first > 0xffff) continue;
      if (list !== undefined) {
        [...list.matchAll(/<([\da-fA-F]*)>/g)].forEach(([, value], index) => put(first + index, letterOf(value!)));
        continue;
      }
      const start = letterOf(single!);
      // 범위는 마지막 코드 단위만 하나씩 올라간다. 글자 하나가 아니면 건너뛴다.
      if (start === null || start.length !== 1) continue;
      for (let code = first; code <= last; code++) put(code, String.fromCharCode(start.charCodeAt(0) + (code - first)));
    }
  }
  // 1바이트 글꼴인데 코드가 255 를 넘으면 우리가 잘못 읽은 것이다.
  if (bytes === 1 && [...codes.values()].some(code => code > 0xff)) return null;
  return codes;
}

/** UTF-16BE 16진 → 글자. 합자처럼 글자 여럿이면 쓰지 않는다. */
function letterOf(hex: string): string | null {
  const units = hex.match(/.{4}/g);
  if (!units?.length) return null;
  const text = String.fromCharCode(...units.map(unit => Number.parseInt(unit, 16)));
  return [...text].length === 1 ? text : null;
}

/**
 * CID 글꼴의 /W 와 /DW. 1000 단위다.
 *
 * /W 는 두 가지 꼴이 섞여 들어온다 — `코드 [너비 너비 …]` 와 `첫코드 끝코드 너비`.
 * 둘째 자리가 배열이냐 숫자냐로 가른다.
 */
function compositeWidths(context: PDFContext, font: PDFDict): ((code: number) => number) | null {
  const fallback = number(context.lookup(font.get(PDFName.of('DW')))) ?? 1000;
  const table = new Map<number, number>();
  const list = context.lookup(font.get(PDFName.of('W')));
  for (let index = 0; list instanceof PDFArray && index < list.size();) {
    const first = number(context.lookup(list.get(index)));
    if (first === undefined) break;
    const next = context.lookup(list.get(index + 1));
    if (next instanceof PDFArray) {
      next.asArray().forEach((value, at) => {
        const width = number(context.lookup(value));
        if (width !== undefined) table.set(first + at, width);
      });
      index += 2;
      continue;
    }
    const last = number(next);
    const width = number(context.lookup(list.get(index + 2)));
    if (last === undefined || width === undefined || last < first || last - first > 0xffff) break;
    for (let code = first; code <= last; code++) table.set(code, width);
    index += 3;
  }
  return (code) => table.get(code) ?? fallback;
}

/** 단순 글꼴의 /FirstChar 와 /Widths. 이것이 없으면 폭을 잴 수 없어 물러난다. */
function simpleWidths(context: PDFContext, font: PDFDict): ((code: number) => number) | null {
  const first = number(context.lookup(font.get(PDFName.of('FirstChar'))));
  const list = context.lookup(font.get(PDFName.of('Widths')));
  if (first === undefined || !(list instanceof PDFArray) || !list.size()) return null;
  const descriptor = context.lookup(font.get(PDFName.of('FontDescriptor')));
  const fallback = descriptor instanceof PDFDict
    ? number(context.lookup(descriptor.get(PDFName.of('MissingWidth')))) ?? 0
    : 0;
  const table = new Map<number, number>();
  list.asArray().forEach((value, at) => {
    const width = number(context.lookup(value));
    if (width !== undefined) table.set(first + at, width);
  });
  return (code) => table.get(code) ?? fallback;
}
