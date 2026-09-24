import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { convertSpreadsheet } from './spreadsheet-formats';
import { SHEET_OUTPUTS } from './format-catalog';
function fixture(ascii = false): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(ascii ? [['item', 'quantity'], ['pencil', 3]] : [['품목', '수량'], ['연필', 3]]), '한글');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['id', 'note'], ['001', '=HYPERLINK("bad")']]), '두번째');
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
}
describe('spreadsheet conversions', () => {
  for (const format of ['xls', 'xlsb', 'ods', 'fods', 'csv', 'tsv', 'json', 'dif', 'sylk']) it(`reads generated ${format} back into XLSX`, async () => {
    const ascii = ['dif', 'sylk'].includes(format);
    const source = (await convertSpreadsheet(fixture(ascii), 'test.xlsx', format)).files[0]!;
    const converted = (await convertSpreadsheet(source.bytes, source.name, 'xlsx')).files[0]!;
    const book = XLSX.read(converted.bytes, { type: 'array' });
    expect(book.Sheets[book.SheetNames[0]!]!['A2'].v).toBe(ascii ? 'pencil' : '연필');
  });
  for (const output of SHEET_OUTPUTS) it(`writes ${output} without losing the second sheet`, async () => {
    const result = await convertSpreadsheet(fixture(['dif', 'sylk'].includes(output)), 'test.xlsx', output);
    if (['xlsx', 'xls', 'xlsb', 'ods', 'fods'].includes(output)) {
      const book = XLSX.read(result.files[0]!.bytes, { type: 'array' });
      expect(book.SheetNames).toEqual(['한글', '두번째']);
      expect(book.Sheets['한글']!['A2'].v).toBe('연필');
      expect(book.Sheets['한글']!['B2'].v).toBe(3);
    } else {
      expect(result.files).toHaveLength(2);
      expect(result.files[0]!.bytes.length).toBeGreaterThan(0);
    }
  });
  it('preserves leading zeroes in CSV and neutralizes formula-like text on export', async () => {
    const input = new TextEncoder().encode('id,note\n001,=1+1');
    const xlsx = await convertSpreadsheet(input, 'x.csv', 'xlsx');
    const book = XLSX.read(xlsx.files[0]!.bytes, { type: 'array' });
    expect(book.Sheets['Sheet1']!['A2'].v).toBe('001');
    expect(book.Sheets['Sheet1']!['B2'].f).toBeUndefined();
    const csv = await convertSpreadsheet(input, 'x.csv', 'csv');
    expect(new TextDecoder().decode(csv.files[0]!.bytes)).toContain("'=1+1");
  });
  it('refuses lossy Korean DIF/SYLK output', async () => {
    for (const format of ['dif', 'sylk']) await expect(convertSpreadsheet(fixture(), 'x.xlsx', format)).rejects.toThrow('ASCII');
  });
  it('rejects nested JSON and excessive cell ranges', async () => {
    await expect(convertSpreadsheet(new TextEncoder().encode('[{"a":{"b":1}}]'), 'x.json', 'xlsx')).rejects.toThrow('중첩');
    const book = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([['a']]); sheet['!ref'] = 'A1:Z20001';
    XLSX.utils.book_append_sheet(book, sheet, 'x');
    await expect(convertSpreadsheet(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), 'x.xlsx', 'csv')).rejects.toThrow('50만');
  });
  it('warns about formulas without a cached result', async () => {
    const book = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([['a']]); sheet['A2'] = { t: 'n', f: '1+1' }; sheet['!ref'] = 'A1:A2';
    XLSX.utils.book_append_sheet(book, sheet, 'x');
    const result = await convertSpreadsheet(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), 'x.xlsx', 'csv');
    expect(result.notes.join(' ')).toContain('계산값');
  });
  it('preserves date number formats in XLSX output', async () => {
    const book = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([['date']]);
    sheet['A2'] = { t: 'n', v: 45000, z: 'yyyy-mm-dd' }; sheet['!ref'] = 'A1:A2'; XLSX.utils.book_append_sheet(book, sheet, 'x');
    const result = await convertSpreadsheet(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), 'x.xlsx', 'xlsx');
    expect(XLSX.read(result.files[0]!.bytes, { type: 'array', cellNF: true }).Sheets['x']!['A2'].z).toBe('yyyy-mm-dd');
  });
});
