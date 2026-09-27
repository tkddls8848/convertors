/**
 * PDF 모아찍기·빈 쪽 빼기 — 화면 없이 도는 부분.
 *
 * 모아찍기는 원본 쪽을 통째로 그림처럼(Form XObject) 떠서 A4 한 장에 칸을 나눠
 * 앉힌다. 글자는 글자로 남아 검색·복사가 되지만, 링크·양식·주석은 **쪽 내용이
 * 아니라서** 따라오지 않는다.
 *
 * pdf-lib 의 embedPage 는 /Rotate 를 모른다 — 돌아 보이던 스캔 쪽이 옆으로
 * 누워서 앉는다. 그래서 보이는 크기로 칸에 맞추고, 그리는 쪽에서 거꾸로 돌려
 * 바로 세운다(`placeRotated`).
 *
 * 빈 쪽은 **그려 보고** 가린다. 내용 스트림이 비었는지로는 알 수 없다 — 흰
 * 네모를 칠한 쪽, 스캔한 빈 종이도 내용은 있다. 그림으로 가리는 것은 추정이라
 * 화면이 고르게 하고, 글자가 하나라도 있는 쪽은 애초에 후보에 올리지 않는다.
 */
import { degrees, PDFDocument, rgb, type PDFEmbeddedPage } from 'pdf-lib';

import { readPdf } from './pdf';
import { pageFrame, visualSize, type Box, type Point, type Quarter, type Size } from './pdf-stamp';

/** A4 (210×297mm) 를 pt 로. */
export const A4: Size = { width: 595.28, height: 841.89 };
export const PER_SHEET = [2, 4, 6, 9] as const;
export type PerSheet = typeof PER_SHEET[number];
/** row: 왼쪽→오른쪽 다음 줄. column: 위→아래 다음 칸. */
export type Order = 'row' | 'column';

export interface NupLayout { sheet: Size; cols: number; rows: number }

/** 쪽 수를 나누는 모든 가로×세로. 2 → 2×1, 1×2. */
function grids(n: number): [number, number][] {
  const found: [number, number][] = [];
  for (let cols = 1; cols <= n; cols++) if (n % cols === 0) found.push([cols, n / cols]);
  return found;
}

/**
 * 원본 쪽이 가장 크게 앉는 용지 방향과 칸 나눔을 고른다.
 *
 * 세로 원본이면 2쪽은 A4 가로에 2×1, 4쪽은 A4 세로에 2×2, 6쪽은 A4 가로에 3×2,
 * 9쪽은 A4 세로에 3×3 이 된다.
 * 크기가 같으면 세로를 고른다 — 사람들이 기대하는 모양이다.
 */
export function chooseLayout(n: number, page: Size, margin: number, gap: number): NupLayout {
  let best: NupLayout & { scale: number } | null = null;
  for (const sheet of [A4, { width: A4.height, height: A4.width }]) {
    for (const [cols, rows] of grids(n)) {
      const cell = cellSize({ sheet, cols, rows }, margin, gap);
      const scale = Math.min(cell.width / page.width, cell.height / page.height);
      if (!best || scale > best.scale + 1e-9) best = { sheet, cols, rows, scale };
    }
  }
  if (!best || best.scale <= 0) throw new Error('여백과 간격이 너무 커서 쪽이 들어갈 자리가 없습니다.');
  return { sheet: best.sheet, cols: best.cols, rows: best.rows };
}

function cellSize(layout: NupLayout, margin: number, gap: number): Size {
  return {
    width: (layout.sheet.width - margin * 2 - gap * (layout.cols - 1)) / layout.cols,
    height: (layout.sheet.height - margin * 2 - gap * (layout.rows - 1)) / layout.rows,
  };
}

/** 칸들을 채우는 순서대로. 좌표는 PDF 식(왼쪽 아래 원점)이다. */
export function cellRects(layout: NupLayout, margin: number, gap: number, order: Order): Box[] {
  const cell = cellSize(layout, margin, gap);
  const rects: Box[] = [];
  const total = layout.cols * layout.rows;
  for (let i = 0; i < total; i++) {
    const col = order === 'row' ? i % layout.cols : Math.floor(i / layout.rows);
    const row = order === 'row' ? Math.floor(i / layout.cols) : i % layout.rows;
    rects.push({
      x: margin + col * (cell.width + gap),
      // 첫 줄이 맨 위다. PDF 는 y 가 위로 자라므로 거꾸로 센다.
      y: layout.sheet.height - margin - (row + 1) * cell.height - row * gap,
      width: cell.width, height: cell.height,
    });
  }
  return rects;
}

/** 비율을 지켜 칸 가운데에 앉힌 네모와 배율. */
export function fitInCell(size: Size, cell: Box): Box & { scale: number } {
  const scale = Math.min(cell.width / size.width, cell.height / size.height);
  const width = size.width * scale;
  const height = size.height * scale;
  return { x: cell.x + (cell.width - width) / 2, y: cell.y + (cell.height - height) / 2, width, height, scale };
}

/**
 * 돌지 않은 쪽(`size`, /Rotate 전)을 `scale` 배로 그려, 보이는 모습이 `target`
 * 을 왼쪽 아래로 하는 네모에 바로 서게 하는 drawPage 인자.
 *
 * /Rotate 는 시계방향이고 drawPage 의 rotate 는 원점 둘레 반시계라 `-rotation`
 * 만큼 돌린다. 돌리면 네모가 원점의 왼쪽·아래로 넘어가므로 그만큼 원점을 민다.
 */
export function placeRotated(size: Size, rotation: Quarter, scale: number, target: Point): Point & { rotate: number } {
  const w = size.width * scale;
  const h = size.height * scale;
  const offset = rotation === 90 ? { x: 0, y: w }
    : rotation === 180 ? { x: w, y: h }
      : rotation === 270 ? { x: h, y: 0 }
        : { x: 0, y: 0 };
  return { x: target.x + offset.x, y: target.y + offset.y, rotate: -rotation };
}

export interface NupOptions {
  perSheet: PerSheet;
  order: Order;
  /** pt. */
  margin: number;
  gap: number;
  border: boolean;
}

export interface NupResult { bytes: Uint8Array; sheets: number; layout: NupLayout; skipped: number[] }

export async function nupPdf(bytes: Uint8Array, options: NupOptions): Promise<NupResult> {
  if (!PER_SHEET.includes(options.perSheet)) throw new Error('한 장에 2·4·6·9쪽 중에서 고르세요.');
  if (!(options.margin >= 0 && options.gap >= 0)) throw new Error('여백과 간격은 0 이상이어야 합니다.');
  const { document: source } = await readPdf(bytes, 'input.pdf');
  const pages = source.getPages();
  const frames = pages.map(pageFrame);
  // 칸 나눔은 첫 쪽을 보고 정한다. 모양이 다른 쪽도 제 칸 안에서 비율을 지킨다.
  const first = frames[0]!;
  const layout = chooseLayout(options.perSheet, visualSize(first.box, first.rotation), options.margin, options.gap);
  const cells = cellRects(layout, options.margin, options.gap, options.order);

  const output = await PDFDocument.create();
  const skipped: number[] = [];
  const embedded: (PDFEmbeddedPage | null)[] = [];
  for (const [index, page] of pages.entries()) {
    const { box } = frames[index]!;
    // 내용 스트림이 아예 없는 쪽은 뜰 것이 없다 — pdf-lib 은 저장할 때 가서야 죽는다.
    // 칸은 비워 두고 자리는 지킨다.
    if (!page.node.Contents()) {
      embedded.push(null);
      skipped.push(index);
      continue;
    }
    // 보이는 네모(CropBox)만 떠 온다. 기본값은 MediaBox 라 잘려 있던 가장자리가 되살아난다.
    embedded.push(await output.embedPage(page, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height }));
  }

  const perSheet = options.perSheet;
  for (let start = 0; start < pages.length; start += perSheet) {
    const sheet = output.addPage([layout.sheet.width, layout.sheet.height]);
    for (let slot = 0; slot < perSheet && start + slot < pages.length; slot++) {
      const index = start + slot;
      const { box, rotation } = frames[index]!;
      const fitted = fitInCell(visualSize(box, rotation), cells[slot]!);
      const form = embedded[index];
      if (form) {
        const at = placeRotated(box, rotation, fitted.scale, fitted);
        sheet.drawPage(form, { x: at.x, y: at.y, xScale: fitted.scale, yScale: fitted.scale, rotate: degrees(at.rotate) });
      }
      if (options.border) {
        sheet.drawRectangle({ ...fitted, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
      }
    }
  }
  return { bytes: await output.save(), sheets: output.getPageCount(), layout, skipped };
}

// --- 빈 쪽 --------------------------------------------------------------------------

/**
 * 흰 바탕이 아닌 픽셀의 비율(0~1).
 *
 * 가장 어두운 채널이 `threshold` 보다 어두우면 잉크로 본다. 투명한 픽셀은 흰
 * 종이 위에 얹힌 것으로 보고 섞는다. 스캔의 옅은 얼룩까지 잉크로 치지 않도록
 * 문턱은 흰색에서 조금 떨어뜨려 둔다.
 */
export function inkRatio(rgba: Uint8ClampedArray, threshold = 220): number {
  const pixels = Math.floor(rgba.length / 4);
  if (!pixels) return 0;
  let ink = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    const alpha = rgba[i + 3]! / 255;
    const dark = Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    const onWhite = 255 - alpha * (255 - dark);
    if (onWhite < threshold) ink++;
  }
  return ink / pixels;
}

/** 빈 쪽 후보 판정. 글자가 있으면 그림이 아무리 비어도 빈 쪽이 아니다. */
export function isBlank(ratio: number, hasText: boolean, sensitivity: number): boolean {
  return !hasText && ratio <= sensitivity;
}

/**
 * 고른 쪽을 뺀 새 PDF.
 *
 * `removePage` 로 지우지 않고 남길 쪽을 새 문서로 복사한다 — pdf-lib 은 지운
 * 쪽의 내용 객체를 파일에 그대로 남겨서, 뺀 쪽이 파일 안에 숨어 따라간다.
 */
export async function removePages(bytes: Uint8Array, remove: number[]): Promise<{ bytes: Uint8Array; pages: number }> {
  const { document: source } = await readPdf(bytes, 'input.pdf');
  const dropped = new Set(remove);
  const keep = source.getPageIndices().filter(index => !dropped.has(index));
  if (!keep.length) throw new Error('모든 쪽을 뺄 수는 없습니다. 남길 쪽을 하나 이상 두세요.');
  const output = await PDFDocument.create();
  for (const page of await output.copyPages(source, keep)) output.addPage(page);
  return { bytes: await output.save(), pages: keep.length };
}
