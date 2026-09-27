import { describe, expect, it } from 'vitest';

import {
  divide, fromSupply, fromTax, fromTotal, guardCell, itemTable, parseRate, parseWon,
  rateLabel, tableRows, toCsv, toTsv, VAT_LIMIT, type Rounding,
} from './vat';

const TEN = 1000n;
const ROUNDINGS: Rounding[] = ['floor', 'round', 'ceil'];

describe('divide', () => {
  it('버림·반올림·올림', () => {
    expect([divide(14n, 10n, 'floor'), divide(14n, 10n, 'round'), divide(14n, 10n, 'ceil')]).toEqual([1n, 1n, 2n]);
    expect([divide(15n, 10n, 'floor'), divide(15n, 10n, 'round'), divide(15n, 10n, 'ceil')]).toEqual([1n, 2n, 2n]);
    expect([divide(20n, 10n, 'floor'), divide(20n, 10n, 'round'), divide(20n, 10n, 'ceil')]).toEqual([2n, 2n, 2n]);
  });
  it('음수·0 으로 나누기는 던진다', () => {
    expect(() => divide(1n, 0n, 'floor')).toThrow();
    expect(() => divide(-1n, 10n, 'floor')).toThrow();
  });
});

describe('parseRate', () => {
  it('정수·소수·% 를 받는다', () => {
    expect(parseRate('10')).toEqual({ ok: true, value: 1000n });
    expect(parseRate('10%')).toEqual({ ok: true, value: 1000n });
    expect(parseRate('0')).toEqual({ ok: true, value: 0n });
    expect(parseRate('5.5')).toEqual({ ok: true, value: 550n });
    expect(parseRate('0.01')).toEqual({ ok: true, value: 1n });
    expect(parseRate('100')).toEqual({ ok: true, value: 10000n });
  });
  it('범위 밖·모양이 틀린 값은 거절한다', () => {
    for (const bad of ['', '-1', '100.01', '101', 'abc', '1.234', '10%%']) expect(parseRate(bad).ok).toBe(false);
  });
  it('rateLabel 은 되돌려 적는다', () => {
    expect(rateLabel(1000n)).toBe('10%');
    expect(rateLabel(550n)).toBe('5.5%');
    expect(rateLabel(0n)).toBe('0%');
    expect(rateLabel(1n)).toBe('0.01%');
  });
});

describe('parseWon', () => {
  it('쉼표·원을 받고 상한을 지킨다', () => {
    expect(parseWon('1,100,000원')).toEqual({ ok: true, value: 1100000n });
    expect(parseWon(String(VAT_LIMIT)).ok).toBe(false);
    expect(parseWon('1.5').ok).toBe(false);
  });
});

describe('fromSupply', () => {
  it('10% 기본', () => {
    expect(fromSupply(1000000n, TEN, 'floor')).toEqual({ supply: 1000000n, tax: 100000n, total: 1100000n });
  });
  it('끝자리 처리 방식이 세액에 먹는다', () => {
    expect(fromSupply(12345n, TEN, 'floor').tax).toBe(1234n);
    expect(fromSupply(12345n, TEN, 'round').tax).toBe(1235n);
    expect(fromSupply(12344n, TEN, 'round').tax).toBe(1234n);
    expect(fromSupply(12341n, TEN, 'ceil').tax).toBe(1235n);
  });
  it('영세율', () => {
    expect(fromSupply(5000n, 0n, 'ceil')).toEqual({ supply: 5000n, tax: 0n, total: 5000n });
  });
  it('Number 로는 틀리는 큰 값', () => {
    const supply = 123456789012345678n;
    expect(fromSupply(supply, TEN, 'floor')).toEqual({ supply, tax: 12345678901234567n, total: 135802467913580245n });
  });
});

describe('fromTotal', () => {
  it('11,000 → 10,000 + 1,000', () => {
    expect(fromTotal(11000n, TEN, 'floor')).toEqual({ supply: 10000n, tax: 1000n, total: 11000n });
  });
  it('나누어떨어지지 않을 때 끝자리 방식이 공급가액에 먹는다', () => {
    // 10000 / 1.1 = 9090.909…
    expect(fromTotal(10000n, TEN, 'floor')).toEqual({ supply: 9090n, tax: 910n, total: 10000n });
    expect(fromTotal(10000n, TEN, 'round')).toEqual({ supply: 9091n, tax: 909n, total: 10000n });
    expect(fromTotal(10000n, TEN, 'ceil')).toEqual({ supply: 9091n, tax: 909n, total: 10000n });
  });
  it('공급가액 + 세액 = 합계 가 언제나 맞는다', () => {
    const broken: string[] = [];
    for (const rounding of ROUNDINGS) {
      for (const rate of [0n, 1n, 300n, 550n, TEN, 3333n, 10000n]) {
        for (let total = 0n; total < 3000n; total += 1n) {
          const result = fromTotal(total, rate, rounding);
          if (result.supply + result.tax !== total || result.tax < 0n || result.supply < 0n) broken.push(`${rounding} ${rate} ${total}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
  it('큰 값에서도 맞는다', () => {
    let total = 1n;
    for (let i = 0; i < 500; i++) {
      total = (total * 6364136223846793005n + 1442695040888963407n) % VAT_LIMIT;
      const result = fromTotal(total, TEN, 'round');
      expect(result.supply + result.tax).toBe(total);
      // 공급가액의 10% 와 세액은 1원 넘게 벌어지지 않는다.
      const diff = result.tax * 10n - result.supply;
      expect(diff > -11n && diff < 11n).toBe(true);
    }
  });
  it('영세율이면 공급가액이 합계다', () => {
    expect(fromTotal(12345n, 0n, 'floor')).toEqual({ supply: 12345n, tax: 0n, total: 12345n });
  });
});

describe('fromTax', () => {
  it('세액 → 공급가액·합계', () => {
    expect(fromTax(1000n, TEN, 'floor')).toEqual({ ok: true, value: { supply: 10000n, tax: 1000n, total: 11000n } });
  });
  it('세율 0 은 거절한다', () => {
    expect(fromTax(1000n, 0n, 'floor').ok).toBe(false);
  });
  it('되짚어 낸 세액이 다르면 알려 준다', () => {
    // 3% 에서 세액 1원 → 공급가액 33(버림) → 다시 세액 0.99 → 0
    const result = fromTax(1n, 300n, 'floor');
    expect(result).toEqual({ ok: true, value: { supply: 33n, tax: 1n, total: 34n, mismatch: 0n } });
  });
});

describe('itemTable', () => {
  const rows = [
    { name: '노트북', qty: '3', price: '1,250,000' },
    { name: '', qty: '', price: '' },
    { name: '', qty: '1', price: ' ' },
    { name: '모니터', qty: '2', price: '333,333' },
    { name: '마우스', qty: '1.5', price: '10000' },
  ];
  it('줄마다 수량 × 단가, 세액은 합계에 한 번', () => {
    const table = itemTable(rows, TEN, 'floor');
    expect(table.rows.map(row => row.amount)).toEqual([3750000n, 666666n]);
    expect(table.rows.map(row => row.index)).toEqual([0, 3]);
    expect(table.supply).toBe(4416666n);
    expect(table.tax).toBe(441666n);
    expect(table.total).toBe(4858332n);
    expect(table.errors).toEqual([{ index: 4, error: expect.stringContaining('수량') }]);
  });
  it('빈 표는 0', () => {
    expect(itemTable([], TEN, 'floor')).toMatchObject({ supply: 0n, tax: 0n, total: 0n, rows: [], errors: [] });
  });
  it('너무 큰 합계는 계산하지 않는다', () => {
    const table = itemTable([
      { name: 'a', qty: '1000000000', price: '999999999999999999' },
    ], TEN, 'floor');
    expect(table.errors[0]?.index).toBe(-1);
    expect(table.total).toBe(0n);
  });
  it('CSV·TSV 로 내보낸다 — 수식처럼 보이는 이름은 막는다', () => {
    const table = itemTable([
      { name: '=HYPERLINK("x")', qty: '1', price: '100' },
      { name: '케이블, 2m', qty: '2', price: '50' },
    ], TEN, 'floor');
    const grid = tableRows(table, '10%');
    const csv = toCsv(grid);
    expect(csv.startsWith('﻿품목,수량,단가,공급가액\r\n')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")",1,100,100\r\n`);
    expect(csv).toContain('"케이블, 2m",2,50,100\r\n');
    expect(csv).toContain('세액 (10%),,,20\r\n');
    expect(csv).toContain('합계,,,220\r\n');
    const tsv = toTsv(grid);
    expect(tsv.split('\n')[1]).toBe(`'=HYPERLINK("x")\t1\t100\t100`);
  });
  it('guardCell', () => {
    expect(guardCell('-3')).toBe(`'-3`);
    expect(guardCell('+1')).toBe(`'+1`);
    expect(guardCell('@a')).toBe(`'@a`);
    expect(guardCell('정상')).toBe('정상');
  });
});
