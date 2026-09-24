import { describe, expect, it } from 'vitest';

import { luhn, redact, REDACT_KINDS, type MaskStyle, type RedactKind } from './redact';

const ALL: RedactKind[] = REDACT_KINDS.map(item => item.kind);
const DEFAULT: RedactKind[] = REDACT_KINDS.filter(item => item.defaultOn).map(item => item.kind);
const run = (text: string, kinds: RedactKind[] = DEFAULT, style: MaskStyle = 'partial') => redact(text, { kinds, style });
const kindsOf = (text: string, kinds: RedactKind[] = ALL): RedactKind[] => run(text, kinds).findings.map(item => item.kind);

describe('주민등록번호', () => {
  it('붙임표·공백·붙여 쓴 것을 모두 찾고 뒷자리 첫 숫자만 남긴다', () => {
    expect(run('주민번호: 900101-1234567').text).toBe('주민번호: 900101-1******');
    expect(run('900101 2234567').text).toBe('900101 2******');
    expect(run('9001011234567').text).toBe('9001011******');
  });
  it('외국인등록번호(5–8)와 검증식을 따르지 않는 2020년 뒤 번호도 찾는다', () => {
    expect(kindsOf('211231-5000001')).toEqual(['rrn']);
    expect(kindsOf('201015-3999990')).toEqual(['rrn']);
  });
  it('날짜가 아니거나 뒷자리 첫 숫자가 0·9 면 아니다', () => {
    expect(kindsOf('901301-1234567')).toEqual([]);
    expect(kindsOf('900230-1234567')).toEqual([]);
    expect(kindsOf('900101-9234567')).toEqual([]);
  });
  it('더 긴 숫자 덩이의 일부는 잡지 않는다', () => {
    expect(kindsOf('12900101-1234567')).toEqual([]);
    expect(kindsOf('900101-12345678')).toEqual([]);
  });
});

describe('전화번호', () => {
  it('휴대전화·서울·지역·070·안심번호·대표번호', () => {
    expect(run('010-1234-5678').text).toBe('010-****-5678');
    expect(run('01012345678').text).toBe('010****5678');
    expect(run('02.123.4567').text).toBe('02.***.4567');
    expect(run('031 123 4567').text).toBe('031 *** 4567');
    expect(kindsOf('070-1234-5678')).toEqual(['phone']);
    expect(kindsOf('0505-123-4567')).toEqual(['phone']);
    expect(run('1588-1234').text).toBe('1588-****');
  });
  it('구분자가 섞이면 아니다. 날짜·금액·주문번호도 아니다', () => {
    expect(kindsOf('010-1234.5678')).toEqual([]);
    expect(kindsOf('2024-01-01')).toEqual([]);
    expect(kindsOf('2024.01.01 15:30')).toEqual([]);
    expect(kindsOf('1,234,567원')).toEqual([]);
    expect(kindsOf('주문번호 20240101-000123')).toEqual([]);
    expect(kindsOf('15881234')).toEqual([]);
  });
});

describe('이메일', () => {
  it('앞 두 글자만 남긴다', () => {
    expect(run('문의: abcde@example.com.').text).toBe('문의: ab***@example.com.');
    expect(run('a@b.co.kr').text).toBe('*@b.co.kr');
  });
  it('전부 가리기는 점만 남긴다', () => {
    expect(run('ab@ex.com', DEFAULT, 'full').text).toBe('**@**.***');
  });
});

describe('카드번호', () => {
  it('Luhn 이 맞으면 앞 4·뒤 4 만 남긴다', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(run('4111-1111-1111-1111').text).toBe('4111-****-****-1111');
    expect(run('5500 0000 0000 0004').text).toBe('5500 **** **** 0004');
    expect(run('3782-822463-10005').text).toBe('3782-******-*0005');
    expect(run('4111111111111111').text).toBe('4111********1111');
  });
  it('Luhn 이 틀리면 아니다 — 주문번호·송장번호', () => {
    expect(kindsOf('4111-1111-1111-1112')).toEqual([]);
    expect(kindsOf('주문 1234567890123456')).toEqual([]);
  });
});

describe('계좌번호 (기본 꺼짐)', () => {
  it('켜야 찾는다', () => {
    expect(kindsOf('123-456789-01-234', DEFAULT)).toEqual([]);
    expect(run('입금: 123-456789-01-234', ['account']).text).toBe('입금: 123-******-**-***');
    expect(kindsOf('110-123-456789', ['account'])).toEqual(['account']);
  });
  it('날짜·사업자번호·전화는 계좌가 아니다', () => {
    expect(kindsOf('2024-01-15-12345', ['account'])).toEqual([]);
    expect(kindsOf('123-45-67890', ['account'])).toEqual([]);
    expect(kindsOf('010-1234-5678', ['account'])).toEqual([]);
    expect(kindsOf('12-34-56', ['account'])).toEqual([]);
  });
});

describe('여권번호 (기본 꺼짐)', () => {
  it('옛 모양과 새 모양', () => {
    expect(run('M12345678', ['passport']).text).toBe('M123*****');
    expect(kindsOf('M123A4567', ['passport'])).toEqual(['passport']);
    expect(kindsOf('M12345678', DEFAULT)).toEqual([]);
  });
  it('더 긴 영숫자의 일부나 다른 첫 글자는 아니다', () => {
    expect(kindsOf('XM12345678', ['passport'])).toEqual([]);
    expect(kindsOf('A12345678', ['passport'])).toEqual([]);
  });
});

describe('redact', () => {
  it('표시로 바꾸기와 줄 번호, 종류별 수', () => {
    const result = run('이름 홍길동\n전화 010-1234-5678\n메일 hong@example.com, 010-9876-5432', DEFAULT, 'tag');
    expect(result.text).toBe('이름 홍길동\n전화 [전화번호]\n메일 [이메일], [전화번호]');
    expect(result.findings.map(item => [item.kind, item.line])).toEqual([['phone', 2], ['email', 3], ['phone', 3]]);
    expect(result.counts).toMatchObject({ phone: 2, email: 1, rrn: 0 });
  });
  it('전부 가리기는 구분자를 남긴다', () => {
    expect(run('900101-1234567', DEFAULT, 'full').text).toBe('******-*******');
  });
  it('끈 종류는 건드리지 않는다', () => {
    expect(run('010-1234-5678', ['email']).text).toBe('010-1234-5678');
  });
});
