import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import * as XLSX from 'xlsx';

import { patchXlsx } from './xlsx-patch';

function quote(): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([['품목', '수량', '단가', '금액'], ['볼펜', 3, 1500, null], ['합계', null, null, null], ['금액 글', null, null, null]]);
  ws['D2'] = { t: 'n', v: 4500, f: 'B2*C2' };
  ws['D3'] = { t: 'n', v: 4500, f: 'SUM(D2:D2)' };
  ws['D4'] = { t: 's', v: '4500원', f: 'D3&"원"' };
  ws['!ref'] = 'A1:D4';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '견적');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['다른 시트', 1]]), '메모');
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
}

describe('xlsx 의 칸 값만 바꿔 넣는다', () => {
  it('숫자 칸과 수식 칸의 계산값을 바꾸고, 엑셀이 열 때 다시 계산하게 표시한다', () => {
    const { bytes, problems } = patchXlsx(quote(), [
      { sheet: '견적', address: 'C2', value: 2000 },
      { sheet: '견적', address: 'D2', value: 6000 },
      { sheet: '견적', address: 'D3', value: 6000 },
      { sheet: '견적', address: 'D4', value: '6000원' },
    ]);
    expect(problems).toEqual([]);
    const sheet = XLSX.read(bytes, { cellFormula: true }).Sheets['견적']!;
    expect(sheet['C2']!.v).toBe(2000);
    expect(sheet['D2']).toMatchObject({ v: 6000, f: 'B2*C2' });
    expect(sheet['D3']).toMatchObject({ v: 6000, f: 'SUM(D2:D2)' });
    expect(sheet['D4']).toMatchObject({ v: '6000원', t: 's' });
    expect(strFromU8(unzipSync(bytes)['xl/workbook.xml']!)).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  });

  it('고친 시트 말고 다른 부분(다른 시트·스타일·공유 문자열)은 바이트 그대로다', () => {
    const before = unzipSync(quote());
    const after = unzipSync(patchXlsx(quote(), [{ sheet: '견적', address: 'C2', value: 2000 }]).bytes);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const name of Object.keys(before)) {
      if (name === 'xl/workbook.xml' || name.endsWith('sheet1.xml')) continue;
      expect(after[name], name).toEqual(before[name]);
    }
  });

  it('글자 칸·빈 칸은 고치지 않고 알린다', () => {
    const { problems } = patchXlsx(quote(), [
      { sheet: '견적', address: 'A2', value: 5 },
      { sheet: '견적', address: 'B3', value: 5 },
    ]);
    expect(problems.map(p => p.address)).toEqual(['A2', 'B3']);
  });

  it('없는 시트를 고치려 하면 알린다', () => {
    const { problems } = patchXlsx(quote(), [{ sheet: '없음', address: 'A1', value: 1 }]);
    expect(problems[0]!.reason).toMatch(/시트/);
  });
});

describe('xlsx 글자 칸', () => {
  function withSharedStrings(): Uint8Array {
    const ws = XLSX.utils.aoa_to_sheet([['품목', '수량'], ['볼펜', 3], ['합계', null]]);
    ws['A4'] = { t: 's', v: '볼펜 외', f: 'A2&" 외"' };
    ws['!ref'] = 'A1:B4';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '견적');
    return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array', bookSST: true }) as ArrayBuffer);
  }

  it('공유 문자열 칸도, 그냥 글자 칸도 그 칸 안에 글자를 넣어 바꾼다(다른 칸은 그대로)', () => {
    const { bytes, problems } = patchXlsx(withSharedStrings(), [
      { sheet: '견적', address: 'A2', value: '만년필 <고급> & 세트' },
      { sheet: '견적', address: 'A4', value: '만년필 <고급> & 세트 외' },
    ]);
    expect(problems).toEqual([]);
    const sheet = XLSX.read(bytes, { cellFormula: true }).Sheets['견적']!;
    expect(sheet['A2']!.v).toBe('만년필 <고급> & 세트');
    expect(sheet['A1']!.v).toBe('품목');
    expect(sheet['A3']!.v).toBe('합계');
    expect(sheet['A4']).toMatchObject({ v: '만년필 <고급> & 세트 외', f: 'A2&" 외"' });
  });

  it('글자 칸에 숫자, 숫자 칸에 글자는 넣지 않는다', () => {
    const { problems } = patchXlsx(withSharedStrings(), [
      { sheet: '견적', address: 'A2', value: 5 },
      { sheet: '견적', address: 'B2', value: '셋' },
    ]);
    expect(problems.map(p => p.address)).toEqual(['A2', 'B2']);
  });
});
