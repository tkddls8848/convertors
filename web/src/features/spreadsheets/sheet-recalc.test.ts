import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { fromWorkbook, recalc, type SheetModel } from './sheet-recalc';

/** 견적서 꼴: 수량·단가 → 금액 → 합계 → 부가세(10원 아래 버림) → 총액. */
function quote(): SheetModel[] {
  const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet([
    ['품목', '수량', '단가', '금액'],
    ['볼펜', 3, 1500, null],
    ['공책', 2, 2500, null],
    ['합계', null, null, null],
    ['부가세', null, null, null],
    ['총액', null, null, null],
    ['비고', null, null, null],
  ]);
  ws['D2'] = { t: 'n', v: 4500, f: 'B2*C2' };
  ws['D3'] = { t: 'n', v: 5000, f: 'B3*C3' };
  ws['D4'] = { t: 'n', v: 9500, f: 'SUM(D2:D3)' };
  ws['D5'] = { t: 'n', v: 950, f: 'ROUNDDOWN(D4*0.1,-1)' };
  ws['D6'] = { t: 'n', v: 10450, f: 'D4+D5' };
  ws['B7'] = { t: 'n', v: 0, f: 'COUNT(A1:A2)' };             // 숫자 칸과 무관한 수식(글자 칸을 센다)
  ws['!ref'] = 'A1:D7';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '견적');
  return fromWorkbook(wb);
}

describe('고친 칸에 딸린 수식만 다시 계산한다', () => {
  it('단가를 고치면 금액·합계·부가세·총액이 따라 바뀐다', () => {
    const { changes, problems } = recalc(quote(), [{ sheet: '견적', address: 'C2', value: 2000 }]);
    expect(problems).toEqual([]);
    expect(changes).toEqual([
      { sheet: '견적', address: 'C2', before: 1500, after: 2000, formula: false },
      { sheet: '견적', address: 'D2', before: 4500, after: 6000, formula: true },
      { sheet: '견적', address: 'D4', before: 9500, after: 11000, formula: true },
      { sheet: '견적', address: 'D5', before: 950, after: 1100, formula: true },
      { sheet: '견적', address: 'D6', before: 10450, after: 12100, formula: true },
    ]);
  });

  it('고친 칸과 무관한 수식은 건드리지 않는다', () => {
    const { changes } = recalc(quote(), [{ sheet: '견적', address: 'B3', value: 2 }]);
    expect(changes.map(change => change.address)).not.toContain('B7');
  });

  it('다시 계산하지 못한 칸과, 그 칸을 읽는 칸은 바꾸지 않고 까닭을 알린다', () => {
    const sheets = quote();
    sheets[0]!.cells.set('D4', { value: 9500, formula: 'NUMBERSTRING(D2,1)' });
    const { changes, problems } = recalc(sheets, [{ sheet: '견적', address: 'C2', value: 2000 }]);
    expect(problems.map(p => p.address)).toEqual(['D4', 'D5', 'D6']);
    expect(problems[0]!.reason).toMatch(/NUMBERSTRING/);
    expect(problems[1]!.reason).toMatch(/D4/);
    expect(changes.map(change => change.address)).toEqual(['C2', 'D2']);
  });

  it('순환 참조는 멈추고 알린다', () => {
    const sheets = quote();
    sheets[0]!.cells.set('D2', { value: 4500, formula: 'B2*C2+D6' });
    const { problems } = recalc(sheets, [{ sheet: '견적', address: 'C2', value: 2000 }]);
    expect(problems.some(p => /순환/.test(p.reason))).toBe(true);
  });

  it('다른 시트에서 읽는 수식도 따라간다', () => {
    const sheets = quote();
    sheets.push({ name: '요약', rows: 1, cols: 1, cells: new Map([['A1', { value: 10450, formula: '견적!D6' }]]) });
    const { changes } = recalc(sheets, [{ sheet: '견적', address: 'C2', value: 2000 }]);
    expect(changes.at(-1)).toEqual({ sheet: '요약', address: 'A1', before: 10450, after: 12100, formula: true });
  });

  it('글자 칸을 고치면 그 글자를 잇는 수식도 따라간다', () => {
    const sheets = quote();
    sheets[0]!.cells.set('A8', { value: '볼펜 외 1건', formula: 'A2&" 외 1건"' });
    const { changes, problems } = recalc(sheets, [{ sheet: '견적', address: 'A2', value: '만년필' }]);
    expect(problems).toEqual([]);
    expect(changes).toEqual([
      { sheet: '견적', address: 'A2', before: '볼펜', after: '만년필', formula: false },
      { sheet: '견적', address: 'A8', before: '볼펜 외 1건', after: '만년필 외 1건', formula: true },
    ]);
  });
});
