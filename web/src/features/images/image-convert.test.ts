import { describe, expect, it } from 'vitest';

import { outputName, qualityValue, sizeProblem, targetSize, uniqueNames } from './image-convert';

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
