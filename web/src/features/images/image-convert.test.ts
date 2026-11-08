import { describe, expect, it } from 'vitest';

import { fitBudget, outputName, parseMaxBytes, qualityValue, sizeProblem, stretchNote, targetSize, uniqueNames } from './image-convert';

const photo = { width: 4000, height: 3000 };

describe('targetSize', () => {
  it('원본 크기는 그대로다', () => {
    expect(targetSize(photo, { mode: 'original' })).toEqual(photo);
  });

  it('최대 가로·세로에 비율을 지켜 맞춘다', () => {
    expect(targetSize(photo, { mode: 'fit', maxWidth: 1920, maxHeight: null, upscale: false })).toEqual({ width: 1920, height: 1440 });
    expect(targetSize(photo, { mode: 'fit', maxWidth: 1920, maxHeight: 1080, upscale: false })).toEqual({ width: 1440, height: 1080 });
    expect(targetSize({ width: 1000, height: 3000 }, { mode: 'fit', maxWidth: null, maxHeight: 1500, upscale: false })).toEqual({ width: 500, height: 1500 });
  });

  it('작은 그림은 고르지 않으면 키우지 않는다', () => {
    const small = { width: 800, height: 600 };
    expect(targetSize(small, { mode: 'fit', maxWidth: 1600, maxHeight: null, upscale: false })).toEqual(small);
    expect(targetSize(small, { mode: 'fit', maxWidth: 1600, maxHeight: null, upscale: true })).toEqual({ width: 1600, height: 1200 });
  });

  it('비율(%)', () => {
    expect(targetSize(photo, { mode: 'percent', percent: 50 })).toEqual({ width: 2000, height: 1500 });
    expect(targetSize({ width: 3, height: 1 }, { mode: 'percent', percent: 1 })).toEqual({ width: 1, height: 1 });
    expect(() => targetSize(photo, { mode: 'percent', percent: 0 })).toThrow(/비율/);
    expect(() => targetSize(photo, { mode: 'percent', percent: 500 })).toThrow(/비율/);
  });

  it('한도를 적지 않거나 잘못 적으면 멈춘다', () => {
    expect(() => targetSize(photo, { mode: 'fit', maxWidth: null, maxHeight: null, upscale: false })).toThrow(/하나는/);
    expect(() => targetSize(photo, { mode: 'fit', maxWidth: -5, maxHeight: null, upscale: false })).toThrow(/정수/);
  });
});

describe('정확한 크기 (비율 무시)', () => {
  it('적은 가로·세로 그대로 늘리거나 줄인다', () => {
    expect(targetSize({ width: 3000, height: 4000 }, { mode: 'exact', width: 431, height: 620 })).toEqual({ width: 431, height: 620 });
    expect(targetSize({ width: 100, height: 100 }, { mode: 'exact', width: 431, height: 620 })).toEqual({ width: 431, height: 620 });
  });

  it('가로·세로를 둘 다 1 이상의 정수로 적지 않으면 멈춘다', () => {
    expect(() => targetSize(photo, { mode: 'exact', width: null, height: 620 })).toThrow(/가로·세로/);
    expect(() => targetSize(photo, { mode: 'exact', width: 431.5, height: 620 })).toThrow(/정수/);
    expect(() => targetSize(photo, { mode: 'exact', width: 0, height: 620 })).toThrow(/정수/);
  });

  it('비율이 달라지면 어느 쪽으로 얼마나 늘어나는지 알린다', () => {
    expect(stretchNote({ width: 3000, height: 4000 }, { width: 431, height: 620 })).toBe('비율이 달라져 세로로 8% 늘어납니다');
    expect(stretchNote({ width: 1000, height: 1000 }, { width: 1200, height: 1000 })).toBe('비율이 달라져 가로로 20% 늘어납니다');
  });

  it('비율이 거의 같으면 알리지 않는다', () => {
    expect(stretchNote({ width: 4000, height: 3000 }, { width: 1920, height: 1440 })).toBeNull();
    expect(stretchNote({ width: 1000, height: 1000 }, { width: 1010, height: 1000 })).toBeNull();
  });
});

describe('최대 용량', () => {
  it('KB 를 1,000 바이트로 센다 — 사이트가 어느 쪽으로 세든 넘지 않게', () => {
    expect(parseMaxBytes('700')).toBe(700_000);
    expect(parseMaxBytes(' 1.5 ')).toBe(1_500);
    expect(parseMaxBytes('')).toBeNull();
  });

  it('0 이하나 숫자가 아니면 멈춘다', () => {
    for (const text of ['0', '-3', 'abc']) expect(() => parseMaxBytes(text), text).toThrow(/최대 용량/);
  });

  // 화질 q 로 저장하면 q × 10,000 바이트가 되는 가짜 인코더 — 화질이 높을수록 크다.
  const linear = () => {
    const tried: number[] = [];
    return { tried, encode: async (q: number) => { tried.push(q); return new Uint8Array(q * 10_000); } };
  };

  it('한도가 없으면 고른 화질로 한 번만 저장한다', async () => {
    const { tried, encode } = linear();
    const result = await fitBudget(encode, { maxBytes: null, quality: 85, lossy: true });
    expect(result.quality).toBe(85);
    expect(tried).toEqual([85]);
  });

  it('고른 화질로 넘치면 한도 안에 드는 가장 높은 화질을 찾는다', async () => {
    const { tried, encode } = linear();
    const result = await fitBudget(encode, { maxBytes: 700_000, quality: 85, lossy: true });
    expect(result.quality).toBe(70);
    expect(result.bytes.length).toBe(700_000);
    expect(tried.length).toBeLessThanOrEqual(10);
  });

  it('고른 화질로 이미 들어가면 화질을 낮추지 않는다', async () => {
    const { tried, encode } = linear();
    const result = await fitBudget(encode, { maxBytes: 900_000, quality: 85, lossy: true });
    expect(result.quality).toBe(85);
    expect(tried).toEqual([85]);
  });

  it('가장 낮은 화질로도 넘치면 그때 용량을 알리고 멈춘다', async () => {
    const { encode } = linear();
    await expect(fitBudget(encode, { maxBytes: 50_000, quality: 85, lossy: true })).rejects.toThrow(/화질 10.*98KB.*50KB/);
  });

  it('화질이 없는 PNG 는 넘치면 JPEG 를 권한다', async () => {
    const encode = async () => new Uint8Array(812_000);
    await expect(fitBudget(encode, { maxBytes: 700_000, quality: 85, lossy: false })).rejects.toThrow(/PNG.*793KB.*700KB.*JPEG/);
    const fits = await fitBudget(async () => new Uint8Array(500_000), { maxBytes: 700_000, quality: 85, lossy: false });
    expect(fits.quality).toBeNull();
  });
});

describe('sizeProblem', () => {
  it('화소와 한 변 한도', () => {
    expect(sizeProblem(photo, '원본')).toBeNull();
    expect(sizeProblem({ width: 10000, height: 6000 }, '원본')).toMatch(/화소/);
    expect(sizeProblem({ width: 20000, height: 100 }, '결과')).toMatch(/한 변/);
  });
});

describe('이름', () => {
  it('확장자를 형식에 맞게 바꾼다', () => {
    expect(outputName('사진.HEIC', 'jpeg')).toBe('사진.jpg');
    expect(outputName('a.b.png', 'webp')).toBe('a.b.webp');
    expect(outputName('scan', 'png')).toBe('scan.png');
  });

  it('겹치는 이름은 (2) 를 붙인다 — 대소문자만 다른 것도', () => {
    expect(uniqueNames(['a.jpg', 'a.jpg', 'A.jpg', 'b.jpg'])).toEqual(['a.jpg', 'a (2).jpg', 'A (3).jpg', 'b.jpg']);
  });

  it('화질 % 를 0–1 로', () => {
    expect(qualityValue(85)).toBe(0.85);
    expect(qualityValue(0)).toBe(0.01);
    expect(qualityValue(120)).toBe(1);
  });
});
