/**
 * 엑셀 숫자 고치기 — 엑셀이 없는 곳(휴대폰)에서 견적서의 숫자 몇 칸을 급히 고친다.
 *
 * 화면은 시트를 표로 보여 주고, 숫자 칸을 누르면 그 자리에서 고친다. 고칠 때마다 그
 * 칸을 읽는 수식(금액·합계·부가세)을 다시 계산해 바로 보여 준다(`sheet-recalc.ts`).
 * 저장은 원본을 새로 쓰지 않고 바뀐 칸의 값만 덮어쓴다(`xls-patch.ts`, `xlsx-patch.ts`)
 * — 회사 양식이 그대로 남아야 남에게 보낼 수 있다.
 */
import * as XLSX from 'xlsx';

import { reason } from '../../shared/errors';
import { comma, filePicker, need, outputs, size, statusLine, stem, toolSection } from '../../shared/kit';
import type { CellValue } from './formula';
import { fromWorkbook, recalc, type Change, type Problem, type SheetModel } from './sheet-recalc';
import { patchXls } from './xls-patch';
import { patchXlsx } from './xlsx-patch';

const LIMITS = { bytes: 20 * 1024 * 1024, rows: 300, cols: 30 };
const XLS_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

const show = (value: CellValue): string =>
  value === null ? '' : typeof value === 'number' ? comma(value) : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE')
    : typeof value === 'object' ? value.error : value;

export function sheetEditTool(): HTMLElement {
  const tool = toolSection('conv-sheet-edit', `
    <h2>엑셀 숫자 고치기</h2>
    <p class="conv-note">견적서·명세서(.xls·.xlsx)의 <strong>숫자 칸</strong>을 고치면 합계·부가세 같은 수식 칸도 다시 계산해 넣습니다.
      양식(글꼴·테두리·병합·인쇄 설정)은 원본 그대로 두고 고친 칸의 값만 바꿉니다. 파일은 이 기기를 벗어나지 않습니다. 20MB까지.</p>
    <details class="conv-more"><summary>안 되는 것</summary>
      <ul class="conv-notes">
        <li>글자 칸, 빈 칸에 숫자 넣기, 행·열 더하기, 서식 바꾸기.</li>
        <li>계산할 줄 모르는 수식(한글 금액 NUMBERSTRING 등)은 고치지 않고 알립니다. 엑셀에서 열면 다시 계산되도록 표시하지만, 휴대폰 미리보기에는 옛 값이 보일 수 있습니다.</li>
        <li>.xls 의 숫자 칸 일부는 파일 구조상 정수 ±5억·소수 둘째 자리까지만 담깁니다.</li>
        <li>암호가 걸린 파일, 엑셀 95 이전 형식.</li>
      </ul>
    </details>
    <label class="conv-drop" for="sheet-edit-file">
      <input id="sheet-edit-file" type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      <span>엑셀 파일(.xls·.xlsx)을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <div class="conv-results">
      <p class="conv-status" role="status" aria-live="polite"></p>
      <ul class="sheet-edit-changes" aria-label="바뀌는 칸"></ul>
      <ul class="conv-notes sheet-edit-problems" aria-label="확인할 칸"></ul>
      <div class="conv-outputs conv-actions sheet-edit-outputs" aria-label="저장 결과"></div>
    </div>
    <div class="conv-actions sheet-edit-bar" hidden>
      <label>시트 <select id="sheet-edit-sheet"></select></label>
      <button type="button" class="conv-download" data-action="save" disabled>고친 파일 저장</button>
      <button type="button" data-action="undo" disabled>모두 되돌리기</button>
    </div>
    <p class="conv-note sheet-edit-hint" hidden>밑줄 친 숫자 칸을 눌러 고치세요. 수식 칸은 고친 칸을 따라 저절로 바뀝니다.</p>
    <div class="sheet-edit-grid-wrap" hidden><table class="sheet-edit-grid"></table></div>
  `);

  const input = need<HTMLInputElement>(tool, '#sheet-edit-file');
  const say = statusLine(need(tool, '.conv-status'));
  const changeList = need<HTMLUListElement>(tool, '.sheet-edit-changes');
  const problemList = need<HTMLUListElement>(tool, '.sheet-edit-problems');
  const out = outputs(need(tool, '.sheet-edit-outputs'));
  const bar = need<HTMLElement>(tool, '.sheet-edit-bar');
  const hint = need<HTMLElement>(tool, '.sheet-edit-hint');
  const sheetSelect = need<HTMLSelectElement>(tool, '#sheet-edit-sheet');
  const saveButton = need<HTMLButtonElement>(tool, '[data-action="save"]');
  const undoButton = need<HTMLButtonElement>(tool, '[data-action="undo"]');
  const gridWrap = need<HTMLElement>(tool, '.sheet-edit-grid-wrap');
  const grid = need<HTMLTableElement>(tool, '.sheet-edit-grid');

  let file: { name: string; bytes: Uint8Array; xls: boolean } | null = null;
  let workbook: XLSX.WorkBook | null = null;
  let model: SheetModel[] = [];
  const edits = new Map<string, number>(); // `${sheet}!${address}` → 새 값
  let result: { changes: Change[]; problems: Problem[] } = { changes: [], problems: [] };

  const keyOf = (sheet: string, address: string): string => `${sheet}!${address}`;
  // 고치는 중에 다른 칸을 누르면, 먼저 고친 칸을 반영하느라 표를 다시 그려 그 누름이
  // 사라진다. 누른 칸을 기억해 두었다가 다시 그린 뒤 이어서 연다.
  let pending: string | null = null;
  grid.addEventListener('pointerdown', event => {
    pending = (event.target as HTMLElement).closest<HTMLButtonElement>('.sheet-cell')?.dataset['address'] ?? null;
  });

  const refreshSummary = (): void => {
    changeList.replaceChildren();
    problemList.replaceChildren();
    for (const change of result.changes) {
      const li = document.createElement('li');
      li.textContent = `${change.sheet} ${change.address}${change.formula ? ' (수식)' : ''}: ${show(change.before)} → ${show(change.after)}`;
      changeList.append(li);
    }
    for (const problem of result.problems) {
      const li = document.createElement('li');
      li.textContent = `${problem.sheet} ${problem.address}: ${problem.reason}`;
      problemList.append(li);
    }
    saveButton.disabled = edits.size === 0;
    undoButton.disabled = edits.size === 0;
  };

  const recompute = (): void => {
    result = recalc(model, [...edits].map(([k, value]) => {
      const at = k.lastIndexOf('!');
      return { sheet: k.slice(0, at), address: k.slice(at + 1), value };
    }));
    out.clear();
    refreshSummary();
    renderGrid();
  };

  /** 칸에 보일 글자. 고쳤거나 다시 계산한 칸은 원래 칸의 숫자 꼴(z)로 새 값을 적는다. */
  const textOf = (sheetName: string, address: string, cell: XLSX.CellObject | undefined): { text: string; state: '' | 'edited' | 'changed' } => {
    const change = result.changes.find(c => c.sheet === sheetName && c.address === address);
    if (!change) return { text: cell?.w ?? (cell?.v === undefined ? '' : String(cell.v)), state: '' };
    let text = show(change.after);
    if (typeof change.after === 'number' && cell?.z) {
      try { text = XLSX.SSF.format(cell.z, change.after); } catch { /* 모르는 꼴이면 쉼표 숫자로 */ }
    }
    return { text, state: change.formula ? 'changed' : 'edited' };
  };

  const renderGrid = (): void => {
    if (!workbook) return;
    const sheetName = sheetSelect.value;
    const sheet = workbook.Sheets[sheetName];
    grid.replaceChildren();
    if (!sheet?.['!ref']) { say(`${sheetName} 시트가 비어 있습니다.`); return; }
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const lastRow = Math.min(range.e.r, range.s.r + LIMITS.rows - 1);
    const lastCol = Math.min(range.e.c, range.s.c + LIMITS.cols - 1);
    const covered = new Set<string>();
    const spans = new Map<string, { rows: number; cols: number }>();
    for (const merge of sheet['!merges'] ?? []) {
      spans.set(XLSX.utils.encode_cell(merge.s), { rows: merge.e.r - merge.s.r + 1, cols: merge.e.c - merge.s.c + 1 });
      for (let r = merge.s.r; r <= merge.e.r; r++) for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (r !== merge.s.r || c !== merge.s.c) covered.add(XLSX.utils.encode_cell({ r, c }));
      }
    }
    const head = document.createElement('tr');
    head.append(document.createElement('th'));
    for (let c = range.s.c; c <= lastCol; c++) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = XLSX.utils.encode_col(c);
      head.append(th);
    }
    const thead = document.createElement('thead');
    thead.append(head);
    const tbody = document.createElement('tbody');
    for (let r = range.s.r; r <= lastRow; r++) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = String(r + 1);
      tr.append(th);
      for (let c = range.s.c; c <= lastCol; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        if (covered.has(address)) continue;
        const td = document.createElement('td');
        const span = spans.get(address);
        if (span) { td.rowSpan = span.rows; td.colSpan = span.cols; }
        const cell = sheet[address] as XLSX.CellObject | undefined;
        const { text, state } = textOf(sheetName, address, cell);
        if (state) td.dataset['state'] = state;
        if (cell?.f) td.classList.add('is-formula');
        if (cell && cell.t === 'n' && !cell.f) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'sheet-cell';
          button.dataset['address'] = address;
          button.textContent = text;
          button.setAttribute('aria-label', `${address} ${text} 고치기`);
          button.addEventListener('click', () => startEdit(td, sheetName, address, cell));
          td.append(button);
        } else td.textContent = text;
        if (typeof cell?.v === 'number' || cell?.t === 'n') td.classList.add('num');
        tr.append(td);
      }
      tbody.append(tr);
    }
    grid.append(thead, tbody);
    if (range.e.r > lastRow || range.e.c > lastCol) say(`이 시트는 ${LIMITS.rows}줄·${LIMITS.cols}열까지만 보여 줍니다.`);
  };

  const startEdit = (td: HTMLTableCellElement, sheetName: string, address: string, cell: XLSX.CellObject): void => {
    const current = edits.get(keyOf(sheetName, address)) ?? Number(cell.v);
    const field = document.createElement('input');
    field.type = 'text';
    field.inputMode = 'decimal';
    field.className = 'sheet-cell-input';
    field.value = String(current);
    field.setAttribute('aria-label', `${address} 새 값`);
    let finished = false;
    const finish = (keep: boolean): void => {
      if (finished) return;
      finished = true;
      if (keep) {
        const text = field.value.replace(/[,\s원]/g, '');
        const value = Number(text);
        if (text === '' || !Number.isFinite(value)) { say(`${address}: 숫자로 적어 주세요.`, 'error'); renderGrid(); return; }
        const original = Number(cell.v);
        if (value === original) edits.delete(keyOf(sheetName, address)); else edits.set(keyOf(sheetName, address), value);
        recompute();
        say(edits.size ? `고친 칸 ${edits.size}개 · 바뀌는 수식 칸 ${result.changes.filter(c => c.formula).length}개. 다 고쳤으면 "고친 파일 저장"을 누르세요.` : '');
      } else renderGrid();
      const next = pending && pending !== address ? pending : null;
      pending = null;
      if (next) grid.querySelector<HTMLButtonElement>(`.sheet-cell[data-address="${next}"]`)?.click();
      else grid.querySelector<HTMLButtonElement>(`.sheet-cell[data-address="${address}"]`)?.focus({ preventScroll: true });
    };
    field.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    field.addEventListener('blur', () => finish(true));
    td.replaceChildren(field);
    field.focus();
    field.select();
  };

  const open = async (picked: File[]): Promise<void> => {
    const chosen = picked[0];
    if (!chosen) return;
    out.clear();
    edits.clear();
    result = { changes: [], problems: [] };
    refreshSummary();
    if (!/\.(xls|xlsx)$/i.test(chosen.name)) { say('.xls 나 .xlsx 파일만 고칠 수 있습니다.', 'error'); return; }
    if (chosen.size > LIMITS.bytes) { say(`파일이 너무 큽니다(${size(chosen.size)}). 20MB까지 엽니다.`, 'error'); return; }
    say(`${chosen.name} 읽는 중…`);
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      const xls = XLS_SIGNATURE.every((b, i) => bytes[i] === b);
      workbook = XLSX.read(bytes, { cellFormula: true, cellNF: true, cellDates: false, dense: false });
      model = fromWorkbook(workbook);
      file = { name: chosen.name, bytes, xls };
      sheetSelect.replaceChildren(...workbook.SheetNames.map(name => new Option(name, name)));
      bar.hidden = false;
      hint.hidden = false;
      gridWrap.hidden = false;
      renderGrid();
      const formulas = model.reduce((n, sheet) => n + [...sheet.cells.values()].filter(c => c.formula).length, 0);
      say(`${chosen.name} · 시트 ${workbook.SheetNames.length}개 · 수식 칸 ${formulas}개. 숫자 칸을 눌러 고치세요.`, 'ok');
    } catch (error) {
      workbook = null; file = null;
      bar.hidden = true; hint.hidden = true; gridWrap.hidden = true;
      say(`열지 못했습니다: ${reason(error)}`, 'error');
    }
  };

  filePicker(input, files => { void open(files); });
  sheetSelect.addEventListener('change', renderGrid);
  undoButton.addEventListener('click', () => { edits.clear(); recompute(); say('고친 것을 모두 되돌렸습니다.'); });
  saveButton.addEventListener('click', () => {
    if (!file || !edits.size) return;
    try {
      const writes = result.changes.map(change => ({ sheet: change.sheet, address: change.address, value: change.after }));
      const patched = file.xls ? patchXls(file.bytes, writes) : patchXlsx(file.bytes, writes);
      const all = [...result.problems, ...patched.problems];
      problemList.replaceChildren(...all.map(problem => {
        const li = document.createElement('li');
        li.textContent = `${problem.sheet} ${problem.address}: ${problem.reason}`;
        return li;
      }));
      out.clear();
      const ext = file.xls ? 'xls' : 'xlsx';
      out.add(patched.bytes, `${stem(file.name)}-고침.${ext}`,
        file.xls ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const written = writes.length - patched.problems.length;
      say(all.length
        ? `${written}칸을 담았습니다. 아래 "확인할 칸"을 꼭 보세요.`
        : `${written}칸(고친 칸 ${edits.size}개와 다시 계산한 칸)을 담았습니다. 아래 링크로 내려받으세요.`, all.length ? 'error' : 'ok');
    } catch (error) { say(`저장하지 못했습니다: ${reason(error)}`, 'error'); }
  });

  return tool;
}
