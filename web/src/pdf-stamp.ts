/**
 * PDF 워터마크·쪽번호 — 화면 없이 도는 부분.
 *
 * 글자를 **보이는 쪽** 에 맞춰 놓는다. PDF 의 쪽은 두 겹이다.
 *
 *   사용자 공간 — 내용이 적힌 좌표. MediaBox 원점이 0 이 아닐 수도 있다
 *   보이는 틀   — CropBox 만큼 잘라 /Rotate 만큼 시계방향으로 돌린 것
 *
 * 스캔한 문서는 /Rotate 90 이 흔하다. 사용자 공간에 그대로 "아래 가운데" 를
 * 계산하면 쪽번호가 옆구리에 누워서 찍힌다. 그래서 자리는 보이는 틀에서 정하고
 * (`toUser` 로) 사용자 공간으로 옮긴다. 이 변환은 서명(`pdf-sign.ts`)과
 * 모아찍기(`pdf-nup.ts`)도 같이 쓴다 — 두 벌이 되면 한쪽만 고쳐진다.
 *
 * 한글은 PDF 기본 글꼴에 없다. 글자가 WinAnsi 로 다 적히면 Helvetica 로
 * 내려받기 없이 찍고, 아니면 글꼴을 받아 서브셋으로 심는다(pdf-edit.ts 와 같은 길).
 */
import { degrees, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

import { reason } from './errors';
import { readPdf } from './pdf';
import { stripLayoutTables } from './sfnt';

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Box extends Point, Size {}
export type Quarter = 0 | 90 | 180 | 270;
export interface Rgb { r: number; g: number; b: number }

// --- 보이는 틀 ------------------------------------------------------------------

/** /Rotate 는 90 의 배수여야 하지만 음수·360 이상도 돌아다닌다. */
export function quarter(angle: number): Quarter {
  return ((((Math.round(angle / 90) * 90) % 360) + 360) % 360) as Quarter;
}

/**
 * 쪽에서 보이는 네모. CropBox 가 MediaBox 밖으로 나가면 겹치는 곳만 보인다 —
 * PDF.js 도 그렇게 그리므로 미리보기와 저장이 같은 틀을 쓴다.
 */
export function visibleBox(page: PDFPage): Box {
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  const left = Math.max(crop.x, media.x);
  const bottom = Math.max(crop.y, media.y);
  const right = Math.min(crop.x + crop.width, media.x + media.width);
  const top = Math.min(crop.y + crop.height, media.y + media.height);
  // 둘이 겹치지 않는 망가진 파일이면 MediaBox 로 물러난다.
  if (right - left < 1 || top - bottom < 1) return media;
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

export function pageFrame(page: PDFPage): { box: Box; rotation: Quarter } {
  return { box: visibleBox(page), rotation: quarter(page.getRotation().angle) };
}

/** 돌린 뒤 보이는 크기. 90·270 이면 가로세로가 바뀐다. */
export function visualSize(box: Size, rotation: Quarter): Size {
  return rotation % 180 ? { width: box.height, height: box.width } : { width: box.width, height: box.height };
}

/** 보이는 틀(왼쪽 아래 원점, 위로 +y) → 사용자 공간. */
export function toUser(point: Point, box: Box, rotation: Quarter): Point {
  const { x: vx, y: vy } = point;
  const { width: w, height: h } = box;
  // /Rotate 는 시계방향이다. 그 거꾸로를 적는다.
  const [px, py] = rotation === 90 ? [w - vy, vx]
    : rotation === 180 ? [w - vx, h - vy]
      : rotation === 270 ? [vy, h - vx]
        : [vx, vy];
  return { x: box.x + px, y: box.y + py };
}

/** 사용자 공간 → 보이는 틀. `toUser` 의 거꾸로. */
export function toVisual(point: Point, box: Box, rotation: Quarter): Point {
  const px = point.x - box.x;
  const py = point.y - box.y;
  const { width: w, height: h } = box;
  const [vx, vy] = rotation === 90 ? [py, w - px]
    : rotation === 180 ? [w - px, h - py]
      : rotation === 270 ? [h - py, px]
        : [px, py];
  return { x: vx, y: vy };
}

/**
 * 보이는 틀에서 반시계 `angle` 인 방향은 사용자 공간에서 `angle + rotation` 이다.
 * 틀 전체가 시계방향으로 돌아 보이므로 그만큼 먼저 거꾸로 돌려 두면 바로 선다.
 */
export function userAngle(angle: number, rotation: Quarter): number {
  return (((angle + rotation) % 360) + 360) % 360;
}

/** 원점 둘레로 반시계 회전. */
export function rotate(point: Point, angle: number): Point {
  const r = (angle * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

// --- 글자 자리 --------------------------------------------------------------------

/** 글자 한 줄을 놓을 자리 — 기준선 왼쪽 끝과 반시계 각도. */
export interface Placed extends Point { angle: number }

/**
 * 대문자 높이 어림. 글꼴마다 조금씩 다르지만(Helvetica 0.72, 한글 글꼴 0.75~0.8)
 * 가운데 맞춤에 쓰는 정도라 몇 % 어긋나도 눈에 띄지 않는다.
 */
const CAP = 0.72;
/** 바둑판 워터마크의 한 쪽 한도. 넘으면 간격을 넓힌다 — 파일이 쓸데없이 불어난다. */
export const MAX_TILES = 120;

export type Layout = 'center' | 'tile';

/** 글자 한 줄의 가운데를 `center` 에 두는 기준선 자리. */
export function centered(center: Point, textWidth: number, size: number, angle: number): Placed {
  const half = rotate({ x: textWidth / 2, y: (size * CAP) / 2 }, angle);
  return { x: center.x - half.x, y: center.y - half.y, angle };
}

/** 워터마크 자리들. 보이는 틀 기준이다. */
export function watermarkPlacements(frame: Size, textWidth: number, size: number, angle: number, layout: Layout): Placed[] {
  const middle = { x: frame.width / 2, y: frame.height / 2 };
  if (layout === 'center') return [centered(middle, textWidth, size, angle)];

  // 돌린 글자가 차지하는 네모만큼 띄우고, 줄마다 반 칸 어긋나게 둔다(벽돌 쌓기) —
  // 곧게 늘어놓으면 빈 줄무늬가 생겨 그 사이를 잘라 쓰기 쉽다.
  const r = (angle * Math.PI) / 180;
  const height = size * CAP;
  const boxWidth = Math.abs(textWidth * Math.cos(r)) + Math.abs(height * Math.sin(r));
  const boxHeight = Math.abs(textWidth * Math.sin(r)) + Math.abs(height * Math.cos(r));
  let stepX = boxWidth + size * 3;
  let stepY = boxHeight + size * 3;
  const count = (): number => (Math.ceil(frame.width / stepX) + 2) * (Math.ceil(frame.height / stepY) + 2);
  while (count() > MAX_TILES) { stepX *= 1.25; stepY *= 1.25; }

  const placed: Placed[] = [];
  const rows = Math.ceil(frame.height / 2 / stepY) + 1;
  const cols = Math.ceil(frame.width / 2 / stepX) + 1;
  for (let row = -rows; row <= rows; row++) {
    const shift = row % 2 ? stepX / 2 : 0;
    for (let col = -cols; col <= cols; col++) {
      const center = { x: middle.x + col * stepX + shift, y: middle.y + row * stepY };
      // 쪽에 조금이라도 걸치는 것만 남긴다.
      if (center.x + boxWidth / 2 < 0 || center.x - boxWidth / 2 > frame.width) continue;
      if (center.y + boxHeight / 2 < 0 || center.y - boxHeight / 2 > frame.height) continue;
      placed.push(centered(center, textWidth, size, angle));
    }
  }
  return placed;
}

export type NumberPosition = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';

/** 쪽번호 자리. 여백은 보이는 가장자리에서 글자까지의 거리다. */
export function numberPlacement(frame: Size, textWidth: number, size: number, position: NumberPosition, margin: number): Placed {
  const [vertical, horizontal] = position.split('-') as ['top' | 'bottom', 'center' | 'left' | 'right'];
  const x = horizontal === 'left' ? margin
    : horizontal === 'right' ? frame.width - margin - textWidth
      : (frame.width - textWidth) / 2;
  const y = vertical === 'bottom' ? margin : frame.height - margin - size * CAP;
  return { x, y, angle: 0 };
}

/** 보이는 틀의 자리를 사용자 공간의 drawText 인자로. */
export function placeOnPage(placed: Placed, box: Box, rotation: Quarter): Placed {
  const at = toUser(placed, box, rotation);
  return { x: at.x, y: at.y, angle: userAngle(placed.angle, rotation) };
}

// --- 입력 읽기 --------------------------------------------------------------------

/**
 * 쪽 범위 한 묶음. 비우면 전부다. `5-` 는 5쪽부터 끝까지.
 * 돌려주는 것은 0부터 센 번호를 오름차순으로 — 찍는 데는 순서가 없다.
 */
export function parsePageRange(text: string, count: number): number[] {
  if (!text.trim()) return Array.from({ length: count }, (_, index) => index);
  const found = new Set<number>();
  for (const part of text.split(',')) {
    if (!part.trim()) continue;
    const match = /^\s*(\d+)\s*(?:(-)\s*(\d*)\s*)?$/.exec(part);
    if (!match) throw new Error(`쪽 범위를 읽지 못했습니다: “${part.trim()}”. 예: 1-3, 5, 8-`);
    const first = Number(match[1]);
    const last = match[2] ? (match[3] ? Number(match[3]) : count) : first;
    if (first < 1 || last > count || last < first) throw new Error(`쪽 번호는 1~${count} 사이의 오름차순 범위로 적어 주세요.`);
    for (let n = first; n <= last; n++) found.add(n - 1);
  }
  if (!found.size) throw new Error('쪽 범위가 비었습니다.');
  return [...found].sort((a, b) => a - b);
}

/** `{n}`·`{total}` 을 채운다. `{n}` 이 없으면 모든 쪽에 같은 글자가 찍힌다 — 그건 워터마크다. */
export function formatPageNumber(template: string, n: number, total: number): string {
  if (!template.includes('{n}')) throw new Error('쪽번호 모양에 {n} 이 있어야 합니다. 예: {n} / {total}');
  return template.replaceAll('{n}', String(n)).replaceAll('{total}', String(total));
}

/** WinAnsi 의 0x80~0x9F 자리에 든 글자들. 나머지는 Latin-1 과 같다. */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** PDF 기본 글꼴(Helvetica)로 적을 수 있는가. 아니면 글꼴을 받아 심어야 한다. */
export function isWinAnsi(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) continue;
    if (WIN_ANSI_EXTRA.includes(char)) continue;
    return false;
  }
  return true;
}

export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return { r: 0, g: 0, b: 0 };
  const value = parseInt(match[1]!, 16);
  return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}

// --- 찍기 ------------------------------------------------------------------------

export interface WatermarkOptions {
  text: string;
  size: number;
  /** 0~1. */
  opacity: number;
  /** 보이는 틀에서 반시계 각도. */
  angle: number;
  color: Rgb;
  layout: Layout;
}

export interface NumberOptions {
  template: string;
  position: NumberPosition;
  /** pt. */
  margin: number;
  size: number;
  start: number;
  /** 범위의 첫 쪽(보통 표지)에는 번호를 찍지 않는다. 다음 쪽이 `start` 다. */
  skipFirst: boolean;
  color: Rgb;
}

export interface StampOptions {
  watermark?: WatermarkOptions | undefined;
  numbers?: NumberOptions | undefined;
  /** 쪽 범위. 비우면 전부. */
  range: string;
}

export const STAMP_LIMITS = { minSize: 4, maxSize: 200, chars: 80, templateChars: 40 };

/** 찍을 글자 전부. 글꼴을 받아야 하는지 먼저 알아야 해서 따로 뽑는다. */
export function stampTexts(options: StampOptions, pageCount: number): string[] {
  const texts: string[] = [];
  if (options.watermark) texts.push(options.watermark.text);
  if (options.numbers) {
    const numbered = numberedPages(parsePageRange(options.range, pageCount), options.numbers.skipFirst);
    const total = options.numbers.start + numbered.length - 1;
    // 모든 번호를 다 만들 필요는 없다. 쓰이는 글자는 숫자와 모양 글자뿐이다.
    texts.push(formatPageNumber(options.numbers.template, total, total));
    texts.push(formatPageNumber(options.numbers.template, options.numbers.start, total));
  }
  return texts;
}

export function needsFont(options: StampOptions, pageCount: number): boolean {
  return !stampTexts(options, pageCount).every(isWinAnsi);
}

function numberedPages(pages: number[], skipFirst: boolean): number[] {
  return skipFirst ? pages.slice(1) : pages;
}

function check(options: StampOptions): void {
  if (!options.watermark && !options.numbers) throw new Error('워터마크나 쪽번호 중 하나는 켜 주세요.');
  const size = (value: number, what: string): void => {
    if (!Number.isFinite(value) || value < STAMP_LIMITS.minSize || value > STAMP_LIMITS.maxSize) {
      throw new Error(`${what} 글자 크기는 ${STAMP_LIMITS.minSize}~${STAMP_LIMITS.maxSize}pt 사이여야 합니다.`);
    }
  };
  const mark = options.watermark;
  if (mark) {
    if (!mark.text.trim()) throw new Error('워터마크 글자를 적어 주세요.');
    if ([...mark.text].length > STAMP_LIMITS.chars) throw new Error(`워터마크는 ${STAMP_LIMITS.chars}자까지 적을 수 있습니다.`);
    size(mark.size, '워터마크');
    if (!(mark.opacity > 0 && mark.opacity <= 1)) throw new Error('불투명도는 1~100% 사이여야 합니다.');
    if (!Number.isFinite(mark.angle)) throw new Error('기울기를 숫자로 적어 주세요.');
  }
  const numbers = options.numbers;
  if (numbers) {
    if ([...numbers.template].length > STAMP_LIMITS.templateChars) throw new Error(`쪽번호 모양은 ${STAMP_LIMITS.templateChars}자까지입니다.`);
    size(numbers.size, '쪽번호');
    if (!Number.isInteger(numbers.start) || numbers.start < 0 || numbers.start > 100000) throw new Error('시작 번호는 0 이상의 정수여야 합니다.');
    if (!(numbers.margin >= 0 && numbers.margin <= 300)) throw new Error('여백을 확인해 주세요.');
  }
}

/** 한 줄로. 줄바꿈은 drawText 가 여러 줄로 나눠 가운데 맞춤이 틀어진다. */
const oneLine = (text: string): string => text.replace(/[\r\n\t]+/g, ' ');

export interface StampResult { bytes: Uint8Array; pages: number; numbered: number }

/**
 * 워터마크와 쪽번호를 찍는다.
 *
 * `fontBytes` 는 WinAnsi 로 적을 수 없는 글자(한글 등)가 있을 때만 쓴다.
 * 없는데 필요하면 조용히 물음표를 찍지 않고 멈춘다.
 */
export async function stampPdf(bytes: Uint8Array, options: StampOptions, fontBytes?: Uint8Array): Promise<StampResult> {
  check(options);
  const { document } = await readPdf(bytes, 'input.pdf');
  const count = document.getPageCount();
  const pages = parsePageRange(options.range, count);

  let font: PDFFont;
  if (needsFont(options, count)) {
    if (!fontBytes?.length) throw new Error('한글 등 기본 글꼴에 없는 글자가 있습니다. 글꼴을 골라 주세요.');
    // fontkit 은 400KB 가 넘는다. 실제로 심는 사람만 받는다.
    document.registerFontkit((await import('@pdf-lib/fontkit')).default);
    try {
      // 배치 테이블을 떼는 이유는 sfnt.ts 에. 서브셋이라 쓴 글자만 담긴다.
      font = await document.embedFont(stripLayoutTables(fontBytes), { subset: true });
    } catch (error) {
      throw new Error(`글꼴을 심지 못했습니다 — ${reason(error)}`);
    }
  } else {
    font = await document.embedFont(StandardFonts.Helvetica);
  }

  const mark = options.watermark;
  const markText = mark ? oneLine(mark.text) : '';
  const markWidth = mark ? font.widthOfTextAtSize(markText, mark.size) : 0;
  const numbers = options.numbers;
  const numbered = numbers ? numberedPages(pages, numbers.skipFirst) : [];
  const total = numbers ? numbers.start + numbered.length - 1 : 0;

  for (const index of pages) {
    const page = document.getPage(index);
    const { box, rotation } = pageFrame(page);
    const frame = visualSize(box, rotation);

    if (mark) {
      const color = rgb(mark.color.r, mark.color.g, mark.color.b);
      for (const placed of watermarkPlacements(frame, markWidth, mark.size, mark.angle, mark.layout)) {
        const at = placeOnPage(placed, box, rotation);
        page.drawText(markText, { x: at.x, y: at.y, rotate: degrees(at.angle), size: mark.size, font, color, opacity: mark.opacity });
      }
    }

    const ordinal = numbered.indexOf(index);
    if (numbers && ordinal >= 0) {
      const text = oneLine(formatPageNumber(numbers.template, numbers.start + ordinal, total));
      const width = font.widthOfTextAtSize(text, numbers.size);
      const at = placeOnPage(numberPlacement(frame, width, numbers.size, numbers.position, numbers.margin), box, rotation);
      page.drawText(text, {
        x: at.x, y: at.y, rotate: degrees(at.angle), size: numbers.size, font,
        color: rgb(numbers.color.r, numbers.color.g, numbers.color.b),
      });
    }
  }
  return { bytes: await document.save(), pages: pages.length, numbered: numbers ? numbered.length : 0 };
}
