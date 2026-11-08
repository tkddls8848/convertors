import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { decodeRk, encodeRk, indexBiff, patchBiff, patchXls } from './xls-patch';

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

  it('글자 결과를 내는 수식은 덮어쓸 수 없어 "열 때 다시 계산" 표시를 하고 알린다', () => {
    const before = stream();
    const { writes, problems } = patchBiff(before, [{ sheet: '견적', address: 'D6', value: '일금오천' }]);
    expect(problems).toEqual([{ sheet: '견적', address: 'D6', reason: expect.stringMatching(/열면 다시 계산/) }]);
    expect(indexBiff(apply(before, writes)).cells.get('견적!D6')!.alwaysCalc).toBe(true);
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
