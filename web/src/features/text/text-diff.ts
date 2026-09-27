/**
 * 텍스트 비교 — 줄 단위 Myers 차이와, 바뀐 줄 안의 글자 단위 차이.
 *
 * Myers O(ND) 는 바뀐 곳이 적을수록 빠르다. 대신 **걸음마다 V 를 적어 두고**
 * 거꾸로 되짚으므로 메모리가 D² 에 비례한다. 그래서 줄 수와 바뀐 줄 수 둘 다에
 * 한도를 두고, 넘으면 조용히 엉터리 답을 내지 않고 멈춘다.
 *
 * 공백·대소문자·빈 줄 무시는 **비교할 때만** 적용한다. 보이는 글과 내려받는
 * 차이 파일에는 원래 글이 그대로 나간다. 무시한 차이 때문에 같다고 본 줄은 문맥
 * 줄로 원본 쪽 글을 적으므로, 그런 옵션을 켠 차이 파일은 patch 로 되돌려 적용하면
 * 어긋날 수 있다.
 *
 * 줄바꿈 방식(CRLF·LF)과 마지막 줄바꿈 유무는 비교하지 않는다. 붙여 넣은 글과
 * 파일을 비교할 때 거의 늘 거기서 어긋나는데, 그것을 "바뀐 줄"이라 하면 쓸모가 없다.
 */
import { graphemes } from './text-count';

export const TEXT_DIFF_LIMITS = {
  /** 한쪽의 줄 수 */
  lines: 20_000,
  /** 바뀐 줄(삭제+추가) 수. 메모리가 이것의 제곱으로 는다 */
  edits: 3_000,
  /** 글자 단위 비교를 하는 한 줄의 최대 길이. 넘으면 줄만 칠한다 */
  lineChars: 5_000,
  charEdits: 600,
};

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
  ignoreBlankLines?: boolean;
}

/** 줄 안의 조각. `changed` 면 <del>/<ins> 로 칠한다. */
export interface Part { text: string; changed: boolean }

export type Op =
  | { kind: 'same'; a: number | null; b: number | null }
  | { kind: 'del'; a: number; parts?: Part[] }
  | { kind: 'add'; b: number; parts?: Part[] };

export interface DiffResult {
  linesA: string[];
  linesB: string[];
  ops: Op[];
  added: number;
  deleted: number;
  /** 삭제와 추가가 짝지어 "바뀐 줄"로 본 수 */
  changed: number;
  /** 마지막 줄바꿈이 한쪽에만 있다 — 비교에서 뺐지만 화면이 알린다 */
  finalNewline: { a: boolean; b: boolean };
}

export function splitLines(text: string): { lines: string[]; finalNewline: boolean } {
  if (text === '') return { lines: [], finalNewline: false };
  const lines = text.split(/\r\n|\r|\n/);
  const finalNewline = lines[lines.length - 1] === '';
  if (finalNewline) lines.pop();
  return { lines, finalNewline };
}

/**
 * Myers 편집 스크립트. 0 = 같음, 1 = a 에서 지움, 2 = b 에 더함.
 * `maxD` 를 넘으면 null — 부르는 쪽이 그 뜻을 말로 바꾼다.
 */
export function editScript(a: ArrayLike<number>, b: ArrayLike<number>, maxD: number): number[] | null {
  // 앞뒤의 같은 부분은 걸음 수에 들지 않지만 V 를 키운다. 먼저 걷어 낸다.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  const A = (i: number): number => a[head + i]!;
  const B = (i: number): number => b[head + i]!;

  const middle: number[] = [];
  if (n === 0) for (let i = 0; i < m; i++) middle.push(2);
  else if (m === 0) for (let i = 0; i < n; i++) middle.push(1);
  else {
    const max = n + m;
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace: Int32Array[] = [];
    let found = -1;
    const limit = Math.min(max, maxD);
    outer: for (let d = 0; d <= limit; d++) {
      trace.push(v.slice(offset - d, offset + d + 1));
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
        let y = x - k;
        while (x < n && y < m && A(x) === B(y)) { x++; y++; }
        v[offset + k] = x;
        if (x >= n && y >= m) { found = d; break outer; }
      }
    }
    if (found < 0) return null;

    // 거꾸로 되짚는다. trace[d] 는 d 걸음을 시작하기 전의 V(-d..d) 다.
    const reversed: number[] = [];
    let x = n;
    let y = m;
    for (let d = found; d > 0; d--) {
      const saved = trace[d]!;
      const V = (k: number): number => saved[k + d]!;
      const k = x - y;
      const prevK = k === -d || (k !== d && V(k - 1) < V(k + 1)) ? k + 1 : k - 1;
      const prevX = V(prevK);
      const prevY = prevX - prevK;
      const startX = prevK === k + 1 ? prevX : prevX + 1;
      while (x > startX) { reversed.push(0); x--; y--; }
      reversed.push(prevK === k + 1 ? 2 : 1);
      x = prevX; y = prevY;
    }
    while (x > 0) { reversed.push(0); x--; }
    middle.push(...reversed.reverse());
  }

  const out: number[] = new Array<number>(head).fill(0);
  for (const step of middle) out.push(step);
  for (let i = 0; i < tail; i++) out.push(0);
  return out;
}

function normalize(line: string, options: DiffOptions): string {
  let value = line;
  if (options.ignoreWhitespace) value = value.replace(/\s+/gu, ' ').trim();
  if (options.ignoreCase) value = value.toLowerCase();
  return value;
}

/** 같은 글의 줄은 같은 번호를 받는다. 두 쪽이 한 사전을 쓴다. */
function intern(lines: string[], options: DiffOptions, dictionary: Map<string, number>): number[] {
  return lines.map(line => {
    const key = normalize(line, options);
    let id = dictionary.get(key);
    if (id === undefined) { id = dictionary.size; dictionary.set(key, id); }
    return id;
  });
}

export function diffText(textA: string, textB: string, options: DiffOptions = {}): DiffResult {
  const sideA = splitLines(textA);
  const sideB = splitLines(textB);
  const { lines: linesA } = sideA;
  const { lines: linesB } = sideB;
  if (linesA.length > TEXT_DIFF_LIMITS.lines || linesB.length > TEXT_DIFF_LIMITS.lines) {
    throw new Error(`한쪽이 ${TEXT_DIFF_LIMITS.lines.toLocaleString('ko-KR')}줄을 넘어 비교하지 않았습니다. 나눠서 비교해 주세요.`);
  }

  // 빈 줄 무시는 빈 줄을 빼고 비교한 뒤 제자리에 도로 끼워 넣는다.
  const blank = (line: string): boolean => options.ignoreBlankLines === true && line.trim() === '';
  const keptA = linesA.map((_, i) => i).filter(i => !blank(linesA[i]!));
  const keptB = linesB.map((_, i) => i).filter(i => !blank(linesB[i]!));
  const dictionary = new Map<string, number>();
  const idsA = intern(keptA.map(i => linesA[i]!), options, dictionary);
  const idsB = intern(keptB.map(i => linesB[i]!), options, dictionary);

  const script = editScript(idsA, idsB, TEXT_DIFF_LIMITS.edits);
  if (!script) {
    throw new Error(`바뀐 줄이 ${TEXT_DIFF_LIMITS.edits.toLocaleString('ko-KR')}줄을 넘어 비교를 멈췄습니다. 서로 다른 글이거나 너무 많이 바뀌었습니다.`);
  }

  const ops: Op[] = [];
  let nextA = 0;
  let nextB = 0;
  /** 건너뛴 빈 줄을 `untilA`·`untilB` 앞까지 채운다. 양쪽에 있으면 같은 줄로 짝짓는다. */
  const flush = (untilA: number, untilB: number): void => {
    while (nextA < untilA || nextB < untilB) {
      if (nextA < untilA && nextB < untilB) ops.push({ kind: 'same', a: nextA++, b: nextB++ });
      else if (nextA < untilA) ops.push({ kind: 'same', a: nextA++, b: null });
      else ops.push({ kind: 'same', a: null, b: nextB++ });
    }
  };
  let i = 0;
  let j = 0;
  for (const step of script) {
    if (step === 0) {
      const a = keptA[i++]!; const b = keptB[j++]!;
      flush(a, b);
      ops.push({ kind: 'same', a, b });
      nextA = a + 1; nextB = b + 1;
    } else if (step === 1) {
      const a = keptA[i++]!;
      flush(a, nextB);
      ops.push({ kind: 'del', a });
      nextA = a + 1;
    } else {
      const b = keptB[j++]!;
      flush(nextA, b);
      ops.push({ kind: 'add', b });
      nextB = b + 1;
    }
  }
  flush(linesA.length, linesB.length);

  const changed = pairChanges(ops, linesA, linesB);
  const deleted = ops.filter(op => op.kind === 'del').length - changed;
  const added = ops.filter(op => op.kind === 'add').length - changed;
  return { linesA, linesB, ops, added, deleted, changed, finalNewline: { a: sideA.finalNewline, b: sideB.finalNewline } };
}

/**
 * 붙어 있는 삭제 뭉치와 추가 뭉치를 앞에서부터 한 줄씩 짝지어 글자 단위로 비교한다.
 * 짝지은 수를 돌려준다.
 */
function pairChanges(ops: Op[], linesA: string[], linesB: string[]): number {
  let paired = 0;
  let index = 0;
  while (index < ops.length) {
    if (ops[index]!.kind === 'same') { index++; continue; }
    const dels: Array<Op & { kind: 'del' }> = [];
    const adds: Array<Op & { kind: 'add' }> = [];
    while (index < ops.length && ops[index]!.kind !== 'same') {
      const op = ops[index++]!;
      if (op.kind === 'del') dels.push(op); else if (op.kind === 'add') adds.push(op);
    }
    const count = Math.min(dels.length, adds.length);
    for (let n = 0; n < count; n++) {
      const del = dels[n]!; const add = adds[n]!;
      paired++;
      const parts = diffChars(linesA[del.a]!, linesB[add.b]!);
      if (parts) { del.parts = parts.a; add.parts = parts.b; }
    }
  }
  return paired;
}

/**
 * 두 줄의 글자 단위 차이. 너무 길거나 거의 다 다르면 null — 온통 칠해진 줄은
 * 칠하지 않은 줄보다 읽기 어렵다.
 */
export function diffChars(lineA: string, lineB: string): { a: Part[]; b: Part[] } | null {
  const unitsA = graphemes(lineA);
  const unitsB = graphemes(lineB);
  if (unitsA.length > TEXT_DIFF_LIMITS.lineChars || unitsB.length > TEXT_DIFF_LIMITS.lineChars) return null;
  const dictionary = new Map<string, number>();
  const id = (unit: string): number => {
    let value = dictionary.get(unit);
    if (value === undefined) { value = dictionary.size; dictionary.set(unit, value); }
    return value;
  };
  const script = editScript(unitsA.map(id), unitsB.map(id), TEXT_DIFF_LIMITS.charEdits);
  if (!script) return null;
  const same = script.filter(step => step === 0).length;
  // 같은 글자가 짧은 쪽의 3할도 안 되면 사실상 새 줄이다.
  if (same < Math.min(unitsA.length, unitsB.length) * 0.3) return null;

  const a: Part[] = [];
  const b: Part[] = [];
  const push = (parts: Part[], text: string, changed: boolean): void => {
    const last = parts[parts.length - 1];
    if (last && last.changed === changed) last.text += text;
    else parts.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  for (const step of script) {
    if (step === 0) { push(a, unitsA[i++]!, false); push(b, unitsB[j++]!, false); }
    else if (step === 1) push(a, unitsA[i++]!, true);
    else push(b, unitsB[j++]!, true);
  }
  return { a, b };
}

/** 화면에 그릴 줄. 줄 번호는 1부터다. */
export type Row =
  | { kind: 'same'; a: number | null; b: number | null; text: string }
  | { kind: 'del'; a: number; text: string; parts?: Part[] }
  | { kind: 'add'; b: number; text: string; parts?: Part[] }
  | { kind: 'skip'; count: number };

/** 바뀐 곳 사이의 긴 같은 줄은 "… N줄 같음 …" 한 줄로 접는다. */
export function viewRows(result: DiffResult, context = 3): Row[] {
  const rows: Row[] = [];
  const { ops, linesA, linesB } = result;
  let index = 0;
  while (index < ops.length) {
    const op = ops[index]!;
    if (op.kind === 'del') { rows.push({ kind: 'del', a: op.a + 1, text: linesA[op.a]!, ...(op.parts ? { parts: op.parts } : {}) }); index++; continue; }
    if (op.kind === 'add') { rows.push({ kind: 'add', b: op.b + 1, text: linesB[op.b]!, ...(op.parts ? { parts: op.parts } : {}) }); index++; continue; }
    let end = index;
    while (end < ops.length && ops[end]!.kind === 'same') end++;
    const run = ops.slice(index, end) as Array<Op & { kind: 'same' }>;
    const keepHead = index === 0 ? 0 : context;
    const keepTail = end === ops.length ? 0 : context;
    const toRow = (same: Op & { kind: 'same' }): Row => ({
      kind: 'same',
      a: same.a === null ? null : same.a + 1,
      b: same.b === null ? null : same.b + 1,
      text: same.a !== null ? linesA[same.a]! : linesB[same.b!]!,
    });
    if (run.length > keepHead + keepTail + 1) {
      run.slice(0, keepHead).forEach(same => rows.push(toRow(same)));
      rows.push({ kind: 'skip', count: run.length - keepHead - keepTail });
      run.slice(run.length - keepTail).forEach(same => rows.push(toRow(same)));
    } else run.forEach(same => rows.push(toRow(same)));
    index = end;
  }
  return rows;
}

/**
 * 통합 차이(unified diff). 바뀐 곳마다 앞뒤 `context` 줄을 붙이고, 문맥이 겹치는
 * 곳은 한 덩이로 합친다. 같으면 빈 문자열.
 *
 * 빈 줄 무시로 한쪽에만 있는 빈 줄은 덩이를 새로 만들지 않지만, 덩이 안에 들면
 * `-`/`+` 로 적는다 — 그래야 줄 번호가 맞는다.
 */
export function unifiedDiff(result: DiffResult, nameA: string, nameB: string, context = 3): string {
  const { ops, linesA, linesB } = result;
  const isChange = (op: Op): boolean => op.kind !== 'same';
  const changes = ops.map((op, index) => isChange(op) ? index : -1).filter(index => index >= 0);
  if (!changes.length) return '';

  // 덩이의 범위를 ops 의 자리로 모은다.
  const hunks: Array<[number, number]> = [];
  for (const index of changes) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length, index + context + 1);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  }

  const out = [`--- ${nameA}`, `+++ ${nameB}`];
  // 덩이가 시작하는 곳의 줄 번호를 알려면 그 앞까지 몇 줄씩 지났는지 세야 한다.
  let seenA = 0;
  let seenB = 0;
  let cursor = 0;
  const advance = (op: Op): void => {
    if (op.kind === 'same') { if (op.a !== null) seenA++; if (op.b !== null) seenB++; }
    else if (op.kind === 'del') seenA++;
    else seenB++;
  };
  const range = (start: number, count: number): string =>
    count === 1 ? `${start}` : `${count === 0 ? start - 1 : start},${count}`;

  for (const [start, end] of hunks) {
    while (cursor < start) advance(ops[cursor++]!);
    const body: string[] = [];
    let countA = 0;
    let countB = 0;
    for (let index = start; index < end; index++) {
      const op = ops[index]!;
      if (op.kind === 'same') {
        if (op.a !== null && op.b !== null) { body.push(` ${linesA[op.a]}`); countA++; countB++; }
        else if (op.a !== null) { body.push(`-${linesA[op.a]}`); countA++; }
        else if (op.b !== null) { body.push(`+${linesB[op.b]}`); countB++; }
      } else if (op.kind === 'del') { body.push(`-${linesA[op.a]}`); countA++; }
      else { body.push(`+${linesB[op.b]}`); countB++; }
    }
    out.push(`@@ -${range(seenA + 1, countA)} +${range(seenB + 1, countB)} @@`, ...body);
    while (cursor < end) advance(ops[cursor++]!);
  }
  return `${out.join('\n')}\n`;
}
