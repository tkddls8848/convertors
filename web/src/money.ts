/**
 * 금액을 한글·한자(갖은자)·숫자 혼용으로 적고, 한글로 적힌 금액을 다시 숫자로 읽는다.
 *
 * 계약서·견적서의 "일금 … 원정" 은 위조를 막으려고 적는다. 그래서 기본값은
 * 십·백·천 앞의 "일" 을 **빼지 않는다**(일천, 일백, 일십) — "천" 앞에 "일" 을 덧붙여
 * 금액을 부풀리는 일을 막는 관행이다. 빼는 쪽은 선택이다.
 *
 * 값은 BigInt 로 다룬다. 9999경(10^20 - 1)까지 받는데 Number 는 2^53 을 넘으면
 * 끝자리가 조용히 바뀐다 — 금액에서 가장 나쁜 실패다.
 */

/** 받는 가장 큰 값 + 1. 경 다음 단위(해)는 쓰는 곳이 없어 두지 않는다. */
export const MONEY_LIMIT = 10n ** 20n;

export type Parsed = { ok: true; value: bigint } | { ok: false; error: string };

const HANGUL_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const HANGUL_SMALL = ['', '십', '백', '천'];
const HANGUL_BIG = ['', '만', '억', '조', '경'];

// 갖은자. 一二三 은 획 하나로 고칠 수 있어 계약서에는 갖은자를 쓴다.
const HANJA_DIGITS = ['', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
const HANJA_SMALL = ['', '拾', '佰', '阡'];
const HANJA_BIG = ['', '萬', '億', '兆', '京'];

/**
 * 숫자로 적힌 금액을 읽는다. 쉼표·공백·₩·끝의 "원" 을 받는다.
 * 소수점은 받지 않는다 — 원 미만을 어떻게 할지(버림·반올림)는 이 도구가 정할 일이 아니다.
 */
export function parseAmount(text: string): Parsed {
  let s = text.trim();
  if (!s) return { ok: false, error: '금액을 적어 주세요.' };
  s = s.replace(/^[₩￦\\]\s*/, '').replace(/\s*원\s*정?$/, '').trim();
  if (/^[-−]/.test(s)) return { ok: false, error: '음수는 적을 수 없습니다.' };
  if (/[.．]/.test(s)) return { ok: false, error: '소수점은 받지 않습니다. 원 단위 정수로 적어 주세요.' };
  const digits = s.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(digits)) return { ok: false, error: '숫자·쉼표·공백과 끝의 "원" 만 적을 수 있습니다.' };
  const value = BigInt(digits);
  if (value >= MONEY_LIMIT) return { ok: false, error: '9999경(20자리)까지만 적을 수 있습니다.' };
  return { ok: true, value };
}

/** 뒤에서부터 네 자리씩 끊는다. [일의 자리 묶음, 만 묶음, 억 묶음, …] */
function groups(value: bigint): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest > 0n) {
    out.push(Number(rest % 10000n));
    rest /= 10000n;
  }
  return out;
}

function spell(value: bigint, digits: string[], small: string[], big: string[], omitOne: boolean): string {
  const parts: string[] = [];
  groups(value).forEach((group, index) => {
    // 0000 묶음은 단위째 건너뛴다 — 1억은 "일억만" 이 아니라 "일억" 이다.
    if (group === 0) return;
    // "만" 하나는 흔히 "일" 없이 읽지만 억·조·경 앞의 "일" 은 빼지 않는다.
    if (omitOne && group === 1 && index === 1) { parts.unshift(big[index]!); return; }
    let text = '';
    for (let place = 3; place >= 0; place--) {
      const digit = Math.floor(group / 10 ** place) % 10;
      if (digit === 0) continue;
      const one = digit === 1 && place > 0 && omitOne;
      text += (one ? '' : digits[digit]!) + small[place]!;
    }
    parts.unshift(text + big[index]!);
  });
  return parts.join('');
}

export interface SpellOptions {
  /** 십·백·천 앞의 "일" 과 "일만" 의 "일" 을 뺀다. 계약서에는 권하지 않는다. */
  omitOne?: boolean;
}

/** 12345000 → "일천이백삼십사만오천". 0 → "영". */
export function toHangul(value: bigint, options: SpellOptions = {}): string {
  check(value);
  if (value === 0n) return '영';
  return spell(value, HANGUL_DIGITS, HANGUL_SMALL, HANGUL_BIG, options.omitOne ?? false);
}

/** 갖은자. "일" 은 언제나 쓴다(壹阡) — 위조 방지가 갖은자를 쓰는 까닭이다. */
export function toHanja(value: bigint): string {
  check(value);
  if (value === 0n) return '零';
  return spell(value, HANJA_DIGITS, HANJA_SMALL, HANJA_BIG, false);
}

/** "일금 일천이백삼십사만오천원정 (₩12,345,000)" */
export function formalHangul(value: bigint, options: SpellOptions = {}): string {
  return `일금 ${toHangul(value, options)}원정 (₩${commaBig(value)})`;
}

/** "金 壹阡貳佰參拾肆萬伍阡원整" */
export function formalHanja(value: bigint): string {
  return `金 ${toHanja(value)}원整`;
}

/** "1,234만 5,000원". 비어 있는 네 자리 묶음은 적지 않는다. */
export function toMixed(value: bigint): string {
  check(value);
  if (value === 0n) return '0원';
  const parts: string[] = [];
  groups(value).forEach((group, index) => {
    if (group !== 0) parts.unshift(`${group.toLocaleString('en-US')}${HANGUL_BIG[index]!}`);
  });
  return `${parts.join(' ')}원`;
}

/** 세 자리 쉼표. toLocaleString 은 BigInt 에도 되지만 환경마다 모양이 다를 수 있어 직접 끊는다. */
export function commaBig(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  return (negative ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function check(value: bigint): void {
  if (value < 0n || value >= MONEY_LIMIT) throw new RangeError('0 이상 9999경 이하만 적을 수 있습니다.');
}

// --- 거꾸로: 한글로 적힌 금액 → 숫자 -------------------------------------------

const DIGIT_VALUE: Record<string, number> = {
  영: 0, 공: 0, 零: 0,
  일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9,
  壹: 1, 貳: 2, 參: 3, 肆: 4, 伍: 5, 陸: 6, 柒: 7, 捌: 8, 玖: 9,
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const SMALL_VALUE: Record<string, bigint> = {
  십: 10n, 백: 100n, 천: 1000n,
  拾: 10n, 佰: 100n, 阡: 1000n, 十: 10n, 百: 100n, 千: 1000n, 仟: 1000n,
};
const BIG_VALUE: Record<string, bigint> = {
  만: 10n ** 4n, 억: 10n ** 8n, 조: 10n ** 12n, 경: 10n ** 16n,
  萬: 10n ** 4n, 億: 10n ** 8n, 兆: 10n ** 12n, 京: 10n ** 16n,
};

/**
 * "일억이천만" → 120000000, "천오백" → 1500, "3억 5천만" → 350000000,
 * "일금 일천이백삼십사만오천원정" 처럼 앞뒤에 붙는 말도 받는다.
 * 단위가 거꾸로 오거나("십천") 숫자가 이어지면("이삼") 틀렸다고 말한다 — 적어 둔
 * 금액을 확인하려는 기능이라 너그럽게 읽어 주면 오히려 쓸모가 없다.
 */
export function parseKorean(text: string): Parsed {
  // 공백은 지우지 않고 가름으로 둔다. "3 5만" 을 35만으로 붙여 읽으면 안 된다.
  let s = text.trim();
  s = s.replace(/^(일금|金|금)\s*/, '').replace(/^[₩￦]\s*/, '');
  s = s.replace(/\s*(원정|원整|圓整|원|圓|정|整|也)$/, '').trim();
  if (!s) return { ok: false, error: '금액을 적어 주세요.' };
  if (/[.．]/.test(s)) return { ok: false, error: '소수점은 받지 않습니다.' };

  let total = 0n;
  let section = 0n;
  let current: bigint | null = null;
  let lastSmall = 10000n;
  let lastBig = MONEY_LIMIT;
  let sawAnything = false;

  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch)) {
      const run = /^[0-9][0-9,]*/.exec(s.slice(i))![0];
      if (current !== null) return { ok: false, error: `숫자가 이어졌습니다: "${run}" 앞` };
      current = BigInt(run.replace(/,/g, ''));
      i += run.length;
      sawAnything = true;
      continue;
    }
    if (ch in DIGIT_VALUE) {
      if (current !== null) return { ok: false, error: `숫자가 이어졌습니다: "${ch}" 앞` };
      current = BigInt(DIGIT_VALUE[ch]!);
      sawAnything = true;
    } else if (ch in SMALL_VALUE) {
      const unit = SMALL_VALUE[ch]!;
      if (unit >= lastSmall) return { ok: false, error: `단위 순서가 맞지 않습니다: "${ch}"` };
      section += (current ?? 1n) * unit;
      current = null;
      lastSmall = unit;
      sawAnything = true;
    } else if (ch in BIG_VALUE) {
      const unit = BIG_VALUE[ch]!;
      if (unit >= lastBig) return { ok: false, error: `단위 순서가 맞지 않습니다: "${ch}"` };
      let amount = section + (current ?? 0n);
      // "만" 하나만 오면 일만이다. 앞에 아무것도 없을 때만 그렇게 읽는다.
      if (amount === 0n && current === null && lastSmall === 10000n) {
        if (lastBig !== MONEY_LIMIT) return { ok: false, error: `단위가 이어졌습니다: "${ch}" 앞에 숫자가 없습니다` };
        amount = 1n;
      }
      total += amount * unit;
      section = 0n;
      current = null;
      lastSmall = 10000n;
      lastBig = unit;
      sawAnything = true;
    } else {
      return { ok: false, error: `읽을 수 없는 글자: "${ch}"` };
    }
    i++;
  }
  if (!sawAnything) return { ok: false, error: '금액을 적어 주세요.' };
  total += section + (current ?? 0n);
  if (total >= MONEY_LIMIT) return { ok: false, error: '9999경(20자리)까지만 읽습니다.' };
  return { ok: true, value: total };
}

/** 숫자로 적혔으면 숫자로, 한글·한자가 섞였으면 한글 금액으로 읽는다. */
export function parseAny(text: string): Parsed & { korean: boolean } {
  const korean = /[일이삼사오육륙칠팔구십백천만억조경영零壹貳參肆伍陸柒捌玖拾佰阡萬億兆京一二三四五六七八九十百千仟]/.test(text);
  return { ...(korean ? parseKorean(text) : parseAmount(text)), korean };
}
