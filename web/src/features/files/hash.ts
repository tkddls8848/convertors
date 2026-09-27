/**
 * 파일 해시.
 *
 * SHA 갈래는 브라우저의 `crypto.subtle.digest` 를 쓴다. 빠르고 검증된 구현이지만
 * **한 번에 통째로** 받아야 해서(이어 넣는 API 가 없다) 파일 전체가 메모리에 올라간다.
 * 그래서 SHA 는 파일당 512MB 로 막는다.
 *
 * MD5 는 subtle 에 없다. 그런데 내려받기 사이트가 아직 MD5 를 많이 적어 두므로
 * 여기서 직접 구현한다. 조각씩 넣을 수 있게(update/digest) 만들어 큰 파일도
 * 메모리에 다 올리지 않고 진행률을 보이며 센다.
 *
 * MD5·SHA-1 은 우연한 손상을 가려내기에는 충분하지만 일부러 바꾼 파일은 가려내지
 * 못한다(충돌을 만들 수 있다). 화면이 그렇게 적는다.
 */

export type Algorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export const ALGORITHMS: Algorithm[] = ['SHA-256', 'MD5', 'SHA-1', 'SHA-384', 'SHA-512'];

/** subtle 은 통째로 받으므로 메모리에 올릴 수 있는 만큼만. */
export const SHA_LIMIT = 512 * 1024 * 1024;
/** MD5 를 셀 때 한 번에 읽는 조각. 진행률이 부드럽고 메모리는 적게 쓰는 크기. */
export const CHUNK = 4 * 1024 * 1024;

/** 16진 자리 수로 알고리즘을 가린다. 기대값만 붙여 넣어도 무엇과 견줄지 안다. */
const BY_LENGTH: Record<number, Algorithm> = { 32: 'MD5', 40: 'SHA-1', 64: 'SHA-256', 96: 'SHA-384', 128: 'SHA-512' };

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

// --- MD5 (RFC 1321) ---------------------------------------------------------

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** 조각씩 넣는 MD5. 64바이트가 차지 않은 나머지는 다음 update 까지 들고 있는다. */
export class Md5 {
  private state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private block = new Uint8Array(64);
  private filled = 0;
  private length = 0;
  private words = new Uint32Array(16);
  private done = false;

  update(bytes: Uint8Array): this {
    if (this.done) throw new Error('이미 끝낸 MD5 에는 더 넣을 수 없습니다.');
    this.length += bytes.length;
    let offset = 0;
    if (this.filled) {
      const take = Math.min(64 - this.filled, bytes.length);
      this.block.set(bytes.subarray(0, take), this.filled);
      this.filled += take;
      offset = take;
      if (this.filled < 64) return this;
      this.compress(this.block, 0);
      this.filled = 0;
    }
    // 가득 찬 블록은 복사하지 않고 제자리에서 센다 — 큰 파일에서 차이가 난다.
    for (; offset + 64 <= bytes.length; offset += 64) this.compress(bytes, offset);
    if (offset < bytes.length) {
      this.block.set(bytes.subarray(offset), 0);
      this.filled = bytes.length - offset;
    }
    return this;
  }

  digest(): Uint8Array {
    if (!this.done) {
      const bits = this.length * 8;
      const tail = new Uint8Array((this.filled < 56 ? 64 : 128) - this.filled);
      tail[0] = 0x80;
      // 길이는 64비트 little-endian. 2^53 바이트를 넘을 일은 없으니 두 조각으로 충분하다.
      const view = new DataView(tail.buffer);
      view.setUint32(tail.length - 8, bits >>> 0, true);
      view.setUint32(tail.length - 4, Math.floor(bits / 2 ** 32), true);
      const length = this.length;
      this.update(tail);
      this.length = length;
      this.done = true;
    }
    const out = new Uint8Array(16);
    const view = new DataView(out.buffer);
    this.state.forEach((word, i) => view.setUint32(i * 4, word, true));
    return out;
  }

  hex(): string {
    return toHex(this.digest());
  }

  private compress(bytes: Uint8Array, at: number): void {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      const j = at + i * 4;
      w[i] = (bytes[j]! | (bytes[j + 1]! << 8) | (bytes[j + 2]! << 16) | (bytes[j + 3]! << 24)) >>> 0;
    }
    const state = this.state;
    let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const sum = (a + f + K[i]! + w[g]!) >>> 0;
      const s = S[i]!;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
  }
}

export function md5Hex(bytes: Uint8Array): string {
  return new Md5().update(bytes).hex();
}

export async function shaHex(algorithm: Exclude<Algorithm, 'MD5'>, bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(algorithm, new Uint8Array(bytes));
  return toHex(new Uint8Array(digest));
}

/** 파일을 벗어나지 않는 한 가지만 받는다 — File 도 Blob 이다. */
export interface HashOptions {
  /** 0~1. MD5 는 조각마다, SHA 는 읽기 전과 끝에 한 번씩 부른다. */
  progress?: (fraction: number) => void;
  /** true 를 돌려주면 다음 조각에서 멈춘다. */
  cancelled?: () => boolean;
}

export class CancelledError extends Error {
  constructor() { super('해시 계산을 멈췄습니다.'); }
}

export async function hashBlob(blob: Blob, algorithm: Algorithm, options: HashOptions = {}): Promise<string> {
  if (algorithm === 'MD5') {
    const md5 = new Md5();
    for (let at = 0; at < blob.size; at += CHUNK) {
      if (options.cancelled?.()) throw new CancelledError();
      md5.update(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
      options.progress?.(Math.min(1, (at + CHUNK) / blob.size));
    }
    options.progress?.(1);
    return md5.hex();
  }
  if (blob.size > SHA_LIMIT) {
    throw new Error(`${algorithm} 는 파일을 통째로 메모리에 올려야 해서 512MB 까지만 셉니다. 더 큰 파일은 MD5 로 세어 주세요.`);
  }
  options.progress?.(0);
  const hex = await shaHex(algorithm, new Uint8Array(await blob.arrayBuffer()));
  options.progress?.(1);
  return hex;
}

// --- 기대값 견주기 -----------------------------------------------------------

/**
 * 붙여 넣은 기대값을 고른다. 사이트마다 대문자, 두 자리마다 콜론·공백,
 * `SHA256SUMS` 한 줄 통째(`<해시>  <이름>`)로 적어 두기도 한다.
 */
export function normalizeExpected(text: string): string {
  const trimmed = text.trim();
  // SUMS 한 줄이면 앞 토큰만 쓴다. 두 자리씩 띄어 쓴 해시(`ab cd …`)와 가리려고
  // 첫 토큰이 16진 32자 이상일 때만 그렇게 본다.
  const first = /^\\?([0-9a-fA-F]{32,})\s+\*?\S/.exec(trimmed);
  const hex = first ? first[1]! : trimmed.replace(/[\s:]/g, '');
  return hex.toLowerCase();
}

export function detectAlgorithm(normalized: string): Algorithm | undefined {
  if (!/^[0-9a-f]+$/.test(normalized)) return undefined;
  return BY_LENGTH[normalized.length];
}

export type Expectation =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ok'; hex: string; algorithm: Algorithm };

export function parseExpected(text: string): Expectation {
  const hex = normalizeExpected(text);
  if (!hex) return { kind: 'empty' };
  if (!/^[0-9a-f]+$/.test(hex)) return { kind: 'invalid', message: '기대값에 16진수(0-9, a-f) 밖의 글자가 있습니다.' };
  const algorithm = detectAlgorithm(hex);
  if (!algorithm) {
    return { kind: 'invalid', message: `기대값이 ${hex.length}자입니다. MD5 는 32자, SHA-1 은 40자, SHA-256 은 64자, SHA-384 는 96자, SHA-512 는 128자입니다.` };
  }
  return { kind: 'ok', hex, algorithm };
}

// --- 결과 정리 ---------------------------------------------------------------

export interface HashRow { name: string; hash: string }

/**
 * `sha256sum -c` 가 읽는 꼴. 이름에 역슬래시·줄바꿈이 있으면 coreutils 처럼
 * 줄 앞에 `\` 를 붙이고 이스케이프한다 — 안 그러면 한 줄이 둘로 읽힌다.
 */
export function sumsText(rows: HashRow[]): string {
  return rows.map(({ name, hash }) => {
    if (!/[\\\n\r]/.test(name)) return `${hash}  ${name}\n`;
    const escaped = name.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    return `\\${hash}  ${escaped}\n`;
  }).join('');
}

/** 같은 해시를 가진 행 번호 묶음. 둘 이상인 것만. */
export function duplicateGroups(hashes: string[]): number[][] {
  const groups = new Map<string, number[]>();
  hashes.forEach((hash, index) => {
    if (!hash) return;
    const list = groups.get(hash) ?? [];
    list.push(index);
    groups.set(hash, list);
  });
  return [...groups.values()].filter(list => list.length > 1);
}

export function sumsFileName(algorithm: Algorithm): string {
  return `${algorithm.replace('-', '')}SUMS`;
}
