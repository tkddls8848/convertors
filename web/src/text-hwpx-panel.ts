/**
 * 텍스트·Markdown → HWPX 화면.
 *
 * HWPX 를 **읽는** 쪽(`hwpx.ts` → Markdown)의 반대 방향이다. 짓는 일은
 * `hwpx-writer.ts` 가 이미 하고 있으므로 여기서 하는 것은 글을 블록으로 나눠
 * 넘기는 것뿐이다.
 *
 * 쓰기 모듈은 `DOMParser` 를 쓰므로 단추를 누른 사람만 받는다 — 견적서만 쓰는
 * 사람이 HWPX 뼈대까지 내려받을 이유가 없다.
 */
import { reason } from './errors';
import { parseMarkdown } from './markdown';

const MAX_CHARS = 2_000_000;
/** A4. PDF point(1/72 inch) — `hwpx-writer` 가 100을 곱해 HWPX 단위로 바꾼다. */
const A4 = { width: 595.28, height: 841.89 };

export function textHwpxTool(): HTMLElement {
  const tool = document.createElement('section');
  tool.className = 'conv-tool conv-text-hwpx';
  tool.innerHTML = `
    <h2>텍스트·Markdown → HWPX</h2>
    <p class="conv-note">글을 붙여 넣거나 <code>.md</code>·<code>.txt</code> 파일을 올리면 한글에서 열리는 HWPX 를 만듭니다.
      <strong>글과 표만 옮깁니다</strong> — 글꼴·크기·색·굵기는 옮기지 않습니다.
      무엇을 옮기지 못했는지는 만든 뒤 아래에 적습니다.</p>
    <label class="conv-drop" for="conv-text-file">
      <input id="conv-text-file" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" />
      <span>텍스트·Markdown 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <label for="conv-text-input" class="conv-label">또는 직접 붙여 넣기</label>
    <textarea id="conv-text-input" class="conv-input" rows="10" spellcheck="false"
      placeholder="# 제목&#10;&#10;문단을 적습니다.&#10;&#10;| 품목 | 수량 |&#10;| --- | --- |&#10;| 볼펜 | 3 |"></textarea>
    <div class="conv-actions">
      <label><input type="checkbox" class="text-markdown" checked> Markdown 으로 해석 (제목·목록·표)</label>
      <button type="button" class="conv-download" data-action="save">HWPX 로 저장</button>
    </div>
    <p class="conv-note">끄면 <strong>줄 하나가 문단 하나</strong>가 됩니다 — 로그·주소록처럼 줄이 곧 뜻인 글에 쓰세요.</p>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <ul class="text-notes" aria-label="옮기지 못한 것"></ul>
    <div class="text-outputs conv-actions" aria-label="저장 결과"></div>
  `;

  const file = tool.querySelector<HTMLInputElement>('#conv-text-file')!;
  const drop = tool.querySelector<HTMLElement>('.conv-drop')!;
  const area = tool.querySelector<HTMLTextAreaElement>('#conv-text-input')!;
  const markdown = tool.querySelector<HTMLInputElement>('.text-markdown')!;
  const save = tool.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const status = tool.querySelector<HTMLElement>('.conv-status')!;
  const notes = tool.querySelector<HTMLElement>('.text-notes')!;
  const outputs = tool.querySelector<HTMLElement>('.text-outputs')!;

  let name = 'document.hwpx';
  let busy = false;
  let urls: string[] = [];

  const message = (text: string, error = false): void => {
    status.textContent = text;
    status.dataset['tone'] = error ? 'error' : '';
  };
  const clearOutputs = (): void => {
    urls.forEach(url => URL.revokeObjectURL(url));
    urls = [];
    outputs.replaceChildren();
    notes.replaceChildren();
  };

  const load = (chosen: File): void => {
    void (async () => {
      if (chosen.size > MAX_CHARS) { message(`파일이 너무 큽니다. ${(MAX_CHARS / 1_000_000).toFixed(0)}MB까지 읽습니다.`, true); return; }
      clearOutputs();
      // 인코딩까지 가리지는 않는다 — 깨져 보이면 인코딩 변환기를 먼저 쓰라고 적는다.
      area.value = await chosen.text();
      name = `${chosen.name.replace(/\.(md|markdown|txt)$/i, '')}.hwpx`;
      message(`${chosen.name} 를 읽었습니다. 글자가 깨져 보이면 아래 인코딩 변환기로 UTF-8 로 바꾼 뒤 다시 올려 주세요.`);
    })();
  };

  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (chosen) load(chosen);
    file.value = '';
  });
  for (const type of ['dragenter', 'dragover'] as const) drop.addEventListener(type, event => {
    event.preventDefault();
    drop.dataset['over'] = 'yes';
  });
  drop.addEventListener('dragleave', () => delete drop.dataset['over']);
  drop.addEventListener('drop', event => {
    event.preventDefault();
    delete drop.dataset['over'];
    const chosen = event.dataTransfer?.files?.[0];
    if (chosen) load(chosen);
  });
  area.addEventListener('input', clearOutputs);
  markdown.addEventListener('change', clearOutputs);

  save.addEventListener('click', () => {
    if (busy) return;
    void (async () => {
      const source = area.value;
      if (!source.trim()) { message('옮길 글이 없습니다.', true); return; }
      if (source.length > MAX_CHARS) { message('글이 200만 자를 넘습니다.', true); return; }
      busy = true; save.disabled = true; clearOutputs();
      try {
        message('글을 나누는 중…');
        const parsed = parseMarkdown(source, { markdown: markdown.checked });
        if (!parsed.blocks.length) throw new Error('옮길 글이 없습니다.');
        message('HWPX 짓는 중…');
        // 뼈대와 쓰기 모듈은 여기서 처음 받는다.
        const [{ documentToHwpx }, { default: templateUrl }] = await Promise.all([
          import('./hwpx-writer'),
          import('./assets/Skeleton.hwpx?url'),
        ]);
        const response = await fetch(templateUrl);
        if (!response.ok) throw new Error('HWPX 뼈대를 읽지 못했습니다.');
        const bytes = documentToHwpx(new Uint8Array(await response.arrayBuffer()), [
          { ...A4, blocks: parsed.blocks },
        ]);
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/hwp+zip' }));
        urls.push(url);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        const tables = parsed.blocks.filter(block => block.kind === 'table').length;
        link.textContent = `${name} 내려받기 (문단 ${parsed.blocks.length - tables}개${tables ? ` · 표 ${tables}개` : ''})`;
        outputs.append(link);
        for (const text of parsed.notes) {
          const item = document.createElement('li');
          item.textContent = text;
          notes.append(item);
        }
        message('HWPX 를 만들었습니다. 한글에서 열어 확인해 주세요.');
      } catch (error) {
        clearOutputs();
        message(reason(error), true);
      } finally { busy = false; save.disabled = false; }
    })();
  });

  return tool;
}
