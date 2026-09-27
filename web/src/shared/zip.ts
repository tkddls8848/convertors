/**
 * ZIP 읽기.
 *
 * HWPX(OWPML)도 DOCX도 XLSX도 속은 ZIP 이다. 라이브러리를 들이지 않는 이유는
 * 우리가 쓰는 것이 **읽기 한 가지**뿐이고, 푸는 일은 브라우저가 이미 할 줄 알기
 * 때문이다 (`DecompressionStream('deflate-raw')` — Chrome 103, Safari 16.4,
 * Firefox 113, Node 18 이상).
 *
 * 이 코드는 gong-go 저장소의 `converter/zip-read.js` 를 옮겨 온 것이다. 거기서는
 * Node 의 `zlib.inflateRawSync` 를 썼고 여기서는 브라우저 API 를 쓰므로 **비동기**
 * 라는 점만 다르다. 규칙·한도·안전 검사는 그대로다.
 *
 * 지키는 것 둘:
 *   - zip-slip 을 막는다. 이름에 `..` 나 역슬래시가 있거나 `/` 로 시작하는 항목은
 *     읽지 않는다. 브라우저에서는 디스크에 쓰지 않지만, 같은 함수를 데스크톱
 *     경로에서도 쓰게 되면 그때 바로 구멍이 된다.
 *   - 압축 폭탄을 막는다. 항목 수와 푼 뒤 전체 크기에 한도를 둔다.
 *
 * 항목 **이름**은 UTF-8 이 아닐 수 있다. 윈도우 탐색기가 만든 ZIP 은 한글 이름을
 * CP949 로 적으면서 그렇다고 표시하지 않는다 — `decodeName` 이 그것을 가린다.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** general purpose flag bit 11 — 이름이 UTF-8 이라고 적어 둔 표식. */
const UTF8_NAMES = 0x800;

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const utf8 = new TextDecoder();
const cp949 = new TextDecoder('euc-kr');

/**
 * 항목 이름을 읽는다.
 *
 * 윈도우 탐색기가 만든 ZIP 은 한글 이름을 CP949 로 적으면서 UTF-8 표식을 달지
 * 않는다. 그것을 UTF-8 로 읽으면 이름이 깨진 채 화면에 나온다 — 조용히 틀리는
 * 쪽이라 고친다. 표식이 있으면 그 말을 믿고, 없으면 UTF-8 로 엄격하게 읽어 본 뒤
 * 어긋날 때만 CP949 로 본다 (ASCII 이름은 어느 쪽이든 같다).
 */
function decodeName(bytes: Uint8Array, flags: number): string {
  if (flags & UTF8_NAMES) return utf8.decode(bytes);
  try { return utf8Strict.decode(bytes); } catch { return cp949.decode(bytes); }
}

export interface ZipLimits {
  /** 중앙 디렉터리에 적힌 항목 수 상한. */
  maxEntries: number;
  /** 푼 뒤 전체 바이트 상한. */
  maxSize: number;
}

const DEFAULT_LIMITS: ZipLimits = { maxEntries: 5000, maxSize: 64 * 1024 * 1024 };

/** 이름 → 푼 내용. 순서는 중앙 디렉터리에 적힌 순서다. */
export type ZipEntries = Map<string, Uint8Array>;

export async function readZip(bytes: Uint8Array, limits: Partial<ZipLimits> = {}): Promise<ZipEntries> {
  const { maxEntries, maxSize } = { ...DEFAULT_LIMITS, ...limits };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (count > maxEntries) throw new Error(`ZIP 항목 수가 한도를 넘습니다: ${count}`);

  const entries: ZipEntries = new Map();
  let offset = directoryOffset;
  let total = 0;

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL) {
      throw new Error('ZIP 중앙 디렉터리가 손상됐습니다.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (flags & 1) throw new Error('암호화된 ZIP은 지원하지 않습니다.');
    if (offset + 46 + nameLength + extraLength + commentLength > view.byteLength) throw new Error('ZIP 항목 헤더가 손상됐습니다.');
    const name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength), flags);
    offset += 46 + nameLength + extraLength + commentLength;

    if (!isSafePath(name)) continue;
    total += size;
    if (total > maxSize) throw new Error(`ZIP 을 푼 크기가 한도를 넘습니다: ${total} 바이트`);

    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOCAL) {
      throw new Error(`ZIP 지역 헤더가 손상됐습니다: ${name}`);
    }
    // 지역 헤더의 이름·extra 길이는 중앙 디렉터리의 것과 다를 수 있다. 여기 적힌 것을 쓴다.
    const localName = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localName + localExtra;
    if (start + compressedSize > view.byteLength) throw new Error('ZIP 압축 데이터가 잘렸습니다.');
    const compressed = bytes.subarray(start, start + compressedSize);

    let data: Uint8Array;
    if (method === 0) data = compressed.slice();
    else if (method === 8) data = await inflateRaw(compressed, Math.min(size, maxSize));
    else throw new Error(`지원하지 않는 ZIP 압축 방식 ${method}: ${name}`);
    if (data.byteLength !== size) throw new Error(`ZIP 크기가 적힌 것과 다릅니다: ${name}`);
    entries.set(name, data);
  }
  return entries;
}

/**
 * 끝에서부터 EOCD 표식을 찾는다. 주석이 붙어 있을 수 있어 마지막 22바이트가
 * 항상 EOCD 는 아니다. 주석 길이 상한(0xffff)까지만 거슬러 본다.
 */
function findEocd(view: DataView): number {
  const start = Math.max(0, view.byteLength - 0xffff - 22);
  for (let index = view.byteLength - 22; index >= start; index -= 1) {
    if (view.getUint32(index, true) === EOCD) return index;
  }
  throw new Error('ZIP 이 아닙니다(EOCD 를 찾지 못했습니다).');
}

export function isSafePath(name: string): boolean {
  return !!name && !name.includes('\\') && !name.startsWith('/') && !name.split('/').includes('..');
}

async function inflateRaw(data: Uint8Array, maxSize: number): Promise<Uint8Array> {
  // 스트림에 넣기 전에 제 버퍼로 한 번 옮긴다. 타입이 까다로워서가 아니라
  // (TypeScript 는 SharedArrayBuffer 위의 배열을 여기 넣지 못하게 한다) 넘겨받은
  // 배열이 원본 ZIP 의 일부를 가리키는 subarray 이기 때문이다 — 스트림이 읽는
  // 동안 그 자리가 살아 있어야 한다. 구역 하나는 수십 KB라 복사가 싸다.
  const input = new Uint8Array(data.byteLength);
  input.set(data);
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxSize) { await reader.cancel(); throw new Error('ZIP 실제 압축 해제 크기가 한도를 넘습니다.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
