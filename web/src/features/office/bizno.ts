/**
 * 사업자등록번호(10자리)·법인등록번호(13자리)의 검증 숫자 확인.
 *
 * 이것은 **오타 확인**이다. 마지막 자리가 앞 자리들과 맞는지만 본다. 맞아도
 * 실제로 발급된 번호인지, 지금 영업 중인지(휴·폐업)는 알 수 없다 — 그것은
 * 국세청 홈택스에서 확인해야 하고, 이 도구는 번호를 어디에도 보내지 않는다.
 *
 * 13자리는 법인등록번호로만 읽는다. 주민등록번호도 13자리지만 검증 방식이 다르고,
 * 그런 번호를 여기서 다룰 이유가 없다.
 */

export type Kind = 'business' | 'corporation';

export const KIND_NAMES: Record<Kind, string> = {
  business: '사업자등록번호',
  corporation: '법인등록번호',
};

export interface Check {
  input: string;
  /** 숫자만 남긴 것. 자릿수가 맞으면 하이픈을 넣어 적는다. */
  normalized: string;
  kind: Kind | null;
  valid: boolean;
  reason: string;
  /** 번호 가운데 자리로 짐작한 갈래. 국세청·법원의 분류라 바뀔 수 있어 "참고" 로만 보인다. */
  note: string;
}

const BUSINESS_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];

export function businessCheckDigit(digits: string): number {
  const d = [...digits].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i]! * BUSINESS_WEIGHTS[i]!;
  // 아홉째 자리는 ×5 의 십의 자리가 한 번 더 들어간다.
  sum += Math.floor((d[8]! * 5) / 10);
  return (10 - (sum % 10)) % 10;
}

export function corporationCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 2);
  return (10 - (sum % 10)) % 10;
}

/** 사업자등록번호 가운데 두 자리(4–5째)의 뜻. 국세청 분류다. */
export function businessType(digits: string): string {
  const code = Number(digits.slice(3, 5));
  if (code >= 1 && code <= 79) return '개인 과세사업자';
  if (code >= 90 && code <= 99) return '개인 면세사업자';
  switch (code) {
    case 80: return '아파트관리사무소·다단계판매원 등';
    case 81: case 86: case 87: case 88: return '영리법인 본점';
    case 82: return '비영리법인';
    case 83: return '국가·지방자치단체';
    case 84: return '외국법인';
    case 85: return '영리법인 지점';
    case 89: return '법인 아닌 종교단체';
    default: return '알 수 없는 구분';
  }
}

/**
 * 법인등록번호 5–6째 자리. 확실히 아는 회사 종류만 이름을 붙이고 나머지는 번호만 둔다
 * — 틀린 이름을 붙이느니 모른다고 하는 편이 낫다.
 */
const CORPORATION_TYPES: Record<string, string> = {
  '11': '주식회사',
  '12': '합명회사',
  '13': '합자회사',
  '14': '유한회사',
};

export function formatNumber(digits: string): string {
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  if (digits.length === 13) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return digits;
}

/** 번호 하나를 본다. 하이픈·점·공백은 가름표로 보고 지운다. */
export function checkNumber(input: string): Check {
  const text = input.trim();
  const base = { input: text, kind: null, valid: false, note: '' };
  if (/[^\d\-.\s]/.test(text)) {
    return { ...base, normalized: text.replace(/[\-.\s]/g, ''), reason: '숫자가 아닌 글자가 있습니다' };
  }
  const digits = text.replace(/\D/g, '');
  if (digits.length === 10) {
    const expected = businessCheckDigit(digits);
    const actual = Number(digits[9]);
    const valid = expected === actual;
    return {
      input: text,
      normalized: formatNumber(digits),
      kind: 'business',
      valid,
      reason: valid ? '검증 숫자 일치' : `검증 숫자 불일치 (끝자리가 ${expected} 이어야 합니다)`,
      note: `참고: ${businessType(digits)} (가운데 ${digits.slice(3, 5)})`,
    };
  }
  if (digits.length === 13) {
    const expected = corporationCheckDigit(digits);
    const actual = Number(digits[12]);
    const valid = expected === actual;
    const typeCode = digits.slice(4, 6);
    const typeName = CORPORATION_TYPES[typeCode];
    return {
      input: text,
      normalized: formatNumber(digits),
      kind: 'corporation',
      valid,
      reason: valid ? '검증 숫자 일치' : `검증 숫자 불일치 (끝자리가 ${expected} 이어야 합니다)`,
      note: `참고: 등기관서 ${digits.slice(0, 4)} · 법인 종류 ${typeCode}${typeName ? `(${typeName})` : ''}`,
    };
  }
  return {
    ...base,
    normalized: digits,
    reason: `자릿수가 맞지 않습니다 — ${digits.length}자리 (사업자 10자리, 법인 13자리)`,
  };
}

/**
 * 여러 번호를 가른다. 줄바꿈·쉼표·세미콜론·탭은 언제나 가름이다. 공백은 조각 안의
 * 숫자를 모았을 때 10·13자리가 되면 번호 안의 공백("123 45 67890")으로, 아니면 가름으로 본다.
 */
export function splitNumbers(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/[\r\n,;\t]+/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const digits = trimmed.replace(/\D/g, '');
    if (/\s/.test(trimmed) && digits.length !== 10 && digits.length !== 13) {
      out.push(...trimmed.split(/\s+/).filter(Boolean));
    } else {
      out.push(trimmed);
    }
  }
  return out;
}

export interface Batch { checks: Check[]; valid: number; invalid: number }

export function checkMany(text: string): Batch {
  const checks = splitNumbers(text).map(checkNumber);
  const valid = checks.filter(c => c.valid).length;
  return { checks, valid, invalid: checks.length - valid };
}

function csvCell(text: string): string {
  // 엑셀이 수식으로 읽지 않게 막는다. 입력 칸은 사람이 붙여 넣은 그대로라 무엇이든 올 수 있다.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 BOM 을 붙인 CSV — 엑셀이 한글을 깨뜨리지 않게. */
export function batchCsv(checks: Check[]): string {
  const rows = [['입력', '정규화', '종류', '결과', '이유', '참고']];
  for (const c of checks) {
    rows.push([c.input, c.normalized, c.kind ? KIND_NAMES[c.kind] : '', c.valid ? '맞음' : '틀림', c.reason, c.note]);
  }
  return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
