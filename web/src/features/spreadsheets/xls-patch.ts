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
 *   - 수식 칸의 계산값: 숫자·참거짓·오류는 8바이트 자리에 들어간다. **글자 결과**는 뒤따르는
 *     STRING 기록의 길이가 바뀌어 못 쓴다 — 그 칸은 "열 때 다시 계산" 표시를 하고 알린다.
 *   - 빈 칸·글자 칸에 숫자 넣기: 기록을 새로 끼워야 해서 못 한다.
 * 덧붙여 RECALCID 의 계산기 빌드 번호를 0 으로 둔다. 엑셀은 저장한 계산기가 자기보다
 * 옛것이면 열 때 모든 수식을 다시 계산한다 — 우리가 못 쓴 칸도 엑셀에서는 맞게 보인다.
 */

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
} as const;

export interface BiffCell {
  kind: 'number' | 'rk' | 'formula' | 'formula-text';
  /** 값이 든 자리(스트림 안 바이트 위치). number·formula 는 8바이트, rk 는 4바이트. */
  at: number;
  /** 수식 칸의 grbit 자리. */
  flagsAt?: number;
  alwaysCalc?: boolean;
}

const columnName = (index: number): string => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
const addressOf = (row: number, col: number): string => `${columnName(col)}${row + 1}`;

export function indexBiff(stream: Uint8Array): {
  cells: Map<string, BiffCell>; recalcAt?: number; recalcBuild?: number; read(key: string): number | undefined;
} {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const sheetAt = new Map<number, string>();
  const cells = new Map<string, BiffCell>();
  let recalcAt: number | undefined;
  let current: string | null = null;
  let first = true;

  for (let at = 0; at + 4 <= stream.length;) {
    const id = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    const body = at + 4;
    if (body + length > stream.length) break;
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
          cells.set(key, { kind: text ? 'formula-text' : 'formula', at: body + 6, flagsAt: body + 14, alwaysCalc: (view.getUint16(body + 14, true) & 1) === 1 });
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
    read(key) {
      const cell = cells.get(key);
      if (!cell) return undefined;
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
export function patchBiff(stream: Uint8Array, requests: XlsWrite[]): { writes: Array<{ at: number; bytes: Uint8Array }>; problems: XlsProblem[] } {
  const index = indexBiff(stream);
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const writes: Array<{ at: number; bytes: Uint8Array }> = [];
  const problems: XlsProblem[] = [];
  const recalcOnOpen = (cell: BiffCell): void => {
    writes.push({ at: cell.flagsAt!, bytes: word(view.getUint16(cell.flagsAt!, true) | 1, 2) });
  };

  for (const request of requests) {
    const cell = index.cells.get(`${request.sheet}!${request.address}`);
    const fail = (reason: string): void => { problems.push({ sheet: request.sheet, address: request.address, reason }); };
    const value = request.value;
    if (!cell) { fail('숫자가 든 칸이 아니라 고칠 수 없습니다(빈 칸·글자 칸).'); continue; }
    if (cell.kind === 'number' || cell.kind === 'rk') {
      if (typeof value !== 'number') { fail('숫자 칸에는 숫자만 넣을 수 있습니다.'); continue; }
      if (cell.kind === 'number') { writes.push({ at: cell.at, bytes: float(value) }); continue; }
      const rk = encodeRk(value);
      if (rk === null) { fail(`이 칸은 파일 구조상 ${value} 을(를) 담을 수 없습니다. 정수는 ±5억 안, 소수는 둘째 자리까지 됩니다.`); continue; }
      writes.push({ at: cell.at, bytes: word(rk, 4) });
      continue;
    }
    // 수식 칸의 계산값
    if (typeof value === 'number') {
      if (cell.kind === 'formula') writes.push({ at: cell.at, bytes: float(value) });
      else { recalcOnOpen(cell); fail('글자를 내던 수식이 숫자를 내게 되어 이 파일에 바로 쓸 수 없습니다 — 엑셀에서 열면 다시 계산됩니다.'); }
    } else if (typeof value === 'boolean') {
      writes.push({ at: cell.at, bytes: new Uint8Array([1, 0, value ? 1 : 0, 0, 0, 0, 0xff, 0xff]) });
    } else if (value === null || value === '') {
      writes.push({ at: cell.at, bytes: new Uint8Array([3, 0, 0, 0, 0, 0, 0xff, 0xff]) });
    } else if (typeof value === 'object') {
      writes.push({ at: cell.at, bytes: new Uint8Array([2, 0, ERROR_CODES[value.error] ?? 0x0f, 0, 0, 0, 0xff, 0xff]) });
    } else {
      recalcOnOpen(cell);
      fail('글자 결과는 이 파일에 바로 쓸 수 없어, 엑셀에서 열면 다시 계산되도록 표시했습니다. 휴대폰 미리보기에는 옛 값이 보일 수 있습니다.');
    }
  }
  if (writes.length && index.recalcAt !== undefined) writes.push({ at: index.recalcAt, bytes: word(0, 4) });
  return { writes, problems };
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
  const { writes, problems } = patchBiff(stream, requests);
  const bytes = file.slice();
  for (const write of writes) write.bytes.forEach((b, i) => { bytes[workbook.offsetOf(write.at + i)] = b; });
  return { bytes, problems };
}
