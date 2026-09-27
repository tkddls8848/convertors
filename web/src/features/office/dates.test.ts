import { describe, expect, it } from 'vitest';

import {
  addBusinessDays, addMonths, between, daysInMonth, ddayLabel, elapsed, formatDate, formatWithWeekday,
  formatYmd, fromDay, holidaySet, isLeap, nthDay, parseDate, parseHolidays, shift, toDay, weekday,
  type CalendarDate,
} from './dates';

const date = (text: string): CalendarDate => {
  const parsed = parseDate(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};
const day = (text: string): number => toDay(date(text));
const show = (n: number): string => formatDate(fromDay(n));

describe('날 번호', () => {
  it('1970-01-01 은 0, 목요일', () => {
    expect(day('1970-01-01')).toBe(0);
    expect(weekday(0)).toBe(4);
  });
  it('Date.UTC 와 같은 번호를 낸다', () => {
    for (const text of ['1900-03-01', '2000-02-29', '2024-12-31', '2025-01-01', '1600-01-01', '9999-12-31', '0001-01-01']) {
      const { y, m, d } = date(text);
      const utc = new Date(0);
      utc.setUTCFullYear(y, m - 1, d);
      expect(toDay({ y, m, d })).toBe(Math.round(utc.getTime() / 86400000));
    }
  });
  it('오가면 제자리다', () => {
    for (let n = -800000; n < 3000000; n += 997) expect(toDay(fromDay(n))).toBe(n);
  });
  it('요일', () => {
    expect(formatWithWeekday(day('2025-03-01'))).toBe('2025-03-01 (토)');
    expect(formatWithWeekday(day('2024-02-29'))).toBe('2024-02-29 (목)');
    expect(formatWithWeekday(day('2026-09-24'))).toBe('2026-09-24 (목)');
  });
});

describe('윤년·말일', () => {
  it('윤년 규칙', () => {
    expect([1900, 2000, 2024, 2025, 2100].map(isLeap)).toEqual([false, true, true, false, false]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
  });
});

describe('parseDate', () => {
  it('여러 모양을 받는다', () => {
    expect(date('2025-3-1')).toEqual({ y: 2025, m: 3, d: 1 });
    expect(date('2025.03.01.')).toEqual({ y: 2025, m: 3, d: 1 });
    expect(date('2025/03/01')).toEqual({ y: 2025, m: 3, d: 1 });
    expect(date('20250301')).toEqual({ y: 2025, m: 3, d: 1 });
  });
  it('없는 날·모양이 틀린 값은 거절한다', () => {
    for (const bad of ['2025-02-30', '2025-02-29', '2100-02-29', '2025-13-01', '2025-00-10', '2025-04-31', '0000-01-01', '25-03-01', 'abc', '']) {
      expect(parseDate(bad).ok, bad).toBe(false);
    }
    expect(parseDate('2024-02-29').ok).toBe(true);
    expect(parseDate('2000-02-29').ok).toBe(true);
  });
});

describe('D-day', () => {
  const today = day('2026-09-24');
  it('남으면 D-, 지나면 D+, 같은 날 D-Day', () => {
    expect(ddayLabel(today, day('2026-10-06'))).toBe('D-12');
    expect(ddayLabel(today, day('2026-09-21'))).toBe('D+3');
    expect(ddayLabel(today, today)).toBe('D-Day');
    expect(ddayLabel(today, day('2027-09-24'))).toBe('D-365');
  });
  it('지난 날 — 당일 포함이면 하나 더', () => {
    const start = day('2026-06-17');
    expect(elapsed(start, today, false)).toBe(99);
    expect(elapsed(start, today, true)).toBe(100);
    expect(elapsed(today + 5, today, true)).toBe(-5);
  });
  it('기념일 100일째', () => {
    expect(show(nthDay(day('2026-06-17'), 100))).toBe('2026-09-24');
    expect(show(nthDay(day('2025-01-01'), 1))).toBe('2025-01-01');
  });
});

describe('더하기', () => {
  it('일·주', () => {
    const r = shift(date('2024-02-28'), 1, 'day');
    expect(r.ok && show(r.value.day)).toBe('2024-02-29');
    const w = shift(date('2025-12-25'), 2, 'week');
    expect(w.ok && show(w.value.day)).toBe('2026-01-08');
    const back = shift(date('2025-03-01'), -1, 'day');
    expect(back.ok && show(back.value.day)).toBe('2025-02-28');
  });
  it('개월 — 말일로 당기고 그렇다고 알린다', () => {
    const cases: Array<[string, number, string, boolean]> = [
      ['2025-01-31', 1, '2025-02-28', true],
      ['2024-01-31', 1, '2024-02-29', true],
      ['2025-01-30', 1, '2025-02-28', true],
      ['2025-01-15', 1, '2025-02-15', false],
      ['2025-03-31', -1, '2025-02-28', true],
      ['2025-08-31', 1, '2025-09-30', true],
      ['2025-11-30', 3, '2026-02-28', true],
      ['2025-01-31', 12, '2026-01-31', false],
      ['2025-05-10', -17, '2023-12-10', false],
    ];
    for (const [from, n, to, clamped] of cases) {
      const r = addMonths(date(from), n);
      expect(r.ok && [formatDate(r.value.date), r.value.clamped], `${from} + ${n}`).toEqual([to, clamped]);
    }
  });
  it('년 — 2월 29일은 평년에 28일로', () => {
    const r = shift(date('2024-02-29'), 1, 'year');
    expect(r.ok && [show(r.value.day), r.value.clamped]).toEqual(['2025-02-28', true]);
    const r4 = shift(date('2024-02-29'), 4, 'year');
    expect(r4.ok && [show(r4.value.day), r4.value.clamped]).toEqual(['2028-02-29', false]);
  });
  it('범위 밖·정수 아님은 거절', () => {
    expect(shift(date('9999-12-31'), 1, 'day').ok).toBe(false);
    expect(shift(date('9999-12-31'), 1, 'month').ok).toBe(false);
    expect(shift(date('2025-01-01'), 1.5, 'day').ok).toBe(false);
  });
});

describe('영업일', () => {
  const holidays = holidaySet(parseHolidays('2025-10-06 추석\n2025-10-07 # 추석 연휴\n2025-10-08').days, true);
  it('주말을 건너뛴다', () => {
    // 2025-09-26 금요일 + 1 영업일 = 29일 월요일
    const r = addBusinessDays(day('2025-09-26'), 1, holidays);
    expect(r.ok && formatWithWeekday(r.value.day)).toBe('2025-09-29 (월)');
    const five = addBusinessDays(day('2025-09-22'), 5, holidays);
    expect(five.ok && show(five.value.day)).toBe('2025-09-29');
  });
  it('공휴일(적은 것과 양력 고정)을 건너뛴다', () => {
    // 10/2(목) 다음: 3 개천절, 4·5 주말, 6·7·8 추석, 9 한글날 → 10일(금)
    const r = addBusinessDays(day('2025-10-02'), 1, holidays);
    expect(r.ok && formatWithWeekday(r.value.day)).toBe('2025-10-10 (금)');
  });
  it('뒤로도 센다', () => {
    const r = addBusinessDays(day('2025-10-10'), -1, holidays);
    expect(r.ok && show(r.value.day)).toBe('2025-10-02');
  });
  it('0 이면 그날', () => {
    const r = addBusinessDays(day('2025-10-04'), 0, holidays);
    expect(r.ok && show(r.value.day)).toBe('2025-10-04');
  });
  it('shift 로도 부른다', () => {
    const r = shift(date('2025-12-24'), 1, 'business', holidays);
    expect(r.ok && show(r.value.day)).toBe('2025-12-26');
  });
});

describe('between', () => {
  const both = { includeStart: true, includeEnd: true };
  const startOnly = { includeStart: true, includeEnd: false };
  const neither = { includeStart: false, includeEnd: false };

  it('기본은 뺄셈', () => {
    const s = between(day('2025-01-01'), day('2025-01-31'), startOnly);
    expect(s.calendar).toBe(30);
  });
  it('양 끝 포함·제외', () => {
    expect(between(day('2025-01-01'), day('2025-01-31'), both).calendar).toBe(31);
    expect(between(day('2025-01-01'), day('2025-01-31'), neither).calendar).toBe(29);
    expect(between(day('2025-01-01'), day('2025-01-01'), both).calendar).toBe(1);
    expect(between(day('2025-01-01'), day('2025-01-01'), startOnly).calendar).toBe(0);
    expect(between(day('2025-01-01'), day('2025-01-02'), neither).calendar).toBe(0);
  });
  it('평일·주말·공휴일·영업일', () => {
    // 2025-09-29(월) – 2025-10-12(일), 14일: 평일 10, 주말 4
    const holidays = holidaySet(parseHolidays('2025-10-06\n2025-10-07\n2025-10-08\n2025-10-04 # 토요일과 겹침').days, true);
    const s = between(day('2025-09-29'), day('2025-10-12'), both, holidays);
    expect([s.calendar, s.weekdays, s.weekends]).toEqual([14, 10, 4]);
    // 평일 공휴일: 3 개천절, 6·7·8, 9 한글날 = 5
    expect([s.holidays, s.business]).toEqual([5, 5]);
    const plain = between(day('2025-09-29'), day('2025-10-12'), both);
    expect([plain.holidays, plain.business]).toEqual([0, 10]);
  });
  it('뒤집힌 순서는 뒤집어 세고 알린다', () => {
    const s = between(day('2025-01-31'), day('2025-01-01'), startOnly);
    expect([s.reversed, s.calendar]).toEqual([true, 30]);
  });
  it('년·개월·일', () => {
    expect(formatYmd(between(day('2025-01-01'), day('2025-12-31'), both).ymd)).toBe('1년');
    expect(formatYmd(between(day('2024-01-15'), day('2025-03-18'), startOnly).ymd)).toBe('1년 2개월 3일');
    expect(formatYmd(between(day('2025-01-31'), day('2025-03-01'), startOnly).ymd)).toBe('1개월 1일');
    expect(formatYmd(between(day('2025-03-01'), day('2025-03-01'), startOnly).ymd)).toBe('0일');
    expect(between(day('2025-01-01'), day('2025-01-16'), startOnly).weeks).toEqual([2, 1]);
  });
});

describe('parseHolidays', () => {
  it('주석·이름·빈 줄을 받고 틀린 줄은 번호로 알린다', () => {
    const list = parseHolidays('# 2025 연휴\n2025-10-06 추석\n\n2025-02-30\n2025.10.07 # 연휴\nabc');
    expect([...list.days.entries()].map(([n, name]) => [show(n), name])).toEqual([
      ['2025-10-06', '추석'], ['2025-10-07', '공휴일'],
    ]);
    expect(list.errors).toEqual([expect.stringMatching(/^4번째 줄/), expect.stringMatching(/^6번째 줄/)]);
  });
  it('양력 고정 공휴일은 선택할 때만', () => {
    const on = holidaySet(new Map(), true);
    const off = holidaySet(new Map(), false);
    expect(on.name(day('2031-08-15'))).toBe('광복절');
    expect(off.has(day('2031-08-15'))).toBe(false);
    expect(on.has(day('2031-08-16'))).toBe(false);
  });
});
