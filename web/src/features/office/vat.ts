/**
 * 부가세 계산. 공급가액·세액·합계 가운데 하나를 알면 나머지를 낸다.
 *
 * 모든 값은 원 단위 정수(BigInt)다. 부동소수로 1.1 을 곱하면 11,000 이
 * 12,100.000000000002 가 되는 식으로 끝자리가 흔들린다 — 세금계산서 금액이
 * 1원 어긋나면 그 한 건이 다시 발행된다.
 *
 * 세율은 만분율(basis point)로 들고 있다. 10% = 1000. 0.01% 까지 적을 수 있고
 * 나눗셈은 끝에 한 번만 한다.
 */
import { parseAmount } from './money';

export type Rounding = 'floor' | 'round' | 'ceil';

export const ROUNDING_NAMES: Record<Rounding, string> = {
  floor: '원 미만 버림',
  round: '원 미만 반올림',
  ceil: '원 미만 올림',
};

/** 받는 금액의 상한. 합계가 부가세 20자리 표기(money.ts)를 넘지 않게 넉넉히 낮춘다. */
export const VAT_LIMIT = 10n ** 18n;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface VatAmounts {
  supply: bigint;
  tax: bigint;
  total: bigint;
  /** 세액에서 공급가액을 거꾸로 구할 때, 그 공급가액으로 다시 세액을 내면 달라지는 경우. */
  mismatch?: bigint;
}

/** 0 이상 정수 나눗셈을 고른 방식으로 끝맺는다. */
export function divide(numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  if (denominator <= 0n || numerator < 0n) throw new RangeError('0 이상을 양수로만 나눕니다.');
  const quotient = numerator / denominator;
  const rest = numerator % denominator;
  if (rest === 0n) return quotient;
  if (rounding === 'ceil') return quotient + 1n;
  if (rounding === 'round') return rest * 2n >= denominator ? quotient + 1n : quotient;
  return quotient;
}

/** "10", "10%", "0", "5.5" → 만분율. 0–100 만 받는다. */
export function parseRate(text: string): Result<bigint> {
  const s = text.trim().replace(/\s*%$/, '');
  if (!s) return { ok: false, error: '세율을 적어 주세요.' };
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) return { ok: false, error: '세율은 0–100 사이 숫자로, 소수 둘째 자리까지 적어 주세요.' };
  const bp = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (bp > 10000n) return { ok: false, error: '세율은 100% 를 넘을 수 없습니다.' };
  return { ok: true, value: bp };
}

/** 원 단위 금액을 읽는다. money.ts 규칙(쉼표·원 허용, 소수점 거절)에 상한만 더한다. */
export function parseWon(text: string): Result<bigint> {
  const parsed = parseAmount(text);
  if (!parsed.ok) return parsed;
  if (parsed.value >= VAT_LIMIT) return { ok: false, error: '100경 미만만 계산합니다.' };
  return parsed;
}

/** 공급가액 → 세액·합계. */
export function fromSupply(supply: bigint, rateBp: bigint, rounding: Rounding): VatAmounts {
  const tax = divide(supply * rateBp, 10000n, rounding);
  return { supply, tax, total: supply + tax };
}

/**
 * 합계(부가세 포함) → 공급가액·세액.
 * 공급가액을 먼저 끝맺고 세액은 **뺄셈으로** 낸다. 그래야 둘을 더하면 언제나 합계다.
 */
export function fromTotal(total: bigint, rateBp: bigint, rounding: Rounding): VatAmounts {
  const supply = divide(total * 10000n, 10000n + rateBp, rounding);
  return { supply, tax: total - supply, total };
}

/**
 * 세액 → 공급가액·합계. 세율이 0 이면 거꾸로 구할 수 없다.
 * 끝맺은 공급가액으로 세액을 다시 내면 1원쯤 달라질 수 있어 그 값을 함께 준다.
 */
export function fromTax(tax: bigint, rateBp: bigint, rounding: Rounding): Result<VatAmounts> {
  if (rateBp === 0n) return { ok: false, error: '세율이 0% 이면 세액으로 공급가액을 구할 수 없습니다.' };
  const supply = divide(tax * 10000n, rateBp, rounding);
  const again = fromSupply(supply, rateBp, rounding).tax;
  const amounts: VatAmounts = { supply, tax, total: supply + tax };
  if (again !== tax) amounts.mismatch = again;
  return { ok: true, value: amounts };
}

// --- 품목표 ----------------------------------------------------------------------

export interface ItemInput { name: string; qty: string; price: string }
export interface ItemRow { index: number; name: string; qty: bigint; price: bigint; amount: bigint }
/** `index` 는 입력 줄 번호(0부터). -1 이면 표 전체의 문제다. */
export interface ItemError { index: number; error: string }

export interface ItemTable extends VatAmounts {
  rows: ItemRow[];
  errors: ItemError[];
}

/**
 * 품목마다 수량 × 단가 = 공급가액, 세액은 **합계 공급가액에 한 번** 매긴다.
 * 줄마다 세액을 끝맺고 더하는 발행 방식과는 몇 원 다를 수 있다 — 화면이 그렇게 적는다.
 * 품목·단가가 빈 줄은 없는 줄로 본다. 틀린 줄은 합계에서 빼고 이유를 준다.
 */
export function itemTable(items: ItemInput[], rateBp: bigint, rounding: Rounding): ItemTable {
  const rows: ItemRow[] = [];
  const errors: ItemError[] = [];
  items.forEach((item, index) => {
    // 품목과 단가가 모두 비면 없는 줄이다. 수량은 화면이 1 로 채워 두므로 보지 않는다.
    if (!item.name.trim() && !item.price.trim()) return;
    const qty = parseAmount(item.qty);
    if (!qty.ok) { errors.push({ index, error: `수량: ${qty.error}` }); return; }
    if (qty.value > 1_000_000_000n) { errors.push({ index, error: '수량: 10억 개까지만 받습니다.' }); return; }
    const price = parseWon(item.price);
    if (!price.ok) { errors.push({ index, error: `단가: ${price.error}` }); return; }
    rows.push({ index, name: item.name.trim(), qty: qty.value, price: price.value, amount: qty.value * price.value });
  });
  let supply = rows.reduce((sum, row) => sum + row.amount, 0n);
  if (supply >= VAT_LIMIT) {
    // 합계를 적을 수 없을 만큼 크면 계산을 내지 않는다. 틀린 줄과 같은 자리로 알린다(-1 = 표 전체).
    errors.push({ index: -1, error: '공급가액 합계가 100경을 넘습니다.' });
    rows.length = 0;
    supply = 0n;
  }
  return { rows, errors, ...fromSupply(supply, rateBp, rounding) };
}

/** 엑셀이 수식으로 읽을 머리글자(=,+,-,@, 탭, CR)면 작은따옴표를 붙인다. */
export function guardCell(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvCell(text: string): string {
  const safe = guardCell(text);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function tsvCell(text: string): string {
  // TSV 는 따옴표 규칙을 믿을 수 없다(붙여 넣기에서 엑셀이 제멋대로 푼다). 탭·줄바꿈을 공백으로.
  return guardCell(text).replace(/[\t\r\n]+/g, ' ');
}

/** 품목표를 표 모양 글로. 숫자는 쉼표 없이 적어 엑셀이 숫자로 받게 한다. */
export function tableRows(table: ItemTable, rateLabel: string): string[][] {
  const out: string[][] = [['품목', '수량', '단가', '공급가액']];
  for (const row of table.rows) out.push([row.name, String(row.qty), String(row.price), String(row.amount)]);
  out.push([]);
  out.push(['공급가액 합계', '', '', String(table.supply)]);
  out.push([`세액 (${rateLabel})`, '', '', String(table.tax)]);
  out.push(['합계', '', '', String(table.total)]);
  return out;
}

export function toCsv(rows: string[][]): string {
  return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function toTsv(rows: string[][]): string {
  return rows.map(row => row.map(tsvCell).join('\t')).join('\n');
}

/** 만분율 → "10%", "5.5%". */
export function rateLabel(rateBp: bigint): string {
  const whole = rateBp / 100n;
  const frac = (rateBp % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}%`;
}
