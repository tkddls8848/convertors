/**
 * 엑셀 수식을 브라우저 안에서 다시 계산한다 — 견적서에서 숫자 몇 칸을 고쳤을 때
 * 합계·부가세 칸의 값을 새로 써 넣기 위해서다.
 *
 * 엑셀의 모든 함수를 흉내 내지 않는다. 견적서·명세서에 흔한 셈(사칙연산, 비교, 글자
 * 잇기, SUM·ROUND 무리·IF 등)만 받고, **모르는 함수나 이름을 만나면 멈춘다**
 * (`UnsupportedFormula`). 틀린 값을 조용히 써 넣는 것보다, 그 칸은 엑셀이 열 때 다시
 * 계산하게 두고 사람에게 알리는 편이 낫다.
 *
 * 수식 글은 SheetJS 가 읽어 준 A1 형식(`SUM(D2:D3)`, `'견적 서'!$A$1`)이다.
 */

export type CellValue = number | string | boolean | { error: string } | null;

export interface Address { row: number; col: number }
export interface Reference { sheet: string; from: Address; to: Address }

export interface FormulaContext {
  /** 지금 수식이 있는 시트. 시트 이름이 없는 참조는 이 시트를 가리킨다. */
  sheet: string;
  /** 칸의 값. 빈 칸은 null. `address` 는 'C5' 꼴이다. */
  cell(sheet: string, address: string): CellValue;
  /** 열 전체(`A:A`)를 셀 때 쓸 시트의 크기. */
  bounds(sheet: string): { rows: number; cols: number };
}

export class UnsupportedFormula extends Error {
  constructor(what: string) {
    super(`다시 계산할 줄 모르는 수식입니다: ${what}`);
    this.name = 'UnsupportedFormula';
  }
}

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; value: string }
  | { kind: 'ref'; sheet?: string; from: Address; to: Address; single: boolean }
  | { kind: 'name'; name: string }
  | { kind: 'unary'; op: '-' | '+'; arg: Node }
  | { kind: 'percent'; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

export type Formula = Node;

// --- 칸 주소 ----------------------------------------------------------------

export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
export const addressOf = ({ row, col }: Address): string => `${columnName(col)}${row + 1}`;
function parseAddress(text: string): Address {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(text)!;
  return { col: columnIndex(match[1]!), row: Number(match[2]) - 1 };
}

// --- 글자 쪼개기 ---------------------------------------------------------------

type Token =
  | { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'err'; v: string }
  | { t: 'ref'; sheet?: string; a: string; b?: string; cols?: [string, string] }
  | { t: 'func'; v: string } | { t: 'ident'; v: string } | { t: 'op'; v: string };

const SHEET = String.raw`(?:'((?:[^']|'')+)'|([^\s!'(),:;=<>+\-*/^&%"{}]+))!`;
const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
const COLUMN = String.raw`\$?[A-Za-z]{1,3}`;
const RE = {
  space: /^\s+/,
  number: /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
  string: /^"((?:[^"]|"")*)"/,
  error: /^#(?:DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|NULL!)/,
  sheetRef: new RegExp(`^${SHEET}(${CELL})(?::(${CELL}))?(?![A-Za-z0-9_(])`),
  sheetColumns: new RegExp(`^${SHEET}(${COLUMN}):(${COLUMN})(?![A-Za-z0-9_(])`),
  ref: new RegExp(`^(${CELL})(?::(${CELL}))?(?![A-Za-z0-9_(])`),
  columns: new RegExp(`^(${COLUMN}):(${COLUMN})(?![A-Za-z0-9_(\\d])`),
  func: /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/,
  ident: /^[A-Za-z_ㄱ-힝][A-Za-z0-9_.ㄱ-힝]*/,
  op: /^(?:<>|<=|>=|[-+*/^&%=<>(),;])/,
};

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let rest = text.trim().replace(/^=/, '');
  while (rest.length) {
    let m: RegExpExecArray | null;
    if ((m = RE.space.exec(rest))) { rest = rest.slice(m[0].length); continue; }
    if ((m = RE.string.exec(rest))) tokens.push({ t: 'str', v: m[1]!.replace(/""/g, '"') });
    else if ((m = RE.error.exec(rest))) tokens.push({ t: 'err', v: m[0] });
    else if ((m = RE.sheetRef.exec(rest))) tokens.push({ t: 'ref', sheet: (m[1]?.replace(/''/g, "'") ?? m[2])!, a: m[3]!, ...(m[4] ? { b: m[4] } : {}) });
    else if ((m = RE.sheetColumns.exec(rest))) tokens.push({ t: 'ref', sheet: (m[1]?.replace(/''/g, "'") ?? m[2])!, a: '', cols: [m[3]!, m[4]!] });
    else if ((m = RE.number.exec(rest)) && !/^[A-Za-z_]/.test(rest.slice(m[0].length))) tokens.push({ t: 'num', v: Number(m[0]) });
    else if ((m = RE.func.exec(rest))) { tokens.push({ t: 'func', v: m[1]!.toUpperCase().replace(/^_XLFN\./, '').replace(/^_XLWS\./, '') }); }
    else if ((m = RE.ref.exec(rest))) tokens.push({ t: 'ref', a: m[1]!, ...(m[2] ? { b: m[2] } : {}) });
    else if ((m = RE.columns.exec(rest))) tokens.push({ t: 'ref', a: '', cols: [m[1]!, m[2]!] });
    else if ((m = RE.op.exec(rest))) tokens.push({ t: 'op', v: m[0] === ';' ? ',' : m[0] });
    else if ((m = RE.ident.exec(rest))) tokens.push({ t: 'ident', v: m[0] });
    else throw new UnsupportedFormula(rest.slice(0, 12));
    // func 는 여는 괄호까지 먹었다 — 괄호는 따로 되돌려 둔다.
    if (tokens[tokens.length - 1]!.t === 'func') tokens.push({ t: 'op', v: '(' });
    rest = rest.slice(m[0].length);
  }
  return tokens;
}

// --- 읽기 (우선순위: 비교 < & < +- < */ < ^ < % < 단항 -) ---------------------

export function parseFormula(text: string): Formula {
  const tokens = tokenize(text);
  let at = 0;
  const peek = (): Token | undefined => tokens[at];
  const isOp = (...ops: string[]): boolean => { const t = peek(); return t?.t === 'op' && ops.includes(t.v); };
  const expect = (op: string): void => { if (!isOp(op)) throw new UnsupportedFormula(text); at++; };

  const comparison = (): Node => {
    let left = concat();
    while (isOp('=', '<>', '<', '>', '<=', '>=')) { const op = (tokens[at++] as { v: string }).v; left = { kind: 'binary', op, left, right: concat() }; }
    return left;
  };
  const concat = (): Node => {
    let left = additive();
    while (isOp('&')) { at++; left = { kind: 'binary', op: '&', left, right: additive() }; }
    return left;
  };
  const additive = (): Node => {
    let left = multiplicative();
    while (isOp('+', '-')) { const op = (tokens[at++] as { v: string }).v; left = { kind: 'binary', op, left, right: multiplicative() }; }
    return left;
  };
  const multiplicative = (): Node => {
    let left = power();
    while (isOp('*', '/')) { const op = (tokens[at++] as { v: string }).v; left = { kind: 'binary', op, left, right: power() }; }
    return left;
  };
  const power = (): Node => {
    let left = percent();
    while (isOp('^')) { at++; left = { kind: 'binary', op: '^', left, right: percent() }; }
    return left;
  };
  const percent = (): Node => {
    let node = unary();
    while (isOp('%')) { at++; node = { kind: 'percent', arg: node }; }
    return node;
  };
  const unary = (): Node => {
    if (isOp('-', '+')) { const op = (tokens[at++] as { v: string }).v as '-' | '+'; return { kind: 'unary', op, arg: unary() }; }
    return primary();
  };
  const primary = (): Node => {
    const token = tokens[at++];
    if (!token) throw new UnsupportedFormula(text);
    switch (token.t) {
      case 'num': return { kind: 'number', value: token.v };
      case 'str': return { kind: 'string', value: token.v };
      case 'err': return { kind: 'error', value: token.v };
      case 'ident': {
        const upper = token.v.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') return { kind: 'boolean', value: upper === 'TRUE' };
        return { kind: 'name', name: token.v };
      }
      case 'ref': {
        if (token.cols) {
          const [a, b] = token.cols.map(c => columnIndex(c.replace('$', '')));
          return { kind: 'ref', ...(token.sheet ? { sheet: token.sheet } : {}), from: { row: 0, col: Math.min(a!, b!) }, to: { row: Infinity, col: Math.max(a!, b!) }, single: false };
        }
        const from = parseAddress(token.a);
        const to = token.b ? parseAddress(token.b) : from;
        return {
          kind: 'ref', ...(token.sheet ? { sheet: token.sheet } : {}),
          from: { row: Math.min(from.row, to.row), col: Math.min(from.col, to.col) },
          to: { row: Math.max(from.row, to.row), col: Math.max(from.col, to.col) },
          single: !token.b,
        };
      }
      case 'func': {
        expect('(');
        const args: Node[] = [];
        if (!isOp(')')) {
          do {
            if (isOp(',', ')')) args.push({ kind: 'string', value: '' }); // 빈 인수
            else args.push(comparison());
          } while (isOp(',') && ++at);
        }
        expect(')');
        return { kind: 'call', name: token.v, args };
      }
      case 'op':
        if (token.v === '(') { const inner = comparison(); expect(')'); return inner; }
        throw new UnsupportedFormula(text);
    }
  };

  const tree = comparison();
  if (at !== tokens.length) throw new UnsupportedFormula(text);
  return tree;
}

/** 수식이 읽는 칸·범위. 시트 이름이 없는 것은 `sheet` 로 채운다. */
export function referencesOf(node: Formula, sheet: string): Reference[] {
  const found: Reference[] = [];
  const walk = (n: Node): void => {
    switch (n.kind) {
      case 'ref': found.push({ sheet: n.sheet ?? sheet, from: n.from, to: n.to }); break;
      case 'unary': case 'percent': walk(n.arg); break;
      case 'binary': walk(n.left); walk(n.right); break;
      case 'call': n.args.forEach(walk); break;
      default: break;
    }
  };
  walk(node);
  return found;
}

// --- 계산 -------------------------------------------------------------------

type Matrix = CellValue[][];
type Result = CellValue | Matrix;

const isError = (v: unknown): v is { error: string } => typeof v === 'object' && v !== null && 'error' in v;
const err = (code: string): { error: string } => ({ error: code });
/** 엑셀은 15자리까지만 믿는다. 0.1+0.2 같은 꼬리를 떼어 반올림이 흔들리지 않게 한다. */
const fifteen = (x: number): number => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(15)) : x);

function toNumber(v: CellValue): number | { error: string } {
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isError(v)) return v;
  const text = v.trim().replace(/,/g, '');
  if (text !== '' && Number.isFinite(Number(text))) return Number(text);
  return err('#VALUE!');
}
function toText(v: CellValue): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(fifteen(v));
  return isError(v) ? v.error : v;
}
function toBool(v: CellValue): boolean | { error: string } {
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (isError(v)) return v;
  const upper = v.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') return upper === 'TRUE';
  return err('#VALUE!');
}

function compare(a: CellValue, b: CellValue): number {
  const rank = (v: CellValue): number => (typeof v === 'boolean' ? 2 : typeof v === 'string' ? 1 : 0);
  const left = a === null ? (typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0) : a;
  const right = b === null ? (typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0) : b;
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
  if (typeof left === 'string') return left.toLowerCase().localeCompare((right as string).toLowerCase());
  return Number(left) - Number(right);
}

function round(x: number, digits: number, how: 'round' | 'up' | 'down'): number {
  const d = Math.trunc(digits);
  const scale = 10 ** d;
  const scaled = fifteen(Math.abs(x) * scale);
  const r = how === 'round' ? Math.round(scaled) : how === 'up' ? Math.ceil(scaled) : Math.floor(scaled);
  return fifteen((Math.sign(x) * r) / scale) || 0;
}

export function evaluate(node: Formula, context: FormulaContext): CellValue {
  const value = run(node, context);
  return Array.isArray(value) ? scalar(value) : value;
}

/** 범위를 칸 하나 자리에 쓰면 엑셀은 한 칸짜리만 받는다. */
function scalar(value: Result): CellValue {
  if (!Array.isArray(value)) return value;
  return value.length === 1 && value[0]!.length === 1 ? value[0]![0]! : err('#VALUE!');
}

function run(node: Node, ctx: FormulaContext): Result {
  switch (node.kind) {
    case 'number': case 'string': case 'boolean': return node.value;
    case 'error': return err(node.value);
    case 'name': throw new UnsupportedFormula(`이름 ${node.name}`);
    case 'ref': {
      const sheet = node.sheet ?? ctx.sheet;
      const lastRow = Number.isFinite(node.to.row) ? node.to.row : ctx.bounds(sheet).rows - 1;
      const rows: Matrix = [];
      for (let r = node.from.row; r <= lastRow; r++) {
        const row: CellValue[] = [];
        for (let c = node.from.col; c <= node.to.col; c++) row.push(ctx.cell(sheet, addressOf({ row: r, col: c })));
        rows.push(row);
      }
      return node.single ? rows[0]![0]! : rows;
    }
    case 'unary': {
      const n = toNumber(scalar(run(node.arg, ctx)));
      return isError(n) ? n : node.op === '-' ? -n : n;
    }
    case 'percent': {
      const n = toNumber(scalar(run(node.arg, ctx)));
      return isError(n) ? n : n / 100;
    }
    case 'binary': {
      const left = scalar(run(node.left, ctx));
      const right = scalar(run(node.right, ctx));
      if (isError(left)) return left;
      if (isError(right)) return right;
      if (node.op === '&') return toText(left) + toText(right);
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        const c = compare(left, right);
        return node.op === '=' ? c === 0 : node.op === '<>' ? c !== 0 : node.op === '<' ? c < 0 : node.op === '>' ? c > 0 : node.op === '<=' ? c <= 0 : c >= 0;
      }
      const a = toNumber(left);
      const b = toNumber(right);
      if (isError(a)) return a;
      if (isError(b)) return b;
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? err('#DIV/0!') : a / b;
        case '^': return a ** b;
        default: throw new UnsupportedFormula(node.op);
      }
    }
    case 'call': return call(node.name, node.args, ctx);
  }
}

/**
 * 엑셀의 NUMBERSTRING — 견적서의 "일금 ○○원정". 엑셀이 낸 답에 맞췄다(formula.test.ts 의 표).
 * 1: 일십삼만팔천육백(한 자리마다 '일' 을 붙인다), 2: 壹拾參萬八阡六百, 3: 일삼팔육영영.
 * 소수는 반올림하고, 음수는 #NUM!.
 */
function numberString(x: number, how: number): CellValue {
  if (x < 0 || ![1, 2, 3].includes(how)) return err('#NUM!');
  const digits = String(Math.round(fifteen(x)));
  const names = how === 2 ? ['零', '壹', '貳', '參', '四', '伍', '六', '七', '八', '九'] : ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  if (how === 3) return [...digits].map(d => names[Number(d)]).join('');
  if (digits === '0') return names[0]!;
  const small = how === 2 ? ['', '拾', '百', '阡'] : ['', '십', '백', '천'];
  const large = how === 2 ? ['', '萬', '億', '兆', '京'] : ['', '만', '억', '조', '경'];
  let out = '';
  const groups = Math.ceil(digits.length / 4);
  const padded = digits.padStart(groups * 4, '0');
  for (let g = 0; g < groups; g++) {
    const chunk = padded.slice(g * 4, g * 4 + 4);
    let part = '';
    for (let i = 0; i < 4; i++) {
      const d = Number(chunk[i]);
      if (d) part += names[d]! + small[3 - i]!;
    }
    if (part) out += part + large[groups - 1 - g]!;
  }
  return out;
}

/** 인수 값을 펼친다. 범위 안의 글자·빈 칸·참·거짓은 숫자 함수가 건너뛴다(엑셀과 같다). */
function numbersOf(args: Node[], ctx: FormulaContext): number[] | { error: string } {
  const out: number[] = [];
  for (const arg of args) {
    const value = run(arg, ctx);
    if (Array.isArray(value)) {
      for (const v of value.flat()) {
        if (isError(v)) return v;
        if (typeof v === 'number') out.push(v);
      }
    } else {
      const n = toNumber(value);
      if (isError(n)) return n;
      out.push(n);
    }
  }
  return out;
}

function call(name: string, args: Node[], ctx: FormulaContext): Result {
  const one = (i: number): CellValue => scalar(run(args[i] ?? { kind: 'string', value: '' }, ctx));
  const num = (i: number): number | { error: string } => toNumber(one(i));
  const nums = (): number[] | { error: string } => numbersOf(args, ctx);
  switch (name) {
    case 'SUM': { const v = nums(); return isError(v) ? v : v.reduce((s, x) => s + x, 0); }
    case 'PRODUCT': { const v = nums(); return isError(v) ? v : v.reduce((s, x) => s * x, 1); }
    case 'MIN': { const v = nums(); return isError(v) ? v : v.length ? Math.min(...v) : 0; }
    case 'MAX': { const v = nums(); return isError(v) ? v : v.length ? Math.max(...v) : 0; }
    case 'AVERAGE': { const v = nums(); return isError(v) ? v : v.length ? v.reduce((s, x) => s + x, 0) / v.length : err('#DIV/0!'); }
    case 'COUNT': {
      let count = 0;
      for (const arg of args) {
        const value = run(arg, ctx);
        if (Array.isArray(value)) count += value.flat().filter(v => typeof v === 'number').length;
        else if (!isError(toNumber(value)) && value !== null) count++;
      }
      return count;
    }
    case 'COUNTA': {
      let count = 0;
      for (const arg of args) {
        const value = run(arg, ctx);
        count += Array.isArray(value) ? value.flat().filter(v => v !== null && v !== '').length : 1;
      }
      return count;
    }
    case 'ROUND': case 'ROUNDUP': case 'ROUNDDOWN': {
      const x = num(0); const d = args.length > 1 ? num(1) : 0;
      if (isError(x)) return x;
      if (isError(d)) return d;
      return round(x, d, name === 'ROUND' ? 'round' : name === 'ROUNDUP' ? 'up' : 'down');
    }
    case 'INT': { const x = num(0); return isError(x) ? x : Math.floor(fifteen(x)); }
    case 'TRUNC': {
      const x = num(0); const d = args.length > 1 ? num(1) : 0;
      if (isError(x)) return x;
      if (isError(d)) return d;
      return round(x, d, 'down');
    }
    case 'ABS': { const x = num(0); return isError(x) ? x : Math.abs(x); }
    case 'MOD': {
      const a = num(0); const b = num(1);
      if (isError(a)) return a;
      if (isError(b)) return b;
      return b === 0 ? err('#DIV/0!') : a - b * Math.floor(a / b);
    }
    case 'SUMPRODUCT': {
      const ranges = args.map(arg => run(arg, ctx)).map(v => (Array.isArray(v) ? v.flat() : [v]));
      if (ranges.some(r => r.length !== ranges[0]!.length)) return err('#VALUE!');
      let total = 0;
      for (let i = 0; i < ranges[0]!.length; i++) {
        let product = 1;
        for (const r of ranges) {
          const v = r[i]!;
          if (isError(v)) return v;
          product *= typeof v === 'number' ? v : 0;
        }
        total += product;
      }
      return total;
    }
    case 'IF': {
      const test = toBool(one(0));
      if (isError(test)) return test;
      return test ? (args.length > 1 ? one(1) : true) : (args.length > 2 ? one(2) : false);
    }
    case 'IFERROR': { const v = one(0); return isError(v) ? one(1) : v; }
    case 'AND': case 'OR': {
      const values: boolean[] = [];
      for (const arg of args) {
        const value = run(arg, ctx);
        for (const v of Array.isArray(value) ? value.flat().filter(x => x !== null && typeof x !== 'string') : [value]) {
          const b = toBool(v);
          if (isError(b)) return b;
          values.push(b);
        }
      }
      return name === 'AND' ? values.every(Boolean) : values.some(Boolean);
    }
    case 'NOT': { const b = toBool(one(0)); return isError(b) ? b : !b; }
    case 'CONCATENATE': case 'CONCAT': return args.map((_, i) => one(i)).map(v => (isError(v) ? v.error : toText(v))).join('');
    case 'VALUE': return num(0);
    case 'NUMBERSTRING': {
      const x = num(0); const how = num(1);
      if (isError(x)) return x;
      if (isError(how)) return how;
      return numberString(x, Math.trunc(how));
    }
    default: throw new UnsupportedFormula(`함수 ${name}`);
  }
}
