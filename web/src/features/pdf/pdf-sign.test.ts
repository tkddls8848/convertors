import { decodePDFRawStream, degrees, PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { drawArgs, imageRect, mmToPt, signPdf, spotFromUser, whiteToTransparent, type SignImage } from './pdf-sign';
import { rotate, toVisual, visualSize, type Quarter } from './pdf-stamp';

const BOX = { x: 0, y: 0, width: 600, height: 800 };
const ROTATIONS: Quarter[] = [0, 90, 180, 270];

describe('크기와 자리', () => {
  it('mm 를 pt 로', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72);
    expect(mmToPt(210)).toBeCloseTo(595.28, 1);
  });

  it('누른 자리를 가운데로, 가장자리를 넘으면 안으로 민다', () => {
    const frame = { width: 600, height: 800 };
    expect(imageRect(frame, { fx: 0.5, fy: 0.5 }, 100, 0.5)).toEqual({ x: 250, y: 375, width: 100, height: 50 });
    // 오른쪽 아래 모서리를 눌러도 그림 전체가 쪽 안에 든다.
    expect(imageRect(frame, { fx: 1, fy: 1 }, 100, 0.5)).toEqual({ x: 500, y: 0, width: 100, height: 50 });
    expect(imageRect(frame, { fx: 0, fy: 0 }, 100, 0.5)).toEqual({ x: 0, y: 750, width: 100, height: 50 });
    // 쪽보다 크면 비율을 지켜 줄인다.
    const big = imageRect(frame, { fx: 0.5, fy: 0.5 }, 1200, 1);
    expect(big.width).toBeCloseTo(600);
    expect(big.height).toBeCloseTo(600);
  });

  it.each(ROTATIONS)('%i 도 쪽: 누른 점이 비율로 바뀐다', rotation => {
    const frame = visualSize(BOX, rotation);
    // 보이는 왼쪽 위에서 가로 25%, 세로 10% 자리를 사용자 공간으로 만든 뒤 되돌린다.
    const visual = { x: frame.width * 0.25, y: frame.height * 0.9 };
    const user = rotation === 0 ? visual
      : rotation === 90 ? { x: BOX.width - visual.y, y: visual.x }
        : rotation === 180 ? { x: BOX.width - visual.x, y: BOX.height - visual.y }
          : { x: visual.y, y: BOX.height - visual.x };
    const spot = spotFromUser(user, BOX, rotation);
    expect(spot.fx).toBeCloseTo(0.25);
    expect(spot.fy).toBeCloseTo(0.1);
  });

  it.each(ROTATIONS)('%i 도 쪽: 그림이 보이는 네모에 바로 서서 앉는다', rotation => {
    const rect = { x: 40, y: 60, width: 120, height: 50 };
    const args = drawArgs(rect, BOX, rotation);
    // drawImage 는 원점에서 (width,0)·(0,height) 방향으로 그린다. 네 모서리를 보이는 틀로 옮겨 본다.
    const corner = (dx: number, dy: number) => {
      const turned = rotate({ x: dx, y: dy }, args.rotate);
      return toVisual({ x: args.x + turned.x, y: args.y + turned.y }, BOX, rotation);
    };
    const bottomLeft = corner(0, 0);
    const topRight = corner(args.width, args.height);
    expect(bottomLeft.x).toBeCloseTo(rect.x);
    expect(bottomLeft.y).toBeCloseTo(rect.y);
    expect(topRight.x).toBeCloseTo(rect.x + rect.width);
    expect(topRight.y).toBeCloseTo(rect.y + rect.height);
  });
});

describe('whiteToTransparent', () => {
  it('흰 바탕만 투명하게 하고 붉은 인주는 남긴다', () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255, // 흰 종이
      250, 248, 245, 255, // 누런 종이
      220, 30, 30, 255, // 인주
      0, 0, 0, 255, // 먹
      215, 215, 215, 255, // 경계 — 반쯤 투명
    ]);
    const changed = whiteToTransparent(pixels, 235);
    expect(changed).toBe(3);
    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual([0, 0, 255, 255]);
    expect(pixels[19]).toBeGreaterThan(0);
    expect(pixels[19]).toBeLessThan(255);
  });
});

/** 압축하지 않은 RGB PNG. 저장소에 그림 파일을 두지 않으려고 손으로 짠다(images-pdf.test.ts 와 같은 방법). */
function png(width: number, height: number): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = new Uint8Array(height * (1 + width * 3));
  const head = [0x78, 0x01, 1, raw.length & 0xff, raw.length >> 8, ~raw.length & 0xff, (~raw.length >> 8) & 0xff];
  const idat = new Uint8Array(head.length + raw.length + 4);
  idat.set(head);
  idat.set(raw, head.length);
  new DataView(idat.buffer).setUint32(head.length + raw.length, 1);
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', ihdr), ...chunk('IDAT', idat), ...chunk('IEND', new Uint8Array(0))]);
}

describe('signPdf', () => {
  it('그림을 한 번만 심고 고른 쪽마다 찍는다', async () => {
    const document = await PDFDocument.create();
    for (const rotation of ROTATIONS) document.addPage([600, 800]).setRotation(degrees(rotation));
    const source = await document.save();
    const image: SignImage = { bytes: png(4, 2), kind: 'png', width: 4, height: 2 };

    const result = await signPdf(source, image, [
      { fx: 0.8, fy: 0.9, widthMm: 30, pages: [0, 1, 2, 3] },
      { fx: 0.5, fy: 0.5, widthMm: 20, pages: [1] },
    ]);
    expect(result.stamps).toBe(5);

    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getPageCount()).toBe(4);
    const images = reloaded.context.enumerateIndirectObjects()
      .filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(images).toHaveLength(1);
    const draws = (index: number): number => {
      const contents = reloaded.getPage(index).node.Contents();
      const streams = contents instanceof PDFArray ? contents.asArray().map(ref => reloaded.context.lookup(ref)) : [contents];
      return streams.map(stream => stream instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()) : '')
        .join('\n').split(' Do').length - 1;
    };
    expect([draws(0), draws(1), draws(2), draws(3)]).toEqual([1, 2, 1, 1]);
  });

  it('자리가 없거나 폭이 터무니없으면 거절한다', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const source = await document.save();
    const image: SignImage = { bytes: png(1, 1), kind: 'png', width: 1, height: 1 };
    await expect(signPdf(source, image, [])).rejects.toThrow(/자리/);
    await expect(signPdf(source, image, [{ fx: 0, fy: 0, widthMm: 1000, pages: [0] }])).rejects.toThrow(/mm/);
    await expect(signPdf(source, image, [{ fx: 0, fy: 0, widthMm: 30, pages: [3] }])).rejects.toThrow(/4쪽/);
  });
});
