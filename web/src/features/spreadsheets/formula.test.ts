import { describe, expect, it } from 'vitest';

import { evaluate, parseFormula, referencesOf, UnsupportedFormula, type CellValue } from './formula';

/** 'A1' → 값. 시트 이름이 없으면 '견적' 시트로 본다. */
function run(text: string, cells: Record<string, CellValue> = {}): CellValue {
  return evaluate(parseFormula(text), {
    sheet: '견적',
    cell: (sheet, address) => cells[`${sheet}!${address}`] ?? cells[address] ?? null,
    bounds: () => ({ rows: 50, cols: 10 }),
  });
}

describe('수식 계산', () => {
  it('사칙연산은 엑셀의 우선순위를 따른다', () => {
    expect(run('1+2*3')).toBe(7);
    expect(run('(1+2)*3')).toBe(9);
    expect(run('2^3^2')).toBe(64); // 엑셀은 왼쪽부터 거듭제곱
    expect(run('-2^2')).toBe(4);    // 엑셀은 단항 음수가 먼저
    expect(run('50%')).toBe(0.5);
    expect(run('10/4')).toBe(2.5);
  });

  it('칸 참조 — 절대 참조와 다른 시트', () => {
    const cells = { B2: 3, C2: 1500, '단가표!A1': 7 };
    expect(run('B2*C2', cells)).toBe(4500);
    expect(run('$B$2*$C2', cells)).toBe(4500);
    expect(run("단가표!A1+1", cells)).toBe(8);
    expect(run("'단가표'!$A$1*2", cells)).toBe(14);
  });

  it('빈 칸은 0, 숫자 글자는 숫자로, 다른 글자는 #VALUE!', () => {
    expect(run('A1+1')).toBe(1);
    expect(run('A1+1', { A1: '41' })).toBe(42);
    expect(run('A1+1', { A1: '볼펜' })).toEqual({ error: '#VALUE!' });
  });

  it('SUM 은 범위의 글자·빈 칸을 건너뛴다', () => {
    expect(run('SUM(D2:D4)', { D2: 4500, D3: '비고', D4: 5000 })).toBe(9500);
    expect(run('SUM(D2:D3,100)', { D2: 1, D3: 2 })).toBe(103);
  });

  it('반올림 셋은 엑셀처럼 0 에서 먼 쪽으로, 자리 수 음수도 받는다', () => {
    expect(run('ROUND(2.5,0)')).toBe(3);
    expect(run('ROUND(-2.5,0)')).toBe(-3);
    expect(run('ROUND(1.005,2)')).toBe(1.01);     // 부동소수 오차에 지지 않는다
    expect(run('ROUNDDOWN(12345,-1)')).toBe(12340);
    expect(run('ROUNDUP(12341,-1)')).toBe(12350);
    expect(run('ROUNDDOWN(-1.29,1)')).toBe(-1.2);
    expect(run('INT(-1.5)')).toBe(-2);
    expect(run('TRUNC(-1.5)')).toBe(-1);
  });

  it('견적서에 흔한 함수들', () => {
    const cells = { B2: 3, C2: 1500, B3: 2, C3: 2500 };
    expect(run('SUMPRODUCT(B2:B3,C2:C3)', cells)).toBe(9500);
    expect(run('IF(B2>2,"많음","적음")', cells)).toBe('많음');
    expect(run('IFERROR(1/0,0)')).toBe(0);
    expect(run('MAX(B2:C3)', cells)).toBe(2500);
    expect(run('MIN(B2:C3)', cells)).toBe(2);
    expect(run('AVERAGE(B2:B3)', cells)).toBe(2.5);
    expect(run('COUNT(B2:C3)', cells)).toBe(4);
    expect(run('ABS(-3)+MOD(7,3)')).toBe(4);
    expect(run('AND(1,TRUE)')).toBe(true);
    expect(run('"합계 "&B2&"개"', cells)).toBe('합계 3개');
  });

  it('0 으로 나누면 #DIV/0! 이고 오류는 퍼진다', () => {
    expect(run('1/0')).toEqual({ error: '#DIV/0!' });
    expect(run('SUM(1/0,2)')).toEqual({ error: '#DIV/0!' });
  });

  it('모르는 함수와 이름은 멈추고 이름을 알린다 — 조용히 틀린 값을 내지 않는다', () => {
    expect(() => run('NUMBERSTRING(D20,1)')).toThrow(UnsupportedFormula);
    expect(() => run('NUMBERSTRING(D20,1)')).toThrow(/NUMBERSTRING/);
    expect(() => run('단가*2')).toThrow(UnsupportedFormula);
  });

  it('참조한 칸과 범위를 시트 이름까지 붙여 돌려준다', () => {
    expect(referencesOf(parseFormula('SUM(D2:D3)+단가표!A1*$B$2'), '견적')).toEqual([
      { sheet: '견적', from: { row: 1, col: 3 }, to: { row: 2, col: 3 } },
      { sheet: '단가표', from: { row: 0, col: 0 }, to: { row: 0, col: 0 } },
      { sheet: '견적', from: { row: 1, col: 1 }, to: { row: 1, col: 1 } },
    ]);
  });

  it('xlsx 가 붙이는 _xlfn. 접두어는 떼고 읽는다', () => {
    expect(run('_xlfn.IFERROR(1/0,5)')).toBe(5);
  });
});
