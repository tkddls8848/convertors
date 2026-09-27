/**
 * 개인정보 가리기 — 글 속의 주민번호·전화·이메일·카드·계좌·여권번호를 찾아 가린다.
 *
 * **모양으로만 찾는다.** 이름·주소·자유롭게 적은 숫자는 찾지 못하고, 모양이 같은
 * 다른 숫자를 잘못 가릴 수도 있다. 그래서 무엇을 찾았는지 줄 번호와 함께 늘어놓고,
 * 보내기 전에 사람이 확인하게 한다.
 *
 * 주민번호는 검증 숫자를 보지 않는다. 2020년 10월부터 새로 주는 번호는 뒷자리가
 * 무작위라 검증식을 따르지 않는다 — 검증하면 새 번호를 놓친다. 대신 앞 여섯
 * 자리가 있을 수 있는 날짜인지와 뒷자리 첫 숫자(1–8)를 본다.
 *
 * 카드번호는 반대로 Luhn 검증을 **꼭** 본다. 16자리 숫자는 주문번호·송장번호에도
 * 흔해서 그것 없이는 거의 다 잘못 잡는다.
 *
 * 계좌번호와 여권번호는 기본으로 꺼 둔다. 계좌번호는 은행마다 모양이 달라 붙임표로
 * 나뉜 숫자를 넓게 잡을 수밖에 없고, 그러면 관리번호·문서번호까지 잡힌다.
 */

export type RedactKind = 'rrn' | 'phone' | 'email' | 'card' | 'account' | 'passport';
export type MaskStyle = 'partial' | 'full' | 'tag';

export const REDACT_KINDS: Array<{ kind: RedactKind; label: string; tag: string; defaultOn: boolean }> = [
  { kind: 'rrn', label: '주민등록번호·외국인등록번호', tag: '[주민번호]', defaultOn: true },
  { kind: 'phone', label: '전화번호', tag: '[전화번호]', defaultOn: true },
  { kind: 'email', label: '이메일', tag: '[이메일]', defaultOn: true },
  { kind: 'card', label: '카드번호', tag: '[카드번호]', defaultOn: true },
  { kind: 'account', label: '계좌번호', tag: '[계좌번호]', defaultOn: false },
  { kind: 'passport', label: '여권번호', tag: '[여권번호]', defaultOn: false },
];

export interface RedactOptions {
  kinds: RedactKind[];
  style: MaskStyle;
}

export interface Finding {
  kind: RedactKind;
  /** 원문에서의 자리(UTF-16 단위)와 길이 */
  index: number;
  length: number;
  /** 1부터 */
  line: number;
  /** 가린 모양. 화면은 원문 대신 이것만 보인다 */
  masked: string;
}

export interface RedactResult {
  text: string;
  findings: Finding[];
  counts: Record<RedactKind, number>;
}

// 더 긴 숫자 덩이의 한 조각이면 잡지 않는다. 앞뒤가 숫자이거나 "구분자+숫자" 이면 덩이가 이어진다.
const START = String.raw`(?<![0-9])(?<![0-9][-.])`;
const END = String.raw`(?![0-9])(?![-.][0-9])`;

const PATTERNS: Record<RedactKind, RegExp> = {
  rrn: new RegExp(String.raw`${START}(\d{2})(\d{2})(\d{2})[- ]?[1-8]\d{6}${END}`, 'g'),
  phone: new RegExp([
    // 휴대전화 010·011·016–019, 서울 02, 지역번호, 인터넷전화 070, 안심번호 0502–0508
    String.raw`${START}(?:01[016-9]|02|0(?:3[1-3]|4[1-4]|5[1-5]|6[1-4])|070|050[2-8])([-. ]?)\d{3,4}\1\d{4}${END}`,
    // 대표번호 15XX·16XX·18XX — 구분자 없는 여덟 자리는 날짜와 구별이 안 되므로 구분자를 요구한다
    String.raw`${START}1[568]\d{2}[-. ]\d{4}${END}`,
  ].join('|'), 'g'),
  email: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g,
  card: /(?<![0-9])(?<![0-9][- ])\d{4}(?:([- ])\d{3,6}(?:\1\d{3,6}){1,3}|\d{9,15})(?![0-9])(?![- ][0-9])/g,
  account: new RegExp(String.raw`${START}\d{2,6}(?:-\d{2,7}){2,3}${END}`, 'g'),
  passport: /(?<![A-Za-z0-9])[MSROD](?:\d{8}|\d{3}[A-Z]\d{4})(?![A-Za-z0-9])/g,
};

/** 먼저 잡은 것이 이긴다. 주민번호(13자리)가 카드(Luhn)로 잘못 잡히지 않게 앞에 둔다. */
const ORDER: RedactKind[] = ['rrn', 'card', 'phone', 'email', 'account', 'passport'];

const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function plausibleDate(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS[month - 1]!;
}

export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let value = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { value *= 2; if (value > 9) value -= 9; }
    sum += value;
  }
  return sum % 10 === 0;
}

function accept(kind: RedactKind, match: RegExpExecArray): boolean {
  const text = match[0];
  const digits = text.replace(/\D/g, '');
  switch (kind) {
    case 'rrn': return plausibleDate(Number(match[2]), Number(match[3]));
    case 'card': {
      if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return false;
      // 붙임표 없는 긴 숫자는 발급사 첫 숫자(2–6, 국내 전용 9)일 때만 본다.
      return /[- ]/.test(text) || /^[2-69]/.test(digits);
    }
    case 'account': {
      if (digits.length < 10 || digits.length > 14) return false;
      const groups = text.split('-');
      // 2024-01-01-… 처럼 날짜로 시작하면 계좌가 아니다.
      if (/^(19|20)\d{2}$/.test(groups[0]!) && Number(groups[1]) >= 1 && Number(groups[1]) <= 12) return false;
      // 사업자등록번호(3-2-5)는 개인정보가 아니다.
      if (groups.length === 3 && groups[0]!.length === 3 && groups[1]!.length === 2 && groups[2]!.length === 5) return false;
      // 전화번호 모양은 전화 쪽에서 본다.
      if (/^0\d{1,3}$/.test(groups[0]!) && groups.length === 3 && digits.length <= 11) return false;
      return true;
    }
    default: return true;
  }
}

const maskChars = (text: string): string => text.replace(/[0-9A-Za-z]/g, '*');

/** 앞에서 `keep` 개의 숫자·글자만 남기고, 끝에서 `tail` 개도 남긴다. 구분자는 그대로. */
function keepEnds(text: string, keep: number, tail: number): string {
  const total = text.replace(/[^0-9A-Za-z]/g, '').length;
  let seen = 0;
  return text.replace(/[0-9A-Za-z]/g, char => {
    seen++;
    return seen <= keep || seen > total - tail ? char : '*';
  });
}

export function mask(kind: RedactKind, text: string, style: MaskStyle): string {
  if (style === 'tag') return REDACT_KINDS.find(item => item.kind === kind)!.tag;
  if (kind === 'email') {
    const at = text.indexOf('@');
    const local = text.slice(0, at);
    const domain = text.slice(at);
    if (style === 'full') return `${'*'.repeat(local.length)}@${domain.slice(1).replace(/[^.]/g, '*')}`;
    // 한 글자짜리는 하나도 남기지 않는다 — 남기면 가린 것이 없다.
    const keep = Math.min(2, Math.floor(local.length / 2));
    return `${local.slice(0, keep)}${'*'.repeat(local.length - keep)}${domain}`;
  }
  if (style === 'full') return maskChars(text);
  switch (kind) {
    case 'rrn': return keepEnds(text, 7, 0);
    case 'card': return keepEnds(text, 4, 4);
    case 'passport': return keepEnds(text, 4, 0);
    case 'phone': {
      const groups = text.split(/([-. ])/);
      // 010-1234-5678 → 010-****-5678. 대표번호(1588-1234)는 앞 덩이만 남긴다.
      if (groups.length === 5) return `${groups[0]}${groups[1]}${maskChars(groups[2]!)}${groups[3]}${groups[4]}`;
      if (groups.length === 3) return `${groups[0]}${groups[1]}${maskChars(groups[2]!)}`;
      const head = text.startsWith('02') ? 2 : 3;
      return `${text.slice(0, head)}${maskChars(text.slice(head, -4))}${text.slice(-4)}`;
    }
    case 'account': {
      const first = text.indexOf('-');
      return `${text.slice(0, first)}${maskChars(text.slice(first))}`;
    }
  }
}

export function redact(text: string, options: RedactOptions): RedactResult {
  const taken: Array<{ kind: RedactKind; index: number; length: number }> = [];
  const overlaps = (index: number, end: number): boolean =>
    taken.some(item => index < item.index + item.length && item.index < end);

  for (const kind of ORDER) {
    if (!options.kinds.includes(kind)) continue;
    const pattern = new RegExp(PATTERNS[kind].source, PATTERNS[kind].flags);
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (!accept(kind, match)) continue;
      const end = match.index + match[0].length;
      if (!overlaps(match.index, end)) taken.push({ kind, index: match.index, length: match[0].length });
    }
  }
  taken.sort((left, right) => left.index - right.index);

  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const lineOf = (index: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= index) low = mid; else high = mid - 1;
    }
    return low + 1;
  };

  const counts = Object.fromEntries(REDACT_KINDS.map(item => [item.kind, 0])) as Record<RedactKind, number>;
  const findings: Finding[] = [];
  const pieces: string[] = [];
  let cursor = 0;
  for (const item of taken) {
    const masked = mask(item.kind, text.slice(item.index, item.index + item.length), options.style);
    pieces.push(text.slice(cursor, item.index), masked);
    cursor = item.index + item.length;
    counts[item.kind]++;
    findings.push({ ...item, line: lineOf(item.index), masked });
  }
  pieces.push(text.slice(cursor));
  return { text: pieces.join(''), findings, counts };
}
