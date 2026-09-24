import { describe, expect, it } from 'vitest';

import { readTables, stripLayoutTables } from './sfnt';

/** 시험용 sfnt 한 벌. 테이블 이름과 내용만 맞으면 된다 — 글리프는 보지 않는다. */
function buildFont(tables: [string, Uint8Array][]): Uint8Array {
  const pad = (n: number): number => (n + 3) & ~3;
  const directory = 12 + tables.length * 16;
  const out = new Uint8Array(directory + tables.reduce((sum, [, body]) => sum + pad(body.length), 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  let at = directory;
  tables.forEach(([tag, body], index) => {
    const record = 12 + index * 16;
    for (let c = 0; c < 4; c++) out[record + c] = tag.charCodeAt(c);
    view.setUint32(record + 4, 0);
    view.setUint32(record + 8, at);
    view.setUint32(record + 12, body.length);
    out.set(body, at);
    at += pad(body.length);
  });
  return out;
}

const body = (text: string): Uint8Array => new TextEncoder().encode(text);
/** head 는 54바이트다. checkSumAdjustment 가 8번째 바이트에, indexToLocFormat 이 50번째에 있다. */
const head = (longLoca = false): Uint8Array => {
  const table = new Uint8Array(54);
  new DataView(table.buffer).setInt16(50, longLoca ? 1 : 0);
  return table;
};

/** 글리프 길이만 정해 glyf·loca·maxp·head 를 갖춘 시험용 글꼴. 내용은 길이만큼의 연속된 수다. */
function buildGlyphFont(lengths: number[], extra: [string, Uint8Array][] = []): Uint8Array {
  const glyf = new Uint8Array(lengths.reduce((sum, length) => sum + length, 0));
  glyf.forEach((_, index) => { glyf[index] = (index % 251) + 1; });
  const loca = new Uint8Array((lengths.length + 1) * 4);
  const view = new DataView(loca.buffer);
  let at = 0;
  lengths.forEach((length, index) => { view.setUint32(index * 4, at); at += length; });
  view.setUint32(lengths.length * 4, at);
  const maxp = new Uint8Array(32);
  new DataView(maxp.buffer).setUint16(4, lengths.length);
  return buildFont([...extra, ['glyf', glyf], ['head', head(true)], ['loca', loca], ['maxp', maxp]]);
}

/** 글꼴에서 글리프 하나하나의 자리와 내용을 도로 읽는다. */
function readGlyphs(font: Uint8Array): { offset: number; body: number[] }[] {
  const tables = readTables(font);
  const find = (tag: string): { offset: number; length: number } => tables.find(table => table.tag === tag)!;
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(find('maxp').offset + 4);
  const loca = find('loca').offset;
  const glyf = find('glyf').offset;
  const at = (index: number): number => view.getUint32(loca + index * 4);
  return Array.from({ length: count }, (_, index) => ({
    offset: at(index),
    body: [...font.subarray(glyf + at(index), glyf + at(index + 1))],
  }));
}

describe('sfnt 테이블 손질', () => {
  it('배치 테이블을 떼고 나머지는 그대로 둔다', () => {
    const font = buildFont([['GPOS', body('xx')], ['cmap', body('cmap-내용')], ['glyf', body('glyf-내용')], ['head', head()]]);
    const stripped = stripLayoutTables(font);

    const tags = readTables(stripped).map(table => table.tag);
    expect(tags).not.toContain('GPOS');
    expect(tags.sort()).toEqual(['cmap', 'glyf', 'head']);
  });

  it('뗀 뒤에도 남은 테이블의 내용이 바뀌지 않는다', () => {
    const font = buildFont([['GSUB', body('버릴 것')], ['cmap', body('지킬 내용')], ['head', head()]]);
    const stripped = stripLayoutTables(font);

    const cmap = readTables(stripped).find(table => table.tag === 'cmap')!;
    expect(new TextDecoder().decode(stripped.subarray(cmap.offset, cmap.offset + cmap.length))).toBe('지킬 내용');
  });

  it('뗄 것이 없으면 받은 바이트를 그대로 돌려준다', () => {
    // 멀쩡한 글꼴을 괜히 다시 짜지 않는다 — 다시 짜는 것 자체가 위험이다.
    const font = buildFont([['cmap', body('가')], ['glyf', body('나')], ['head', head()]]);
    expect(stripLayoutTables(font)).toBe(font);
  });

  it('GPOS·GSUB·GDEF·kern·DSIG 를 모두 뗀다', () => {
    const font = buildFont([
      ['GPOS', body('1')], ['GSUB', body('2')], ['GDEF', body('3')],
      ['kern', body('4')], ['DSIG', body('5')], ['BASE', body('6')],
      ['cmap', body('7')], ['head', head()],
    ]);
    expect(readTables(stripLayoutTables(font)).map(table => table.tag).sort()).toEqual(['cmap', 'head']);
  });

  it('head 의 checkSumAdjustment 를 다시 센다', () => {
    // 테이블을 옮겼으니 예전 값은 맞지 않는다. 그대로 두면 깨진 글꼴로 읽힌다.
    const font = buildFont([['GPOS', body('xx')], ['cmap', body('가')], ['head', head()]]);
    const stripped = stripLayoutTables(font);
    const record = readTables(stripped).find(table => table.tag === 'head')!;
    const view = new DataView(stripped.buffer, stripped.byteOffset, stripped.byteLength);
    const stored = view.getUint32(record.offset + 8);

    view.setUint32(record.offset + 8, 0);
    let sum = 0;
    for (let at = 0; at + 4 <= view.byteLength; at += 4) sum = (sum + view.getUint32(at)) >>> 0;
    expect(stored).toBe((0xb1b0afba - sum) >>> 0);
  });

  it('WOFF·글꼴 묶음·엉뚱한 파일은 이름을 대고 멈춘다', () => {
    const woff = new Uint8Array(16);
    woff.set(new TextEncoder().encode('wOFF'));
    expect(() => stripLayoutTables(woff)).toThrow(/WOFF/);

    const collection = new Uint8Array(16);
    collection.set(new TextEncoder().encode('ttcf'));
    expect(() => stripLayoutTables(collection)).toThrow(/묶음/);

    expect(() => stripLayoutTables(new TextEncoder().encode('이건 글꼴이 아니다'))).toThrow(/TrueType/);
    expect(() => stripLayoutTables(new Uint8Array(4))).toThrow(/짧습니다/);
  });

  it('홀수 길이 글리프에 한 바이트를 붙여 자리를 짝수로 맞춘다', () => {
    // 이것이 어긋나면 서브셋의 loca 가 반내림되어 그 글리프부터 밀려 읽힌다 —
    // 화면에서는 고친 글자가 통째로 사라지는 것으로 보인다. sfnt.ts 참고.
    const font = buildGlyphFont([7, 4, 3, 10]);
    const glyphs = readGlyphs(stripLayoutTables(font));

    expect(glyphs.map(glyph => glyph.offset)).toEqual([0, 8, 12, 16]);
    expect(glyphs.every(glyph => glyph.offset % 2 === 0)).toBe(true);
  });

  it('붙인 바이트가 글리프 내용을 밀어내지 않는다', () => {
    // 글리프는 제 안에 길이를 갖고 있어 뒤에 붙은 0 을 읽지 않는다. 앞부분이
    // 한 바이트라도 달라지면 글자 모양이 바뀐 것이다.
    const font = buildGlyphFont([5, 6]);
    const before = readGlyphs(font);
    const after = readGlyphs(stripLayoutTables(font));

    expect(after[0]!.body).toEqual([...before[0]!.body, 0]);
    expect(after[1]!.body).toEqual(before[1]!.body);
  });

  it('배치 테이블을 떼면서도 글리프 자리를 맞춘다', () => {
    const font = buildGlyphFont([3, 3], [['GPOS', body('xx')]]);
    const stripped = stripLayoutTables(font);

    expect(readTables(stripped).map(table => table.tag)).not.toContain('GPOS');
    expect(readGlyphs(stripped).map(glyph => glyph.offset)).toEqual([0, 4]);
  });

  it('글리프가 모두 짝수면 다시 짜지 않는다', () => {
    const font = buildGlyphFont([4, 6]);
    expect(stripLayoutTables(font)).toBe(font);
  });

  it('glyf 가 없는 글꼴(CFF)은 그대로 둔다', () => {
    // .otf 는 글리프를 CFF 에 담는다. 우리가 아는 모양이 아니면 손대지 않는다.
    const font = buildFont([['CFF ', body('홀수')], ['cmap', body('가')], ['head', head(true)]]);
    expect(stripLayoutTables(font)).toBe(font);
  });

  it('loca 가 거꾸로 가거나 glyf 밖을 가리키면 손대지 않는다', () => {
    const font = buildGlyphFont([5, 5]);
    const loca = readTables(font).find(table => table.tag === 'loca')!;
    new DataView(font.buffer).setUint32(loca.offset + 4, 99_999);
    expect(stripLayoutTables(font)).toBe(font);
  });

  it('목록이 파일 밖을 가리키면 심기 전에 멈춘다', () => {
    // 그대로 fontkit 에 넘기면 "Trying to access beyond buffer length" 로 죽는다.
    const font = buildFont([['cmap', body('가')], ['head', head()]]);
    new DataView(font.buffer).setUint32(12 + 12, 9999);
    expect(() => readTables(font)).toThrow(/파일 끝/);
  });
});
