/**
 * 달력 날짜 계산 — D-day, N일·N개월 뒤, 영업일, 두 날짜 사이.
 *
 * 시각도 시간대도 없이 (년, 월, 일)만 다룬다. `Date` 로 더하고 빼면 서머타임이나
 * 브라우저 시간대 때문에 하루가 23·25시간이 되어 날짜가 하나 밀리는 일이 생긴다.
 * 그래서 안에서는 1970-01-01 부터 센 **날 번호**(정수)로만 계산한다.
 * 변환은 Howard Hinnant 의 days_from_civil 식이다 — 그레고리력 전 구간에서 맞는다.
 *
 * 공휴일은 사람이 적은 목록이 기본이다. 음력 명절·대체공휴일·임시공휴일은 해마다
 * 정해지므로 자동으로 넣지 않는다. 양력으로 고정된 날만 선택으로 넣는다.
 */

export interface CalendarDate { y: number; m: number; d: number }

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

export function isValid(date: CalendarDate): boolean {
  const { y, m, d } = date;
  return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)
    && y >= MIN_YEAR && y <= MAX_YEAR && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** 1970-01-01 = 0 인 날 번호. */
export function toDay(date: CalendarDate): number {
  const y = date.m <= 2 ? date.y - 1 : date.y;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (date.m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + date.d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDay(day: number): CalendarDate {
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** 0 = 일요일 … 6 = 토요일. 1970-01-01 은 목요일이다. */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function isWeekend(day: number): boolean {
  const w = weekday(day);
  return w === 0 || w === 6;
}

/** "2025-02-03", "2025.2.3", "2025/02/03", "20250203". 없는 날(2025-02-30)은 거절한다. */
export function parseDate(text: string): Result<CalendarDate> {
  const s = text.trim().replace(/\.$/, '');
  const match = /^(\d{4})[-./\s]\s*(\d{1,2})[-./\s]\s*(\d{1,2})$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!match) return { ok: false, error: `날짜 모양이 아닙니다: "${text.trim()}" (예: 2025-03-01)` };
  const date = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  if (!isValid(date)) return { ok: false, error: `없는 날짜입니다: ${text.trim()}` };
  return { ok: true, value: date };
}

export function formatDate(date: CalendarDate): string {
  return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
}

/** "2025-03-01 (토)" */
export function formatWithWeekday(day: number): string {
  return `${formatDate(fromDay(day))} (${WEEKDAYS[weekday(day)]})`;
}

// --- D-day ------------------------------------------------------------------------

/** 목표일까지 남은 날로 적는다. 남았으면 D-12, 지났으면 D+3, 같은 날이면 D-Day. */
export function ddayLabel(today: number, target: number): string {
  const diff = target - today;
  if (diff === 0) return 'D-Day';
  return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

/**
 * 시작일부터 오늘까지 지난 날. 기념일 "100일" 은 시작일을 1일로 센다(당일 포함).
 * 시작일이 미래면 음수다.
 */
export function elapsed(start: number, today: number, includeStart: boolean): number {
  const diff = today - start;
  return includeStart && diff >= 0 ? diff + 1 : diff;
}

/** 당일을 1일로 셀 때 N일째가 되는 날. */
export function nthDay(start: number, n: number): number {
  return start + n - 1;
}

// --- 더하기 -----------------------------------------------------------------------

export interface Shifted { day: number; clamped: boolean }

function inRange(day: number): Result<number> {
  const { y } = fromDay(day);
  return y >= MIN_YEAR && y <= MAX_YEAR ? { ok: true, value: day } : { ok: false, error: '1년부터 9999년 사이만 계산합니다.' };
}

/**
 * N개월 뒤. 그 달에 같은 날이 없으면 **말일로 당긴다** — 1월 31일 + 1개월 = 2월 28(29)일.
 * 당겼는지 함께 알려 준다. 계약 기간을 셀 때 하루가 달라지는 자리다.
 */
export function addMonths(date: CalendarDate, months: number): Result<Shifted & { date: CalendarDate }> {
  const index = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  if (y < MIN_YEAR || y > MAX_YEAR) return { ok: false, error: '1년부터 9999년 사이만 계산합니다.' };
  const last = daysInMonth(y, m);
  const d = Math.min(date.d, last);
  const out = { y, m, d };
  return { ok: true, value: { day: toDay(out), date: out, clamped: d !== date.d } };
}

export type Unit = 'day' | 'week' | 'month' | 'year' | 'business';

export const UNIT_NAMES: Record<Unit, string> = {
  day: '일', week: '주', month: '개월', year: '년', business: '영업일',
};

export interface Holidays {
  has(day: number): boolean;
  name(day: number): string | undefined;
}

export const NO_HOLIDAYS: Holidays = { has: () => false, name: () => undefined };

/** 날짜에 N 단위를 더한다(빼려면 음수). 영업일은 주말과 공휴일을 건너뛴다. */
export function shift(date: CalendarDate, amount: number, unit: Unit, holidays: Holidays = NO_HOLIDAYS): Result<Shifted> {
  if (!Number.isInteger(amount)) return { ok: false, error: '정수만 더할 수 있습니다.' };
  if (Math.abs(amount) > 3_650_000) return { ok: false, error: '너무 큰 값입니다.' };
  const start = toDay(date);
  switch (unit) {
    case 'day': {
      const r = inRange(start + amount);
      return r.ok ? { ok: true, value: { day: r.value, clamped: false } } : r;
    }
    case 'week': {
      const r = inRange(start + amount * 7);
      return r.ok ? { ok: true, value: { day: r.value, clamped: false } } : r;
    }
    case 'month': return addMonths(date, amount);
    case 'year': return addMonths(date, amount * 12);
    case 'business': return addBusinessDays(start, amount, holidays);
  }
}

/** 오늘로부터 N 영업일. 시작일 자체는 세지 않는다(+1 = 다음 영업일). 0 이면 그날 그대로. */
export function addBusinessDays(start: number, amount: number, holidays: Holidays): Result<Shifted> {
  if (Math.abs(amount) > 1_000_000) return { ok: false, error: '너무 큰 값입니다.' };
  const step = amount < 0 ? -1 : 1;
  let day = start;
  let left = Math.abs(amount);
  // 공휴일을 몽땅 채워 넣어도 끝나도록 한 번 더 걸러 둔다.
  let guard = left * 7 + 400;
  while (left > 0) {
    day += step;
    if (--guard < 0) return { ok: false, error: '영업일을 찾지 못했습니다. 공휴일 목록을 확인하세요.' };
    if (!isWeekend(day) && !holidays.has(day)) left--;
  }
  const r = inRange(day);
  return r.ok ? { ok: true, value: { day, clamped: false } } : r;
}

// --- 두 날짜 사이 -------------------------------------------------------------------

export interface SpanOptions { includeStart: boolean; includeEnd: boolean }

export interface Span {
  /** 끝이 시작보다 앞이면 뒤집어 셌다는 뜻이다. */
  reversed: boolean;
  /** 센 구간 [first, last] — 비었으면 first > last. */
  first: number;
  last: number;
  calendar: number;
  weekdays: number;
  weekends: number;
  /** 평일에 걸린 공휴일. 주말과 겹친 공휴일은 이미 주말로 빠졌다. */
  holidays: number;
  business: number;
  /** [년, 개월, 일] — 센 구간 전체의 길이. */
  ymd: [number, number, number];
  /** [주, 일] */
  weeks: [number, number];
}

/**
 * 두 날짜 사이를 센다. 기본(시작일 포함·끝나는 날 제외)이면 달력일은 단순한 뺄셈이다.
 * 둘 다 넣으면 1월 1일–12월 31일이 365일, "1년 0개월 0일" 이 된다(계약 기간 방식).
 */
export function between(a: number, b: number, options: SpanOptions, holidays: Holidays = NO_HOLIDAYS): Span {
  const reversed = b < a;
  const [start, end] = reversed ? [b, a] : [a, b];
  const first = start + (options.includeStart ? 0 : 1);
  const last = end - (options.includeEnd ? 0 : 1);
  let weekdays = 0;
  let weekends = 0;
  let off = 0;
  const calendar = Math.max(0, last - first + 1);
  // 하루씩 센다. 9999년 전체도 수백만 번이라 충분히 빠르고, 공휴일 판정이 함수라 건너뛸 수도 없다.
  for (let day = first; day <= last; day++) {
    if (isWeekend(day)) weekends++;
    else {
      weekdays++;
      if (holidays.has(day)) off++;
    }
  }
  return {
    reversed, first, last, calendar, weekdays, weekends,
    holidays: off,
    business: weekdays - off,
    ymd: calendar > 0 ? ymd(first, last + 1) : [0, 0, 0],
    weeks: [Math.floor(calendar / 7), calendar % 7],
  };
}

/** [from, to) 의 길이를 년·개월·일로. 개월은 말일 당김(addMonths)과 같은 규칙이다. */
export function ymd(from: number, to: number): [number, number, number] {
  const a = fromDay(from);
  const b = fromDay(to);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  const landed = (n: number): number => {
    const r = addMonths(a, n);
    return r.ok ? r.value.day : Number.POSITIVE_INFINITY;
  };
  while (months > 0 && landed(months) > to) months--;
  const days = to - (months > 0 ? landed(months) : from);
  return [Math.floor(months / 12), months % 12, days];
}

export function formatYmd([y, m, d]: [number, number, number]): string {
  const parts: string[] = [];
  if (y) parts.push(`${y}년`);
  if (m) parts.push(`${m}개월`);
  if (d || !parts.length) parts.push(`${d}일`);
  return parts.join(' ');
}

// --- 공휴일 -------------------------------------------------------------------------

/** 양력으로 날이 고정된 공휴일. 대체공휴일은 해마다 달라 넣지 않는다. */
export const FIXED_HOLIDAYS: ReadonlyArray<[number, number, string]> = [
  [1, 1, '신정'], [3, 1, '삼일절'], [5, 5, '어린이날'], [6, 6, '현충일'],
  [8, 15, '광복절'], [10, 3, '개천절'], [10, 9, '한글날'], [12, 25, '성탄절'],
];

export interface HolidayList { days: Map<number, string>; errors: string[] }

/**
 * 한 줄에 날짜 하나. `#` 뒤는 주석, 날짜 뒤에 이름을 적어도 된다("2025-10-06 추석").
 * 틀린 줄은 버리지 않고 몇째 줄인지 알린다 — 조용히 빠진 공휴일 하나가 마감일을 바꾼다.
 */
export function parseHolidays(text: string): HolidayList {
  const days = new Map<number, string>();
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const match = /^(\S+)\s*(.*)$/.exec(line)!;
    const parsed = parseDate(match[1]!);
    if (!parsed.ok) { errors.push(`${index + 1}번째 줄: ${parsed.error}`); return; }
    days.set(toDay(parsed.value), match[2]!.trim() || '공휴일');
  });
  return { days, errors };
}

/** 적은 목록과(선택하면) 양력 고정 공휴일을 합친다. 고정 공휴일은 어느 해든 날짜만 보고 안다. */
export function holidaySet(list: Map<number, string>, includeFixed: boolean): Holidays {
  const fixed = (day: number): string | undefined => {
    if (!includeFixed) return undefined;
    const { m, d } = fromDay(day);
    return FIXED_HOLIDAYS.find(([hm, hd]) => hm === m && hd === d)?.[2];
  };
  return {
    has: day => list.has(day) || fixed(day) !== undefined,
    name: day => list.get(day) ?? fixed(day),
  };
}
