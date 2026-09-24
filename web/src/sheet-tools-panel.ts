/**
 * 표 합치기·나누기 화면.
 *
 * SheetJS 는 일꾼(sheet-tools.worker.ts)에만 든다. 이 화면은 sheet-tools.ts 에서
 * **타입만** 가져온다 — 값을 가져오면 SheetJS 가 화면 묶음에 딸려 온다. 그래서 한도
 * 숫자도 여기 따로 적는다(바꿀 때 둘 다 바꾼다).
 *
 * 일꾼 부르기는 format-panel.ts 와 같다. 부를 때마다 새로 띄우고, 60초가 넘거나
 * 취소하면 일꾼째 끝낸다 — 도는 SheetJS 를 중간에 멈출 다른 방법이 없다.
 */
import { reason } from './errors';
import { comma, filePicker, need, outputs, size, statusLine, toolSection, type Outputs, type Say } from './kit';
import type { FileInfo, MergeOptions, OutputFormat, SplitOptions, ToolResult } from './sheet-tools';
import type { SheetToolRequest } from './sheet-tools.worker';

// sheet-tools.ts 의 SHEET_LIMITS·SHEET_TOOL_INPUTS·ALL_SHEETS 와 같은 값이다.
const MAX_FILE = 16 * 1024 * 1024;
const MAX_FILES = 50;
const INPUTS = ['csv', 'tsv', 'xlsx', 'xlsm', 'xls', 'ods'];
const ALL_SHEETS = '*';
const TIMEOUT = 60_000;

const ACCEPT = INPUTS.map(ext => `.${ext}`).join(',');

export function sheetMergeTool(): HTMLElement {
  const tool = toolSection('conv-sheet-tools', `
    <h2>표 합치기·나누기</h2>
    <p class="conv-note">CSV·TSV·XLSX·XLS·ODS 여러 개를 한 표로 합치거나, 한 표를 줄 수·열 값에 따라 여러 파일로 나눕니다.
      <strong>파일은 이 컴퓨터를 벗어나지 않습니다.</strong> 파일당 16MB · ${MAX_FILES}개 · 고른 시트 합계 50만 칸 · 60초까지.</p>
    <p class="conv-note"><strong>값만 옮깁니다.</strong> 수식은 저장된 계산값으로 바뀌고(다시 계산하지 않습니다), 서식·병합 셀·그림·메모는 옮기지 않으며 빈 줄은 뺍니다.
      CSV 는 인코딩(UTF-8·CP949)을 가려 읽고 칸을 글자로 읽어 앞자리 0 을 지킵니다. 첫 줄을 머리글로 봅니다.</p>

    <h3>합치기</h3>
    <label class="conv-drop" for="sheet-merge-file">
      <input id="sheet-merge-file" type="file" multiple accept="${ACCEPT}" />
      <span>합칠 표 파일을 고르거나 여기에 끌어다 놓으세요 (여러 개 가능 · 고른 순서대로 붙입니다)</span>
    </label>
    <ul class="conv-list sheet-merge-list" aria-label="합칠 파일"></ul>
    <fieldset class="sheet-merge-mode">
      <legend>합치는 방식</legend>
      <label><input type="radio" name="sheet-merge-mode" value="append" checked /> 한 시트로 이어 붙이기</label><br />
      <label><input type="radio" name="sheet-merge-mode" value="sheets" /> 파일마다 시트 하나로 (XLSX)</label>
    </fieldset>
    <p class="conv-note">이어 붙일 때 머리글은 첫 파일의 것을 쓰고, 같은 머리글은 떼고 붙입니다. <strong>머리글이 다르면 열 이름으로 맞춰</strong> 없던 열은 오른쪽에 더하고, 어느 파일이 달랐는지 알려 드립니다.</p>
    <div class="conv-actions">
      <label><input type="checkbox" id="sheet-merge-source" /> 원본 파일명 열 추가</label>
      <label>저장 형식 <select id="sheet-merge-format"><option value="xlsx">XLSX</option><option value="csv">CSV (UTF-8)</option></select></label>
    </div>
    <div class="conv-actions">
      <button type="button" class="conv-download sheet-merge-run" disabled>합치기</button>
      <button type="button" class="sheet-merge-cancel" disabled>취소</button>
      <button type="button" class="sheet-merge-reset">초기화</button>
    </div>
    <p class="conv-status sheet-merge-status" role="status" aria-live="polite"></p>
    <ul class="conv-notes sheet-merge-notes"></ul>
    <div class="conv-outputs conv-actions sheet-merge-outputs" aria-label="합치기 결과"></div>

    <h3>나누기</h3>
    <label class="conv-drop" for="sheet-split-file">
      <input id="sheet-split-file" type="file" accept="${ACCEPT}" />
      <span>나눌 표 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <div class="conv-form sheet-split-form" hidden>
      <label for="sheet-split-sheet">시트</label>
      <select id="sheet-split-sheet"></select>
      <label for="sheet-split-by">나누는 기준</label>
      <select id="sheet-split-by"><option value="rows">줄 수마다</option><option value="column">열 값마다</option></select>
      <label for="sheet-split-rows" class="sheet-split-rows-label">한 파일의 줄 수</label>
      <input id="sheet-split-rows" type="number" min="1" step="1" value="1000" />
      <label for="sheet-split-column" class="sheet-split-column-label" hidden>기준 열</label>
      <select id="sheet-split-column" hidden></select>
      <label for="sheet-split-format">저장 형식</label>
      <select id="sheet-split-format"><option value="csv">CSV (UTF-8)</option><option value="xlsx">XLSX</option></select>
    </div>
    <p class="conv-note">나눈 파일마다 머리글을 다시 붙이고 ZIP 하나로 묶습니다. 조각은 500개까지이며, 열 값으로 나눌 때 빈 칸은 "(빈 값)" 파일로 모읍니다.</p>
    <div class="conv-actions">
      <button type="button" class="conv-download sheet-split-run" disabled>나누기</button>
      <button type="button" class="sheet-split-cancel" disabled>취소</button>
    </div>
    <p class="conv-status sheet-split-status" role="status" aria-live="polite"></p>
    <ul class="conv-notes sheet-split-notes"></ul>
    <div class="conv-outputs conv-actions sheet-split-outputs" aria-label="나누기 결과"></div>
  `);

  merging(tool);
  splitting(tool);
  return tool;
}

// --- 일꾼 ---------------------------------------------------------------------

interface Job<T> { promise: Promise<T>; cancel: () => void }

function runWorker<T>(request: SheetToolRequest, transfer: ArrayBuffer[]): Job<T> {
  let cancel: () => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL('./sheet-tools.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = (): void => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('60초 제한을 넘었습니다. 파일이나 시트를 줄여 주세요.')); }, TIMEOUT);
    cancel = () => { cleanup(); reject(new Error('취소했습니다.')); };
    worker.onmessage = (event: MessageEvent<{ result?: T; error?: string }>) => {
      cleanup();
      if (event.data.error !== undefined) reject(new Error(event.data.error));
      else resolve(event.data.result as T);
    };
    worker.onerror = () => { cleanup(); reject(new Error('표 엔진을 실행하지 못했습니다. 새로고침한 뒤 다시 해 주세요.')); };
    worker.postMessage(request, transfer);
  });
  return { promise, cancel };
}

async function sources(files: File[]): Promise<{ list: { name: string; bytes: Uint8Array }[]; transfer: ArrayBuffer[] }> {
  const list = await Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
  return { list, transfer: list.map(source => source.bytes.buffer as ArrayBuffer) };
}

function check(file: File): string | undefined {
  const ext = file.name.split('.').pop()!.toLowerCase();
  if (!INPUTS.includes(ext)) return `${file.name}: CSV·TSV·XLSX·XLSM·XLS·ODS 만 받습니다.`;
  if (!file.size) return `${file.name}: 빈 파일입니다.`;
  if (file.size > MAX_FILE) return `${file.name}: 파일당 16MB 까지 받습니다.`;
  return undefined;
}

function showResult(result: ToolResult, notes: HTMLElement, links: Outputs): void {
  notes.replaceChildren(...result.notes.map(note => {
    const li = document.createElement('li');
    li.textContent = note;
    return li;
  }));
  for (const file of result.files) links.add(file.bytes, file.name, file.mime);
}

// --- 합치기 -------------------------------------------------------------------

interface Entry { file: File; info?: FileInfo; sheet: string }

function merging(tool: HTMLElement): void {
  const input = need<HTMLInputElement>(tool, '#sheet-merge-file');
  const list = need<HTMLElement>(tool, '.sheet-merge-list');
  const addSource = need<HTMLInputElement>(tool, '#sheet-merge-source');
  const format = need<HTMLSelectElement>(tool, '#sheet-merge-format');
  const run = need<HTMLButtonElement>(tool, '.sheet-merge-run');
  const cancel = need<HTMLButtonElement>(tool, '.sheet-merge-cancel');
  const reset = need<HTMLButtonElement>(tool, '.sheet-merge-reset');
  const say = statusLine(need(tool, '.sheet-merge-status'));
  const notes = need<HTMLElement>(tool, '.sheet-merge-notes');
  const links = outputs(need(tool, '.sheet-merge-outputs'));
  const modes = [...tool.querySelectorAll<HTMLInputElement>('input[name="sheet-merge-mode"]')];

  let entries: Entry[] = [];
  let busy = false;
  let job: Job<unknown> | undefined;

  const mode = (): MergeOptions['mode'] => (modes.find(radio => radio.checked)?.value ?? 'append') as MergeOptions['mode'];
  const clearResult = (): void => { links.clear(); notes.replaceChildren(); };

  const render = (): void => {
    const sheetsMode = mode() === 'sheets';
    addSource.disabled = sheetsMode || busy;
    // 파일마다 시트 하나는 CSV 에 담을 수 없다. 고르지 못하게 막는다.
    const csv = format.querySelector<HTMLOptionElement>('option[value="csv"]')!;
    csv.disabled = sheetsMode;
    if (sheetsMode) format.value = 'xlsx';
    run.disabled = busy || !entries.length || entries.some(entry => !entry.info);
    list.replaceChildren(...entries.map((entry, index) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${index + 1}. ${entry.file.name} (${size(entry.file.size)})`;
      li.append(name);
      if (entry.info) {
        const select = document.createElement('select');
        select.setAttribute('aria-label', `${entry.file.name} 에서 쓸 시트`);
        for (const sheet of entry.info.sheets) select.add(new Option(`${sheet.name} (${comma(sheet.rows)}줄)`, sheet.name));
        if (entry.info.sheets.length > 1) select.add(new Option('모든 시트', ALL_SHEETS));
        select.value = entry.sheet || entry.info.sheets[0]?.name || '';
        select.disabled = busy || entry.info.sheets.length < 2;
        select.addEventListener('change', () => { entry.sheet = select.value; clearResult(); });
        li.append(select);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '빼기';
      remove.disabled = busy;
      remove.setAttribute('aria-label', `${entry.file.name} 빼기`);
      remove.addEventListener('click', () => { entries.splice(index, 1); clearResult(); render(); });
      li.append(remove);
      return li;
    }));
  };

  const add = async (added: File[]): Promise<void> => {
    if (busy) return;
    const problem = added.map(check).find(Boolean);
    if (problem) { say(problem, 'error'); return; }
    if (entries.length + added.length > MAX_FILES) { say(`파일은 ${MAX_FILES}개까지 합칩니다.`, 'error'); return; }
    const fresh = added.map(file => ({ file, sheet: '' }) as Entry);
    entries.push(...fresh);
    clearResult();
    await work(`${added.length}개 파일의 시트를 살피는 중…`, async () => {
      const { list: payload, transfer } = await sources(added);
      job = runWorker<FileInfo[]>({ type: 'inspect', sources: payload }, transfer);
      const infos = (await job.promise) as FileInfo[];
      fresh.forEach((entry, i) => { entry.info = infos[i]!; });
      const read = infos.flatMap(info => info.notes);
      notes.replaceChildren(...read.map(note => { const li = document.createElement('li'); li.textContent = note; return li; }));
      say(`${entries.length}개 파일 · 시트를 고른 뒤 합치기를 누르세요.`);
    }, () => { entries = entries.filter(entry => !fresh.includes(entry)); });
  };

  /** 일꾼을 부르는 동안 화면을 묶어 둔다. 실패하면 `undo` 로 되돌린다. */
  const work = async (message: string, task: () => Promise<void>, undo?: () => void): Promise<void> => {
    busy = true;
    cancel.disabled = false;
    say(message);
    render();
    try {
      await task();
    } catch (error) {
      undo?.();
      clearResult();
      say(reason(error), 'error');
    } finally {
      busy = false;
      job = undefined;
      cancel.disabled = true;
      render();
    }
  };

  filePicker(input, files => { void add(files); }, () => busy);
  for (const radio of modes) radio.addEventListener('change', () => { clearResult(); render(); });
  addSource.addEventListener('change', clearResult);
  format.addEventListener('change', clearResult);
  cancel.addEventListener('click', () => job?.cancel());
  reset.addEventListener('click', () => {
    if (busy) return;
    entries = [];
    clearResult();
    say('');
    render();
  });

  run.addEventListener('click', () => {
    void work('합치는 중…', async () => {
      clearResult();
      const { list: payload, transfer } = await sources(entries.map(entry => entry.file));
      const options: MergeOptions = {
        sheets: entries.map(entry => entry.sheet),
        mode: mode(),
        addSource: addSource.checked && mode() === 'append',
        format: format.value as OutputFormat,
      };
      job = runWorker<ToolResult>({ type: 'merge', sources: payload, options }, transfer);
      const result = (await job.promise) as ToolResult;
      showResult(result, notes, links);
      say('합쳤습니다. 내려받아 머리글과 줄 수를 확인한 뒤 쓰세요.', 'ok');
    });
  });

  render();
}

// --- 나누기 -------------------------------------------------------------------

function splitting(tool: HTMLElement): void {
  const input = need<HTMLInputElement>(tool, '#sheet-split-file');
  const form = need<HTMLElement>(tool, '.sheet-split-form');
  const sheetSelect = need<HTMLSelectElement>(tool, '#sheet-split-sheet');
  const by = need<HTMLSelectElement>(tool, '#sheet-split-by');
  const rows = need<HTMLInputElement>(tool, '#sheet-split-rows');
  const rowsLabel = need<HTMLElement>(tool, '.sheet-split-rows-label');
  const column = need<HTMLSelectElement>(tool, '#sheet-split-column');
  const columnLabel = need<HTMLElement>(tool, '.sheet-split-column-label');
  const format = need<HTMLSelectElement>(tool, '#sheet-split-format');
  const run = need<HTMLButtonElement>(tool, '.sheet-split-run');
  const cancel = need<HTMLButtonElement>(tool, '.sheet-split-cancel');
  const say: Say = statusLine(need(tool, '.sheet-split-status'));
  const notes = need<HTMLElement>(tool, '.sheet-split-notes');
  const links = outputs(need(tool, '.sheet-split-outputs'));

  let file: File | undefined;
  let info: FileInfo | undefined;
  let busy = false;
  let job: Job<unknown> | undefined;

  const clearResult = (): void => { links.clear(); notes.replaceChildren(); };

  const fillColumns = (): void => {
    const sheet = info?.sheets.find(s => s.name === sheetSelect.value);
    const headers = sheet?.headers ?? [];
    column.replaceChildren(...headers.map((name, i) => new Option(`${i + 1}. ${name || '(이름 없는 열)'}`, String(i))));
    render();
  };

  const render = (): void => {
    const byColumn = by.value === 'column';
    rows.hidden = byColumn;
    rowsLabel.hidden = byColumn;
    column.hidden = !byColumn;
    columnLabel.hidden = !byColumn;
    form.hidden = !info;
    for (const element of [sheetSelect, by, rows, column, format]) element.disabled = busy;
    const sheet = info?.sheets.find(s => s.name === sheetSelect.value);
    run.disabled = busy || !file || !info || !sheet || (byColumn && !column.options.length);
    cancel.disabled = !busy;
  };

  const work = async (message: string, task: () => Promise<void>): Promise<void> => {
    busy = true;
    say(message);
    render();
    try {
      await task();
    } catch (error) {
      clearResult();
      say(reason(error), 'error');
    } finally {
      busy = false;
      job = undefined;
      render();
    }
  };

  filePicker(input, files => {
    const chosen = files[0];
    if (!chosen || busy) return;
    const problem = check(chosen);
    if (problem) { say(problem, 'error'); return; }
    clearResult();
    file = chosen;
    info = undefined;
    void work(`${chosen.name} 의 시트를 살피는 중…`, async () => {
      const { list: payload, transfer } = await sources([chosen]);
      job = runWorker<FileInfo[]>({ type: 'inspect', sources: payload }, transfer);
      const [found] = (await job.promise) as FileInfo[];
      if (!found?.sheets.length) throw new Error('시트가 없습니다.');
      info = found;
      sheetSelect.replaceChildren(...found.sheets.map(sheet => new Option(`${sheet.name} (${comma(sheet.rows)}줄)`, sheet.name)));
      fillColumns();
      notes.replaceChildren(...found.notes.map(note => { const li = document.createElement('li'); li.textContent = note; return li; }));
      say(`${chosen.name} · 기준을 고른 뒤 나누기를 누르세요.`);
    }).then(() => { if (!info) file = undefined; render(); });
  }, () => busy);

  sheetSelect.addEventListener('change', () => { clearResult(); fillColumns(); });
  for (const element of [by, rows, column, format]) element.addEventListener('change', () => { clearResult(); render(); });
  cancel.addEventListener('click', () => job?.cancel());

  run.addEventListener('click', () => {
    if (!file) return;
    const perFile = Number(rows.value);
    if (by.value === 'rows' && (!Number.isInteger(perFile) || perFile < 1)) { say('한 파일의 줄 수는 1 이상의 정수로 적어 주세요.', 'error'); return; }
    const target = file;
    void work('나누는 중…', async () => {
      clearResult();
      const { list: payload, transfer } = await sources([target]);
      const options: SplitOptions = {
        sheet: sheetSelect.value,
        by: by.value as SplitOptions['by'],
        size: perFile,
        column: Number(column.value || 0),
        format: format.value as OutputFormat,
      };
      job = runWorker<ToolResult>({ type: 'split', source: payload[0]!, options }, transfer);
      showResult((await job.promise) as ToolResult, notes, links);
      say('나눴습니다. ZIP 을 풀어 확인한 뒤 쓰세요.', 'ok');
    });
  });

  render();
}
