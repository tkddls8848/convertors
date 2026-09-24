/**
 * PDF 워터마크·쪽번호 화면.
 *
 * 글꼴은 **필요할 때만** 받는다. 찍을 글자가 모두 영문·숫자면 PDF 기본 글꼴
 * (Helvetica)로 내려받기 없이 찍고, 한글이 섞이면 고른 한글 글꼴을 그때 받는다.
 * "{n} / {total}" 쪽번호만 찍으러 온 사람에게 5MB 를 받게 할 이유가 없다.
 *
 * 받아 둔 글꼴 목록이 없으면(배포에서 글꼴을 못 받았을 때) 있는 척하지 않는다 —
 * 한글에는 글꼴이 있어야 한다고 적고 "내 글꼴 불러오기" 로 물러난다.
 */
import { reason } from './errors';
import { loadCatalog, loadFont, mb, type CatalogFont } from './fonts';
import { filePicker, need, outputs, statusLine, stem, toolSection, yieldToPaint } from './kit';
import { MAX_PDF_BYTES, readPdf } from './pdf';
import { EDIT_LIMITS } from './pdf-edit';
import {
  hexToRgb, needsFont, parsePageRange, stampPdf, STAMP_LIMITS,
  type NumberOptions, type NumberPosition, type StampOptions, type WatermarkOptions,
} from './pdf-stamp';
import { readTables } from './sfnt';

const MM = 72 / 25.4;

export function pdfStampTool(): HTMLElement {
  const tool = toolSection('conv-pdf-stamp', `
    <h2>PDF 워터마크·쪽번호</h2>
    <p class="conv-note">“대외비”·“사본” 같은 글자와 쪽번호를 쪽 위에 겹쳐 찍습니다. 최대 64MB · 1,000쪽.
      돌려 둔 쪽(/Rotate)과 잘라 둔 쪽(CropBox)도 <strong>보이는 방향 그대로</strong> 찍습니다.
      파일은 이 컴퓨터를 벗어나지 않습니다.</p>
    <ul class="conv-notes">
      <li><strong>워터마크는 지울 수 있습니다.</strong> 글자를 위에 얹는 것이라 PDF 편집기로 떼어 낼 수 있고, 원래 내용을 가리거나 보호하지 않습니다.</li>
      <li>한글을 찍으려면 한글 글꼴을 받아 심습니다(수 MB, 쓴 글자만 담깁니다). 영문·숫자만이면 내려받지 않습니다.</li>
      <li>암호가 걸린 PDF 는 열지 않습니다. 책갈피·양식·링크는 그대로 둡니다.</li>
    </ul>
    <label class="conv-drop" for="stamp-file">
      <input id="stamp-file" type="file" accept=".pdf,application/pdf" />
      <span>PDF 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>

    <fieldset class="stamp-controls" disabled>
      <legend>워터마크</legend>
      <label><input type="checkbox" id="stamp-wm-on" checked /> 워터마크 넣기</label>
      <div class="conv-form">
        <label for="stamp-wm-text">글자</label>
        <input id="stamp-wm-text" type="text" class="conv-wide" value="대외비" maxlength="${STAMP_LIMITS.chars}" />
        <label for="stamp-wm-size">크기(pt)</label>
        <input id="stamp-wm-size" type="number" min="${STAMP_LIMITS.minSize}" max="${STAMP_LIMITS.maxSize}" step="1" value="60" />
        <label for="stamp-wm-opacity">불투명도(%)</label>
        <input id="stamp-wm-opacity" type="number" min="1" max="100" step="5" value="20" />
        <label for="stamp-wm-angle">기울기(도)</label>
        <div>
          <input id="stamp-wm-angle" type="number" min="-360" max="360" step="1" value="45" list="stamp-angles" />
          <datalist id="stamp-angles"><option value="0"></option><option value="45"></option><option value="-45"></option><option value="90"></option></datalist>
        </div>
        <label for="stamp-wm-color">색</label>
        <input id="stamp-wm-color" type="color" value="#c00000" />
        <label for="stamp-wm-layout">배치</label>
        <select id="stamp-wm-layout">
          <option value="center" selected>쪽 가운데 하나</option>
          <option value="tile">쪽 전체에 바둑판으로</option>
        </select>
      </div>
    </fieldset>

    <fieldset class="stamp-controls" disabled>
      <legend>쪽번호</legend>
      <label><input type="checkbox" id="stamp-no-on" checked /> 쪽번호 넣기</label>
      <div class="conv-form">
        <label for="stamp-no-template">모양</label>
        <div>
          <input id="stamp-no-template" type="text" value="{n} / {total}" list="stamp-templates" maxlength="${STAMP_LIMITS.templateChars}" />
          <datalist id="stamp-templates">
            <option value="{n}"></option><option value="{n} / {total}"></option>
            <option value="- {n} -"></option><option value="{n}쪽"></option>
          </datalist>
        </div>
        <label for="stamp-no-position">자리</label>
        <select id="stamp-no-position">
          <option value="bottom-center" selected>아래 가운데</option>
          <option value="bottom-right">아래 오른쪽</option>
          <option value="bottom-left">아래 왼쪽</option>
          <option value="top-center">위 가운데</option>
          <option value="top-right">위 오른쪽</option>
          <option value="top-left">위 왼쪽</option>
        </select>
        <label for="stamp-no-margin">가장자리 여백(mm)</label>
        <input id="stamp-no-margin" type="number" min="0" max="100" step="1" value="10" />
        <label for="stamp-no-size">크기(pt)</label>
        <input id="stamp-no-size" type="number" min="${STAMP_LIMITS.minSize}" max="${STAMP_LIMITS.maxSize}" step="0.5" value="10" />
        <label for="stamp-no-start">시작 번호</label>
        <input id="stamp-no-start" type="number" min="0" step="1" value="1" />
        <label for="stamp-no-color">색</label>
        <input id="stamp-no-color" type="color" value="#000000" />
      </div>
      <label><input type="checkbox" id="stamp-no-skip" /> 첫 쪽(표지)에는 번호를 찍지 않기 — 다음 쪽이 시작 번호</label>
      <p class="conv-note"><code>{n}</code> 은 쪽번호, <code>{total}</code> 은 마지막 번호입니다. 번호는 아래 “적용할 쪽” 안의 쪽만 차례로 셉니다.</p>
    </fieldset>

    <fieldset class="stamp-controls" disabled>
      <legend>적용할 쪽과 글꼴</legend>
      <div class="conv-form">
        <label for="stamp-range">적용할 쪽</label>
        <input id="stamp-range" type="text" placeholder="비우면 전부. 예: 1-3, 5, 8-" />
        <label for="stamp-font">한글 글꼴</label>
        <select id="stamp-font"></select>
        <label for="stamp-font-file">내 글꼴 불러오기</label>
        <input id="stamp-font-file" type="file" accept=".ttf,.otf,font/ttf,font/otf" />
      </div>
      <p class="conv-note stamp-font-note">글자가 모두 영문·숫자면 글꼴을 받지 않고 PDF 기본 글꼴(Helvetica)로 찍습니다. 한글이 있으면 위에서 고른 글꼴을 받아 심습니다. 올린 글꼴도 이 컴퓨터를 벗어나지 않습니다.</p>
      <div class="conv-actions">
        <button type="button" class="conv-download" data-action="save">찍어서 저장</button>
      </div>
    </fieldset>
    <div class="conv-outputs conv-actions" aria-label="저장 결과"></div>
  `);

  const input = need<HTMLInputElement>(tool, '#stamp-file');
  const say = statusLine(need(tool, '.conv-status'));
  const out = outputs(need(tool, '.conv-outputs'));
  const fieldsets = [...tool.querySelectorAll<HTMLFieldSetElement>('.stamp-controls')];
  const save = need<HTMLButtonElement>(tool, '[data-action="save"]');
  const fontSelect = need<HTMLSelectElement>(tool, '#stamp-font');
  const fontFile = need<HTMLInputElement>(tool, '#stamp-font-file');
  const fontNote = need<HTMLElement>(tool, '.stamp-font-note');
  const value = (id: string): string => need<HTMLInputElement | HTMLSelectElement>(tool, `#${id}`).value;
  const checked = (id: string): boolean => need<HTMLInputElement>(tool, `#${id}`).checked;

  let source: { name: string; bytes: Uint8Array; pages: number } | null = null;
  let busy = false;
  const catalog = new Map<string, CatalogFont>();
  const own = new Map<string, Uint8Array>();

  const render = (): void => {
    for (const fieldset of fieldsets) fieldset.disabled = busy || !source;
    input.disabled = busy;
  };

  // --- 글꼴 -------------------------------------------------------------------

  void (async () => {
    const found = await loadCatalog();
    for (const font of found) catalog.set(font.id, font);
    buildFonts();
  })();

  function buildFonts(): void {
    const keep = fontSelect.value;
    fontSelect.replaceChildren();
    if (!catalog.size && !own.size) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '받아 둔 한글 글꼴 없음 — 내 글꼴을 불러오세요';
      fontSelect.append(none);
      fontNote.textContent = '이 배포에는 한글 글꼴이 없습니다. 영문·숫자는 PDF 기본 글꼴로 찍을 수 있지만, 한글을 찍으려면 “내 글꼴 불러오기” 로 .ttf·.otf 글꼴 파일을 올려 주세요. 올린 글꼴은 이 컴퓨터를 벗어나지 않습니다.';
      return;
    }
    for (const group of [...new Set([...catalog.values()].map(font => font.group))]) {
      const node = document.createElement('optgroup');
      node.label = group;
      for (const font of catalog.values()) if (font.group === group) node.append(option(font.id, `${font.label} · ${mb(font.bytes)}`));
      fontSelect.append(node);
    }
    if (own.size) {
      const node = document.createElement('optgroup');
      node.label = '내 글꼴';
      for (const id of own.keys()) node.append(option(id, id.slice('own-'.length)));
      fontSelect.append(node);
    }
    if (keep && [...fontSelect.options].some(item => item.value === keep)) fontSelect.value = keep;
  }

  function option(id: string, label: string): HTMLOptionElement {
    const node = document.createElement('option');
    node.value = id;
    node.textContent = label;
    return node;
  }

  fontFile.addEventListener('change', () => {
    const file = fontFile.files?.[0];
    fontFile.value = '';
    if (!file) return;
    void (async () => {
      try {
        if (file.size > EDIT_LIMITS.fontBytes) throw new Error('글꼴 파일은 32MB까지 읽습니다.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        // 못 쓰는 글꼴은 저장할 때가 아니라 올릴 때 알아야 한다.
        readTables(bytes);
        const id = `own-${file.name}`;
        own.set(id, bytes);
        buildFonts();
        fontSelect.value = id;
        say(`${file.name} 글꼴을 불러왔습니다.`, 'ok');
      } catch (error) {
        say(`글꼴을 읽지 못했습니다: ${reason(error)}`, 'error');
      }
    })();
  });

  async function fontBytes(): Promise<Uint8Array> {
    const id = fontSelect.value;
    const mine = own.get(id);
    if (mine) return mine;
    const entry = catalog.get(id);
    if (!entry) throw new Error('한글 등 기본 글꼴에 없는 글자가 있어 글꼴이 필요합니다. “내 글꼴 불러오기” 로 한글 글꼴(.ttf·.otf)을 올려 주세요.');
    return loadFont(entry, message => say(message));
  }

  // --- 파일 --------------------------------------------------------------------

  filePicker(input, files => void open(files[0]!), () => busy);

  async function open(file: File): Promise<void> {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { say('PDF 파일만 열 수 있습니다.', 'error'); return; }
    if (file.size > MAX_PDF_BYTES) { say(`파일이 너무 큽니다(${mb(file.size)}). 64MB까지 읽습니다.`, 'error'); return; }
    busy = true; render(); out.clear();
    try {
      say(`${file.name} 읽는 중…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { document } = await readPdf(bytes, file.name);
      source = { name: file.name, bytes, pages: document.getPageCount() };
      say(`${file.name} · ${source.pages}쪽. 찍을 것을 고르고 저장을 누르세요.`, 'ok');
    } catch (error) {
      source = null;
      say(reason(error), 'error');
    } finally { busy = false; render(); }
  }

  // --- 저장 --------------------------------------------------------------------

  function options(): StampOptions {
    const watermark: WatermarkOptions | undefined = checked('stamp-wm-on') ? {
      text: value('stamp-wm-text'),
      size: Number(value('stamp-wm-size')),
      opacity: Number(value('stamp-wm-opacity')) / 100,
      angle: Number(value('stamp-wm-angle')),
      color: hexToRgb(value('stamp-wm-color')),
      layout: value('stamp-wm-layout') === 'tile' ? 'tile' : 'center',
    } : undefined;
    const numbers: NumberOptions | undefined = checked('stamp-no-on') ? {
      template: value('stamp-no-template'),
      position: value('stamp-no-position') as NumberPosition,
      margin: Number(value('stamp-no-margin')) * MM,
      size: Number(value('stamp-no-size')),
      start: Number(value('stamp-no-start')),
      skipFirst: checked('stamp-no-skip'),
      color: hexToRgb(value('stamp-no-color')),
    } : undefined;
    return { watermark, numbers, range: value('stamp-range') };
  }

  save.addEventListener('click', () => {
    if (!source || busy) return;
    const picked = source;
    void (async () => {
      busy = true; render(); out.clear();
      try {
        const chosen = options();
        // 범위 오류는 글꼴을 받기 전에 알린다.
        parsePageRange(chosen.range, picked.pages);
        const font = needsFont(chosen, picked.pages) ? await fontBytes() : undefined;
        say('찍는 중…');
        await yieldToPaint();
        const result = await stampPdf(picked.bytes, chosen, font);
        const name = `${stem(picked.name)}-stamped.pdf`;
        out.add(result.bytes, name, 'application/pdf');
        const parts = [
          chosen.watermark ? `워터마크 ${result.pages}쪽` : '',
          chosen.numbers ? `쪽번호 ${result.numbered}쪽` : '',
        ].filter(Boolean).join(' · ');
        say(`${parts}에 찍었습니다${font ? ' (한글 글꼴을 심었습니다)' : ''}. 아래 링크를 눌러 내려받으세요.`, 'ok');
      } catch (error) {
        out.clear();
        say(reason(error), 'error');
      } finally { busy = false; render(); }
    })();
  });

  render();
  return tool;
}
