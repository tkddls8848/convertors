import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { encodeText } from './encoding';
import {
  ALL_SHEETS, EMPTY_KEY, SOURCE_COLUMN, guardFormula, inspectSheets, mergeSheets, mergeTables, partFileName, sheetName,
  splitByColumn, splitByRows, splitSheet, toCsv, type Row, type Source,
} from './sheet-tools';

const csv = (name: string, text: string): Source => ({ name, bytes: new TextEncoder().encode(text) });
const cp949 = (name: string, text: string): Source => ({
  name, bytes: encodeText(text, { encoding: 'euc-kr', bom: false, newline: 'keep', replaceMissing: false }).bytes,
});
function xlsx(name: string, sheets: Record<string, Row[]>): Source {
  const book = XLSX.utils.book_new();
  for (const [sheet, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet);
  return { name, bytes: new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })) };
}
const readRows = (bytes: Uint8Array, sheet?: string): unknown[][] => {
  const book = XLSX.read(bytes, { type: 'array' });
  return XLSX.utils.sheet_to_json(book.Sheets[sheet ?? book.SheetNames[0]!]!, { header: 1, defval: null });
};
const csvText = (bytes: Uint8Array): string => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

describe('mergeTables', () => {
  it('drops identical headers of later tables', () => {
    const merged = mergeTables([
      { label: 'a.csv', rows: [['품목', '수량'], ['연필', 3]] },
      { label: 'b.csv', rows: [['품목', '수량'], ['지우개', 5], ['자', 1]] },
    ]);
    expect(merged.rows).toEqual([['품목', '수량'], ['연필', 3], ['지우개', 5], ['자', 1]]);
    expect(merged.differing).toEqual([]);
  });

  it('aligns different headers by name and reports them', () => {
    const merged = mergeTables([
      { label: 'a.csv', rows: [['품목', '수량', '단가'], ['연필', 3, 500]] },
      { label: 'b.csv', rows: [['단가', '품목', '비고'], [700, '지우개', '파랑']] },
    ]);
    expect(merged.rows).toEqual([
      ['품목', '수량', '단가', '비고'],
      ['연필', 3, 500, null],
      ['지우개', null, 700, '파랑'],
    ]);
    expect(merged.differing).toEqual(['b.csv']);
  });

  it('matches repeated header names by occurrence', () => {
    const merged = mergeTables([
      { label: 'a', rows: [['메모', '메모'], ['1', '2']] },
      { label: 'b', rows: [['메모', '메모'], ['3', '4']] },
    ]);
    expect(merged.rows).toEqual([['메모', '메모'], ['1', '2'], ['3', '4']]);
  });

  it('adds a source file column', () => {
    const merged = mergeTables([
      { label: '1월.xlsx', rows: [['품목'], ['연필']] },
      { label: '2월.xlsx', rows: [['품목'], ['자']] },
      { label: '빈.xlsx', rows: [] },
    ], true);
    expect(merged.rows).toEqual([[SOURCE_COLUMN, '품목'], ['1월.xlsx', '연필'], ['2월.xlsx', '자']]);
    expect(merged.empty).toEqual(['빈.xlsx']);
  });
});

describe('mergeSheets', () => {
  it('reads CP949 CSV, keeps leading zeros and merges with XLSX', async () => {
    const result = await mergeSheets([
      cp949('1월.csv', '사번,이름\r\n007,김철수\r\n'),
      xlsx('2월.xlsx', { 명단: [['사번', '이름'], ['010', '이영희']] }),
    ], { sheets: [], mode: 'append', addSource: true, format: 'xlsx' });
    expect(readRows(result.files[0]!.bytes)).toEqual([
      [SOURCE_COLUMN, '사번', '이름'], ['1월.csv', '007', '김철수'], ['2월.xlsx', '010', '이영희'],
    ]);
    expect(result.notes.join(' ')).toContain('CP949');
  });

  it('writes CSV with BOM, CRLF and formula guard', async () => {
    const result = await mergeSheets([
      csv('a.csv', 'id,note\n1,=HYPERLINK("x")\n2,-5\n'),
      csv('b.csv', 'id,note\n3,"@SUM(A1)"\n4,"a,b"\n'),
    ], { sheets: [], mode: 'append', addSource: false, format: 'csv' });
    const text = csvText(result.files[0]!.bytes);
    expect(text.startsWith('﻿id,note\r\n')).toBe(true);
    expect(text).toContain(`1,"'=HYPERLINK(""x"")"`);
    expect(text).toContain('2,-5\r\n');
    expect(text).toContain("3,'@SUM(A1)\r\n");
    expect(text).toContain('4,"a,b"\r\n');
  });

  it('puts every sheet of every file into its own sheet with safe names', async () => {
    const result = await mergeSheets([
      xlsx('매출 [2026]*최종.xlsx', { '1분기': [['a'], [1]], '2분기': [['a'], [2]] }),
      csv('매출 [2026]*최종.csv', 'a\n3\n'),
    ], { sheets: [ALL_SHEETS, ''], mode: 'sheets', addSource: false, format: 'xlsx' });
    const book = XLSX.read(result.files[0]!.bytes, { type: 'array' });
    expect(book.SheetNames).toEqual(['매출 _2026__최종-1분기', '매출 _2026__최종-2분기', '매출 _2026__최종']);
    expect(readRows(result.files[0]!.bytes, '매출 _2026__최종-2분기')).toEqual([['a'], [2]]);
  });

  it('refuses CSV output for one-sheet-per-file', async () => {
    await expect(mergeSheets([csv('a.csv', 'a\n1')], { sheets: [], mode: 'sheets', addSource: false, format: 'csv' })).rejects.toThrow('XLSX');
  });

  it('enforces the cell limit before expanding sheets', async () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['a']]);
    sheet['!ref'] = 'A1:J50001';
    XLSX.utils.book_append_sheet(book, sheet, 'x');
    const big = { name: 'big.xlsx', bytes: new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })) };
    await expect(mergeSheets([big], { sheets: [], mode: 'append', addSource: false, format: 'xlsx' })).rejects.toThrow('50만');
  });
});

describe('split', () => {
  const rows: Row[] = [['지역', '금액'], ['서울', 1], ['부산', 2], ['서울', 3], [null, 4], ['대구', 5]];

  it('splits by rows and repeats the header', () => {
    const parts = splitByRows(rows, 2);
    expect(parts.map(p => p.rows.length)).toEqual([3, 3, 2]);
    for (const part of parts) expect(part.rows[0]).toEqual(['지역', '금액']);
    expect(parts.flatMap(p => p.rows.slice(1))).toEqual(rows.slice(1));
    expect(() => splitByRows(rows, 0)).toThrow();
  });

  it('splits by Korean column values and gathers blanks', () => {
    const parts = splitByColumn(rows, 0);
    expect(parts.map(p => p.key)).toEqual(['서울', '부산', EMPTY_KEY, '대구']);
    expect(parts[0]!.rows).toEqual([['지역', '금액'], ['서울', 1], ['서울', 3]]);
    expect(parts[2]!.rows).toEqual([['지역', '금액'], [null, 4]]);
  });

  it('zips parts with safe, unique names', async () => {
    const source = csv('주문.csv', '거래처,수량\n가/나,1\n가:나,2\n다,3\n,4\n');
    const result = await splitSheet(source, { sheet: '', by: 'column', size: 0, column: 0, format: 'csv' });
    const files = unzipSync(result.files[0]!.bytes);
    expect(Object.keys(files)).toEqual(['주문-가_나.csv', '주문-가_나 (2).csv', '주문-다.csv', `주문-${EMPTY_KEY}.csv`]);
    expect(csvText(files['주문-다.csv']!)).toBe('﻿거래처,수량\r\n다,3\r\n');
  });

  it('numbers row parts with padding and writes XLSX', async () => {
    const lines = ['번호', ...Array.from({ length: 25 }, (_, i) => String(i + 1))].join('\n');
    const result = await splitSheet(csv('목록.csv', lines), { sheet: '', by: 'rows', size: 2, column: 0, format: 'xlsx' });
    const files = unzipSync(result.files[0]!.bytes);
    expect(Object.keys(files)).toHaveLength(13);
    expect(Object.keys(files)[0]).toBe('목록-01.xlsx');
    expect(readRows(files['목록-13.xlsx']!)).toEqual([['번호'], ['25']]);
  });

  it('refuses more than 500 parts', async () => {
    const lines = ['a', ...Array.from({ length: 600 }, (_, i) => String(i))].join('\n');
    await expect(splitSheet(csv('x.csv', lines), { sheet: '', by: 'rows', size: 1, column: 0, format: 'csv' })).rejects.toThrow('500');
  });
});

describe('helpers', () => {
  it('sanitizes and dedupes sheet names', () => {
    const used = new Set<string>();
    expect(sheetName('a[1]:b*?/\\c', used)).toBe('a_1__b____c');
    expect(sheetName('가'.repeat(40), used)).toBe('가'.repeat(31));
    expect(sheetName('가'.repeat(35), used)).toBe(`${'가'.repeat(27)} (2)`);
    expect(sheetName("'인용'", used)).toBe('인용');
    expect(sheetName('', used)).toBe('Sheet');
    expect(sheetName('SHEET', used)).toBe('SHEET (2)');
    expect(sheetName('History', used)).toBe('History_');
  });

  it('guards formula-like text but not numbers', () => {
    expect(guardFormula('=1+1')).toBe("'=1+1");
    expect(guardFormula('+82-10')).toBe("'+82-10");
    expect(guardFormula('@cmd')).toBe("'@cmd");
    expect(guardFormula('-5')).toBe('-5');
    expect(guardFormula('+3.25')).toBe('+3.25');
    expect(guardFormula('평범')).toBe('평범');
    expect(toCsv([['a', null, true, new Date(2026, 0, 2)]])).toBe('﻿a,,TRUE,2026-01-02\r\n');
  });

  it('builds part file names within limits', () => {
    const used = new Set<string>();
    expect(partFileName('보고서', 'CON', 'csv', used)).toBe('보고서-CON.csv');
    expect(partFileName('a', 'b.', 'csv', used)).toBe('a-b.csv');
    expect(Array.from(partFileName('a', '가'.repeat(300), 'csv', used)).length).toBe(104);
  });

  it('inspects sheet names and headers', async () => {
    const [info] = await inspectSheets([xlsx('a.xlsx', { 첫째: [['품목', '수량'], ['연필', 1]], 둘째: [] })]);
    expect(info!.sheets.map(s => s.name)).toEqual(['첫째', '둘째']);
    expect(info!.sheets[0]!.headers).toEqual(['품목', '수량']);
    expect(info!.sheets[0]!.rows).toBe(2);
    expect(info!.sheets[1]!.headers).toEqual([]);
  });
});
