/**
 * PDF 글자 고치기 화면.
 *
 * 쪽을 그려 놓고 글자 조각 위에 상자를 겹친다. 상자를 누르면 그 자리의 글자를
 * 고친다. 무엇이 저장될지는 **실제로 고친 PDF 를 다시 그려** 보여 준다 —
 * 화면에서 본 것과 저장한 것이 다르면 이 도구는 쓸모가 없다.
 *
 * 그래서 문서를 둘 들고 있는다.
 *
 *   원본  — 고를 수 있는 글자 조각이 어디에 있는지. 끝까지 바뀌지 않는다
 *   미리보기 — 원본 + 고친 자리. 화면에 그리는 것은 이쪽이다
 *
 * 조각 목록을 미리보기에서 뽑지 않는 이유는, 덮어쓰기는 원래 글자를 **지우지
 * 않기** 때문이다. 미리보기에는 옛 글자와 새 글자가 겹쳐 들어 있어서 그것으로
 * 목록을 만들면 이미 고친 자리가 두 번 나온다.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { reason } from './errors';
import { loadCatalog, loadFont, mb, STANDARD_FONTS, type CatalogFont } from './fonts';
import {
  applyTextEdits, EDIT_LIMITS, shrinkToFit, sourceFontId, sourceFontResource,
  type Rgb, type FontSource, type TextEdit,
} from './pdf-edit';
import { closestFont, readSourceFonts, type SourceFont } from './pdf-source-font';
import { readTables, stripLayoutTables } from './sfnt';

import type { PageViewport, PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

/** 화면에 겹칠 글자 조각 하나. PDF 좌표와 화면 좌표를 같이 들고 있는다. */
interface Span {
  text: string;
  /** 회전을 적용하지 않은 PDF 사용자 공간. 저장할 때 그대로 쓴다. */
  pdf: { x: number; y: number; width: number; height: number };
  /** 캔버스 위 자리. 상자를 놓는 데 쓴다. */
  view: { left: number; top: number; width: number; height: number };
  /** 원본이 이 조각을 그릴 때 쓴 크기. 조각 높이보다 이쪽이 정확하다. */
  size: number;
  /** 원본이 이 조각에 쓴 글꼴. 다시 쓸 수 없는 글꼴이면 없다. */
  font?: SourceFont | undefined;
}

const ZOOMS = [1, 1.5, 2, 3];
const MAX_SPANS = 4000;

/**
 * PDF.js 는 440KB 다. ZIP 만 풀러 온 사람이 내려받을 이유가 없으므로 파일을
 * 처음 열 때 받아 한 번만 붙든다 (다른 PDF 도구와 같은 방식).
 */
let renderer: Promise<typeof import('./pdf-render')> | null = null;
const loadRenderer = (): NonNullable<typeof renderer> => (renderer ??= import('./pdf-render'));

export function pdfEditTool(): HTMLElement {
  const tool = document.createElement('section');
  tool.className = 'conv-tool conv-pdf-edit';
  tool.innerHTML = `
    <h2>PDF 글자 고치기</h2>
    <p class="conv-note">쪽 위의 글자를 눌러 다른 글자로 바꿉니다. <strong>원본과 같은 글꼴</strong>로 쓰는 것이 기본이고, 다른 글꼴과 크기도 고를 수 있습니다. 최대 64MB.</p>
    <ul class="conv-note edit-caveats">
      <li><strong>원래 글자는 지워지지 않습니다.</strong> 그 자리를 덮고 위에 새로 쓰는 방식이라, 덮인 글자는 파일 안에 남아 글자를 뽑아 보면 나옵니다 — <strong>가려야 할 내용을 감추는 용도로 쓰면 안 됩니다.</strong></li>
      <li><strong>원본 글꼴을 그대로 쓸 수 있습니다</strong> — 다만 <strong>원본 문서에 이미 나온 글자</strong>만 됩니다. PDF 는 쓰인 글자의 모양만 담고 있어서, 한 번도 나오지 않은 글자는 그 글꼴로 그릴 수 없습니다. 그런 글자가 있으면 화면이 짚어 주고 닮은 글꼴로 물러납니다.</li>
      <li>덮을 자리의 배경이 단색이 아니면(무늬·그림·표선 위) <strong>덮은 자국이 보입니다.</strong></li>
    </ul>
    <label class="conv-drop" for="conv-edit-file">
      <input id="conv-edit-file" type="file" accept=".pdf,application/pdf" />
      <span>PDF 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>

    <fieldset class="edit-controls" disabled>
      <legend>쪽 보기</legend>
      <div class="conv-actions">
        <button type="button" data-action="prev">◀ 이전 쪽</button>
        <span class="edit-page"></span>
        <button type="button" data-action="next">다음 쪽 ▶</button>
        <label>확대 <select class="edit-zoom">${ZOOMS.map(z => `<option value="${z}"${z === 1.5 ? ' selected' : ''}>${z * 100}%</option>`).join('')}</select></label>
      </div>
      <div class="edit-stage">
        <canvas class="edit-canvas"></canvas>
        <div class="edit-spans"></div>
      </div>
      <p class="conv-note edit-hint">쪽 위의 글자 상자를 누르면 그 자리를 고칩니다.</p>

      <div class="edit-form" hidden>
        <h3>이 자리 고치기</h3>
        <p class="edit-original conv-note"></p>
        <label class="conv-label" for="conv-edit-text">새 글자</label>
        <textarea id="conv-edit-text" class="conv-input" rows="2" spellcheck="false"></textarea>
        <div class="conv-actions">
          <label>글꼴 <select class="edit-font"></select></label>
          <label>크기 <input class="edit-size" type="number" min="${EDIT_LIMITS.minSize}" max="${EDIT_LIMITS.maxSize}" step="0.5" /></label>
          <label>글자색 <input class="edit-color" type="color" value="#000000" /></label>
        </div>
        <div class="conv-actions">
          <label>덮을 색 <input class="edit-cover" type="color" value="#ffffff" /></label>
          <label><input type="checkbox" class="edit-auto-cover" checked /> 배경색 자동</label>
          <label><input type="checkbox" class="edit-shrink" checked /> 넘치면 크기 자동 줄임</label>
        </div>
        <div class="conv-actions">
          <label>가로 옮김 <input class="edit-dx" type="number" step="0.5" value="0" /></label>
          <label>세로 옮김 <input class="edit-dy" type="number" step="0.5" value="0" /></label>
        </div>
        <p class="edit-fit conv-note"></p>
        <div class="conv-actions">
          <button type="button" class="conv-download" data-action="apply">이 자리 고치기</button>
          <button type="button" data-action="dismiss">그만두기</button>
        </div>
      </div>

      <h3>고친 자리</h3>
      <ol class="edit-list" aria-label="고친 자리"></ol>
      <div class="conv-actions">
        <button type="button" class="conv-download" data-action="save">고친 PDF 저장</button>
        <button type="button" data-action="reset">모두 되돌리기</button>
      </div>
    </fieldset>

    <div class="conv-actions edit-font-add">
      <label>내 글꼴 불러오기 <input class="edit-font-file" type="file" accept=".ttf,.otf,font/ttf,font/otf" /></label>
    </div>
    <p class="conv-note">맑은 고딕·함초롬돋움처럼 저희가 담아 드릴 수 없는 글꼴은 그 글꼴 파일(<code>.ttf</code>·<code>.otf</code>)을 직접 올려 쓰세요. 올린 글꼴도 이 컴퓨터를 벗어나지 않습니다.</p>
    <ul class="edit-warnings conv-note" aria-label="저장 확인 사항"></ul>
    <div class="edit-outputs conv-actions" aria-label="저장 결과"></div>
  `;

  const $ = <T extends HTMLElement>(selector: string): T => tool.querySelector<T>(selector)!;
  const input = $<HTMLInputElement>('#conv-edit-file');
  const drop = $<HTMLLabelElement>('.conv-drop');
  const status = $<HTMLParagraphElement>('.conv-status');
  const controls = $<HTMLFieldSetElement>('.edit-controls');
  const canvas = $<HTMLCanvasElement>('.edit-canvas');
  const overlay = $<HTMLDivElement>('.edit-spans');
  const pageLabel = $<HTMLSpanElement>('.edit-page');
  const zoom = $<HTMLSelectElement>('.edit-zoom');
  const form = $<HTMLDivElement>('.edit-form');
  const original = $<HTMLParagraphElement>('.edit-original');
  const text = $<HTMLTextAreaElement>('#conv-edit-text');
  const fontSelect = $<HTMLSelectElement>('.edit-font');
  const sizeInput = $<HTMLInputElement>('.edit-size');
  const colorInput = $<HTMLInputElement>('.edit-color');
  const coverInput = $<HTMLInputElement>('.edit-cover');
  const autoCover = $<HTMLInputElement>('.edit-auto-cover');
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
    if (found.length) fontSelect.value = found[0]!.id;
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
    const { bytes } = await applyTextEdits(source, edits, [...fonts.values()]);
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
    const page = await originalPdf.document.getPage(pageNumber);
    try {
      // 조각마다 어떤 글꼴을 썼는지는 글꼴 객체가 있어야 알 수 있고, 그 객체는
      // 쪽을 한 번 훑어야 채워진다. 글자만 뽑아서는 채워지지 않는다.
      const named = await fontNames(page);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        if (spans.length >= MAX_SPANS) break;
        const x = item.transform[4] as number;
        const y = item.transform[5] as number;
        const width = item.width || 1;
        const height = Math.max(item.height, 1);
        const [ax, ay] = viewport.convertToViewportPoint(x, y);
        const [bx, by] = viewport.convertToViewportPoint(x + width, y + height);
        spans.push({
          text: item.str,
          pdf: { x, y, width, height },
          view: {
            left: Math.min(ax!, bx!), top: Math.min(ay!, by!),
            width: Math.max(Math.abs(bx! - ax!), 2), height: Math.max(Math.abs(by! - ay!), 2),
          },
          // 가로 배율이 그릴 때 쓴 글자 크기다. 조각 높이는 글자 모양에 따라 들쭉날쭉하다.
          size: Math.max(1, Math.round(Math.abs(item.transform[0] as number) * 10) / 10) || height,
          font: matchSourceFont(named.get(item.fontName), item.str),
        });
      }
    } finally { page.cleanup(); }

    const done = new Set(edits.filter(edit => edit.page === pageNumber).map(edit => `${edit.x},${edit.y}`));
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

  /**
   * PDF.js 가 조각에 붙인 글꼴 이름을 **PDF 안의 글꼴 이름**으로 바꾼다.
   *
   * 조각이 들고 있는 이름은 PDF.js 안에서만 통하는 것(`g_d0_f1`)이라 자원
   * 목록과 곧바로 이어지지 않는다. 쪽을 한 번 훑으면 글꼴 객체가 채워지고,
   * 거기에 원래 이름(BaseFont)이 들어 있다.
   */
  async function fontNames(page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    try {
      await page.getOperatorList();
    } catch {
      // 훑지 못하면 원본 글꼴을 고르지 못할 뿐이다. 나머지는 그대로 돈다.
      return names;
    }
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item) || names.has(item.fontName)) continue;
      try {
        const object = page.commonObjs.get(item.fontName) as { name?: string } | null;
        if (object?.name) names.set(item.fontName, object.name);
      } catch { /* 아직 안 채워진 글꼴은 건너뛴다 */ }
    }
    return names;
  }

  /**
   * 이름이 같은 원본 글꼴을 찾는다.
   *
   * 서브셋 접두사(ABCDEF+)는 같은 글꼴에도 문서마다 다르게 붙으므로 떼고 견준다.
   * 같은 이름이 여럿이면 **그 조각의 원래 글자를 쓸 수 있는** 쪽을 고른다 —
   * 그 글자를 담고 있는 서브셋이 실제로 쓰인 것이다.
   */
  function matchSourceFont(base: string | undefined, text: string): SourceFont | undefined {
    const found = sourceFonts.get(pageNumber);
    if (!found?.length || !base) return undefined;
    const bare = (value: string): string => value.replace(/^[A-Z]{6}\+/, '');
    const named = found.filter(font => bare(font.label) === bare(base));
    return named.find(font => !font.missing(text).length) ?? named[0];
  }

  // --- 한 자리 고치기 -------------------------------------------------------

  function pick(span: Span): void {
    picked = span;
    original.textContent = `원래 글자: ${span.text}`;
    text.value = span.text;
    sizeInput.value = String(span.size);
    dx.value = '0';
    dy.value = '0';
    if (autoCover.checked) coverInput.value = sampleBackground(span) ?? '#ffffff';
    offerSourceFont(span);
    form.hidden = false;
    updateFit();
    text.focus();
    text.select();
  }

  function hideForm(): void {
    form.hidden = true;
    picked = null;
    fit.textContent = '';
  }

  /**
   * 덮을 색을 쪽 그림에서 읽는다.
   *
   * 글자 상자 **바깥** 을 한 바퀴 돌며 가장 흔한 색을 고른다. 안쪽을 보면 글자
   * 색이 섞여 들어 회색이 나온다. 흰 종이면 흰색이, 색 띠 위면 그 색이 나온다.
   */
  function sampleBackground(span: Span): string | null {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    const ratio = canvas.width / (Number(canvas.style.width.replace('px', '')) || canvas.width);
    const left = Math.round(span.view.left * ratio);
    const top = Math.round(span.view.top * ratio);
    const width = Math.round(span.view.width * ratio);
    const height = Math.round(span.view.height * ratio);
    const band = Math.max(2, Math.round(height * 0.25));

    const tally = new Map<string, number>();
    const look = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
      const [r, g, b] = context.getImageData(x, y, 1, 1).data;
      tally.set(hex(r!, g!, b!), (tally.get(hex(r!, g!, b!)) ?? 0) + 1);
    };
    for (let x = left - band; x <= left + width + band; x += Math.max(1, Math.round(width / 24))) {
      look(x, top - band);
      look(x, top + height + band);
    }
    for (let y = top; y <= top + height; y += Math.max(1, Math.round(height / 6))) {
      look(left - band, y);
      look(left + width + band, y);
    }
    let best: string | null = null;
    let seen = 0;
    for (const [color, count] of tally) if (count > seen) { best = color; seen = count; }
    return best;
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
    if (!picked) return;
    const chars = [...text.value].length;
    const size = Number(sizeInput.value) || 0;
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
    if (!picked) return;
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
      if (shrink.checked) {
        // 원본 글꼴은 그 글꼴의 너비 표로 잰다. 심어서 재는 길보다 정확하고 빠르다.
        const measured = source
          ? (value: string, at: number) => Math.max(...value.split('\n').map(line => source.widthOfTextAtSize(line, at)))
          : await measurer(font);
        size = shrinkToFit(at => measured(text.value, at), picked.pdf.width, size);
      }
      edits.push({
        page: pageNumber,
        x: picked.pdf.x + (Number(dx.value) || 0),
        y: picked.pdf.y + (Number(dy.value) || 0),
        width: picked.pdf.width, height: picked.pdf.height,
        text: text.value, size, fontId: font.id,
        color: toRgb(colorInput.value), cover: toRgb(coverInput.value),
        original: picked.text,
      });
      clearOutputs();
      try {
        await refresh();
      } catch (error) {
        // 미리보기가 안 그려지면 저장도 안 된다. 들어간 것을 도로 빼고 그대로 알린다 —
        // 고칠 수 없는 자리를 목록에 남겨 두면 저장 단추가 영영 듣지 않는다.
        edits.pop();
        await refresh().catch(() => {});
        throw error;
      }
      say('고쳤습니다. 아래 미리보기가 저장될 모습입니다.', 'ok');
    } catch (error) {
      say(`고치지 못했습니다: ${reason(error)}`, 'error');
    }
  }

  /**
   * 글자 폭을 재는 함수. 크기를 줄일 때 쓴다.
   *
   * pdf-lib 에 한 번 심어 두고 재사용한다 — 0.5pt 씩 내려가며 수십 번 재는 동안
   * 글꼴을 다시 심으면 몇 초가 걸린다.
   */
  const measurers = new Map<string, Promise<(value: string, size: number) => number>>();

  function measurer(font: FontSource): Promise<(value: string, size: number) => number> {
    let held = measurers.get(font.id);
    if (!held) {
      held = buildMeasurer(font);
      measurers.set(font.id, held);
    }
    return held;
  }

  async function buildMeasurer(font: FontSource): Promise<(value: string, size: number) => number> {
    const document = await PDFDocument.create();
    let embedded;
    if (font.standard) {
      embedded = await document.embedFont(StandardFonts[font.standard]);
    } else {
      document.registerFontkit((await import('@pdf-lib/fontkit')).default);
      embedded = await document.embedFont(stripLayoutTables(font.bytes!), { subset: false });
    }
    return (value, size) => Math.max(...value.split('\n').map(line => embedded.widthOfTextAtSize(line, size)));
  }

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
      label.textContent = `${edit.page}쪽 · “${edit.original}” → “${edit.text}” · ${fonts.get(edit.fontId)?.label ?? edit.fontId} ${edit.size}pt`;
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.textContent = '되돌리기';
      undo.addEventListener('click', () => {
        changeEdits(() => { edits.splice(index, 1); }, `${edit.page}쪽의 “${edit.original}” 을 되돌렸습니다.`);
      });
      row.append(label, undo);
      list.append(row);
    });
  }

  async function save(): Promise<void> {
    if (!source) return;
    if (!edits.length) { say('고친 자리가 없습니다.', 'error'); return; }
    try {
      say('고친 PDF 만드는 중…');
      clearOutputs();
      const result = await applyTextEdits(source, edits, [...fonts.values()]);
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

function toRgb(hexColor: string): Rgb {
  const value = Number.parseInt(hexColor.replace('#', ''), 16);
  return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(part => part.toString(16).padStart(2, '0')).join('')}`;
}

