import { readEditSpans, type Span } from './pdf-edit-spans';
import { pdfEditMarkup } from './pdf-edit-view';
import { createFontMeasurer } from './pdf-edit-measure';
/**
 * PDF 글자 고치기 화면.
 *
 * 쪽을 그려 놓고 글자 조각 위에 상자를 겹친다. 상자를 누르면 그 자리의 글자를
 * 고치거나 지운다. ‘글자 추가’ 를 누르면 빈 곳을 눌러 새 글자를 넣는다.
 * 무엇이 저장될지는 **실제로 고친 PDF 를 다시 그려** 보여 준다 — 화면에서 본
 * 것과 저장한 것이 다르면 이 도구는 쓸모가 없다.
 *
 * 그래서 문서를 둘 들고 있는다.
 *
 *   원본  — 고를 수 있는 글자 조각이 어디에 있는지. 끝까지 바뀌지 않는다
 *   미리보기 — 원본 + 고친 자리. 화면에 그리는 것은 이쪽이다
 *
 * 조각 목록을 미리보기에서 뽑지 않는 이유는, 미리보기에서는 고친 조각이 이미
 * 지워져 있기 때문이다. 고친 자리를 다시 누르거나 되돌리려면 원래 조각이 그
 * 자리에 남아 있어야 한다. 미리보기에서 뽑으면 새로 쓴 글자가 조각으로 잡힌다.
 */
import { PDFDocument } from 'pdf-lib';

import { reason } from '../../shared/errors';
import { loadCatalog, loadFont, mb, STANDARD_FONTS, type CatalogFont } from './fonts';
import {
  applyTextEdits, EDIT_LIMITS, shrinkToFit, sourceFontId, sourceFontResource,
  type Rgb, type FontSource, type SpanBox, type TextEdit,
} from './pdf-edit';
import { redactText } from './pdf-redact';
import { closestFont, readSourceFonts, type SourceFont } from './pdf-source-font';
import { readTables } from './sfnt';

import type { PageViewport, PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

/**
 * PDF.js 는 440KB 다. ZIP 만 풀러 온 사람이 내려받을 이유가 없으므로 파일을
 * 처음 열 때 받아 한 번만 붙든다 (다른 PDF 도구와 같은 방식).
 */
let renderer: Promise<typeof import('./pdf-render')> | null = null;
const loadRenderer = (): NonNullable<typeof renderer> => (renderer ??= import('./pdf-render'));

export function pdfEditTool(): HTMLElement {
  const tool = document.createElement('section');
  tool.className = 'conv-tool conv-pdf-edit';
  tool.innerHTML = pdfEditMarkup();

  const $ = <T extends HTMLElement>(selector: string): T => tool.querySelector<T>(selector)!;
  const input = $<HTMLInputElement>('#conv-edit-file');
  const drop = $<HTMLLabelElement>('.conv-drop');
  const status = $<HTMLParagraphElement>('.conv-status');
  const controls = $<HTMLFieldSetElement>('.edit-controls');
  const stage = $<HTMLDivElement>('.edit-stage');
  const canvas = $<HTMLCanvasElement>('.edit-canvas');
  const overlay = $<HTMLDivElement>('.edit-spans');
  const spotMark = $<HTMLDivElement>('.edit-spot');
  const pageLabel = $<HTMLSpanElement>('.edit-page');
  const zoom = $<HTMLSelectElement>('.edit-zoom');
  const form = $<HTMLDivElement>('.edit-form');
  const formTitle = $<HTMLHeadingElement>('.edit-form-title');
  const applyButton = $<HTMLButtonElement>('.edit-apply');
  const eraseButton = $<HTMLButtonElement>('.edit-erase');
  const eraseNote = $<HTMLParagraphElement>('.edit-erase-note');
  const shrinkRow = $<HTMLDivElement>('.edit-shrink-row');
  const original = $<HTMLParagraphElement>('.edit-original');
  const text = $<HTMLTextAreaElement>('#conv-edit-text');
  const fontSelect = $<HTMLSelectElement>('.edit-font');
  const sizeInput = $<HTMLInputElement>('.edit-size');
  const colorInput = $<HTMLInputElement>('.edit-color');
  const shrink = $<HTMLInputElement>('.edit-shrink');
  const dx = $<HTMLInputElement>('.edit-dx');
  const dy = $<HTMLInputElement>('.edit-dy');
  const fit = $<HTMLParagraphElement>('.edit-fit');
  const list = $<HTMLOListElement>('.edit-list');
  const warnings = $<HTMLUListElement>('.edit-warnings');
  const outputs = $<HTMLDivElement>('.edit-outputs');
  const fontFile = $<HTMLInputElement>('.edit-font-file');

  let source: Uint8Array | null = null;
  let name = 'document.pdf';
  // 여는 일(task)과 열린 문서(proxy)를 같이 들고 있는다. 닫는 것은 task 쪽이다 —
  // proxy 만 놓아 주면 PDF.js 일꾼이 그 문서를 계속 붙들고 있는다.
  let originalPdf: { task: PDFDocumentLoadingTask; document: PDFDocumentProxy } | null = null;
  let previewPdf: { task: PDFDocumentLoadingTask; document: PDFDocumentProxy } | null = null;
  let pageNumber = 1;
  let spans: Span[] = [];
  let picked: Span | null = null;
  /** 새 글자를 넣을 자리(PDF 좌표). 글자 조각을 고르는 중이면 없다. */
  let spot: { x: number; y: number } | null = null;
  /** 지금 그려 놓은 쪽의 보기. 누른 자리를 PDF 좌표로 바꾸는 데 쓴다. */
  let view: PageViewport | null = null;
  const edits: TextEdit[] = [];
  /**
   * 원본을 pdf-lib 으로도 한 번 연다.
   *
   * PDF.js 는 쪽을 그리고 글자를 뽑는 데 쓰고, 원본이 **어떤 글꼴을 갖고 있는지**
   * 는 pdf-lib 쪽에서 읽는다. 자원 목록과 ToUnicode 를 다루는 데는 그쪽이 맞다.
   */
  let sourceDoc: PDFDocument | null = null;
  const sourceFonts = new Map<number, SourceFont[]>();
  /** 목록에서 고를 수 있는 글꼴. 기본 라틴 글꼴이 먼저 서고 받아 온 것이 뒤에 선다. */
  const fonts = new Map<string, FontSource>(STANDARD_FONTS.map(font => [font.id, font]));
  const catalog = new Map<string, CatalogFont>();
  /** 원본 글꼴을 쓸 수 없을 때 돌아갈 글꼴. 한글 글꼴이 있으면 그것이다. */
  let defaultFont = STANDARD_FONTS[0]!.id;

  const say = (message: string, tone: '' | 'ok' | 'error' = ''): void => {
    status.textContent = message;
    status.dataset['tone'] = tone;
  };

  const clearOutputs = (): void => {
    for (const link of outputs.querySelectorAll('a')) URL.revokeObjectURL(link.href);
    outputs.replaceChildren();
  };

  // --- 글꼴 목록 ------------------------------------------------------------

  void (async () => {
    const found = await loadCatalog();
    for (const font of found) catalog.set(font.id, font);
    buildFontOptions(found);
  })();

  function buildFontOptions(found: CatalogFont[]): void {
    fontSelect.replaceChildren();
    // 원본 글꼴 자리는 늘 맨 위에 둔다. 무엇을 고르든 이것이 첫째 선택지다 —
    // 고른 조각에 따라 `pick` 이 이름을 채우고, 못 쓰면 감춘다.
    const origin = document.createElement('optgroup');
    origin.label = '원본 글꼴';
    origin.dataset['origin'] = 'yes';
    origin.hidden = true;
    fontSelect.append(origin);

    const standard = document.createElement('optgroup');
    standard.label = '내려받기 없음 (라틴 전용 · 한글 불가)';
    for (const font of STANDARD_FONTS) standard.append(option(font.id, font.label));
    fontSelect.append(standard);

    for (const group of [...new Set(found.map(font => font.group))]) {
      const node = document.createElement('optgroup');
      node.label = `${group} (한글)`;
      for (const font of found.filter(entry => entry.group === group)) {
        node.append(option(font.id, `${font.label} · ${mb(font.bytes)}`));
      }
      fontSelect.append(node);
    }
    // 한글이 있으면 그쪽을 기본값으로 둔다. 고치는 글이 한글일 확률이 훨씬 높다.
    if (found.length) defaultFont = found[0]!.id;
    fontSelect.value = defaultFont;
  }

  function option(value: string, label: string): HTMLOptionElement {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
  }

  /**
   * 고른 조각의 원본 글꼴을 목록 맨 위에 세운다.
   *
   * 쓸 수 있으면 그것을 기본값으로 둔다 — 고치기 전과 후의 글꼴이 같은 것이
   * 사람이 바라는 기본이다. 쓸 수 없으면 자리를 감추고 고르던 글꼴을 그대로 둔다.
   */
  function offerSourceFont(span: Span): void {
    const origin = fontSelect.querySelector<HTMLOptGroupElement>('optgroup[data-origin]');
    if (!origin) return;
    origin.replaceChildren();
    origin.hidden = !span.font;
    if (!span.font) return;
    const id = sourceFontId(span.font.resource);
    const label = `원본 그대로 · ${span.font.label}`;
    // 심을 것이 없으니 바이트도 없다. 목록에 이름만 있으면 고친 자리에 적힌다.
    fonts.set(id, { id, label });
    origin.append(option(id, label));
    fontSelect.value = id;
  }

  /**
   * 원본 글꼴 자리를 감춘다. 빈 곳에 넣는 글자에는 원본 조각이 없다.
   *
   * 고르던 것이 원본 글꼴이면 기본 글꼴로 돌린다 — 감춘 선택지가 골라진 채로
   * 남으면 목록에는 보이지 않는 글꼴로 쓰인다.
   */
  function hideSourceFont(): void {
    const origin = fontSelect.querySelector<HTMLOptGroupElement>('optgroup[data-origin]');
    if (origin) {
      origin.replaceChildren();
      origin.hidden = true;
    }
    if (sourceFontResource(fontSelect.value) !== null || !fontSelect.value) fontSelect.value = defaultFont;
  }

  /** 원본 글꼴로 쓸 수 없을 때 물러날 글꼴. 세리프와 굵기를 보고 닮은 것을 고른다. */
  function fallbackFor(font: SourceFont): CatalogFont | undefined {
    return closestFont(font, [...catalog.values()]);
  }

  /** 고른 글꼴을 쓸 수 있게 만든다. 받아야 하면 받고, 한 번 받은 것은 다시 받지 않는다. */
  async function ensureFont(id: string): Promise<FontSource> {
    const held = fonts.get(id);
    if (held && (held.standard || held.bytes)) return held;
    const entry = catalog.get(id);
    if (!entry) throw new Error('고른 글꼴을 찾지 못했습니다.');
    const bytes = await loadFont(entry, message => say(message));
    const font: FontSource = { id: entry.id, label: entry.label, bytes };
    fonts.set(id, font);
    return font;
  }

  fontFile.addEventListener('change', () => { void addOwnFont(); });

  async function addOwnFont(): Promise<void> {
    const file = fontFile.files?.[0];
    if (!file) return;
    try {
      if (file.size > EDIT_LIMITS.fontBytes) throw new Error('글꼴 파일은 32MB까지 읽습니다.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      // 못 쓰는 글꼴은 저장할 때가 아니라 **올릴 때** 알아야 한다.
      readTables(bytes);
      const id = `own-${file.name}`;
      fonts.set(id, { id, label: file.name, bytes });
      let group = fontSelect.querySelector<HTMLOptGroupElement>('optgroup[data-own]');
      if (!group) {
        group = document.createElement('optgroup');
        group.label = '내 글꼴';
        group.dataset['own'] = 'yes';
        fontSelect.append(group);
      }
      if (!fontSelect.querySelector(`option[value="${CSS.escape(id)}"]`)) group.append(option(id, file.name));
      fontSelect.value = id;
      say(`${file.name} 글꼴을 불러왔습니다.`, 'ok');
      updateFit();
    } catch (error) {
      say(`글꼴을 읽지 못했습니다: ${reason(error)}`, 'error');
    } finally {
      fontFile.value = '';
    }
  }

  // --- 파일 열기 ------------------------------------------------------------

  const open = async (file: File): Promise<void> => {
    if (!/\.pdf$/i.test(file.name)) { say('PDF 파일만 열 수 있습니다.', 'error'); return; }
    if (file.size > EDIT_LIMITS.inputBytes) { say(`파일이 너무 큽니다(${mb(file.size)}). 64MB까지 읽습니다.`, 'error'); return; }
    say(`${file.name} 읽는 중…`);
    try {
      await destroy();
      source = new Uint8Array(await file.arrayBuffer());
      name = file.name;
      edits.length = 0;
      pageNumber = 1;
      clearOutputs();
      warnings.replaceChildren();
      sourceFonts.clear();
      // 원본이 가진 글꼴을 읽는 쪽. 못 읽어도 화면은 선다 — 목록의 글꼴로 고치면 된다.
      sourceDoc = await PDFDocument.load(source, { updateMetadata: false }).catch(() => null);
      originalPdf = await load(source);
      controls.disabled = false;
      await refresh();
      say(`${file.name} · ${originalPdf.document.numPages}쪽. 고칠 글자를 누르세요.`, 'ok');
    } catch (error) {
      controls.disabled = true;
      say(`PDF를 열지 못했습니다: ${reason(error)}`, 'error');
    }
  };

  async function load(bytes: Uint8Array): Promise<{ task: PDFDocumentLoadingTask; document: PDFDocumentProxy }> {
    const task = (await loadRenderer()).openPdf(bytes);
    return { task, document: await task.promise };
  }

  async function destroy(): Promise<void> {
    await originalPdf?.task.destroy().catch(() => {});
    await previewPdf?.task.destroy().catch(() => {});
    originalPdf = null;
    previewPdf = null;
  }

  // --- 그리기 ---------------------------------------------------------------

  /** 고친 것을 반영한 바이트. 고친 자리가 없으면 원본 그대로다. */
  async function currentBytes(): Promise<Uint8Array> {
    if (!source) throw new Error('PDF를 먼저 여세요.');
    if (!edits.length) return source;
    const { bytes } = await applyTextEdits(source, edits, [...fonts.values()], redactText);
    return bytes;
  }

  async function refresh(): Promise<void> {
    if (!originalPdf || !source) return;
    hideForm();
    const total = originalPdf.document.numPages;
    pageNumber = Math.min(Math.max(pageNumber, 1), total);
    pageLabel.textContent = `${pageNumber} / ${total}쪽`;

    // 화면에 그리는 것은 **고친 결과** 다. 저장한 것과 다른 그림을 보여 주지 않는다.
    await previewPdf?.task.destroy().catch(() => {});
    previewPdf = null;
    previewPdf = await load(await currentBytes());

    const scale = Number(zoom.value) || 1;
    const page = await previewPdf.document.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale, rotation: page.rotate });
      view = viewport;
      await (await loadRenderer()).renderToCanvas(page, canvas, viewport);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      await drawSpans(viewport);
    } finally { page.cleanup(); }
    renderList();
  }

  /** 고를 수 있는 상자는 **원본** 에서 뽑는다. 이유는 파일 머리에 적혀 있다. */
  async function drawSpans(viewport: PageViewport): Promise<void> {
    spans = [];
    overlay.replaceChildren();
    if (!originalPdf) return;
    // 이 쪽이 가진 글꼴은 한 번만 읽어 둔다.
    if (sourceDoc && !sourceFonts.has(pageNumber)) {
      sourceFonts.set(pageNumber, readSourceFonts(sourceDoc.getPage(pageNumber - 1)));
    }
    spans = await readEditSpans(originalPdf.document, pageNumber, viewport, sourceFonts.get(pageNumber));

    // 넣은 글자는 원래 조각이 없으니 고친 자리로 표시할 것도 없다.
    const done = new Set(edits.filter(edit => edit.page === pageNumber && edit.span).map(edit => `${edit.span!.x},${edit.span!.y}`));
    for (const span of spans) {
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'edit-span';
      box.style.left = `${span.view.left}px`;
      box.style.top = `${span.view.top}px`;
      box.style.width = `${span.view.width}px`;
      box.style.height = `${span.view.height}px`;
      box.title = span.text;
      box.setAttribute('aria-label', `고치기: ${span.text}`);
      if (done.has(`${span.pdf.x},${span.pdf.y}`)) box.dataset['done'] = 'yes';
      box.addEventListener('click', () => pick(span));
      overlay.append(box);
    }
  }

  // --- 한 자리 고치기 -------------------------------------------------------

  function pick(span: Span): void {
    picked = span;
    spot = null;
    formMode('replace');
    // 이미 고친 조각이면 그렇다고 알리고 고친 글자를 채운다. 저장하면 앞의 고침을 바꾼다.
    const earlier = edits.find(edit => sameSpan(edit, pageNumber, spanBox(span)));
    original.textContent = earlier
      ? `원래 글자: ${span.text} · 이미 ${earlier.kind === 'erase' ? '지운' : '고친'} 자리입니다. 다시 하면 앞의 것을 바꿉니다.`
      : `원래 글자: ${span.text}`;
    text.value = earlier?.kind === 'replace' ? earlier.text : span.text;
    sizeInput.value = String(span.size);
    dx.value = '0';
    dy.value = '0';
    offerSourceFont(span);
    form.hidden = false;
    updateFit();
    text.focus();
    text.select();
  }

  /**
   * 빈 곳에 새 글자를 넣기 시작한다. 자리는 (x, y) 에서 시작하고, 쪽의 다른
   * 곳을 누르면 그리로 옮긴다. 키보드만 쓰면 가로·세로 옮김 칸으로 맞춘다.
   */
  function startAdd(x: number, y: number): void {
    picked = null;
    spot = { x, y };
    formMode('add');
    original.textContent = '새 글자를 넣을 자리입니다. 쪽의 다른 곳을 누르면 그리로 옮깁니다.';
    text.value = '';
    if (!Number(sizeInput.value)) sizeInput.value = '12';
    dx.value = '0';
    dy.value = '0';
    hideSourceFont();
    drawSpot();
    form.hidden = false;
    updateFit();
    text.focus();
  }

  /** 바꾸기와 넣기는 같은 칸을 쓴다. 넣기에는 지울 것도, 맞출 자리도 없다. */
  function formMode(kind: 'replace' | 'add'): void {
    const adding = kind === 'add';
    formTitle.textContent = adding ? '새 글자 넣기' : '이 자리 고치기';
    applyButton.textContent = adding ? '이 자리에 넣기' : '이 자리 고치기';
    eraseButton.hidden = adding;
    eraseNote.hidden = adding;
    // 빈 곳에는 맞출 원래 자리가 없다.
    shrinkRow.hidden = adding;
    // 넣는 동안에는 글자 상자가 누르는 손을 가로채지 않는다. 글자 옆에도 넣을 수 있어야 한다.
    if (adding) overlay.dataset['mode'] = 'add';
    else delete overlay.dataset['mode'];
    if (!adding) spotMark.hidden = true;
  }

  /** 넣을 자리를 쪽 위에 짚어 보인다. 점이 새 글자 기준선의 왼쪽 끝이다. */
  function drawSpot(): void {
    if (!spot || !view) { spotMark.hidden = true; return; }
    const [left, top] = view.convertToViewportPoint(
      spot.x + (Number(dx.value) || 0), spot.y + (Number(dy.value) || 0));
    spotMark.style.left = `${left}px`;
    spotMark.style.top = `${top}px`;
    spotMark.hidden = false;
  }

  stage.addEventListener('click', event => {
    if (!spot || !view || (event.target as HTMLElement).closest('.edit-span')) return;
    // 캔버스는 보기 크기 그대로 그려 두었다. 누른 점을 보기 좌표로 옮긴 뒤 PDF 좌표로 되돌린다.
    const rect = canvas.getBoundingClientRect();
    const ratio = view.width / (rect.width || view.width);
    const [x, y] = view.convertToPdfPoint((event.clientX - rect.left) * ratio, (event.clientY - rect.top) * ratio);
    spot = { x: x!, y: y! };
    dx.value = '0';
    dy.value = '0';
    drawSpot();
    text.focus();
  });
  for (const node of [dx, dy]) node.addEventListener('input', drawSpot);

  function hideForm(): void {
    form.hidden = true;
    picked = null;
    spot = null;
    formMode('replace');
    fit.textContent = '';
  }

  /** 지금 고른 글꼴이 원본 글꼴이면 그것을, 아니면 없음을 돌려준다. */
  function chosenSourceFont(): SourceFont | undefined {
    const resource = sourceFontResource(fontSelect.value);
    return resource === null ? undefined : sourceFonts.get(pageNumber)?.find(font => font.resource === resource);
  }

  /**
   * 새 글자가 원래 자리에 들어가는지, **원본 글꼴로 쓸 수 있는지** 재어 알린다.
   *
   * 저장하고 나서 알면 늦다. 특히 원본 글꼴은 그 문서에 쓰인 글자만 갖고 있어서,
   * 없는 글자를 넘기면 빈칸이 찍힌다 — 그 글자를 치는 동안 바로 짚어 준다.
   */
  function updateFit(): void {
    if (!picked && !spot) return;
    const chars = [...text.value].length;
    const size = Number(sizeInput.value) || 0;
    if (!picked) {
      delete fit.dataset['tone'];
      fit.textContent = `크기 ${size}pt · ${chars}자`;
      return;
    }
    const missing = chosenSourceFont()?.missing(text.value) ?? [];
    if (missing.length) {
      fit.textContent = `원본 글꼴에 없는 글자: ${missing.join(' ')} — 원본 문서에 한 번도 나오지 않은 글자입니다. 다른 글꼴을 고르세요.`;
      fit.dataset['tone'] = 'error';
      return;
    }
    delete fit.dataset['tone'];
    // 정확한 폭은 글꼴을 심어야 나온다. 여기서는 글자 수로 가늠만 하고 실제 폭은
    // 저장할 때 pdf-lib 이 재어 경고를 남긴다.
    fit.textContent = chars > [...picked.text].length
      ? `원래 ${[...picked.text].length}자 → ${chars}자. 넘치면 ${shrink.checked ? '크기를 자동으로 줄입니다.' : '옆 내용을 덮을 수 있습니다.'}`
      : `크기 ${size}pt · ${chars}자`;
  }

  for (const node of [text, sizeInput, shrink]) node.addEventListener('input', updateFit);
  fontSelect.addEventListener('change', updateFit);

  async function applyOne(): Promise<void> {
    // 기다리는 동안 다른 자리를 누를 수 있다. 시작할 때의 자리로 끝까지 간다.
    const target = picked;
    const place = spot;
    if (!target && !place) return;
    if (!text.value.length) { say('새 글자를 입력하세요.', 'error'); return; }
    const source = chosenSourceFont();
    // 원본 글꼴에 없는 글자는 그려 봐야 빈칸이다. 그리기 전에 멈추고, 닮은 글꼴을
    // 골라 둔 채로 알린다 — 다시 누르면 그 글꼴로 고쳐진다.
    const missing = source?.missing(text.value) ?? [];
    if (source && missing.length) {
      const fallback = fallbackFor(source);
      if (fallback) fontSelect.value = fallback.id;
      updateFit();
      say(`원본 글꼴에 없는 글자가 있습니다 — ${missing.join(' ')}.`
        + (fallback ? ` 닮은 글꼴 ‘${fallback.label}’ 로 바꿔 두었습니다. 다시 누르면 그 글꼴로 고칩니다.` : ' 다른 글꼴을 고르세요.'), 'error');
      return;
    }
    try {
      const font = source ? fonts.get(fontSelect.value)! : await ensureFont(fontSelect.value);
      let size = Number(sizeInput.value);
      if (!Number.isFinite(size) || size < EDIT_LIMITS.minSize || size > EDIT_LIMITS.maxSize) {
        throw new Error(`글자 크기는 ${EDIT_LIMITS.minSize}~${EDIT_LIMITS.maxSize} 사이여야 합니다.`);
      }
      // 빈 곳에는 맞출 원래 자리가 없다. 줄이는 것은 바꾸기에서만 한다.
      if (target && shrink.checked) {
        // 원본 글꼴은 그 글꼴의 너비 표로 잰다. 심어서 재는 길보다 정확하고 빠르다.
        const measured = source
          ? (value: string, at: number) => Math.max(...value.split('\n').map(line => source.widthOfTextAtSize(line, at)))
          : await measurer(font);
        size = shrinkToFit(at => measured(text.value, at), target.pdf.width, size);
      }
      const at = target ? { x: target.pdf.x, y: target.pdf.y } : place!;
      await commit({
        kind: target ? 'replace' : 'add',
        page: pageNumber,
        ...(target ? { span: spanBox(target) } : {}),
        x: at.x + (Number(dx.value) || 0),
        y: at.y + (Number(dy.value) || 0),
        text: text.value, size, fontId: font.id,
        color: toRgb(colorInput.value),
        original: target?.text ?? '',
      }, target ? '고쳤습니다. 아래 미리보기가 저장될 모습입니다.' : '넣었습니다. 아래 미리보기가 저장될 모습입니다.');
    } catch (error) {
      say(`${target ? '고치지' : '넣지'} 못했습니다: ${reason(error)}`, 'error');
    }
  }

  /** 고른 글자 조각을 지우기만 한다. 글자를 쓰지 않으니 글꼴도 받지 않는다. */
  async function eraseOne(): Promise<void> {
    const target = picked;
    if (!target) return;
    try {
      await commit({
        kind: 'erase', page: pageNumber, span: spanBox(target),
        x: target.pdf.x, y: target.pdf.y,
        text: '', size: target.size, fontId: fontSelect.value,
        color: toRgb(colorInput.value),
        original: target.text,
      }, '지웠습니다. 원래 글자는 파일에서 빠졌습니다.');
    } catch (error) {
      say(`지우지 못했습니다: ${reason(error)}`, 'error');
    }
  }

  /**
   * 고칠 자리를 목록에 넣고 미리보기를 다시 그린다. 못 그리면 목록을 되돌린다.
   *
   * 같은 조각을 다시 고치면 앞의 고침을 **바꾼다.** 지운 글자는 한 번만 지울 수
   * 있고, 두 고침의 새 글자가 한 자리에 겹쳐 찍히면 안 된다.
   */
  async function commit(edit: TextEdit, done: string): Promise<void> {
    const before = [...edits];
    if (edit.span) {
      const span = edit.span;
      for (let index = edits.length - 1; index >= 0; index--) {
        if (sameSpan(edits[index]!, edit.page, span)) edits.splice(index, 1);
      }
    }
    edits.push(edit);
    clearOutputs();
    // 처음 지울 때는 엔진(wasm)을 받는다. 말없이 기다리게 두지 않는다.
    say('반영하는 중…');
    try {
      await refresh();
    } catch (error) {
      // 미리보기가 안 그려지면 저장도 안 된다. 들어간 것을 도로 빼고 그대로 알린다 —
      // 고칠 수 없는 자리를 목록에 남겨 두면 저장 단추가 영영 듣지 않는다.
      edits.splice(0, edits.length, ...before);
      await refresh().catch(() => {});
      throw error;
    }
    say(done, 'ok');
  }

  /**
   * 글자 폭을 재는 함수. 크기를 줄일 때 쓴다.
   *
   * pdf-lib 에 한 번 심어 두고 재사용한다 — 0.5pt 씩 내려가며 수십 번 재는 동안
   * 글꼴을 다시 심으면 몇 초가 걸린다.
   */
  const measurer = createFontMeasurer();

  // --- 목록과 저장 ----------------------------------------------------------

  function renderList(): void {
    list.replaceChildren();
    if (!edits.length) {
      const empty = document.createElement('li');
      empty.className = 'conv-note';
      empty.textContent = '아직 고친 자리가 없습니다.';
      list.append(empty);
      return;
    }
    edits.forEach((edit, index) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = describe(edit);
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.textContent = '되돌리기';
      undo.addEventListener('click', () => {
        const what = edit.kind === 'add' ? edit.text : edit.original;
        changeEdits(() => { edits.splice(index, 1); }, `${edit.page}쪽의 “${what}” 을 되돌렸습니다.`);
      });
      row.append(label, undo);
      list.append(row);
    });
  }

  function describe(edit: TextEdit): string {
    if (edit.kind === 'erase') return `${edit.page}쪽 · 지움 “${edit.original}”`;
    const font = `${fonts.get(edit.fontId)?.label ?? edit.fontId} ${edit.size}pt`;
    if (edit.kind === 'add') return `${edit.page}쪽 · 추가 “${edit.text}” · ${font}`;
    return `${edit.page}쪽 · “${edit.original}” → “${edit.text}” · ${font}`;
  }

  async function save(): Promise<void> {
    if (!source) return;
    if (!edits.length) { say('고친 자리가 없습니다.', 'error'); return; }
    try {
      say('고친 PDF 만드는 중…');
      clearOutputs();
      const result = await applyTextEdits(source, edits, [...fonts.values()], redactText);
      warnings.replaceChildren();
      for (const warning of result.warnings) {
        const row = document.createElement('li');
        row.textContent = warning;
        warnings.append(row);
      }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: 'application/pdf' }));
      link.download = name.replace(/\.pdf$/i, '') + '-고침.pdf';
      link.textContent = `${link.download} (${mb(result.bytes.length)})`;
      outputs.append(link);
      say(`${edits.length}자리를 고쳤습니다. 아래 링크로 내려받으세요.`, 'ok');
    } catch (error) {
      say(`저장하지 못했습니다: ${reason(error)}`, 'error');
    }
  }

  // --- 이어 붙이기 ----------------------------------------------------------

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void open(file);
  });
  for (const type of ['dragenter', 'dragover'] as const) {
    drop.addEventListener(type, event => { event.preventDefault(); drop.dataset['over'] = 'yes'; });
  }
  for (const type of ['dragleave', 'drop'] as const) drop.addEventListener(type, () => delete drop.dataset['over']);
  drop.addEventListener('drop', event => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) void open(file);
  });

  /** 눌러서 도는 일은 실패해도 조용히 사라지면 안 된다. 상태 줄에 남긴다. */
  const run = (work: () => Promise<void>): void => {
    void work().catch(error => say(`${reason(error)}`, 'error'));
  };

  /**
   * 고친 목록을 바꾼다.
   *
   * 목록은 `edits` 만 보면 되므로 **바로** 다시 그린다. 미리보기는 PDF 를 다시
   * 지어 그리느라 시간이 걸리고, 끝난 뒤에야 알린다 — 다 됐다고 먼저 말해 놓고
   * 화면에는 지운 것이 아직 남아 있으면 그 말을 믿을 수 없게 된다.
   */
  const changeEdits = (mutate: () => void, done: string): void => {
    mutate();
    warnings.replaceChildren();
    clearOutputs();
    renderList();
    run(async () => {
      await refresh();
      say(done, 'ok');
    });
  };

  zoom.addEventListener('change', () => run(refresh));
  tool.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset['action'];
    if (!action) return;
    if (action === 'prev') { pageNumber -= 1; run(refresh); }
    if (action === 'next') { pageNumber += 1; run(refresh); }
    if (action === 'apply') void applyOne();
    if (action === 'erase') void eraseOne();
    if (action === 'add' && view) {
      // 처음 자리는 쪽 가운데다. 누르지 않고 키보드로 옮김 칸만 써도 넣을 수 있다.
      const [x, y] = view.convertToPdfPoint(view.width / 2, view.height / 2);
      startAdd(x!, y!);
    }
    if (action === 'dismiss') hideForm();
    if (action === 'save') void save();
    if (action === 'reset') {
      if (!edits.length) { say('되돌릴 자리가 없습니다.'); return; }
      changeEdits(() => { edits.length = 0; }, '고친 자리를 모두 되돌렸습니다.');
    }
  });

  renderList();
  return tool;
}

function spanBox(span: Span): SpanBox {
  return { x: span.pdf.x, y: span.pdf.y, width: span.pdf.width, size: span.size };
}

function sameSpan(edit: TextEdit, page: number, span: SpanBox): boolean {
  return edit.page === page && edit.span?.x === span.x && edit.span?.y === span.y;
}

function toRgb(hexColor: string): Rgb {
  const value = Number.parseInt(hexColor.replace('#', ''), 16);
  return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}

