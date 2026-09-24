/**
 * PDF 서명·도장 넣기 화면.
 *
 * 쪽을 그려 놓고 누른 자리에 그림을 반투명하게 겹쳐 보인다. 캔버스 한 장에
 * 쪽 그림과 겹침을 매번 다시 그린다 — 두 장을 겹치면 CSS 로 크기를 맞춰야 하고,
 * 좁은 화면에서 둘이 어긋나면 보이는 자리와 찍히는 자리가 달라진다.
 *
 * 누른 점은 PDF.js 의 `convertToPdfPoint` 로 사용자 공간에 옮긴 뒤, 저장과
 * **같은** 틀(pdf-lib 의 CropBox·/Rotate)로 비율을 잰다(`spotFromUser`). 미리보기의
 * 네모도 저장과 같은 `imageRect` 로 그린다.
 *
 * 캔버스를 누를 수 없는 사람을 위해 자리를 % 로도 적을 수 있다.
 */
import { reason } from './errors';
import { imageKind } from './images-pdf';
import { filePicker, need, outputs, size, statusLine, stem, toolSection, yieldToPaint } from './kit';
import { MAX_PDF_BYTES, readPdf } from './pdf';
import {
  imageRect, mmToPt, pageFrames, signPdf, SIGN_LIMITS, spotFromUser, whiteToTransparent,
  type Placement, type SignImage, type Spot,
} from './pdf-sign';
import { parsePageRange, visualSize, type Box, type Quarter } from './pdf-stamp';

import type { PageViewport, PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

/** PDF.js 는 무겁다. 파일을 처음 열 때 받는다(다른 PDF 도구와 같은 방식). */
let renderer: Promise<typeof import('./pdf-render')> | null = null;
const loadRenderer = (): NonNullable<typeof renderer> => (renderer ??= import('./pdf-render'));

/** 미리보기 폭(px). 이보다 넓게 그려도 누르는 자리가 더 정확해지지 않는다. */
const PREVIEW_WIDTH = 900;

interface Prepared extends SignImage { preview: ImageBitmap }

export function pdfSignTool(): HTMLElement {
  const tool = toolSection('conv-pdf-sign', `
    <h2>PDF 서명·도장 넣기</h2>
    <p class="conv-note">서명·직인 그림(PNG·JPEG)을 쪽 위 원하는 자리에 찍습니다. PDF 최대 64MB · 1,000쪽, 그림 20MB.
      파일과 그림은 이 컴퓨터를 벗어나지 않습니다.</p>
    <ul class="conv-notes">
      <li><strong>전자서명·공인인증 서명이 아닙니다.</strong> 그림을 얹을 뿐이라 누구나 떼어 다른 문서에 붙일 수 있고, 찍은 뒤 문서가 바뀌었는지도 알 수 없습니다. 법적 효력이 필요한 서명에는 쓰지 마세요.</li>
      <li>PNG·JPEG 는 다시 압축하지 않고 넣습니다. 그 밖의 그림과 “흰 바탕 투명하게” 는 캔버스를 거쳐 PNG 로 바뀝니다.</li>
      <li>원본에 전자서명이 있었다면 저장하면서 그 서명은 무효가 됩니다.</li>
    </ul>
    <label class="conv-drop" for="sign-file">
      <input id="sign-file" type="file" accept=".pdf,application/pdf" />
      <span>PDF 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <label class="conv-drop" for="sign-image">
      <input id="sign-image" type="file" accept="image/*" />
      <span>서명·도장 그림을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <label><input type="checkbox" id="sign-white" /> 흰 바탕 투명하게 (종이에 찍어 스캔한 도장·서명)</label>
    <p class="conv-status" role="status" aria-live="polite"></p>

    <fieldset class="sign-controls" disabled>
      <legend>자리 고르기</legend>
      <div class="conv-actions">
        <button type="button" data-action="prev">◀ 이전 쪽</button>
        <label>쪽 <select id="sign-page"></select></label>
        <button type="button" data-action="next">다음 쪽 ▶</button>
      </div>
      <p class="conv-note">쪽 위를 누르면 그 자리가 그림의 가운데가 됩니다. 반투명한 것이 고르는 중인 자리입니다.</p>
      <div class="conv-canvas-stage"><canvas class="sign-canvas" aria-label="쪽 미리보기 — 눌러서 자리를 고릅니다"></canvas></div>
      <div class="conv-form">
        <label for="sign-width">그림 폭(mm)</label>
        <input id="sign-width" type="number" min="${SIGN_LIMITS.minWidthMm}" max="${SIGN_LIMITS.maxWidthMm}" step="1" value="30" />
        <label for="sign-fx">왼쪽에서(%)</label>
        <input id="sign-fx" type="number" min="0" max="100" step="0.5" value="80" />
        <label for="sign-fy">위에서(%)</label>
        <input id="sign-fy" type="number" min="0" max="100" step="0.5" value="85" />
        <label for="sign-range">적용할 쪽</label>
        <input id="sign-range" type="text" placeholder="비우면 보고 있는 쪽만. 예: 1-3, 5" />
      </div>
      <label><input type="checkbox" id="sign-all" /> 모든 쪽에 같은 자리</label>
      <p class="conv-note">크기가 다른 쪽에서는 쪽 크기에 대한 비율로 같은 자리에 찍습니다. 쪽 밖으로 나가면 안으로 밀어 넣습니다.</p>
      <div class="conv-actions">
        <button type="button" data-action="add">이 자리 추가</button>
      </div>
      <h3>찍을 자리</h3>
      <ul class="conv-list sign-list" aria-label="찍을 자리"></ul>
      <div class="conv-actions">
        <button type="button" class="conv-download" data-action="save">찍어서 저장</button>
        <button type="button" data-action="reset">자리 모두 지우기</button>
      </div>
    </fieldset>
    <div class="conv-outputs conv-actions" aria-label="저장 결과"></div>
  `);

  const pdfInput = need<HTMLInputElement>(tool, '#sign-file');
  const imageInput = need<HTMLInputElement>(tool, '#sign-image');
  const white = need<HTMLInputElement>(tool, '#sign-white');
  const say = statusLine(need(tool, '.conv-status'));
  const out = outputs(need(tool, '.conv-outputs'));
  const controls = need<HTMLFieldSetElement>(tool, '.sign-controls');
  const pageSelect = need<HTMLSelectElement>(tool, '#sign-page');
  const canvas = need<HTMLCanvasElement>(tool, '.sign-canvas');
  const widthInput = need<HTMLInputElement>(tool, '#sign-width');
  const fxInput = need<HTMLInputElement>(tool, '#sign-fx');
  const fyInput = need<HTMLInputElement>(tool, '#sign-fy');
  const rangeInput = need<HTMLInputElement>(tool, '#sign-range');
  const all = need<HTMLInputElement>(tool, '#sign-all');
  const list = need<HTMLUListElement>(tool, '.sign-list');

  let source: { name: string; bytes: Uint8Array; frames: { box: Box; rotation: Quarter }[] } | null = null;
  let pdf: { task: PDFDocumentLoadingTask; document: PDFDocumentProxy } | null = null;
  let imageFile: File | null = null;
  let image: Prepared | null = null;
  const placements: Placement[] = [];
  let pageIndex = 0;
  let busy = false;
  /** 그려 둔 쪽. 겹침만 바꿀 때 쪽을 다시 그리지 않는다. */
  let base: HTMLCanvasElement | null = null;
  let viewport: PageViewport | null = null;
  let scale = 1;
  let drawing = 0;

  const render = (): void => {
    controls.disabled = busy || !source;
    pdfInput.disabled = busy;
    imageInput.disabled = busy;
  };

  const spot = (): Spot => ({
    fx: clamp01((Number(fxInput.value) || 0) / 100),
    fy: clamp01((Number(fyInput.value) || 0) / 100),
  });

  // --- 파일 ---------------------------------------------------------------------

  filePicker(pdfInput, files => void openPdfFile(files[0]!), () => busy);
  filePicker(imageInput, files => { imageFile = files[0]!; void prepareImage(); }, () => busy);
  white.addEventListener('change', () => { if (imageFile) void prepareImage(); });

  async function openPdfFile(file: File): Promise<void> {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { say('PDF 파일만 열 수 있습니다.', 'error'); return; }
    if (file.size > MAX_PDF_BYTES) { say(`파일이 너무 큽니다(${size(file.size)}). 64MB까지 읽습니다.`, 'error'); return; }
    busy = true; render(); out.clear();
    try {
      say(`${file.name} 읽는 중…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      await readPdf(bytes, file.name);
      const frames = await pageFrames(bytes);
      await pdf?.task.destroy().catch(() => {});
      pdf = null;
      const task = (await loadRenderer()).openPdf(bytes);
      pdf = { task, document: await task.promise };
      source = { name: file.name, bytes, frames };
      placements.length = 0;
      pageIndex = 0;
      pageSelect.replaceChildren(...frames.map((_, index) => {
        const node = document.createElement('option');
        node.value = String(index);
        node.textContent = `${index + 1} / ${frames.length}`;
        return node;
      }));
      busy = false; render();
      await showPage();
      renderList();
      say(`${file.name} · ${frames.length}쪽.${image ? ' 쪽 위를 눌러 자리를 고르세요.' : ' 이제 서명·도장 그림을 올려 주세요.'}`, 'ok');
    } catch (error) {
      source = null;
      say(reason(error), 'error');
    } finally { busy = false; render(); }
  }

  /**
   * 그림을 PDF 에 넣을 모양으로. PNG·JPEG 는 그대로 두고, 그 밖의 형식이나
   * 흰 바탕 지우기는 캔버스를 거친다(JPEG 는 투명을 담지 못한다).
   */
  async function prepareImage(): Promise<void> {
    const file = imageFile;
    if (!file) return;
    if (file.size > SIGN_LIMITS.imageBytes) { say(`그림이 너무 큽니다(${size(file.size)}). 20MB까지 읽습니다.`, 'error'); return; }
    try {
      say(`${file.name} 읽는 중…`);
      let bitmap: ImageBitmap;
      try { bitmap = await createImageBitmap(file); }
      catch { throw new Error(`${file.name}: 이 브라우저가 열 수 없는 그림입니다. PNG 또는 JPEG 로 저장해 주세요.`); }
      const original = new Uint8Array(await file.arrayBuffer());
      const kind = imageKind(original);
      let prepared: Prepared;
      if (kind && !white.checked) {
        prepared = { bytes: original, kind, width: bitmap.width, height: bitmap.height, preview: bitmap };
      } else {
        const bytes = await redraw(bitmap, white.checked, file.name);
        bitmap.close();
        const preview = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        prepared = { bytes, kind: 'png', width: preview.width, height: preview.height, preview };
      }
      image?.preview.close();
      image = prepared;
      out.clear();
      draw();
      say(`${file.name} · ${image.width}×${image.height}px${white.checked ? ' · 흰 바탕을 투명하게 했습니다' : ''}.${source ? ' 쪽 위를 눌러 자리를 고르세요.' : ' 이제 PDF 를 올려 주세요.'}`, 'ok');
    } catch (error) {
      say(reason(error), 'error');
    }
  }

  // --- 그리기 -------------------------------------------------------------------

  async function showPage(): Promise<void> {
    if (!pdf || !source) return;
    const ticket = ++drawing;
    pageSelect.value = String(pageIndex);
    const page = await pdf.document.getPage(pageIndex + 1);
    try {
      const natural = page.getViewport({ scale: 1, rotation: page.rotate });
      scale = Math.min(2, PREVIEW_WIDTH / natural.width);
      const next = page.getViewport({ scale, rotation: page.rotate });
      const target = document.createElement('canvas');
      await (await loadRenderer()).renderToCanvas(page, target, next);
      // 그리는 사이에 다른 쪽으로 넘어갔으면 늦게 온 그림은 버린다.
      if (ticket !== drawing) return;
      base = target;
      viewport = next;
      draw();
    } finally { page.cleanup(); }
  }

  /** 쪽 그림 위에 찍을 자리들과 고르는 중인 자리를 겹친다. */
  function draw(): void {
    if (!base || !source) return;
    canvas.width = base.width;
    canvas.height = base.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(base, 0, 0);
    if (!image) return;
    const frame = source.frames[pageIndex]!;
    const visual = visualSize(frame.box, frame.rotation);
    const paint = (at: Spot, widthMm: number, alpha: number, outline: boolean): void => {
      const rect = imageRect(visual, at, mmToPt(widthMm), image!.height / image!.width);
      // 보이는 틀은 아래가 원점이고 캔버스는 위가 원점이다.
      const x = rect.x * scale;
      const y = (visual.height - rect.y - rect.height) * scale;
      context.globalAlpha = alpha;
      context.drawImage(image!.preview, x, y, rect.width * scale, rect.height * scale);
      context.globalAlpha = 1;
      if (outline) {
        context.setLineDash([6, 4]);
        context.strokeStyle = '#0a66c2';
        context.lineWidth = 1.5;
        context.strokeRect(x, y, rect.width * scale, rect.height * scale);
        context.setLineDash([]);
      }
    };
    for (const placement of placements) if (placement.pages.includes(pageIndex)) paint(placement, placement.widthMm, 0.9, false);
    paint(spot(), Number(widthInput.value) || 30, 0.5, true);
  }

  canvas.addEventListener('click', event => {
    if (!viewport || !source) return;
    const bounds = canvas.getBoundingClientRect();
    // 좁은 화면에서는 CSS 가 캔버스를 줄여 보인다. 픽셀 자리로 되돌린다.
    const px = (event.clientX - bounds.left) * (canvas.width / bounds.width);
    const py = (event.clientY - bounds.top) * (canvas.height / bounds.height);
    const [ux, uy] = viewport.convertToPdfPoint(px, py) as [number, number];
    const frame = source.frames[pageIndex]!;
    const at = spotFromUser({ x: ux, y: uy }, frame.box, frame.rotation);
    fxInput.value = (at.fx * 100).toFixed(1);
    fyInput.value = (at.fy * 100).toFixed(1);
    draw();
  });
  for (const field of [fxInput, fyInput, widthInput]) field.addEventListener('input', draw);

  const go = (index: number): void => {
    if (!source) return;
    pageIndex = Math.min(Math.max(index, 0), source.frames.length - 1);
    void showPage().catch(error => say(reason(error), 'error'));
  };
  pageSelect.addEventListener('change', () => go(Number(pageSelect.value)));

  // --- 자리 목록과 저장 ------------------------------------------------------------

  function renderList(): void {
    list.replaceChildren();
    if (!placements.length) {
      const empty = document.createElement('li');
      empty.textContent = '아직 고른 자리가 없습니다.';
      list.append(empty);
      return;
    }
    placements.forEach((placement, index) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${pagesLabel(placement.pages, source?.frames.length ?? 0)} · 왼쪽에서 ${(placement.fx * 100).toFixed(1)}% · 위에서 ${(placement.fy * 100).toFixed(1)}% · 폭 ${placement.widthMm}mm`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '빼기';
      remove.setAttribute('aria-label', `${index + 1}번째 자리 빼기`);
      remove.addEventListener('click', () => { placements.splice(index, 1); out.clear(); renderList(); draw(); });
      row.append(label, remove);
      list.append(row);
    });
  }

  controls.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset['action'];
    if (!action || busy || !source) return;
    if (action === 'prev') go(pageIndex - 1);
    else if (action === 'next') go(pageIndex + 1);
    else if (action === 'reset') { placements.length = 0; out.clear(); renderList(); draw(); say('자리를 모두 지웠습니다.'); }
    else if (action === 'add') add();
    else if (action === 'save') void save();
  });

  function add(): void {
    if (!source) return;
    try {
      if (!image) throw new Error('서명·도장 그림을 먼저 올려 주세요.');
      const widthMm = Number(widthInput.value);
      if (!(widthMm >= SIGN_LIMITS.minWidthMm && widthMm <= SIGN_LIMITS.maxWidthMm)) {
        throw new Error(`그림 폭은 ${SIGN_LIMITS.minWidthMm}~${SIGN_LIMITS.maxWidthMm}mm 사이여야 합니다.`);
      }
      if (placements.length >= SIGN_LIMITS.placements) throw new Error(`자리는 ${SIGN_LIMITS.placements}곳까지 넣을 수 있습니다.`);
      const count = source.frames.length;
      const pages = all.checked ? parsePageRange('', count)
        : rangeInput.value.trim() ? parsePageRange(rangeInput.value, count)
          : [pageIndex];
      placements.push({ ...spot(), widthMm, pages });
      out.clear();
      renderList();
      draw();
      say(`${pagesLabel(pages, count)}에 찍을 자리를 추가했습니다.`, 'ok');
    } catch (error) {
      say(reason(error), 'error');
    }
  }

  async function save(): Promise<void> {
    if (!source) return;
    busy = true; render(); out.clear();
    try {
      if (!image) throw new Error('서명·도장 그림을 먼저 올려 주세요.');
      if (!placements.length) throw new Error('“이 자리 추가” 로 찍을 자리를 하나 이상 넣어 주세요.');
      say('찍는 중…');
      await yieldToPaint();
      const result = await signPdf(source.bytes, image, placements);
      out.add(result.bytes, `${stem(source.name)}-signed.pdf`, 'application/pdf');
      say(`${result.stamps}곳에 찍었습니다. 아래 링크를 눌러 내려받으세요. 전자서명이 아닌 그림입니다.`, 'ok');
    } catch (error) {
      out.clear();
      say(reason(error), 'error');
    } finally { busy = false; render(); }
  }

  render();
  renderList();
  return tool;
}

/** 캔버스를 거쳐 PNG 로. 흰 바탕 지우기는 여기서 한다. */
async function redraw(bitmap: ImageBitmap, clearWhite: boolean, name: string): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: clearWhite });
    if (!context) throw new Error('캔버스를 만들지 못했습니다.');
    context.drawImage(bitmap, 0, 0);
    if (clearWhite) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      whiteToTransparent(pixels.data);
      context.putImageData(pixels, 0, 0);
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(value => value ? resolve(value) : reject(new Error(`${name}: PNG 로 바꾸지 못했습니다.`)), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { canvas.width = 0; canvas.height = 0; }
}

function pagesLabel(pages: number[], count: number): string {
  if (pages.length === count && count > 1) return '모든 쪽';
  if (pages.length === 1) return `${pages[0]! + 1}쪽`;
  return `${pages.length}개 쪽(${pages[0]! + 1}쪽~)`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
