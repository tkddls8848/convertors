/**
 * PDF 서명·도장 넣기 — 화면 없이 도는 부분.
 *
 * 그림을 쪽 위에 올려 찍을 뿐이다. **전자서명이 아니다** — 누구나 그림을 떼어
 * 다른 문서에 붙일 수 있고, 문서가 뒤에 바뀌었는지도 알 수 없다. 화면이 그렇게
 * 적는다.
 *
 * 자리는 **보이는 틀의 비율** 로 들고 있는다(왼쪽 위에서 가로·세로 몇 %).
 * "모든 쪽에 같은 자리" 를 크기가 다른 쪽에도 뜻이 통하게 옮기려면 pt 보다
 * 비율이 낫고, /Rotate 가 걸린 쪽도 보이는 대로 같은 곳에 떨어진다.
 */
import { degrees, PDFDocument } from 'pdf-lib';

import { readPdf } from './pdf';
import { pageFrame, rotate, toUser, toVisual, userAngle, visualSize, type Box, type Point, type Quarter, type Size } from './pdf-stamp';

export const SIGN_LIMITS = {
  imageBytes: 20 * 1024 * 1024,
  placements: 50,
  minWidthMm: 3,
  maxWidthMm: 300,
};

export function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

/** 보이는 틀의 비율 자리. 왼쪽 위가 (0,0), 오른쪽 아래가 (1,1) — 화면 좌표와 같은 방향. */
export interface Spot { fx: number; fy: number }

export interface Placement extends Spot {
  /** 0부터 센 쪽 번호들. */
  pages: number[];
  widthMm: number;
}

export interface SignImage {
  bytes: Uint8Array;
  kind: 'png' | 'jpeg';
  /** 픽셀. 가로세로 비율에만 쓴다. */
  width: number;
  height: number;
}

/** PDF.js 가 돌려준 사용자 공간 점 → 보이는 틀의 비율. */
export function spotFromUser(point: Point, box: Box, rotation: Quarter): Spot {
  const frame = visualSize(box, rotation);
  const at = toVisual(point, box, rotation);
  return { fx: clamp01(at.x / frame.width), fy: clamp01(1 - at.y / frame.height) };
}

/**
 * 보이는 틀 위의 그림 네모(왼쪽 아래 원점, pt).
 *
 * 쪽보다 크면 쪽 폭에 맞춰 줄이고, 가장자리를 넘으면 안으로 밀어 넣는다 —
 * 반쯤 잘린 도장은 찍힌 것도 안 찍힌 것도 아니다.
 */
export function imageRect(frame: Size, spot: Spot, widthPt: number, aspect: number): Box {
  let width = widthPt;
  let height = width * aspect;
  const fit = Math.min(1, frame.width / width, frame.height / height);
  width *= fit;
  height *= fit;
  const cx = clamp(spot.fx * frame.width, width / 2, frame.width - width / 2);
  const cy = clamp((1 - spot.fy) * frame.height, height / 2, frame.height - height / 2);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** drawImage 인자. 그림은 원점(x,y) 둘레로 돈다. */
export interface DrawArgs extends Box { rotate: number }

/**
 * 보이는 틀의 네모를 사용자 공간의 drawImage 인자로.
 *
 * 돌린 쪽에서는 그림도 같이 돌려야 보는 사람에게 바로 선다. 가운데를 옮긴 뒤
 * 돌린 그림의 가운데가 거기 오도록 원점을 되짚는다.
 */
export function drawArgs(rect: Box, box: Box, rotation: Quarter): DrawArgs {
  const center = toUser({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, box, rotation);
  const angle = userAngle(0, rotation);
  const half = rotate({ x: rect.width / 2, y: rect.height / 2 }, angle);
  return { x: center.x - half.x, y: center.y - half.y, width: rect.width, height: rect.height, rotate: angle };
}

/**
 * 흰 바탕을 투명하게. 스캔한 도장·서명은 흰 종이가 같이 찍혀 글자를 가린다.
 *
 * 가장 어두운 채널로 가린다 — 붉은 인주(255,0,0)는 밝기로는 밝아도 지워지면
 * 안 된다. 경계 40 단계는 서서히 투명하게 해 가장자리가 톱니가 되지 않게 한다.
 * 바꾼 픽셀 수를 돌려준다.
 */
export function whiteToTransparent(rgba: Uint8ClampedArray, threshold = 235): number {
  const soft = 40;
  let changed = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const light = Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    if (light >= threshold) {
      if (rgba[i + 3]) changed++;
      rgba[i + 3] = 0;
    } else if (light > threshold - soft) {
      rgba[i + 3] = Math.round(rgba[i + 3]! * ((threshold - light) / soft));
      changed++;
    }
  }
  return changed;
}

/** 서명·도장 그림을 찍은 새 PDF. */
export async function signPdf(bytes: Uint8Array, image: SignImage, placements: Placement[]): Promise<{ bytes: Uint8Array; stamps: number }> {
  if (!placements.length) throw new Error('찍을 자리를 하나 이상 골라 주세요.');
  if (placements.length > SIGN_LIMITS.placements) throw new Error(`자리는 ${SIGN_LIMITS.placements}곳까지 넣을 수 있습니다.`);
  if (!(image.width > 0 && image.height > 0)) throw new Error('그림 크기를 읽지 못했습니다.');
  const { document } = await readPdf(bytes, 'input.pdf');
  const count = document.getPageCount();
  // 한 번만 심고 여러 번 가리킨다. 쪽마다 심으면 그림이 쪽 수만큼 들어간다.
  const embedded = image.kind === 'png' ? await document.embedPng(image.bytes) : await document.embedJpg(image.bytes);
  const aspect = image.height / image.width;

  let stamps = 0;
  for (const placement of placements) {
    if (!(placement.widthMm >= SIGN_LIMITS.minWidthMm && placement.widthMm <= SIGN_LIMITS.maxWidthMm)) {
      throw new Error(`그림 폭은 ${SIGN_LIMITS.minWidthMm}~${SIGN_LIMITS.maxWidthMm}mm 사이여야 합니다.`);
    }
    for (const index of placement.pages) {
      if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`${index + 1}쪽이 없습니다.`);
      const page = document.getPage(index);
      const { box, rotation } = pageFrame(page);
      const rect = imageRect(visualSize(box, rotation), placement, mmToPt(placement.widthMm), aspect);
      const args = drawArgs(rect, box, rotation);
      page.drawImage(embedded, { ...args, rotate: degrees(args.rotate) });
      stamps++;
    }
  }
  return { bytes: await document.save(), stamps };
}

/**
 * 쪽마다의 보이는 틀. 화면이 누른 점을 비율로 바꿀 때 쓴다 — 저장할 때와
 * **같은** pdf-lib 의 틀로 재야 미리보기와 결과가 어긋나지 않는다.
 */
export async function pageFrames(bytes: Uint8Array): Promise<{ box: Box; rotation: Quarter }[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return document.getPages().map(pageFrame);
}

function clamp(value: number, low: number, high: number): number {
  return high < low ? (low + high) / 2 : Math.min(high, Math.max(low, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
