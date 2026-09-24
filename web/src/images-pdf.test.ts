import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { fitBox, imageKind, imagesToPdf } from './images-pdf';

/** 압축하지 않은 1×1 PNG. 저장소에 그림 파일을 두지 않으려고 손으로 짠다. */
function png(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const name = new TextEncoder().encode(type);
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set(name, 4);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 2; // 8비트, truecolor
  // 줄마다 필터 바이트 하나 + RGB 3바이트. zlib 은 "압축 안 함" 블록으로 적는다.
  const raw = new Uint8Array(height * (1 + width * 3));
  const blocks: number[] = [0x78, 0x01];
  blocks.push(1, raw.length & 0xff, raw.length >> 8, ~raw.length & 0xff, (~raw.length >> 8) & 0xff);
  const idat = new Uint8Array(blocks.length + raw.length + 4);
  idat.set(blocks);
  idat.set(raw, blocks.length);
  // adler32 — 전부 0이므로 a=1, b=0.
  new DataView(idat.buffer).setUint32(blocks.length + raw.length, 1);
  return new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...chunk('IHDR', ihdr), ...chunk('IDAT', idat), ...chunk('IEND', new Uint8Array(0)),
  ]);
}

describe('imageKind', () => {
  it('확장자가 아니라 바이트로 가린다', () => {
    expect(imageKind(png(1, 1))).toBe('png');
    expect(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    // RIFF…WEBP. 브라우저에서 PNG 로 바꾼 뒤에야 들어올 수 있다.
    expect(imageKind(new TextEncoder().encode('RIFF????WEBPVP8 '))).toBeUndefined();
  });
});

describe('fitBox', () => {
  it('비율을 지키고 가운데에 놓는다', () => {
    // 가로로 넓은 그림은 세로가 남는다.
    expect(fitBox({ width: 200, height: 100 }, { width: 100, height: 100 }))
      .toEqual({ x: 0, y: 25, width: 100, height: 50 });
  });

  it('칸보다 작은 그림은 키워서 채운다', () => {
    expect(fitBox({ width: 50, height: 50 }, { width: 100, height: 200 }))
      .toEqual({ x: 0, y: 50, width: 100, height: 100 });
  });
});

describe('imagesToPdf', () => {
  it("'원본 크기'는 쪽을 그림에 맞춘다", async () => {
    const bytes = await imagesToPdf([
      { name: 'a.png', bytes: png(300, 200) },
      { name: 'b.png', bytes: png(100, 400) },
    ], { fit: 'image', margin: 0 });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 300, height: 200 });
    expect(pdf.getPage(1).getSize()).toEqual({ width: 100, height: 400 });
  });

  it('A4 는 쪽 크기를 고정하고 여백을 남긴다', async () => {
    const pdf = await PDFDocument.load(await imagesToPdf(
      [{ name: 'a.png', bytes: png(300, 200) }], { fit: 'a4', margin: 36 },
    ));
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('그림이 아닌 파일은 이름을 대고 멈춘다', async () => {
    // 조용히 건너뛰면 쪽이 빠진 PDF 를 성공으로 받게 된다.
    await expect(imagesToPdf(
      [{ name: '보고서.pdf', bytes: new TextEncoder().encode('%PDF-1.7') }], { fit: 'a4', margin: 0 },
    )).rejects.toThrow('보고서.pdf');
  });

  it('여백이 쪽보다 크면 멈춘다', async () => {
    await expect(imagesToPdf(
      [{ name: 'a.png', bytes: png(10, 10) }], { fit: 'a4', margin: 300 },
    )).rejects.toThrow('여백');
  });

  it('빈 목록은 멈춘다', async () => {
    await expect(imagesToPdf([], { fit: 'a4', margin: 0 })).rejects.toThrow('묶을 그림이 없습니다.');
  });
});
