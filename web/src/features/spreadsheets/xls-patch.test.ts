import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { CFB } from 'xlsx';
import { decodeRk, encodeRk, indexBiff, patchBiff, patchXls, spliceBiff } from './xls-patch';
import { fromWorkbook, recalc } from './sheet-recalc';

// --- 손으로 짠 BIFF8 기록 ------------------------------------------------------
const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const f64 = (x: number): number[] => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x, true); return [...b]; };
const record = (id: number, body: number[]): number[] => [...u16(id), ...u16(body.length), ...body];
const cell = (row: number, col: number): number[] => [...u16(row), ...u16(col), ...u16(15)];

/** 시트 '견적' 하나. B2=3(RK) C2=1500(NUMBER) D2=B2*C2(4500) B3·C3=MULRK(2,2500) D6=한글 금액(글자 결과). */
function stream(options: { encrypted?: boolean } = {}): Uint8Array {
  const name = '견적';
  const sheetName = [name.length, 1, ...[...name].flatMap(ch => u16(ch.charCodeAt(0)))];
  const head = [
    ...record(0x0809, [...u16(0x0600), ...u16(0x0005), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...(options.encrypted ? record(0x002f, [0, 0]) : []),
    ...record(0x01c1, [...u16(0x01c1), 0, 0, ...u32(191029)]),
  ];
  const boundSheetLength = 4 + 6 + sheetName.length;
  const eofLength = 4;
  const sheetStart = head.length + boundSheetLength + eofLength;
  const globals = [...head, ...record(0x0085, [...u32(sheetStart), 0, 0, ...sheetName]), ...record(0x000a, [])];
  const formulaResultString = [0, 0, 0, 0, 0, 0, 0xff, 0xff];
  const sheet = [
    ...record(0x0809, [...u16(0x0600), ...u16(0x0010), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...record(0x027e, [...cell(1, 1), ...u32(encodeRk(3)!)]),
    ...record(0x0203, [...cell(1, 2), ...f64(1500)]),
    ...record(0x0006, [...cell(1, 3), ...f64(4500), ...u16(0), ...u32(0), ...u16(0)]),
    ...record(0x00bd, [...u16(2), ...u16(1), ...u16(15), ...u32(encodeRk(2)!), ...u16(15), ...u32(encodeRk(2500)!), ...u16(2)]),
    ...record(0x0006, [...cell(5, 3), ...formulaResultString, ...u16(0), ...u32(0), ...u16(0)]),
    ...record(0x0207, [...u16(4), 0, ...[...'일금사천'].flatMap(() => [0x41])]),
    ...record(0x000a, []),
  ];
  return new Uint8Array([...globals, ...sheet]);
}
function apply(bytes: Uint8Array, writes: Array<{ at: number; bytes: Uint8Array }>): Uint8Array {
  const out = bytes.slice();
  for (const write of writes) out.set(write.bytes, write.at);
  return out;
}
function applySplices(bytes: Uint8Array, splices: Array<{ at: number; remove: number; insert: Uint8Array }>): Uint8Array {
  let out = bytes;
  for (const splice of [...splices].sort((a, b) => b.at - a.at)) out = spliceBiff(out, splice.at, splice.remove, splice.insert);
  return out;
}
/** (row, col) 수식 칸 바로 뒤 STRING 기록의 글자. 없으면 undefined. */
function textResult(bytes: Uint8Array, row: number, col: number): string | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let afterFormula = false;
  for (let at = 0; at + 4 <= bytes.length;) {
    const id = view.getUint16(at, true), length = view.getUint16(at + 2, true), body = at + 4;
    if (afterFormula && id === 0x0207) {
      const count = view.getUint16(body, true);
      return bytes[body + 2] ? new TextDecoder('utf-16le').decode(bytes.subarray(body + 3, body + 3 + count * 2)) : String.fromCharCode(...bytes.subarray(body + 3, body + 3 + count));
    }
    afterFormula = id === 0x0006 && view.getUint16(body, true) === row && view.getUint16(body + 2, true) === col;
    at = body + length;
  }
  return undefined;
}
/** 시트마다 DBCELL 이 엑셀의 규칙과 맞는지 — 첫 값은 첫 ROW 까지 거리, 다음은 행 첫 칸 사이 거리. */
function dbcellMismatches(stream: Uint8Array): string[] {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const cellIds = new Set([0x00fd, 0x0203, 0x027e, 0x00bd, 0x0006, 0x0201, 0x00be, 0x0205, 0x0204, 0x00d6]);
  const bad: string[] = [];
  let rows: Array<{ at: number; row: number }> = [];
  const first = new Map<number, number>();
  for (let at = 0; at + 4 <= stream.length;) {
    const id = view.getUint16(at, true), length = view.getUint16(at + 2, true), body = at + 4;
    if (id === 0x0208) rows.push({ at, row: view.getUint16(body, true) });
    else if (cellIds.has(id)) { const row = view.getUint16(body, true); if (!first.has(row)) first.set(row, at); }
    else if (id === 0x00d7 && rows.length) {
      if (view.getUint32(body, true) !== at - rows[0]!.at) bad.push(`dbRtrw@${at}`);
      rows.forEach((r, i) => {
        const expected = i === 0 ? first.get(r.row)! - (rows[0]!.at + 20) : first.get(r.row)! - first.get(rows[i - 1]!.row)!;
        if (view.getUint16(body + 4 + i * 2, true) !== expected) bad.push(`rgdb[${i}]@${at}`);
      });
      rows = []; first.clear();
    }
    at = body + length;
  }
  return bad;
}

describe('RK — xls 가 숫자를 4바이트에 접어 넣는 꼴', () => {
  it('정수·소수 둘째 자리·2의 거듭제곱 꼴을 접고 그대로 편다', () => {
    for (const x of [0, 3, -7, 1500, 536870911, 12.34, -0.5, 1.25, 0.1]) {
      const rk = encodeRk(x);
      expect(rk, String(x)).not.toBeNull();
      expect(decodeRk(rk!)).toBe(x);
    }
  });
  it('접을 수 없는 값은 null — 크기가 다른 기록으로 바꾸지 않는다', () => {
    expect(encodeRk(600000001)).toBeNull();
    expect(encodeRk(1.2345)).toBeNull();
  });
});

describe('BIFF8 기록 고치기', () => {
  it('시트 이름과 칸 주소로 숫자·수식 칸을 찾는다', () => {
    const index = indexBiff(stream());
    expect([...index.cells.keys()].sort()).toEqual(['견적!B2', '견적!B3', '견적!C2', '견적!C3', '견적!D2', '견적!D6']);
    expect(index.cells.get('견적!C2')!.kind).toBe('number');
    expect(index.cells.get('견적!B3')!.kind).toBe('rk');
    expect(index.cells.get('견적!D6')!.kind).toBe('formula-text');
  });

  it('NUMBER·RK·MULRK 칸의 값과 수식 칸의 계산값을 같은 자리에 덮어쓴다', () => {
    const before = stream();
    const { writes, problems } = patchBiff(before, [
      { sheet: '견적', address: 'C2', value: 2000 },
      { sheet: '견적', address: 'B2', value: 4 },
      { sheet: '견적', address: 'C3', value: 3000 },
      { sheet: '견적', address: 'D2', value: 8000 },
    ]);
    expect(problems).toEqual([]);
    const after = apply(before, writes);
    expect(after.length).toBe(before.length);
    const index = indexBiff(after);
    expect(index.read('견적!C2')).toBe(2000);
    expect(index.read('견적!B2')).toBe(4);
    expect(index.read('견적!C3')).toBe(3000);
    expect(index.read('견적!B3')).toBe(2);
    expect(index.read('견적!D2')).toBe(8000);
  });

  it('엑셀이 열 때 모든 수식을 다시 계산하도록 RECALCID 의 빌드 번호를 0 으로 둔다', () => {
    const before = stream();
    const after = apply(before, patchBiff(before, [{ sheet: '견적', address: 'C2', value: 2000 }]).writes);
    expect(indexBiff(after).recalcBuild).toBe(0);
  });

  it('수식의 글자 결과도 쓴다 — 글자→글자, 숫자→글자, 글자→숫자', () => {
    const before = stream();
    const { writes, problems, splices } = patchBiff(before, [
      { sheet: '견적', address: 'D6', value: '일금오천원정' },
      { sheet: '견적', address: 'D2', value: '없음' },
    ]);
    expect(problems).toEqual([]);
    const after = applySplices(apply(before, writes), splices);
    expect(textResult(after, 5, 3)).toBe('일금오천원정');
    expect(textResult(after, 1, 3)).toBe('없음');
    expect(indexBiff(after).cells.get('견적!C2')!.kind).toBe('number');
    const back = patchBiff(after, [{ sheet: '견적', address: 'D6', value: 4500 }]);
    const numeric = applySplices(apply(after, back.writes), back.splices);
    expect(indexBiff(numeric).read('견적!D6')).toBe(4500);
    expect(textResult(numeric, 5, 3)).toBeUndefined();
  });

  it('숫자 기록이 없는 칸(빈 칸·글자 칸)과 담을 수 없는 숫자는 고치지 않고 알린다', () => {
    const { writes, problems } = patchBiff(stream(), [
      { sheet: '견적', address: 'A1', value: 5 },
      { sheet: '견적', address: 'B2', value: 600000001 },
    ]);
    expect(problems.map(p => p.address)).toEqual(['A1', 'B2']);
    expect(writes.filter(w => w.bytes.length === 4 && w.at > 0).length).toBe(0);
  });

  it('암호가 걸린 파일은 열지 않는다', () => {
    expect(() => indexBiff(stream({ encrypted: true }))).toThrow(/암호/);
  });
});

describe('xls 파일 전체 — 나머지 바이트는 그대로', () => {
  function book(rows: number): Uint8Array {
    const data: (string | number)[][] = [['품목', '수량', '단가']];
    for (let i = 1; i < rows; i++) data.push([`품목${i}`, i, i * 100]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), '견적');
    return new Uint8Array(XLSX.write(wb, { bookType: 'xls', type: 'array' }) as ArrayBuffer);
  }

  for (const [label, rows] of [['작은 파일(미니 스트림)', 10], ['큰 파일(일반 섹터)', 600]] as const) {
    it(`${label}: 고친 칸 말고는 한 바이트도 바뀌지 않는다`, () => {
      const before = book(rows);
      const { bytes, problems } = patchXls(before, [{ sheet: '견적', address: 'C3', value: 777 }]);
      expect(problems).toEqual([]);
      expect(bytes.length).toBe(before.length);
      let differing = 0;
      for (let i = 0; i < bytes.length; i++) if (bytes[i] !== before[i]) differing++;
      expect(differing).toBeGreaterThan(0);
      expect(differing).toBeLessThanOrEqual(8);
      const sheet = XLSX.read(bytes).Sheets['견적']!;
      expect(sheet['C3']!.v).toBe(777);
      expect(sheet['C2']!.v).toBe(100);
      expect(sheet['A3']!.v).toBe('품목2');
    });
  }

  it('xls 가 아닌 파일은 거절한다', () => {
    expect(() => patchXls(new TextEncoder().encode('hello'), [])).toThrow(/xls/);
  });
});

describe('엑셀이 만든 견적서(.xls) — web/scripts/make-quote-xls.ps1 로 만든 진짜 파일', () => {
  const fixture = (): Uint8Array => new Uint8Array(readFileSync(new URL('../../testing/fixtures/quote-excel.xls', import.meta.url)));
  const sheetOf = (bytes: Uint8Array): XLSX.WorkSheet => XLSX.read(bytes, { cellFormula: true }).Sheets['견적서']!;

  it('숫자 칸은 제자리에서 바뀌고 파일 크기는 그대로다', () => {
    const before = fixture();
    const { bytes, problems } = patchXls(before, [{ sheet: '견적서', address: 'B6', value: 4 }]);
    expect(problems).toEqual([]);
    expect(bytes.length).toBe(before.length);
    expect(sheetOf(bytes)['B6']!.v).toBe(4);
  });

  it('글자 칸을 고친다 — 새 글자는 공유 문자열 끝에 붙이고, 나머지 글자·수식·병합은 그대로다', () => {
    const { bytes, problems } = patchXls(fixture(), [
      { sheet: '견적서', address: 'A6', value: '만년필' },
      { sheet: '견적서', address: 'A3', value: '다라상사 귀하' },
      { sheet: '견적서', address: 'C6', value: 2000 },
    ]);
    expect(problems).toEqual([]);
    const sheet = sheetOf(bytes);
    expect(sheet['A6']!.v).toBe('만년필');
    expect(sheet['A3']!.v).toBe('다라상사 귀하');
    expect(sheet['C6']!.v).toBe(2000);
    expect(sheet['A7']!.v).toBe('공책');
    expect(sheet['A1']!.v).toBe('견 적 서');
    expect(sheet['A14']!.v).toBe('납기: 발주 후 7일');
    expect(sheet['D9']!.f).toBe('SUM(D6:D8)');
    expect(sheet['!merges']).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }]);
  });

  it('긴 글자가 많아 공유 문자열 기록(8KB)을 넘겨도 모두 읽힌다', () => {
    const long = (ch: string): string => ch.repeat(3000);
    const { bytes, problems } = patchXls(fixture(), [
      { sheet: '견적서', address: 'A6', value: long('가') },
      { sheet: '견적서', address: 'A7', value: long('나') },
      { sheet: '견적서', address: 'A8', value: long('다') },
    ]);
    expect(problems).toEqual([]);
    const sheet = sheetOf(bytes);
    expect([sheet['A6']!.v, sheet['A7']!.v, sheet['A8']!.v]).toEqual([long('가'), long('나'), long('다')]);
    expect(sheet['A3']!.v).toBe('가나상사 귀하');
  });

  it('글자 칸에 숫자, 숫자 칸에 글자는 넣지 않는다', () => {
    const { problems } = patchXls(fixture(), [
      { sheet: '견적서', address: 'A6', value: 5 },
      { sheet: '견적서', address: 'B6', value: '셋' },
    ]);
    expect(problems.map(p => p.address)).toEqual(['A6', 'B6']);
  });

  it('단가를 고치면 한글 금액(NUMBERSTRING) 칸에도 새 글자가 들어가고, 행 색인(DBCELL)은 엑셀 규칙대로다', () => {
    const before = fixture();
    const workbook = XLSX.read(before, { cellFormula: true });
    const { changes, problems } = recalc(fromWorkbook(workbook), [{ sheet: '견적서', address: 'C6', value: 2000 }]);
    expect(problems).toEqual([]);
    const patched = patchXls(before, changes.map(c => ({ sheet: c.sheet, address: c.address, value: c.after })));
    expect(patched.problems).toEqual([]);
    const sheet = sheetOf(patched.bytes);
    expect(sheet['B12']!.v).toBe('일금 일십삼만팔천육백원정');
    expect(sheet['D11']!.v).toBe(138600);
    expect(sheet['A14']!.v).toBe('납기: 발주 후 7일');
    const streamOf = (bytes: Uint8Array): Uint8Array => new Uint8Array(CFB.find(CFB.read(bytes, { type: 'array' }), 'Workbook')!.content as Uint8Array);
    expect(dbcellMismatches(streamOf(before))).toEqual([]);
    expect(dbcellMismatches(streamOf(patched.bytes))).toEqual([]);
  });
});
