/**
 * 테스트용 ZIP 만들기.
 *
 * 진짜 HWPX 파일을 저장소에 넣지 않기 위해 필요한 만큼만 조립한다. 화면 코드가
 * 이 파일을 부르지 않으므로 번들에는 들어가지 않는다.
 *
 * 두 가지를 만든다 — 압축하지 않은 것(method 0)과 deflate 로 압축한 것(method 8).
 * 한글이 실제로 쓰는 것은 method 8 이고, method 0 은 파서가 그 갈래도 타는지
 * 보기 위한 것이다.
 */

const encoder = new TextEncoder();

export interface ZipFile {
  /** 이름. Uint8Array 면 그 바이트 그대로 적는다 (CP949 이름을 흉내 낼 때 쓴다). */
  name: string | Uint8Array;
  /** 넣을 내용. 문자열이면 UTF-8 로 적는다. */
  content: string | Uint8Array;
  /** true 면 deflate 로 압축해 넣는다(method 8). */
  deflate?: boolean;
  /** general purpose flag. bit 11(0x800)이 서면 이름이 UTF-8 이라는 뜻이다. */
  flags?: number;
}

export async function makeZip(files: ZipFile[]): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const raw = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const name = typeof file.name === 'string' ? encoder.encode(file.name) : file.name;
    const flags = file.flags ?? 0;
    const method = file.deflate ? 8 : 0;
    const body = file.deflate ? await deflateRaw(raw) : raw;

    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, body.byteLength, true);
    localView.setUint32(22, raw.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    locals.push(local, name, body);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, body.byteLength, true);
    centralView.setUint32(24, raw.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, offset, true);
    centrals.push(central, name);

    offset += local.byteLength + name.byteLength + body.byteLength;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.byteLength, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  return concat([...locals, ...centrals, eocd]);
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
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
  const stream = source.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}
