import { describe, expect, it } from 'vitest';

import {
  commaBig, formalHangul, formalHanja, MONEY_LIMIT, parseAmount, parseAny, parseKorean,
  toHangul, toHanja, toMixed,
} from './money';

const value = (text: string): bigint => {
  const parsed = parseAmount(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};
const korean = (text: string): bigint | string => {
  const parsed = parseKorean(text);
  return parsed.ok ? parsed.value : `오류: ${parsed.error}`;
};

describe('parseAmount', () => {
  it('쉼표·공백·원·₩ 을 받는다', () => {
    expect(value('12,345,000')).toBe(12345000n);
    expect(value('12345000원')).toBe(12345000n);
    expect(value(' 12 345 000 원 ')).toBe(12345000n);
    expect(value('₩12,345,000')).toBe(12345000n);
    expect(value('0')).toBe(0n);
  });

  it('소수점·음수·다른 글자·빈 값은 이유와 함께 거절한다', () => {
    expect(parseAmount('1.5')).toMatchObject({ ok: false, error: expect.stringContaining('소수점') });
    expect(parseAmount('-100')).toMatchObject({ ok: false, error: expect.stringContaining('음수') });
    expect(parseAmount('12a')).toMatchObject({ ok: false });
    expect(parseAmount('   ')).toMatchObject({ ok: false });
    expect(parseAmount('원')).toMatchObject({ ok: false });
  });

  it('9999경까지 받고 그 위는 거절한다 — Number 로는 끝자리가 틀리는 크기다', () => {
    expect(value('99999999999999999999')).toBe(MONEY_LIMIT - 1n);
    expect(parseAmount('100000000000000000000')).toMatchObject({ ok: false });
    expect(value('9007199254740993')).toBe(9007199254740993n);
  });
});

describe('toHangul', () => {
  const cases: Array<[bigint, string, string]> = [
    [0n, '영', '영'],
    [1n, '일', '일'],
    [10n, '일십', '십'],
    [11n, '일십일', '십일'],
    [100n, '일백', '백'],
    [1000n, '일천', '천'],
    [1500n, '일천오백', '천오백'],
    [10000n, '일만', '만'],
    [10001n, '일만일', '만일'],
    [110000n, '일십일만', '십일만'],
    [12345000n, '일천이백삼십사만오천', '천이백삼십사만오천'],
    [100000000n, '일억', '일억'],
    [100000001n, '일억일', '일억일'],
    [100010000n, '일억일만', '일억만'],
    [120000000n, '일억이천만', '일억이천만'],
    [1000000000000n, '일조', '일조'],
    [10n ** 16n, '일경', '일경'],
    [20304050n, '이천삼십만사천오십', '이천삼십만사천오십'],
  ];
  it.each(cases)('%s → %s / 일 생략 %s', (n, formal, omitted) => {
    expect(toHangul(n)).toBe(formal);
    expect(toHangul(n, { omitOne: true })).toBe(omitted);
  });

  it('가장 큰 값', () => {
    expect(toHangul(MONEY_LIMIT - 1n)).toBe('구천구백구십구경구천구백구십구조구천구백구십구억구천구백구십구만구천구백구십구');
  });

  it('범위 밖은 던진다', () => {
    expect(() => toHangul(-1n)).toThrow();
    expect(() => toHangul(MONEY_LIMIT)).toThrow();
  });

  it('1부터 30만까지 거꾸로 읽으면 제자리로 돌아온다', () => {
    for (let n = 0n; n <= 300000n; n += 17n) {
      expect(parseKorean(toHangul(n))).toEqual({ ok: true, value: n });
      expect(parseKorean(toHangul(n, { omitOne: true }))).toEqual({ ok: true, value: n });
    }
  });

  it('큰 값도 거꾸로 읽으면 제자리다', () => {
    let n = 1n;
    for (let i = 0; i < 200; i++) {
      n = (n * 7919n + 104729n) % MONEY_LIMIT;
      expect(parseKorean(toHangul(n))).toEqual({ ok: true, value: n });
      expect(parseKorean(toHanja(n))).toEqual({ ok: true, value: n });
    }
  });
});

describe('격식 표기', () => {
  it('일금 … 원정 (₩…)', () => {
    expect(formalHangul(12345000n)).toBe('일금 일천이백삼십사만오천원정 (₩12,345,000)');
    expect(formalHangul(12345000n, { omitOne: true })).toBe('일금 천이백삼십사만오천원정 (₩12,345,000)');
    expect(formalHangul(0n)).toBe('일금 영원정 (₩0)');
  });

  it('갖은자는 佰 을 쓰고 壹 을 빼지 않는다', () => {
    expect(formalHanja(12345000n)).toBe('金 壹阡貳佰參拾肆萬伍阡원整');
    expect(toHanja(10000n)).toBe('壹萬');
    expect(toHanja(100000001n)).toBe('壹億壹');
    expect(toHanja(0n)).toBe('零');
    expect(toHanja(6789n)).toBe('陸阡柒佰捌拾玖');
  });
});

describe('toMixed', () => {
  it('네 자리 묶음마다 단위를 붙이고 빈 묶음은 건너뛴다', () => {
    expect(toMixed(12345000n)).toBe('1,234만 5,000원');
    expect(toMixed(100000000n)).toBe('1억원');
    expect(toMixed(350000000n)).toBe('3억 5,000만원');
    expect(toMixed(100000001n)).toBe('1억 1원');
    expect(toMixed(999n)).toBe('999원');
    expect(toMixed(0n)).toBe('0원');
  });
});

describe('commaBig', () => {
  it('BigInt 도 세 자리마다 끊는다', () => {
    expect(commaBig(0n)).toBe('0');
    expect(commaBig(999n)).toBe('999');
    expect(commaBig(1000n)).toBe('1,000');
    expect(commaBig(MONEY_LIMIT - 1n)).toBe('99,999,999,999,999,999,999');
    expect(commaBig(-1234n)).toBe('-1,234');
  });
});

describe('parseKorean', () => {
  it('한글 금액', () => {
    expect(korean('일억이천만')).toBe(120000000n);
    expect(korean('천오백')).toBe(1500n);
    expect(korean('만')).toBe(10000n);
    expect(korean('십만')).toBe(100000n);
    expect(korean('영')).toBe(0n);
    expect(korean('일금 일천이백삼십사만오천원정')).toBe(12345000n);
    expect(korean('金 壹阡貳佰參拾肆萬伍阡원整')).toBe(12345000n);
    expect(korean('일조 삼억')).toBe(1000300000000n);
  });

  it('숫자와 섞인 금액', () => {
    expect(korean('3억 5천만')).toBe(350000000n);
    expect(korean('1,234만 5,000원')).toBe(12345000n);
    expect(korean('3천5백')).toBe(3500n);
    expect(korean('12억')).toBe(1200000000n);
  });

  it('틀린 순서·이어진 숫자·모르는 글자는 거절한다', () => {
    expect(korean('십천')).toMatch(/^오류: 단위 순서/);
    expect(korean('만억')).toMatch(/^오류: 단위 순서/);
    expect(korean('이삼')).toMatch(/^오류: 숫자가 이어졌습니다/);
    expect(korean('일억만')).toMatch(/^오류/);
    expect(korean('3 5만')).toMatch(/^오류/);
    expect(korean('일억abc')).toMatch(/^오류: 읽을 수 없는 글자/);
    expect(korean('1.5억')).toMatch(/소수점/);
    expect(korean('원')).toMatch(/^오류/);
  });

  it('범위를 넘으면 거절한다', () => {
    expect(korean('만경')).toMatch(/^오류/);
  });
});

describe('parseAny', () => {
  it('글자를 보고 고른다', () => {
    expect(parseAny('12,345,000')).toEqual({ ok: true, value: 12345000n, korean: false });
    expect(parseAny('3억 5천만')).toEqual({ ok: true, value: 350000000n, korean: true });
    expect(parseAny('12345원')).toMatchObject({ korean: false, value: 12345n });
  });
});
