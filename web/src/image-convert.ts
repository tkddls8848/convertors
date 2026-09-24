/**
 * 이미지 형식·크기 바꾸기의 셈 — 목표 크기, 내보낼 이름, 한도.
 *
 * 그리기(캔버스)는 화면 쪽이 한다. 여기는 브라우저 없이 돌아야 테스트할 수 있다.
 *
 * "최대 가로·세로" 는 **줄이기만** 한다. 작은 그림을 한도에 맞춰 키우면 흐려질 뿐
 * 얻는 것이 없는데, 여러 장을 한꺼번에 돌릴 때 사람이 그걸 바라는 일은 드물다.
 * 키우기는 따로 골라야 한다. 비율(%)은 100 을 넘기면 그 자체가 고른 것이다.
 */
import { stem } from './kit';

export type OutputFormat = 'png' | 'jpeg' | 'webp';

export type Resize =
  | { mode: 'original' }
  | { mode: 'fit'; maxWidth: number | null; maxHeight: number | null; upscale: boolean }
  | { mode: 'percent'; percent: number };

export const IMAGE_CONVERT_LIMITS = {
  count: 200,
  totalBytes: 64 * 1024 * 1024,
  /** 원본과 결과 각각. 5천만 화소면 캔버스 하나가 200MB 다 */
  pixels: 50_000_000,
  /** 한 변. 브라우저마다 캔버스 한 변 한도가 있어 넘으면 조용히 빈 그림이 된다 */
  side: 16_384,
  percent: { min: 1, max: 400 },
};

export const FORMATS: Record<OutputFormat, { mime: string; extension: string; label: string; lossy: boolean }> = {
  png: { mime: 'image/png', extension: 'png', label: 'PNG', lossy: false },
  jpeg: { mime: 'image/jpeg', extension: 'jpg', label: 'JPEG', lossy: true },
  webp: { mime: 'image/webp', extension: 'webp', label: 'WebP', lossy: true },
};

export interface Size { width: number; height: number }

export function targetSize(source: Size, resize: Resize): Size {
  const { width, height } = source;
  let scale = 1;
  if (resize.mode === 'percent') {
    const { min, max } = IMAGE_CONVERT_LIMITS.percent;
    if (!Number.isFinite(resize.percent) || resize.percent < min || resize.percent > max) {
      throw new Error(`비율은 ${min}–${max}% 사이로 적어 주세요.`);
    }
    scale = resize.percent / 100;
  } else if (resize.mode === 'fit') {
    const limits = [resize.maxWidth, resize.maxHeight];
    if (limits.every(value => value === null)) throw new Error('최대 가로나 세로 중 하나는 적어 주세요.');
    if (limits.some(value => value !== null && (!Number.isInteger(value) || value < 1))) {
      throw new Error('최대 가로·세로는 1 이상의 정수(px)로 적어 주세요.');
    }
    scale = Math.min(
      resize.maxWidth === null ? Infinity : resize.maxWidth / width,
      resize.maxHeight === null ? Infinity : resize.maxHeight / height,
    );
    if (!resize.upscale) scale = Math.min(scale, 1);
  }
  if (scale === 1) return { width, height };
  // 한 변이 0 이 되면 캔버스가 그림을 내지 않는다. 최소 1px.
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 크기가 캔버스에 담기는지. 담기지 않으면 이유를 돌려준다. */
export function sizeProblem(size: Size, which: '원본' | '결과'): string | null {
  if (size.width * size.height > IMAGE_CONVERT_LIMITS.pixels) {
    return `${which}이 ${Math.round(size.width * size.height / 1e6)}백만 화소라 한도(5천만 화소)를 넘습니다.`;
  }
  if (Math.max(size.width, size.height) > IMAGE_CONVERT_LIMITS.side) {
    return `${which}의 한 변이 ${IMAGE_CONVERT_LIMITS.side.toLocaleString('ko-KR')}px 을 넘습니다.`;
  }
  return null;
}

export function outputName(name: string, format: OutputFormat): string {
  return `${stem(name) || 'image'}.${FORMATS[format].extension}`;
}

/** 같은 이름이 둘이면 뒤엣것에 (2), (3)… 을 붙인다. ZIP 안에서 서로 덮어쓰지 않게. */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map(name => {
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = name.replace(/(\.[^.]*)?$/, match => ` (${n})${match}`);
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** 그림으로 보이는 파일. 브라우저가 실제로 열 수 있는지는 열어 봐야 안다. */
export function looksLikeImage(name: string, type: string): boolean {
  return type.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp|avif|heic|heif|ico|tiff?)$/i.test(name);
}

/** 0–100 의 화질을 캔버스가 받는 0–1 로. */
export function qualityValue(percent: number): number {
  return Math.min(1, Math.max(0.01, percent / 100));
}
