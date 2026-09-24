/**
 * 글자 인코딩 바꾸기 — CP949(EUC-KR) ↔ UTF-8, BOM, 줄바꿈.
 *
 * 엑셀이 내보낸 CSV 를 다른 프로그램이 읽으면 글자가 깨지고, UTF-8 CSV 를 엑셀이
 * 열면 또 깨진다. 둘 다 한쪽이 틀려서가 아니라 **파일에 어떤 인코딩인지 적혀 있지
 * 않아서** 생기는 일이다. 여기서 하는 일은 그 사실을 읽어 주고 원하는 쪽으로
 * 다시 적는 것뿐이다.
 *
 * **읽는 쪽**은 브라우저가 해 준다(`TextDecoder`). **쓰는 쪽**은 UTF-8 밖에 못
 * 하므로(`TextEncoder` 는 UTF-8 전용이다) CP949 변환표를 **디코더를 뒤집어**
 * 만든다. 표 파일을 저장소에 싣지 않으려는 것이고, 쓰는 표와 읽는 표가 같은
 * 출처라 서로 어긋날 수 없다는 뜻도 된다.
 *
 * 브라우저의 `euc-kr` 은 WHATWG 규격이라 CP949(UHC) 확장 한글까지 읽는다. Node
 * 의 것은 KS X 1001 까지만이라 표가 더 작다 — 테스트는 그 안의 글자만 쓴다.
 */

export type ReadEncoding = 'utf-8' | 'euc-kr' | 'utf-16le' | 'utf-16be';
export type WriteEncoding = 'utf-8' | 'euc-kr';
export type Newline = 'keep' | 'crlf' | 'lf';

export const ENCODING_LIMITS = { bytes: 64 * 1024 * 1024 };

export const ENCODING_NAMES: Record<ReadEncoding, string> = {
  'utf-8': 'UTF-8',
  'euc-kr': 'CP949 (EUC-KR·완성형)',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
};

export interface DecodeResult {
  text: string;
  encoding: ReadEncoding;
  /** BOM 이 있거나 UTF-8 로만 읽히면 확실하다. 그렇지 않으면 CP949 로 **추정**한 것이다. */
  certain: boolean;
  hadBom: boolean;
}

/**
 * 인코딩을 가려 읽는다.
 *
 * BOM 이 있으면 그것이 답이다. 없으면 UTF-8 로 엄격하게 읽어 보고, 한 바이트라도
 * 어긋나면 CP949 로 본다 — 한국에서 UTF-8 이 아닌 텍스트는 거의 그것이다.
 * ASCII 뿐인 파일은 어느 쪽으로 읽어도 같으므로 UTF-8 이라고 답한다.
 */
export function decodeText(bytes: Uint8Array): DecodeResult {
  if (bytes.length > ENCODING_LIMITS.bytes) throw new Error('파일이 64MB를 넘습니다.');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8', certain: true, hadBom: true };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le', certain: true, hadBom: true };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be', certain: true, hadBom: true };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, encoding: 'utf-8', certain: true, hadBom: false };
  } catch {
    // UTF-8 이 아니라는 것만 확실하다. CP949 라는 것은 추정이므로 화면이 그렇게 적는다.
    return { text: new TextDecoder('euc-kr').decode(bytes), encoding: 'euc-kr', certain: false, hadBom: false };
  }
}

let table: Map<string, number> | undefined;

/**
 * CP949 쓰기 표. 디코더로 두 바이트 짝을 모두 읽어 보고 뒤집는다.
 *
 * 2만 4천 번을 도는데 한 번만 만들면 되고, CP949 로 **내보낼 때만** 필요하므로
 * 그때까지 만들지 않는다.
 */
export function cp949Table(): Map<string, number> {
  if (table) return table;
  const decoder = new TextDecoder('euc-kr');
  const pair = new Uint8Array(2);
  const built = new Map<string, number>();
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x41; trail <= 0xfe; trail++) {
      pair[0] = lead; pair[1] = trail;
      const char = decoder.decode(pair);
      // 한 글자로 읽힌 짝만 쓴다. 못 읽은 짝은 U+FFFD 가 되거나 길이가 달라진다.
      if (char.length === 1 && char !== '\ufffd' && !built.has(char)) built.set(char, (lead << 8) | trail);
    }
  }
  table = built;
  return built;
}

export interface EncodeOptions {
  encoding: WriteEncoding;
  /** UTF-8 에만 붙는다. 엑셀이 UTF-8 CSV 를 알아보려면 이것이 있어야 한다. */
  bom: boolean;
  newline: Newline;
  /** true 면 CP949 에 없는 글자를 `?` 로 적는다. false 면 그런 글자가 있을 때 멈춘다. */
  replaceMissing: boolean;
}

export interface EncodeResult {
  bytes: Uint8Array;
  /** CP949 로 적을 수 없어 `?` 가 된 글자. 비어 있지 않으면 화면이 그대로 보여 준다. */
  missing: string[];
}

export function applyNewline(text: string, newline: Newline): string {
  if (newline === 'keep') return text;
  const lf = text.replace(/\r\n?/g, '\n');
  return newline === 'lf' ? lf : lf.replace(/\n/g, '\r\n');
}

export function encodeText(source: string, options: EncodeOptions): EncodeResult {
  const text = applyNewline(source, options.newline);
  if (options.encoding === 'utf-8') {
    const body = new TextEncoder().encode(text);
    if (!options.bom) return { bytes: body, missing: [] };
    const bytes = new Uint8Array(body.length + 3);
    bytes.set([0xef, 0xbb, 0xbf]);
    bytes.set(body, 3);
    return { bytes, missing: [] };
  }

  const map = cp949Table();
  // 글자 하나가 많아야 두 바이트다. 미리 잡아 두면 64MB 파일에서도 배열이 자라지 않는다.
  const out = new Uint8Array(text.length * 2);
  let length = 0;
  const missing = new Set<string>();
  // 코드 포인트 단위로 돈다 — 이모지처럼 두 칸을 쓰는 글자를 반쪽으로 자르지 않기 위해서다.
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) { out[length++] = code; continue; }
    const pair = map.get(char);
    if (pair === undefined) { missing.add(char); out[length++] = 0x3f; continue; }
    out[length++] = pair >> 8;
    out[length++] = pair & 0xff;
  }
  const found = [...missing];
  if (found.length && !options.replaceMissing) {
    const sample = found.slice(0, 10).join(' ');
    throw new Error(`CP949로 적을 수 없는 글자가 ${found.length}종 있습니다: ${sample}${found.length > 10 ? ' …' : ''}`);
  }
  return { bytes: out.slice(0, length), missing: found };
}
