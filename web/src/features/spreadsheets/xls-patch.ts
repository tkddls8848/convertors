/**
 * .xls(엑셀 97–2003, BIFF8) 의 숫자 칸과 수식 계산값을 **제자리에서** 고친다.
 *
 * SheetJS 로 읽고 다시 쓰면 글꼴·테두리·병합·인쇄 설정 같은 양식이 떨어진다. 견적서는
 * 남에게 보내는 문서라 양식이 그대로여야 한다. 그래서 파일을 새로 만들지 않고, 칸의
 * 값이 든 몇 바이트만 같은 크기로 덮어쓴다 — 나머지 바이트는 하나도 바뀌지 않는다.
 *
 * 크기가 같아야 하므로 할 수 있는 것과 없는 것이 갈린다.
 *   - NUMBER(8바이트 실수) 칸: 어떤 숫자든 된다.
 *   - RK·MULRK(4바이트로 접은 숫자) 칸: 접을 수 있는 숫자만(정수 ±5억, 소수 둘째 자리 등).
 *   - 수식 칸의 계산값: 숫자·참거짓·오류는 8바이트 자리에 들어간다. **글자 결과**(한글 금액
 *     등)는 뒤따르는 STRING 기록에 든다. 길이가 바뀌므로 기록을 늘이거나 줄이고, 그 행 묶음의
 *     행 색인(DBCELL)과 뒤쪽 절대 위치(INDEX·BOUNDSHEET)를 함께 고친다(`spliceBiff`).
 *   - 빈 칸·글자 칸에 숫자 넣기: 기록을 새로 끼워야 해서 못 한다.
 *   - 글자 칸(LABELSST): 칸은 공유 문자열 표(SST)의 번호만 든다. 새 글자를 SST 끝에 붙이고
 *     칸의 번호(4바이트)만 바꾼다. SST 가 길어지므로 그 뒤 내용이 밀린다 — 시트 시작
 *     위치(BOUNDSHEET)와 행 색인(INDEX)의 절대 위치를 함께 고치고, 복합 문서를 다시 묶는다.
 *     각 스트림의 내용은 그대로이고 Workbook 스트림만 SST 꼬리가 늘어난다.
 * 덧붙여 RECALCID 의 계산기 빌드 번호를 0 으로 둔다. 엑셀은 저장한 계산기가 자기보다
 * 옛것이면 열 때 모든 수식을 다시 계산한다 — 우리가 못 쓴 칸도 엑셀에서는 맞게 보인다.
 */

import { CFB } from 'xlsx';

export type XlsValue = number | string | boolean | { error: string } | null;
export interface XlsWrite { sheet: string; address: string; value: XlsValue }
export interface XlsProblem { sheet: string; address: string; reason: string }

// --- RK ------------------------------------------------------------------------

/** 4바이트 RK 로 접을 수 있으면 그 값(부호 없는 32비트), 아니면 null. */
export function encodeRk(x: number): number | null {
  if (!Number.isFinite(x)) return null;
  const candidates: number[] = [];
  if (Number.isInteger(x) && x >= -(2 ** 29) && x < 2 ** 29) candidates.push(((x << 2) | 2) >>> 0);
  const hundred = Math.round(x * 100);
  if (Math.abs(hundred) < 2 ** 29) candidates.push(((hundred << 2) | 3) >>> 0);
  for (const [scaled, flag] of [[x, 0], [x * 100, 1]] as const) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, scaled, true);
    if (view.getUint32(0, true) === 0 && (view.getUint32(4, true) & 3) === 0) candidates.push((view.getUint32(4, true) | flag) >>> 0);
  }
  return candidates.find(rk => decodeRk(rk) === x) ?? null;
}

export function decodeRk(rk: number): number {
  let value: number;
  if (rk & 2) value = (rk | 0) >> 2;
  else {
    const view = new DataView(new ArrayBuffer(8));
    view.setUint32(4, (rk & 0xfffffffc) >>> 0, true);
    value = view.getFloat64(0, true);
  }
  return rk & 1 ? value / 100 : value;
}

// --- BIFF8 기록 ------------------------------------------------------------------

const RT = {
  BOF: 0x0809, EOF: 0x000a, FILEPASS: 0x002f, BOUNDSHEET: 0x0085, RECALCID: 0x01c1,
  NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd, FORMULA: 0x0006,
  SST: 0x00fc, CONTINUE: 0x003c, LABELSST: 0x00fd, LABEL: 0x0204, INDEX: 0x020b,
  STRING: 0x0207, SHRFMLA: 0x04bc, ARRAY: 0x0221, TABLE: 0x0236, ROW: 0x0208, DBCELL: 0x00d7,
} as const;
/** 행의 첫 칸이 될 수 있는 기록(DBCELL 이 가리키는 것). STRING·SHRFMLA 는 앞 수식에 딸린다. */
const CELL_RECORDS = new Set([0x00fd, 0x0203, 0x027e, 0x00bd, 0x0006, 0x0201, 0x00be, 0x0205, 0x0204, 0x00d6]);
/** BIFF8 기록 하나의 본문 최대 길이. */
const MAX_RECORD = 8224;
/** 한 칸에 넣을 글자 수 한도. 공유 문자열 하나가 기록 하나에 들어가야 한다. */
export const MAX_TEXT = 4000;

export interface BiffCell {
  kind: 'number' | 'rk' | 'formula' | 'formula-text' | 'sst' | 'label';
  /** 값이 든 자리(스트림 안 바이트 위치). number·formula 는 8바이트, rk 는 4바이트. */
  at: number;
  /** 수식 칸의 grbit 자리. */
  flagsAt?: number;
  /** 수식에 딸린 STRING 기록의 시작 자리(글자 결과일 때). */
  stringAt?: number;
  /** 수식 기록(과 딸린 SHRFMLA·ARRAY)이 끝난 자리 — STRING 을 새로 끼울 곳. */
  insertAt?: number;
  alwaysCalc?: boolean;
}

const columnName = (index: number): string => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
const addressOf = (row: number, col: number): string => `${columnName(col)}${row + 1}`;

/** 공유 문자열 표의 자리: 첫 기록, 마지막 기록(SST 또는 CONTINUE), 사슬이 끝난 다음 자리. */
export interface SstChain { at: number; lastAt: number; end: number; unique: number }

export function indexBiff(stream: Uint8Array): {
  cells: Map<string, BiffCell>; recalcAt?: number; recalcBuild?: number; sst?: SstChain; read(key: string): number | undefined;
} {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const sheetAt = new Map<number, string>();
  const cells = new Map<string, BiffCell>();
  let recalcAt: number | undefined;
  let sst: SstChain | undefined;
  let inSst = false;
  let formula: BiffCell | null = null;
  let current: string | null = null;
  let first = true;

  for (let at = 0; at + 4 <= stream.length;) {
    const id = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    const body = at + 4;
    if (body + length > stream.length) break;
    if (inSst && id !== RT.CONTINUE) { sst!.end = at; inSst = false; }
    if (formula) {
      if (id === RT.STRING) { formula.stringAt = at; formula = null; }
      else if (id === RT.SHRFMLA || id === RT.ARRAY || id === RT.TABLE) formula.insertAt = body + length;
      else formula = null;
    }
    if (inSst) sst!.lastAt = at;
    if (first) {
      if (id !== RT.BOF || view.getUint16(body, true) !== 0x0600) throw new Error('엑셀 97–2003(BIFF8) 형식의 xls 만 고칠 수 있습니다.');
      first = false;
    }
    switch (id) {
      case RT.FILEPASS: throw new Error('암호가 걸린 xls 는 열지 않습니다. 암호를 푼 사본을 넣어 주세요.');
      case RT.BOUNDSHEET: {
        const count = stream[body + 6]!;
        const wide = stream[body + 7]! & 1;
        const chars = stream.subarray(body + 8, body + 8 + count * (wide ? 2 : 1));
        const name = wide ? new TextDecoder('utf-16le').decode(chars) : String.fromCharCode(...chars);
        sheetAt.set(view.getUint32(body, true), name);
        break;
      }
      case RT.RECALCID: recalcAt = body + 4; break;
      case RT.SST: sst = { at, lastAt: at, end: body + length, unique: view.getUint32(body + 4, true) }; inSst = true; break;
      case RT.LABELSST: case RT.LABEL: {
        if (!current) break;
        const key = `${current}!${addressOf(view.getUint16(body, true), view.getUint16(body + 2, true))}`;
        cells.set(key, id === RT.LABELSST ? { kind: 'sst', at: body + 6 } : { kind: 'label', at: body + 6 });
        break;
      }
      case RT.BOF: current = view.getUint16(body + 2, true) === 0x0010 ? sheetAt.get(at) ?? null : null; break;
      case RT.EOF: current = null; break;
      case RT.NUMBER: case RT.RK: case RT.FORMULA: {
        if (!current) break;
        const key = `${current}!${addressOf(view.getUint16(body, true), view.getUint16(body + 2, true))}`;
        if (id === RT.NUMBER) cells.set(key, { kind: 'number', at: body + 6 });
        else if (id === RT.RK) cells.set(key, { kind: 'rk', at: body + 6 });
        else {
          const special = view.getUint16(body + 12, true) === 0xffff;
          const text = special && (stream[body + 6] === 0 || stream[body + 6] === 3);
          formula = { kind: text ? 'formula-text' : 'formula', at: body + 6, flagsAt: body + 14, insertAt: body + length, alwaysCalc: (view.getUint16(body + 14, true) & 1) === 1 };
          cells.set(key, formula);
        }
        break;
      }
      case RT.MULRK: {
        if (!current) break;
        const row = view.getUint16(body, true);
        const firstCol = view.getUint16(body + 2, true);
        const count = (length - 6) / 6;
        for (let i = 0; i < count; i++) cells.set(`${current}!${addressOf(row, firstCol + i)}`, { kind: 'rk', at: body + 4 + i * 6 + 2 });
        break;
      }
      default: break;
    }
    at = body + length;
  }

  return {
    cells, ...(recalcAt === undefined ? {} : { recalcAt, recalcBuild: view.getUint32(recalcAt, true) }),
    ...(sst ? { sst } : {}),
    read(key) {
      const cell = cells.get(key);
      if (!cell || cell.kind === 'sst' || cell.kind === 'label') return undefined;
      if (cell.kind === 'rk') return decodeRk(view.getUint32(cell.at, true));
      if (cell.kind === 'formula-text') return undefined;
      return view.getFloat64(cell.at, true);
    },
  };
}

const ERROR_CODES: Record<string, number> = {
  '#NULL!': 0x00, '#DIV/0!': 0x07, '#VALUE!': 0x0f, '#REF!': 0x17, '#NAME?': 0x1d, '#NUM!': 0x24, '#N/A': 0x2a,
};
const float = (x: number): Uint8Array => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x, true); return b; };
const word = (x: number, size: 2 | 4): Uint8Array => {
  const b = new Uint8Array(size);
  const v = new DataView(b.buffer);
  if (size === 2) v.setUint16(0, x, true); else v.setUint32(0, x >>> 0, true);
  return b;
};

/** 스트림 안에서 덮어쓸 자리와 바이트를 돌려준다. 스트림 자체는 건드리지 않는다. */
export interface Splice { at: number; remove: number; insert: Uint8Array }

/** STRING 기록 한 개(수식의 글자 결과). */
function stringRecord(text: string): Uint8Array {
  const body = encodeString(text);
  const out = new Uint8Array(4 + body.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, RT.STRING, true);
  view.setUint16(2, body.length, true);
  out.set(body, 4);
  return out;
}

export function patchBiff(stream: Uint8Array, requests: XlsWrite[]): {
  writes: Array<{ at: number; bytes: Uint8Array }>; problems: XlsProblem[]; strings: string[]; splices: Splice[];
} {
  const index = indexBiff(stream);
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const writes: Array<{ at: number; bytes: Uint8Array }> = [];
  const problems: XlsProblem[] = [];
  /** SST 끝에 붙일 새 글자. 칸에는 (기존 개수 + 순번) 을 미리 적어 둔다. */
  const strings: string[] = [];
  /** 길이가 바뀌는 고침 — STRING 기록을 바꾸거나 끼우거나 뺀다. */
  const splices: Splice[] = [];
  const recordLength = (at: number): number => 4 + view.getUint16(at + 2, true);
  const recalcOnOpen = (cell: BiffCell): void => {
    writes.push({ at: cell.flagsAt!, bytes: word(view.getUint16(cell.flagsAt!, true) | 1, 2) });
  };

  for (const request of requests) {
    const cell = index.cells.get(`${request.sheet}!${request.address}`);
    const fail = (reason: string): void => { problems.push({ sheet: request.sheet, address: request.address, reason }); };
    const value = request.value;
    if (!cell) { fail('빈 칸이라 고칠 수 없습니다.'); continue; }
    if (cell.kind === 'label') { fail('이 글자 칸은 공유 문자열을 쓰지 않는 옛 꼴이라 고칠 수 없습니다.'); continue; }
    if (cell.kind === 'sst') {
      if (typeof value !== 'string') { fail('글자 칸에는 글자만 넣을 수 있습니다.'); continue; }
      if (!index.sst) { fail('공유 문자열 표를 찾지 못해 글자를 바꿀 수 없습니다.'); continue; }
      if (value.length > MAX_TEXT) { fail(`글자는 한 칸에 ${MAX_TEXT}자까지 넣을 수 있습니다.`); continue; }
      writes.push({ at: cell.at, bytes: word(index.sst.unique + strings.length, 4) });
      strings.push(value);
      continue;
    }
    if (cell.kind === 'number' || cell.kind === 'rk') {
      if (typeof value !== 'number') { fail('숫자 칸에는 숫자만 넣을 수 있습니다.'); continue; }
      if (cell.kind === 'number') { writes.push({ at: cell.at, bytes: float(value) }); continue; }
      const rk = encodeRk(value);
      if (rk === null) { fail(`이 칸은 파일 구조상 ${value} 을(를) 담을 수 없습니다. 정수는 ±5억 안, 소수는 둘째 자리까지 됩니다.`); continue; }
      writes.push({ at: cell.at, bytes: word(rk, 4) });
      continue;
    }
    // 수식 칸의 계산값. 글자가 아닌 결과로 바뀌면 딸린 STRING 기록을 뺀다.
    const dropString = (): void => { if (cell.stringAt !== undefined) splices.push({ at: cell.stringAt, remove: recordLength(cell.stringAt), insert: new Uint8Array() }); };
    if (typeof value === 'number') {
      writes.push({ at: cell.at, bytes: float(value) });
      dropString();
    } else if (typeof value === 'boolean') {
      writes.push({ at: cell.at, bytes: new Uint8Array([1, 0, value ? 1 : 0, 0, 0, 0, 0xff, 0xff]) });
      dropString();
    } else if (value === null || value === '') {
      writes.push({ at: cell.at, bytes: new Uint8Array([3, 0, 0, 0, 0, 0, 0xff, 0xff]) });
      dropString();
    } else if (typeof value === 'object') {
      writes.push({ at: cell.at, bytes: new Uint8Array([2, 0, ERROR_CODES[value.error] ?? 0x0f, 0, 0, 0, 0xff, 0xff]) });
      dropString();
    } else if (value.length > MAX_TEXT) {
      recalcOnOpen(cell);
      fail(`수식 결과가 ${MAX_TEXT}자를 넘어 바로 쓰지 못했습니다 — 엑셀에서 열면 다시 계산됩니다.`);
    } else {
      writes.push({ at: cell.at, bytes: new Uint8Array([0, 0, 0, 0, 0, 0, 0xff, 0xff]) });
      if (cell.stringAt !== undefined) splices.push({ at: cell.stringAt, remove: recordLength(cell.stringAt), insert: stringRecord(value) });
      else splices.push({ at: cell.insertAt!, remove: 0, insert: stringRecord(value) });
    }
  }
  if (writes.length && index.recalcAt !== undefined) writes.push({ at: index.recalcAt, bytes: word(0, 4) });
  return { writes, problems, strings, splices };
}

/**
 * 시트 안 `at` 자리에서 `remove` 바이트를 빼고 `insert` 를 끼운 새 스트림.
 * 밀린 만큼 고친다 — BOUNDSHEET 의 시트 시작 위치, INDEX 의 절대 위치(DEFCOLWIDTH·DBCELL),
 * 그리고 그 자리가 든 행 묶음의 DBCELL(첫 ROW 까지 거리, 바뀐 자리 뒤 첫 행의 칸 거리).
 * DBCELL 의 규칙은 엑셀이 만든 파일에서 읽어 확인했다(xls-patch.test.ts 의 dbcellMismatches).
 */
export function spliceBiff(stream: Uint8Array, at: number, remove: number, insert: Uint8Array): Uint8Array {
  const delta = insert.length - remove;
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);

  // 바뀐 자리가 든 행 묶음의 DBCELL 을 옛 스트림에서 찾는다.
  let dbcell: { at: number; length: number; entry: number } | null = null;
  let rows: Array<{ at: number; row: number }> = [];
  const firstCell = new Map<number, number>();
  for (let p = 0; p + 4 <= stream.length && !dbcell;) {
    const id = view.getUint16(p, true);
    const length = view.getUint16(p + 2, true);
    const body = p + 4;
    if (id === RT.ROW) rows.push({ at: p, row: view.getUint16(body, true) });
    else if (CELL_RECORDS.has(id)) { const row = view.getUint16(body, true); if (!firstCell.has(row)) firstCell.set(row, p); }
    else if (id === RT.DBCELL) {
      if (rows.length && rows[0]!.at < at && at < p) {
        const entry = rows.findIndex(r => (firstCell.get(r.row) ?? -1) > at);
        dbcell = { at: p, length, entry };
      }
      rows = []; firstCell.clear();
    } else if (id === RT.BOF || id === RT.EOF) { rows = []; firstCell.clear(); }
    p = body + length;
  }

  const out = new Uint8Array(stream.length + delta);
  out.set(stream.subarray(0, at), 0);
  out.set(insert, at);
  out.set(stream.subarray(at + remove), at + insert.length);
  const next = new DataView(out.buffer);
  const shift = (p: number): void => { const v = next.getUint32(p, true); if (v > at) next.setUint32(p, v + delta, true); };
  for (let p = 0; p + 4 <= out.length;) {
    const id = next.getUint16(p, true);
    const length = next.getUint16(p + 2, true);
    const body = p + 4;
    if (id === RT.BOUNDSHEET) shift(body);
    if (id === RT.INDEX) { shift(body + 12); for (let q = body + 16; q + 4 <= body + length; q += 4) shift(q); }
    p = body + length;
  }
  if (dbcell) {
    const body = dbcell.at + delta + 4;
    next.setUint32(body, next.getUint32(body, true) + delta, true);
    if (dbcell.entry >= 0) {
      const slot = body + 4 + dbcell.entry * 2;
      next.setUint16(slot, next.getUint16(slot, true) + delta, true);
    }
  }
  return out;
}

/** XLUnicodeRichExtendedString — 늘 2바이트 글자(fHighByte)로 쓴다. 한글이 섞이기 때문이다. */
function encodeString(text: string): Uint8Array {
  const out = new Uint8Array(3 + text.length * 2);
  const view = new DataView(out.buffer);
  view.setUint16(0, text.length, true);
  out[2] = 0x01;
  for (let i = 0; i < text.length; i++) view.setUint16(3 + i * 2, text.charCodeAt(i), true);
  return out;
}

/**
 * SST 사슬 끝에 글자를 붙인 새 스트림. 마지막 기록에 자리가 있으면 거기 잇고, 없으면
 * CONTINUE 기록을 새로 단다(글자 하나는 쪼개지 않는다). 그 뒤로 밀린 만큼 시트 시작
 * 위치(BOUNDSHEET)와 행 색인(INDEX)의 절대 위치를 고친다.
 */
export function growSst(stream: Uint8Array, strings: string[]): Uint8Array {
  if (!strings.length) return stream;
  const sst = indexBiff(stream).sst;
  if (!sst) throw new Error('공유 문자열 표가 없습니다.');
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const records: Array<{ id: number; body: number[] }> = [];
  let last = { id: view.getUint16(sst.lastAt, true), body: [...stream.subarray(sst.lastAt + 4, sst.end)] };
  for (const text of strings) {
    const bytes = encodeString(text);
    if (last.body.length + bytes.length > MAX_RECORD) { records.push(last); last = { id: RT.CONTINUE, body: [] }; }
    last.body.push(...bytes);
  }
  records.push(last);
  const tail = records.flatMap(r => [r.id & 0xff, r.id >> 8, r.body.length & 0xff, r.body.length >> 8, ...r.body]);
  const grown = new Uint8Array(sst.lastAt + tail.length + (stream.length - sst.end));
  grown.set(stream.subarray(0, sst.lastAt), 0);
  grown.set(tail, sst.lastAt);
  grown.set(stream.subarray(sst.end), sst.lastAt + tail.length);
  const delta = grown.length - stream.length;

  const out = new DataView(grown.buffer);
  out.setUint32(sst.at + 4 + 4, sst.unique + strings.length, true);
  const shift = (at: number): void => { const v = out.getUint32(at, true); if (v >= sst.end) out.setUint32(at, v + delta, true); };
  for (let at = 0; at + 4 <= grown.length;) {
    const id = out.getUint16(at, true);
    const length = out.getUint16(at + 2, true);
    const body = at + 4;
    if (id === RT.BOUNDSHEET) shift(body);
    if (id === RT.INDEX) {
      shift(body + 12);
      for (let q = body + 16; q + 4 <= body + length; q += 4) shift(q);
    }
    at = body + length;
  }
  return grown;
}

// --- 복합 문서(CFB) 안의 Workbook 스트림 -------------------------------------------

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;

/** 스트림 안의 바이트 위치를 파일 안 위치로 바꾸는 함수와, 스트림 크기. */
function locate(file: Uint8Array, wanted: string[]): { name: string; size: number; offsetOf(pos: number): number } | null {
  if (file.length < 512 || SIGNATURE.some((b, i) => file[i] !== b)) throw new Error('xls(엑셀 97–2003) 파일이 아닙니다.');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const sectorSize = 1 << view.getUint16(0x1e, true);
  const miniSize = 1 << view.getUint16(0x20, true);
  const cutoff = view.getUint32(0x38, true);
  const sectorAt = (n: number): number => (n + 1) * sectorSize;

  // FAT 섹터 목록: 머리말의 109개 + DIFAT 사슬.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) { const s = view.getUint32(0x4c + i * 4, true); if (s < END - 1) fatSectors.push(s); }
  for (let dif = view.getUint32(0x44, true), guard = 0; dif < END - 1 && guard < 10000; guard++) {
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per; i++) { const s = view.getUint32(sectorAt(dif) + i * 4, true); if (s < END - 1) fatSectors.push(s); }
    dif = view.getUint32(sectorAt(dif) + per * 4, true);
  }
  const fat = (n: number): number => {
    const per = sectorSize / 4;
    const sector = fatSectors[Math.floor(n / per)];
    if (sector === undefined) throw new Error('xls 파일 구조가 깨졌습니다(FAT).');
    return view.getUint32(sectorAt(sector) + (n % per) * 4, true);
  };
  const chain = (start: number): number[] => {
    const out: number[] = [];
    for (let s = start; s < END - 1; s = fat(s)) {
      out.push(s);
      if (out.length > file.length / sectorSize + 1) throw new Error('xls 파일 구조가 깨졌습니다(사슬).');
    }
    return out;
  };

  const directory = chain(view.getUint32(0x30, true));
  const entries: Array<{ name: string; type: number; start: number; size: number }> = [];
  for (const sector of directory) {
    for (let i = 0; i < sectorSize / 128; i++) {
      const base = sectorAt(sector) + i * 128;
      const nameBytes = Math.max(0, view.getUint16(base + 0x40, true) - 2);
      entries.push({
        name: new TextDecoder('utf-16le').decode(file.subarray(base, base + nameBytes)),
        type: file[base + 0x42]!, start: view.getUint32(base + 0x74, true), size: view.getUint32(base + 0x78, true),
      });
    }
  }
  const root = entries[0]!;
  const entry = entries.find(e => e.type === 2 && wanted.some(w => w.toLowerCase() === e.name.toLowerCase()));
  if (!entry) return null;

  if (entry.size >= cutoff) {
    const sectors = chain(entry.start);
    return { name: entry.name, size: entry.size, offsetOf: pos => sectorAt(sectors[Math.floor(pos / sectorSize)]!) + (pos % sectorSize) };
  }
  // 작은 스트림은 루트의 미니 스트림 안에 64바이트 조각으로 산다.
  const rootSectors = chain(root.start);
  const miniFat = chain(view.getUint32(0x3c, true));
  const miniNext = (n: number): number => {
    const per = sectorSize / 4;
    return view.getUint32(sectorAt(miniFat[Math.floor(n / per)]!) + (n % per) * 4, true);
  };
  const minis: number[] = [];
  for (let m = entry.start; m < END - 1; m = miniNext(m)) {
    minis.push(m);
    if (minis.length > entry.size / miniSize + 1) throw new Error('xls 파일 구조가 깨졌습니다(미니 사슬).');
  }
  return {
    name: entry.name, size: entry.size,
    offsetOf: pos => {
      const inMini = minis[Math.floor(pos / miniSize)]! * miniSize + (pos % miniSize);
      return sectorAt(rootSectors[Math.floor(inMini / sectorSize)]!) + (inMini % sectorSize);
    },
  };
}

/** 고친 xls 바이트와, 고치지 못한 칸의 까닭. 원본 배열은 건드리지 않는다. */
export function patchXls(file: Uint8Array, requests: XlsWrite[]): { bytes: Uint8Array; problems: XlsProblem[] } {
  const workbook = locate(file, ['Workbook']);
  if (!workbook) {
    if (locate(file, ['Book'])) throw new Error('엑셀 95 이전 형식(BIFF5)의 xls 는 고칠 수 없습니다. 엑셀에서 97–2003 형식으로 다시 저장해 주세요.');
    throw new Error('xls 안에서 통합 문서를 찾지 못했습니다.');
  }
  const stream = new Uint8Array(workbook.size);
  for (let i = 0; i < workbook.size; i++) stream[i] = file[workbook.offsetOf(i)]!;
  const { writes, problems, strings, splices } = patchBiff(stream, requests);
  if (!strings.length && !splices.length) {
    // 숫자만 고쳤다 — 파일 안 제자리에 덮어쓴다. 나머지 바이트는 하나도 바뀌지 않는다.
    const bytes = file.slice();
    for (const write of writes) write.bytes.forEach((b, i) => { bytes[workbook.offsetOf(write.at + i)] = b; });
    return { bytes, problems };
  }
  // 글자를 붙였거나 수식의 글자 결과를 바꿨다 — 스트림 길이가 바뀌므로 복합 문서를 다시 묶는다.
  // 다른 스트림의 내용은 그대로다.
  for (const write of writes) stream.set(write.bytes, write.at);
  // 뒤쪽부터 늘이고 줄인다 — 앞쪽 자리는 그대로라 남은 고침의 위치가 어긋나지 않는다.
  let edited: Uint8Array = stream;
  for (const splice of [...splices].sort((a, b) => b.at - a.at)) edited = spliceBiff(edited, splice.at, splice.remove, splice.insert);
  const grown = growSst(edited, strings);
  const container = CFB.read(file, { type: 'array' });
  const entry = CFB.find(container, workbook.name);
  if (!entry) throw new Error('xls 안에서 통합 문서를 찾지 못했습니다.');
  entry.content = grown as unknown as typeof entry.content;
  entry.size = grown.length;
  const written = CFB.write(container, { type: 'array', fileType: 'cfb' }) as ArrayBuffer | number[];
  return { bytes: new Uint8Array(written), problems };
}
