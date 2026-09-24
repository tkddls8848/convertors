/**
 * PDF 모아찍기·빈 쪽 빼기 화면.
 *
 * 둘 다 PDF 하나를 받아 새 PDF 를 낸다. 파일은 한 번만 고르게 하고 두 일이
 * 같이 쓴다.
 *
 * 빈 쪽은 **추정** 이다. 쪽을 낮은 해상도로 그려 잉크 비율을 재고, 글자가 하나라도
 * 있는 쪽은 후보에서 뺀다. 그래도 옅은 연필 글씨·작은 점 하나를 빈 쪽으로 볼
 * 수 있어서 후보를 보여 주고 사람이 고르게 한다 — 조용히 빼지 않는다.
 */
import { reason } from './errors';
import { filePicker, need, outputs, size, statusLine, stem, toolSection, yieldToPaint } from './kit';
import { MAX_PDF_BYTES, readPdf } from './pdf';
import { inkRatio, isBlank, nupPdf, removePages, type Order, type PerSheet } from './pdf-nup';

/** 빈 쪽을 가릴 때 그리는 해상도. 점 하나는 놓쳐도 글 한 줄은 놓치지 않는다. */
const SCAN_DPI = 30;
const MM = 72 / 25.4;

export function pdfNupTool(): HTMLElement {
  const tool = toolSection('conv-pdf-nup', `
    <h2>PDF 모아찍기·빈 쪽 빼기</h2>
    <p class="conv-note">여러 쪽을 A4 한 장에 2·4·6·9쪽씩 모아 담거나, 빈 쪽을 찾아 뺍니다. 최대 64MB · 1,000쪽.
      파일은 이 컴퓨터를 벗어나지 않습니다.</p>
    <ul class="conv-notes">
      <li>모아찍기는 쪽 내용을 그대로 옮겨 글자 검색·복사가 됩니다. 다만 <strong>링크·양식 칸·주석·책갈피는 따라오지 않습니다.</strong></li>
      <li>용지 방향(세로·가로)은 쪽이 가장 크게 들어가는 쪽으로 저절로 고릅니다. 돌려 둔 쪽은 보이는 방향대로 바로 세웁니다.</li>
      <li>빈 쪽 찾기는 <strong>추정</strong>입니다. 아주 옅은 글씨나 작은 표시는 빈 쪽으로 보일 수 있으니 후보를 확인하고 빼세요. 글자가 들어 있는 쪽은 후보에 올리지 않습니다.</li>
      <li>빈 쪽을 뺀 PDF 도 책갈피·양식은 옮기지 않습니다. 암호가 걸린 PDF 는 열지 않습니다.</li>
    </ul>
    <label class="conv-drop" for="nup-file">
      <input id="nup-file" type="file" accept=".pdf,application/pdf" />
      <span>PDF 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>

    <fieldset class="nup-controls" disabled>
      <legend>모아찍기</legend>
      <div class="conv-form">
        <label for="nup-per">한 장에</label>
        <select id="nup-per">
          <option value="2">2쪽</option>
          <option value="4" selected>4쪽</option>
          <option value="6">6쪽</option>
          <option value="9">9쪽</option>
        </select>
        <label for="nup-order">순서</label>
        <select id="nup-order">
          <option value="row" selected>왼쪽→오른쪽, 그다음 줄</option>
          <option value="column">위→아래, 그다음 칸</option>
        </select>
        <label for="nup-margin">용지 여백(mm)</label>
        <input id="nup-margin" type="number" min="0" max="50" step="1" value="8" />
        <label for="nup-gap">쪽 사이 간격(mm)</label>
        <input id="nup-gap" type="number" min="0" max="30" step="1" value="4" />
      </div>
      <label><input type="checkbox" id="nup-border" checked /> 쪽마다 얇은 테두리</label>
      <div class="conv-actions">
        <button type="button" class="conv-download" data-action="nup">모아서 저장</button>
      </div>
    </fieldset>

    <fieldset class="nup-controls" disabled>
      <legend>빈 쪽 빼기</legend>
      <div class="conv-form">
        <label for="nup-sensitivity">빈 쪽으로 볼 기준</label>
        <select id="nup-sensitivity">
          <option value="0.0005">엄격 — 거의 완전히 흰 쪽만</option>
          <option value="0.002" selected>보통 — 스캔 잡티 정도는 빈 쪽</option>
          <option value="0.01">느슨 — 작은 표시가 있어도 빈 쪽</option>
        </select>
      </div>
      <div class="conv-actions">
        <button type="button" data-action="scan">빈 쪽 찾기</button>
        <button type="button" data-action="cancel" disabled>그만두기</button>
      </div>
      <ul class="conv-list nup-candidates" aria-label="빈 쪽 후보"></ul>
      <div class="conv-actions">
        <button type="button" class="conv-download" data-action="remove" disabled>고른 쪽 빼고 저장</button>
      </div>
    </fieldset>
    <div class="conv-outputs conv-actions" aria-label="저장 결과"></div>
  `);

  const input = need<HTMLInputElement>(tool, '#nup-file');
  const say = statusLine(need(tool, '.conv-status'));
  const out = outputs(need(tool, '.conv-outputs'));
  const fieldsets = [...tool.querySelectorAll<HTMLFieldSetElement>('.nup-controls')];
  const candidates = need<HTMLUListElement>(tool, '.nup-candidates');
  const cancel = need<HTMLButtonElement>(tool, '[data-action="cancel"]');
  const removeButton = need<HTMLButtonElement>(tool, '[data-action="remove"]');
  const value = (id: string): string => need<HTMLInputElement | HTMLSelectElement>(tool, `#${id}`).value;

  let source: { name: string; bytes: Uint8Array; pages: number } | null = null;
  let busy = false;
  let scanning: AbortController | null = null;
  let found: number[] = [];

  const render = (): void => {
    // 찾는 동안에도 그만두기는 눌려야 한다. 칸 묶음째 막지 않고 단추를 하나씩 막는다.
    for (const fieldset of fieldsets) fieldset.disabled = !source || (busy && !scanning);
    input.disabled = busy;
    for (const button of tool.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
      if (button !== cancel) button.disabled = busy;
    }
    cancel.disabled = !scanning;
    removeButton.disabled = busy || !found.length;
  };

  filePicker(input, files => void open(files[0]!), () => busy);

  async function open(file: File): Promise<void> {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { say('PDF 파일만 열 수 있습니다.', 'error'); return; }
    if (file.size > MAX_PDF_BYTES) { say(`파일이 너무 큽니다(${size(file.size)}). 64MB까지 읽습니다.`, 'error'); return; }
    busy = true; render(); out.clear();
    found = [];
    candidates.replaceChildren();
    try {
      say(`${file.name} 읽는 중…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { document } = await readPdf(bytes, file.name);
      source = { name: file.name, bytes, pages: document.getPageCount() };
      say(`${file.name} · ${source.pages}쪽.`, 'ok');
    } catch (error) {
      source = null;
      say(reason(error), 'error');
    } finally { busy = false; render(); }
  }

  tool.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset['action'];
    if (!action || !source) return;
    if (action === 'cancel') { scanning?.abort(); return; }
    if (busy) return;
    if (action === 'nup') void nup();
    else if (action === 'scan') void scan();
    else if (action === 'remove') void removeChosen();
  });

  async function nup(): Promise<void> {
    if (!source) return;
    busy = true; render(); out.clear();
    try {
      const perSheet = Number(value('nup-per')) as PerSheet;
      say(`${perSheet}쪽씩 모으는 중…`);
      await yieldToPaint();
      const result = await nupPdf(source.bytes, {
        perSheet,
        order: value('nup-order') as Order,
        margin: Math.max(0, Number(value('nup-margin')) || 0) * MM,
        gap: Math.max(0, Number(value('nup-gap')) || 0) * MM,
        border: need<HTMLInputElement>(tool, '#nup-border').checked,
      });
      out.add(result.bytes, `${stem(source.name)}-${perSheet}up.pdf`, 'application/pdf');
      const landscape = result.layout.sheet.width > result.layout.sheet.height;
      const skipped = result.skipped.length ? ` 내용이 아예 없는 ${result.skipped.map(n => n + 1).join('·')}쪽은 칸을 비워 두었습니다.` : '';
      say(`${source.pages}쪽을 A4 ${landscape ? '가로' : '세로'} ${result.sheets}장(${result.layout.cols}×${result.layout.rows})에 담았습니다.${skipped} 아래 링크를 눌러 내려받으세요.`, 'ok');
    } catch (error) {
      out.clear();
      say(reason(error), 'error');
    } finally { busy = false; render(); }
  }

  async function scan(): Promise<void> {
    if (!source) return;
    const controller = new AbortController();
    scanning = controller;
    busy = true; found = []; candidates.replaceChildren(); out.clear(); render();
    const sensitivity = Number(value('nup-sensitivity'));
    const thumbs = new Map<number, HTMLCanvasElement>();
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;
    try {
      const { openPdf, renderToCanvas } = await import('./pdf-render');
      task = openPdf(source.bytes);
      const document = await task.promise;
      for (let n = 1; n <= document.numPages; n++) {
        controller.signal.throwIfAborted();
        say(`${n}/${document.numPages}쪽 살펴보는 중… (빈 쪽 후보 ${found.length}개)`);
        const page = await document.getPage(n);
        try {
          const text = await page.getTextContent();
          const hasText = text.items.some(item => 'str' in item && item.str.trim() !== '');
          // 글자가 있으면 그릴 필요도 없다. 빈 쪽이 아니다.
          if (hasText) continue;
          const canvas = window.document.createElement('canvas');
          await renderToCanvas(page, canvas, page.getViewport({ scale: SCAN_DPI / 72, rotation: page.rotate }));
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('캔버스를 만들지 못했습니다.');
          const ratio = inkRatio(context.getImageData(0, 0, canvas.width, canvas.height).data);
          if (isBlank(ratio, false, sensitivity)) {
            found.push(n - 1);
            thumbs.set(n - 1, canvas);
          }
        } finally { page.cleanup(); }
        // 쪽마다 한 틱 놓아 준다 — 그만두기 단추가 눌려야 한다.
        await yieldToPaint();
      }
      showCandidates(thumbs);
      say(found.length
        ? `빈 쪽 후보 ${found.length}개를 찾았습니다. 뺄 쪽만 체크한 채로 두고 저장을 누르세요.`
        : '빈 쪽을 찾지 못했습니다.', found.length ? 'ok' : undefined);
    } catch (error) {
      found = [];
      candidates.replaceChildren();
      say(controller.signal.aborted ? '빈 쪽 찾기를 그만두었습니다.' : reason(error), controller.signal.aborted ? undefined : 'error');
    } finally {
      await task?.destroy().catch(() => {});
      scanning = null;
      busy = false;
      render();
    }
  }

  function showCandidates(thumbs: Map<number, HTMLCanvasElement>): void {
    candidates.replaceChildren();
    for (const index of found) {
      const row = document.createElement('li');
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.value = String(index);
      label.append(box, ` ${index + 1}쪽 빼기`);
      const span = document.createElement('span');
      span.append(label);
      row.append(span);
      const thumb = thumbs.get(index);
      if (thumb) {
        // 눈으로 확인하게 작게 보인다. 30dpi 그림이라 새로 그릴 필요가 없다.
        thumb.style.width = '3.5rem';
        thumb.style.border = '1px solid var(--line)';
        thumb.setAttribute('aria-hidden', 'true');
        row.append(thumb);
      }
      candidates.append(row);
    }
  }

  async function removeChosen(): Promise<void> {
    if (!source) return;
    const chosen = [...candidates.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map(box => Number(box.value));
    if (!chosen.length) { say('뺄 쪽을 하나 이상 체크하세요.', 'error'); return; }
    busy = true; render(); out.clear();
    try {
      say(`${chosen.length}쪽을 빼는 중…`);
      await yieldToPaint();
      const result = await removePages(source.bytes, chosen);
      out.add(result.bytes, `${stem(source.name)}-noblank.pdf`, 'application/pdf');
      say(`${chosen.map(n => n + 1).join('·')}쪽을 빼고 ${result.pages}쪽을 남겼습니다. 아래 링크를 눌러 내려받으세요.`, 'ok');
    } catch (error) {
      out.clear();
      say(reason(error), 'error');
    } finally { busy = false; render(); }
  }

  render();
  return tool;
}
