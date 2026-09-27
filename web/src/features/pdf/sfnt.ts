/**
 * sfnt(TrueType·OpenType) 테이블 손질.
 *
 * `@pdf-lib/fontkit` 은 GPOS 가 12바이트짜리 빈 껍데기인 글꼴에서 버퍼 끝을
 * 넘어 읽고 죽는다 — "Trying to access beyond buffer length". 나눔고딕·나눔명조·
 * 나눔손글씨·도현·주아·개구가 모두 그렇다. 한글 글꼴에서 드문 일이 아니라서
 * 그 글꼴들을 목록에서 빼는 것으로는 해결되지 않는다. 쓰는 사람이 제 컴퓨터의
 * 글꼴을 올릴 때 같은 일이 그대로 일어난다.
 *
 * 우리가 하는 일은 **글자를 그려 넣는 것** 뿐이다. 합자·커닝 같은 배치 테이블은
 * 쓰지 않는다. 그래서 심기 전에 떼어 낸다 — 고치는 것이 아니라 안 쓰는 것을
 * 버리는 것이라 글자 모양은 그대로다.
 *
 * 같은 이유로 **글리프를 짝수 길이로 맞춘다**(`padGlyphs`). 그쪽은 글꼴이 깨져서가
 * 아니라 서브셋을 만드는 쪽이 홀수 자리를 담지 못해서 생기는 일이다.
 */

/** 그리기에 쓰지 않는 배치·서명 테이블. 이것만 뗀다. */
const LAYOUT_TABLES = new Set(['GPOS', 'GSUB', 'GDEF', 'BASE', 'JSTF', 'MATH', 'DSIG', 'kern']);

/** OpenType 명세가 정한 마법수. head.checkSumAdjustment 를 다시 셀 때 쓴다. */
const CHECKSUM_MAGIC = 0xb1b0afba;

interface TableRecord { tag: string; checksum: number; offset: number; length: number }

/**
 * 배치 테이블을 떼고, 글리프 자리를 짝수로 맞춰 sfnt 를 다시 짠다.
 *
 * 손댈 것이 없으면 받은 바이트를 그대로 돌려준다 — 멀쩡한 글꼴을 괜히 다시
 * 짜서 새 버그를 들일 이유가 없다.
 */
export function stripLayoutTables(bytes: Uint8Array): Uint8Array {
  const tables = readTables(bytes);
  const keep = tables.filter((table) => !LAYOUT_TABLES.has(table.tag.trim()));
  const padded = padGlyphs(bytes, keep);
  if (keep.length === tables.length && !padded) return bytes;
  if (!keep.length) throw new Error('글꼴에 남는 테이블이 없습니다.');
  return rebuild(bytes, keep, padded ?? new Map());
}

/**
 * 홀수 길이 글리프 뒤에 0 한 바이트를 붙인다.
 *
 * `@pdf-lib/fontkit` 의 서브셋은 쓰는 글리프만 이어 붙여 새 glyf 를 짓고, 그
 * 자리표(loca)를 **짧은 꼴** 로 적는다. 짧은 꼴은 자리를 2로 나눠 담기 때문에
 * 홀수 자리는 반내림되어 사라진다 — 그 글리프부터 한 바이트씩 밀려 읽혀
 * 엉뚱한 윤곽선이 되거나 빈칸이 된다. 한글 글꼴은 글리프가 수만 개라 홀수가
 * 섞이지 않을 수 없어서, 한 줄을 고치면 글자 대부분이 사라진다.
 *
 * 그래서 **심기 전에** 모든 글리프를 짝수 길이로 맞춘다. 글리프는 제 안에
 * 윤곽선 수와 좌표 개수를 갖고 있어 뒤에 붙은 0 을 읽지 않는다 — 글자 모양은
 * 그대로이고, 서브셋의 자리가 늘 짝수가 되어 반내림될 것이 없어진다.
 *
 * 맞출 것이 없거나 glyf 가 없는 글꼴(CFF 를 쓰는 .otf)이면 아무것도 돌려주지
 * 않는다. 모르는 모양이면 손대지 않는 것이 맞다.
 */
function padGlyphs(bytes: Uint8Array, tables: TableRecord[]): Map<string, Uint8Array> | null {
  const find = (tag: string): TableRecord | undefined => tables.find((table) => table.tag === tag);
  const glyf = find('glyf');
  const loca = find('loca');
  const head = find('head');
  const maxp = find('maxp');
  if (!glyf || !loca || !head || !maxp || head.length < 54 || maxp.length < 6) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(maxp.offset + 4);
  // 짧은 꼴 loca 는 자리를 2로 나눠 담으므로 애초에 홀수 자리가 없다 — 맞출 것도
  // 없고, 그런 글꼴(글리프가 128KB 안에 드는 작은 글꼴)은 이 버그를 겪지 않는다.
  if (view.getInt16(head.offset + 50) !== 1) return null;
  if (!count || loca.length < (count + 1) * 4) return null;

  const at = (index: number): number => view.getUint32(loca.offset + index * 4);

  const lengths: number[] = [];
  for (let index = 0; index < count; index++) {
    const start = at(index);
    const end = at(index + 1);
    // 자리표가 거꾸로 가거나 glyf 밖을 가리키면 우리가 아는 글꼴이 아니다.
    if (end < start || end > glyf.length) return null;
    lengths.push(end - start);
  }
  if (lengths.every((length) => length % 2 === 0)) return null;

  const body = new Uint8Array(lengths.reduce((sum, length) => sum + length + (length % 2), 0));
  const offsets: number[] = [];
  let out = 0;
  for (let index = 0; index < count; index++) {
    offsets.push(out);
    body.set(bytes.subarray(glyf.offset + at(index), glyf.offset + at(index) + lengths[index]!), out);
    out += lengths[index]! + (lengths[index]! % 2);
  }
  offsets.push(out);

  // 꼴은 그대로 긴 꼴이다. head.indexToLocFormat 을 건드리지 않아도 맞는다.
  const table = new Uint8Array((count + 1) * 4);
  const writer = new DataView(table.buffer);
  offsets.forEach((offset, index) => writer.setUint32(index * 4, offset));
  return new Map([['glyf', body], ['loca', table]]);
}

/** 글꼴 갈래 확인 — 못 쓰는 것은 심기 전에 이름을 대고 멈춘다. */
export function readTables(bytes: Uint8Array): TableRecord[] {
  if (bytes.length < 12) throw new Error('글꼴 파일이 너무 짧습니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  // WOFF 는 압축 포장이고 ttcf 는 글꼴 여럿을 담은 묶음이다. 둘 다 그대로는 못 심는다.
  if (tag === 'wOFF' || tag === 'wOF2') throw new Error('WOFF 글꼴은 심을 수 없습니다. TTF 또는 OTF 파일을 올려 주세요.');
  if (tag === 'ttcf') throw new Error('글꼴 묶음(.ttc)은 심을 수 없습니다. 낱개 TTF 또는 OTF 를 올려 주세요.');
  const version = view.getUint32(0);
  if (version !== 0x00010000 && tag !== 'OTTO' && tag !== 'true' && tag !== 'typ1') {
    throw new Error('TrueType·OpenType 글꼴이 아닙니다.');
  }

  const count = view.getUint16(4);
  if (!count || 12 + count * 16 > bytes.length) throw new Error('글꼴의 테이블 목록이 깨졌습니다.');
  const tables: TableRecord[] = [];
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    // 목록이 파일 밖을 가리키면 여기서 멈춘다. 그대로 심으면 fontkit 이 죽는다.
    if (offset + length > bytes.length) throw new Error('글꼴의 테이블이 파일 끝을 넘어갑니다.');
    tables.push({ tag: String.fromCharCode(...bytes.subarray(at, at + 4)), checksum: view.getUint32(at + 4), offset, length });
  }
  return tables;
}

function rebuild(source: Uint8Array, keep: TableRecord[], replaced: Map<string, Uint8Array>): Uint8Array {
  const pad = (n: number): number => (n + 3) & ~3;
  const bodies = keep.map((table) => replaced.get(table.tag) ?? source.subarray(table.offset, table.offset + table.length));
  const directory = 12 + keep.length * 16;
  const out = new Uint8Array(directory + bodies.reduce((sum, body) => sum + pad(body.length), 0));
  const view = new DataView(out.buffer);

  out.set(source.subarray(0, 4));
  view.setUint16(4, keep.length);
  // searchRange·entrySelector·rangeShift. 읽는 쪽은 대개 무시하지만 명세는 값을 정해 두었다.
  const selector = Math.floor(Math.log2(keep.length));
  const range = 2 ** selector * 16;
  view.setUint16(6, range);
  view.setUint16(8, selector);
  view.setUint16(10, keep.length * 16 - range);

  let at = directory;
  let head = -1;
  keep.forEach((table, index) => {
    const body = bodies[index]!;
    const record = 12 + index * 16;
    for (let c = 0; c < 4; c++) out[record + c] = table.tag.charCodeAt(c);
    view.setUint32(record + 8, at);
    view.setUint32(record + 12, body.length);
    out.set(body, at);
    // head 의 검사합은 명세가 checkSumAdjustment 를 0 으로 놓고 세라고 정해 두었다.
    // 어차피 아래에서 다시 채우므로 여기서 비워 둔다.
    if (table.tag === 'head') { head = at; view.setUint32(at + 8, 0); }
    // 내용을 바꾼 테이블은 예전 검사합이 맞지 않는다. 그 테이블만 다시 센다.
    view.setUint32(record + 4, replaced.has(table.tag)
      ? sum32(new DataView(out.buffer, at, pad(body.length)))
      : table.checksum);
    at += pad(body.length);
  });

  // head.checkSumAdjustment 는 **파일 전체**의 합에서 나온다. 테이블을 옮겼으니
  // 예전 값은 더 이상 맞지 않는다. 그대로 두면 검사하는 도구가 깨진 글꼴로 본다.
  if (head >= 0 && head + 12 <= out.length) {
    view.setUint32(head + 8, 0);
    view.setUint32(head + 8, (CHECKSUM_MAGIC - sum32(view)) >>> 0);
  }
  return out;
}

/** sfnt 검사합 — 4바이트씩 더해 32비트로 감는다. */
function sum32(view: DataView): number {
  let total = 0;
  for (let at = 0; at + 4 <= view.byteLength; at += 4) total = (total + view.getUint32(at)) >>> 0;
  return total;
}
