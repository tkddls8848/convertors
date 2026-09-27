import { describe, expect, it } from 'vitest';

import {
  batchCsv, businessCheckDigit, businessType, checkMany, checkNumber, corporationCheckDigit,
  formatNumber, splitNumbers,
} from './bizno';

describe('사업자등록번호', () => {
  it('실제 번호들이 검증을 통과한다', () => {
    // 공개된 실제 번호들(삼성전자 124-81-00998 등). 검증 숫자는 따로 손으로 계산해 맞춰 보았다.
    for (const n of ['124-81-00998', '220-81-62517', '120-81-47521']) {
      expect(checkNumber(n), n).toMatchObject({ valid: true, kind: 'business' });
    }
  });

  it('검증 숫자를 따로 계산해도 같다', () => {
    expect(businessCheckDigit('1248100998')).toBe(8);
    expect(businessCheckDigit('1234567890')).toBe(1);
    expect(businessCheckDigit('1019098760')).toBe(8);
    expect(businessCheckDigit('0000000000')).toBe(0);
  });

  it('끝자리가 틀리면 무엇이어야 하는지 알린다', () => {
    const result = checkNumber('124-81-00990');
    expect(result).toMatchObject({ valid: false, kind: 'business', normalized: '124-81-00990' });
    expect(result.reason).toContain('8');
  });

  it('한 자리를 바꾸면 거의 언제나 잡는다 — 끝자리 앞 아홉 자리 각각', () => {
    const good = '1248100998';
    let caught = 0;
    let total = 0;
    for (let i = 0; i < 9; i++) {
      for (let v = 0; v <= 9; v++) {
        if (String(v) === good[i]) continue;
        total++;
        if (!checkNumber(good.slice(0, i) + v + good.slice(i + 1)).valid) caught++;
      }
    }
    // 가중치 1·3·7 은 10 과 서로소라 한 자리 오타는 모두 잡힌다. 9째 자리만 ×5 라 일부가 샌다.
    expect(caught / total).toBeGreaterThan(0.9);
  });

  it('가운데 두 자리로 갈래를 짐작한다', () => {
    expect(businessType('1234567890')).toBe('개인 과세사업자');
    expect(businessType('1248100998')).toBe('영리법인 본점');
    expect(businessType('1238200000')).toBe('비영리법인');
    expect(businessType('1238500000')).toBe('영리법인 지점');
    expect(businessType('1239000000')).toBe('개인 면세사업자');
    expect(businessType('1230000000')).toBe('알 수 없는 구분');
    expect(checkNumber('124-81-00998').note).toContain('참고: 영리법인 본점');
  });
});

describe('법인등록번호', () => {
  it('실제 번호가 통과한다', () => {
    // 삼성전자 130111-0006246
    expect(checkNumber('130111-0006246')).toMatchObject({ valid: true, kind: 'corporation', normalized: '130111-0006246' });
    expect(corporationCheckDigit('1301110006246')).toBe(6);
    expect(checkNumber('1101114138560').valid).toBe(true);
  });
  it('틀린 끝자리', () => {
    expect(checkNumber('130111-0006245')).toMatchObject({ valid: false, reason: expect.stringContaining('6') });
  });
  it('등기관서·법인 종류를 참고로 적는다', () => {
    expect(checkNumber('130111-0006246').note).toBe('참고: 등기관서 1301 · 법인 종류 11(주식회사)');
    // 모르는 종류는 번호만
    expect(checkNumber('110199-0000000').note).toMatch(/법인 종류 99$/);
  });
});

describe('입력 다루기', () => {
  it('자릿수·글자 오류', () => {
    expect(checkNumber('12345')).toMatchObject({ valid: false, kind: null, reason: expect.stringContaining('5자리') });
    expect(checkNumber('124-81-0099O')).toMatchObject({ valid: false, reason: expect.stringContaining('숫자가 아닌') });
  });
  it('가름표를 여러 가지로 받는다', () => {
    expect(checkNumber('124.81.00998').valid).toBe(true);
    expect(checkNumber(' 1248100998 ').normalized).toBe('124-81-00998');
    expect(checkNumber('124 81 00998').valid).toBe(true);
  });
  it('formatNumber', () => {
    expect(formatNumber('1248100998')).toBe('124-81-00998');
    expect(formatNumber('1301110006246')).toBe('130111-0006246');
    expect(formatNumber('123')).toBe('123');
  });
  it('splitNumbers — 줄·쉼표·세미콜론·탭·공백', () => {
    expect(splitNumbers('124-81-00998\n220-81-62517, 120-81-47521;1234567890\t130111-0006246')).toEqual([
      '124-81-00998', '220-81-62517', '120-81-47521', '1234567890', '130111-0006246',
    ]);
    expect(splitNumbers('124 81 00998')).toEqual(['124 81 00998']);
    expect(splitNumbers('1248100998 2208162517')).toEqual(['1248100998', '2208162517']);
    expect(splitNumbers('\n\n  ,, \n')).toEqual([]);
  });
  it('checkMany 가 센다', () => {
    const batch = checkMany('124-81-00998\n124-81-00990\n12345\n130111-0006246');
    expect([batch.checks.length, batch.valid, batch.invalid]).toEqual([4, 2, 2]);
  });
  it('CSV — BOM, 수식 막기, 따옴표', () => {
    const csv = batchCsv(checkMany('=1+1\n124-81-00998').checks);
    expect(csv.startsWith('﻿입력,정규화,종류,결과,이유,참고\r\n')).toBe(true);
    expect(csv).toContain(`'=1+1,`);
    expect(csv).toContain('124-81-00998,124-81-00998,사업자등록번호,맞음,검증 숫자 일치,참고: 영리법인 본점 (가운데 81)\r\n');
  });
});
