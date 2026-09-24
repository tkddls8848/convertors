/**
 * ZIP 묶기·풀기 화면.
 *
 * 푸는 쪽은 `zip.ts` 를 그대로 쓴다 — zip-slip 과 압축 폭탄을 막는 검사가 이미
 * 거기 있고, 한글 이름이 CP949 로 적힌 ZIP 도 거기서 가려 읽는다.
 *
 * 묶는 쪽은 fflate 의 `zipSync` 다. 이미 압축된 갈래(그림·PDF·ZIP·글꼴)는 다시
 * 줄이려 들지 않는다 — 시간만 쓰고 크기는 그대로다.
 */
import { zipSync, type Zippable } from 'fflate';

import { reason } from './errors';
import { readZip } from './zip';

const MAX_TOTAL = 64 * 1024 * 1024;
const MAX_FILES = 500;
/** 다시 압축해 봐야 줄지 않는 것들. */
const PACKED = /\.(zip|gz|bz2|xz|7z|rar|png|jpe?g|gif|webp|avif|heic|mp3|mp4|mov|avi|woff2?|pdf|hwpx?|docx|xlsx|pptx)$/i;

export function zipTool(): HTMLElement {
  const tool = document.createElement('section');
  tool.className = 'conv-tool conv-zip';
  tool.innerHTML = `
    <h2>ZIP 묶기·풀기</h2>
    <p class="conv-note">파일 여러 개를 ZIP 하나로 묶거나, ZIP 을 풀어 원하는 것만 내려받습니다. 합계 64MB · 500개까지.
      <strong>윈도우가 만든 ZIP 의 한글 이름도 그대로 읽습니다.</strong>
      암호가 걸린 ZIP 과 분할 압축(<code>.z01</code>)은 지원하지 않습니다.</p>

    <h3>묶기</h3>
    <label class="conv-drop" for="conv-zip-pack">
      <input id="conv-zip-pack" type="file" multiple />
      <span>묶을 파일을 고르거나 여기에 끌어다 놓으세요 (여러 개 가능)</span>
    </label>
    <p class="zip-pack-status conv-status" role="status" aria-live="polite"></p>
    <ul class="zip-pack-list" aria-label="묶을 파일"></ul>
    <div class="conv-actions">
      <button type="button" class="conv-download zip-pack-save" disabled>ZIP 으로 묶기</button>
      <button type="button" class="zip-pack-reset">초기화</button>
    </div>
    <div class="zip-pack-outputs conv-actions" aria-label="묶기 결과"></div>

    <h3>풀기</h3>
    <label class="conv-drop" for="conv-zip-open">
      <input id="conv-zip-open" type="file" accept=".zip,application/zip" />
      <span>ZIP 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <p class="zip-open-status conv-status" role="status" aria-live="polite"></p>
    <ul class="zip-open-list" aria-label="ZIP 안의 파일"></ul>
  `;

  packing(tool);
  unpacking(tool);
  return tool;
}

function packing(tool: HTMLElement): void {
  const input = tool.querySelector<HTMLInputElement>('#conv-zip-pack')!;
  const drop = input.closest<HTMLElement>('.conv-drop')!;
  const status = tool.querySelector<HTMLElement>('.zip-pack-status')!;
  const list = tool.querySelector<HTMLElement>('.zip-pack-list')!;
  const save = tool.querySelector<HTMLButtonElement>('.zip-pack-save')!;
  const reset = tool.querySelector<HTMLButtonElement>('.zip-pack-reset')!;
  const outputs = tool.querySelector<HTMLElement>('.zip-pack-outputs')!;

  let files: File[] = [];
  let urls: string[] = [];
  const message = (text: string, error = false): void => {
    status.textContent = text;
    status.dataset['tone'] = error ? 'error' : '';
  };
  const clearOutputs = (): void => {
    urls.forEach(url => URL.revokeObjectURL(url));
    urls = [];
    outputs.replaceChildren();
  };
  const render = (): void => {
    save.disabled = !files.length;
    list.replaceChildren();
    files.forEach((file, index) => {
      const row = document.createElement('li');
      row.append(document.createTextNode(`${file.name} (${size(file.size)})`));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '빼기';
      remove.setAttribute('aria-label', `${file.name} 빼기`);
      remove.addEventListener('click', () => { files.splice(index, 1); clearOutputs(); render(); });
      row.append(remove);
      list.append(row);
    });
  };

  const add = (added: File[]): void => {
    if (!added.length) return;
    const total = [...files, ...added].reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_TOTAL) { message('묶을 파일은 합계 64MB까지입니다.', true); return; }
    if (files.length + added.length > MAX_FILES) { message(`파일은 ${MAX_FILES}개까지 묶을 수 있습니다.`, true); return; }
    files.push(...added);
    clearOutputs();
    message(`${files.length}개 · ${size(total)}`);
    render();
  };

  input.addEventListener('change', () => { add(Array.from(input.files ?? [])); input.value = ''; });
  dropTarget(drop, add);
  reset.addEventListener('click', () => { files = []; clearOutputs(); message(''); render(); });

  save.addEventListener('click', () => {
    void (async () => {
      save.disabled = true;
      clearOutputs();
      try {
        message('파일 읽는 중…');
        const zippable: Zippable = {};
        const used = new Set<string>();
        for (const file of files) {
          // 같은 이름을 두 번 담으면 뒤엣것이 앞엣것을 지운다. 이름을 바꿔 둘 다 남긴다.
          let name = file.name;
          for (let n = 2; used.has(name); n++) name = file.name.replace(/(\.[^.]*)?$/, match => ` (${n})${match}`);
          used.add(name);
          zippable[name] = [new Uint8Array(await file.arrayBuffer()), { level: PACKED.test(name) ? 0 : 6 }];
        }
        message('묶는 중…');
        // 한 틱 놓아 준다 — zipSync 가 도는 동안은 화면이 멈추므로 그 전에 알린다.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        const bytes = zipSync(zippable);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        urls.push(url);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'archive.zip';
        link.textContent = `archive.zip 내려받기 (${files.length}개 · ${size(bytes.length)})`;
        outputs.append(link);
        message('묶었습니다. 아래 링크를 눌러 내려받으세요.');
      } catch (error) {
        clearOutputs();
        message(reason(error), true);
      } finally { save.disabled = !files.length; }
    })();
  });
  render();
}

function unpacking(tool: HTMLElement): void {
  const input = tool.querySelector<HTMLInputElement>('#conv-zip-open')!;
  const drop = input.closest<HTMLElement>('.conv-drop')!;
  const status = tool.querySelector<HTMLElement>('.zip-open-status')!;
  const list = tool.querySelector<HTMLElement>('.zip-open-list')!;

  let urls: string[] = [];
  const message = (text: string, error = false): void => {
    status.textContent = text;
    status.dataset['tone'] = error ? 'error' : '';
  };

  const open = (file: File): void => {
    void (async () => {
      urls.forEach(url => URL.revokeObjectURL(url));
      urls = [];
      list.replaceChildren();
      if (file.size > MAX_TOTAL) { message('ZIP 은 64MB까지 엽니다.', true); return; }
      try {
        message(`${file.name} 푸는 중…`);
        const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
        let folders = 0;
        for (const [name, bytes] of entries) {
          // 폴더 항목은 내용이 없다. 내려받을 것이 없으므로 세기만 한다.
          if (name.endsWith('/')) { folders++; continue; }
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
          urls.push(url);
          const row = document.createElement('li');
          const link = document.createElement('a');
          link.href = url;
          link.download = name.split('/').pop() || name;
          link.textContent = `${name} (${size(bytes.length)})`;
          row.append(link);
          list.append(row);
        }
        const count = urls.length;
        message(count
          ? `${count}개 파일을 풀었습니다${folders ? ` (폴더 ${folders}개)` : ''}. 이름을 눌러 하나씩 내려받으세요.`
          : 'ZIP 안에 내려받을 파일이 없습니다.', !count);
      } catch (error) {
        // 암호가 걸린 ZIP 은 압축 방식이 아니라 항목 크기에서 어긋난다. 무엇이든 그대로 알린다.
        message(`열지 못했습니다: ${reason(error)}`, true);
      }
    })();
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) open(file);
    input.value = '';
  });
  dropTarget(drop, files => { if (files[0]) open(files[0]); });
}

function dropTarget(drop: HTMLElement, receive: (files: File[]) => void): void {
  for (const type of ['dragenter', 'dragover'] as const) drop.addEventListener(type, event => {
    event.preventDefault();
    drop.dataset['over'] = 'yes';
  });
  drop.addEventListener('dragleave', () => delete drop.dataset['over']);
  drop.addEventListener('drop', event => {
    event.preventDefault();
    delete drop.dataset['over'];
    receive(Array.from(event.dataTransfer?.files ?? []));
  });
}

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
