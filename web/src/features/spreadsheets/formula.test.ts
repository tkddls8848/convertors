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
    expect(() => run('DATEDIF(A1,A2,"d")')).toThrow(UnsupportedFormula);
    expect(() => run('DATEDIF(A1,A2,"d")')).toThrow(/DATEDIF/);
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

describe('NUMBERSTRING — 엑셀이 낸 답(make-quote-xls 와 같은 PC 의 엑셀로 뽑았다)', () => {
  const table: Array<[number, string, string, string]> = [
    [0, '영', '零', '영'], [1, '일', '壹', '일'], [10, '일십', '壹拾', '일영'], [11, '일십일', '壹拾壹', '일일'],
    [20, '이십', '貳拾', '이영'], [101, '일백일', '壹百壹', '일영일'], [110, '일백일십', '壹百壹拾', '일일영'],
    [1001, '일천일', '壹阡壹', '일영영일'], [10000, '일만', '壹萬', '일영영영영'],
    [12345, '일만이천삼백사십오', '壹萬貳阡參百四拾伍', '일이삼사오'], [110000, '일십일만', '壹拾壹萬', '일일영영영영'],
    [138600, '일십삼만팔천육백', '壹拾參萬八阡六百', '일삼팔육영영'], [136950, '일십삼만육천구백오십', '壹拾參萬六阡九百伍拾', '일삼육구오영'],
    [1234567, '일백이십삼만사천오백육십칠', '壹百貳拾參萬四阡伍百六拾七', '일이삼사오육칠'],
    [100010000, '일억일만', '壹億壹萬', '일영영영일영영영영'],
    [123456789, '일억이천삼백사십오만육천칠백팔십구', '壹億貳阡參百四拾伍萬六阡七百八拾九', '일이삼사오육칠팔구'],
    [1000000000000, '일조', '壹兆', '일영영영영영영영영영영영영'],
    [12.7, '일십삼', '壹拾參', '일삼'], [0.4, '영', '零', '영'], [99.5, '일백', '壹百', '일영영'],
  ];
  it.each(table)('%d', (n, one, two, three) => {
    expect(run(`NUMBERSTRING(${n},1)`)).toBe(one);
    expect(run(`NUMBERSTRING(${n},2)`)).toBe(two);
    expect(run(`NUMBERSTRING(${n},3)`)).toBe(three);
  });
  it('음수는 #NUM!', () => {
    expect(run('NUMBERSTRING(-1500,1)')).toEqual({ error: '#NUM!' });
  });
  it('견적서 한글 금액 꼴', () => {
    expect(run('"일금 "&NUMBERSTRING(D11,1)&"원정"', { D11: 138600 })).toBe('일금 일십삼만팔천육백원정');
  });
});
