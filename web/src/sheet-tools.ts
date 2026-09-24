/**
 * 표 합치기·나누기 — 일꾼(sheet-tools.worker.ts) 안에서 도는 쪽.
 *
 * SheetJS 는 무거워서 화면 묶음에 넣지 않는다. 이 파일은 일꾼만 부르고,
 * 시험(vitest)은 node 에서 그대로 부른다.
 *
 * 지키는 것:
 *   - CSV 는 인코딩을 가려 읽는다. 한국어 엑셀이 저장한 CSV 는 BOM 없는 CP949 다.
 *     칸은 글자로 읽어 앞자리 0(우편번호·사번)을 지킨다.
 *   - 머리글이 다른 파일을 이어 붙일 때 열 **자리**가 아니라 **이름**으로 맞춘다.
 *     자리로 붙이면 "단가" 아래에 "수량" 이 조용히 들어간다 — 이 도구에서 가장 나쁜 실패다.
 *     머리글이 달랐던 파일은 알린다.
 *   - 수식은 저장된 계산값만 옮긴다(다시 계산하지 않는다).
 *   - CSV 로 낼 때 =·+·-·@ 로 시작하는 글자 앞에 작은따옴표를 붙여 엑셀이 수식으로
 *     실행하지 않게 한다(spreadsheet-formats.ts 와 같은 규칙).
 */
import { zipSync } from 'fflate';
import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';

import { decodeText, ENCODING_NAMES } from './encoding';
import { readZip } from './zip';

XLSX.set_cptable(cptable);

export const SHEET_LIMITS = {
  fileBytes: 16 * 1024 * 1024,
  files: 50,
  cells: 500_000,
  parts: 500,
  output: 32 * 1024 * 1024,
};
export const SHEET_TOOL_INPUTS = ['csv', 'tsv', 'xlsx', 'xlsm', 'xls', 'ods'];
export const EMPTY_KEY = '(빈 값)';
export const SOURCE_COLUMN = '원본 파일';
/** 고른 시트 자리에 이 값이 오면 그 통합문서의 시트를 모두 쓴다. */
export const ALL_SHEETS = '*';

export type Cell = string | number | boolean | Date | null;
export type Row = Cell[];
export type OutputFormat = 'xlsx' | 'csv';

export interface Source { name: string; bytes: Uint8Array }
export interface OutFile { name: string; bytes: Uint8Array; mime: string }
export interface ToolResult { files: OutFile[]; notes: string[] }

export interface SheetInfo { name: string; headers: string[]; rows: number }
export interface FileInfo { name: string; sheets: SheetInfo[]; notes: string[] }

export interface MergeOptions {
  /** 파일마다 고른 시트 이름. 비우면 첫 시트, ALL_SHEETS 면 모두. */
  sheets: string[];
  mode: 'append' | 'sheets';
  addSource: boolean;
  format: OutputFormat;
}

export interface SplitOptions {
  sheet: string;
  by: 'rows' | 'column';
  /** by = rows 일 때 한 파일의 데이터 행 수(머리글 빼고). */
  size: number;
  /** by = column 일 때 머리글에서의 열 번호(0부터). */
  column: number;
  format: OutputFormat;
}

export const extOf = (name: string): string => name.split('.').pop()!.toLowerCase();
const stemOf = (name: string): string => name.replace(/(?<=.)\.[^.]*$/, '');

// --- 읽기 ---------------------------------------------------------------------

export async function readBook(source: Source, notes: string[] = []): Promise<XLSX.WorkBook> {
  const ext = extOf(source.name);
  if (!SHEET_TOOL_INPUTS.includes(ext)) throw new Error(`${source.name}: CSV·TSV·XLSX·XLSM·XLS·ODS 만 받습니다.`);
  if (!source.bytes.length) throw new Error(`${source.name}: 빈 파일입니다.`);
  if (source.bytes.length > SHEET_LIMITS.fileBytes) throw new Error(`${source.name}: 파일당 16MB 까지 받습니다.`);
  if (ext === 'csv' || ext === 'tsv') {
    const decoded = decodeText(source.bytes);
    if (!decoded.certain) notes.push(`${source.name}: BOM 이 없어 ${ENCODING_NAMES[decoded.encoding]} 로 추정해 읽었습니다. 글자가 깨졌으면 알려 주세요.`);
    // raw: 칸을 글자 그대로 둔다 — "007" 이 7 이 되지 않고, "1-2" 가 날짜가 되지 않는다.
    return XLSX.read(decoded.text, { type: 'string', raw: true, FS: ext === 'tsv' ? '\t' : ',', cellFormula: false });
  }
  // XLSX·ODS 는 ZIP 이다. 푸는 크기를 먼저 재어 압축 폭탄을 거른다.
  if (source.bytes[0] === 0x50 && source.bytes[1] === 0x4b) await readZip(source.bytes, { maxEntries: 3000, maxSize: 32 * 1024 * 1024 });
  return XLSX.read(source.bytes, {
    type: 'array', cellFormula: false, cellDates: true, cellHTML: false, cellStyles: false, bookVBA: false,
  });
}

/** 시트 영역의 칸 수. 실제 값을 펼치기 전에 재어 큰 시트를 미리 거른다. */
export function sheetArea(sheet: XLSX.WorkSheet): number {
  if (!sheet['!ref']) return 0;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  return (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
}

/** 빈 줄은 뺀다. 줄 끝의 빈 칸은 떼어 머리글보다 길어 보이지 않게 한다. */
export function sheetRows(sheet: XLSX.WorkSheet): Row[] {
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  return rows.map(row => {
    let end = row.length;
    while (end > 0 && isBlank(row[end - 1])) end--;
    return row.slice(0, end).map(cell => cell === undefined ? null : cell);
  }).filter(row => row.length);
}

const isBlank = (cell: Cell | undefined): boolean => cell === null || cell === undefined || (typeof cell === 'string' && !cell.trim());

/** 셀을 글자로 — 머리글 견주기, 나누기 기준값, CSV 에 쓴다. */
export function cellText(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    const p = (n: number): string => String(n).padStart(2, '0');
    const day = `${cell.getFullYear()}-${p(cell.getMonth() + 1)}-${p(cell.getDate())}`;
    const time = cell.getHours() || cell.getMinutes() || cell.getSeconds() ? ` ${p(cell.getHours())}:${p(cell.getMinutes())}:${p(cell.getSeconds())}` : '';
    return day + time;
  }
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  return String(cell);
}

// --- 합치기 -------------------------------------------------------------------

export interface Table { label: string; rows: Row[] }

export interface Merged { rows: Row[]; differing: string[]; empty: string[] }

/**
 * 한 시트로 이어 붙인다. 첫 표의 머리글이 기준이고, 같은 머리글은 떼고 붙인다.
 * 머리글이 다르면 이름으로 열을 맞추고 없던 이름은 오른쪽에 새 열로 더한다.
 * 같은 이름이 한 표에 두 번 나오면 몇 번째인지까지 보고 맞춘다.
 */
export function mergeTables(tables: Table[], addSource = false): Merged {
  const differing: string[] = [];
  const empty: string[] = [];
  let first: string[] | undefined;
  const keys: string[] = [];
  const names: string[] = [];
  const body: { label: string; row: Row }[] = [];

  for (const table of tables) {
    if (!table.rows.length) { empty.push(table.label); continue; }
    const width = table.rows.reduce((max, row) => Math.max(max, row.length), 0);
    const header = Array.from({ length: width }, (_, i) => cellText(table.rows[0]![i]).trim());
    const own = occurrenceKeys(header);
    if (!first) first = header;
    else if (header.length !== first.length || header.some((name, i) => name !== first![i])) differing.push(table.label);
    const map = own.map((key, i) => {
      let at = keys.indexOf(key);
      if (at < 0) { at = keys.length; keys.push(key); names.push(header[i]!); }
      return at;
    });
    for (const row of table.rows.slice(1)) {
      const out: Row = [];
      row.forEach((cell, i) => { out[map[i]!] = cell; });
      body.push({ label: table.label, row: out });
    }
  }
  if (!first) return { rows: [], differing, empty };
  const pad = (row: Row): Row => Array.from({ length: keys.length }, (_, i) => row[i] ?? null);
  const rows: Row[] = [addSource ? [SOURCE_COLUMN, ...names] : [...names]];
  for (const { label, row } of body) rows.push(addSource ? [label, ...pad(row)] : pad(row));
  return { rows, differing, empty };
}

function occurrenceKeys(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map(name => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return `${name}\u0000${n}`;
  });
}

/**
 * 엑셀 시트 이름으로. [ ] : * ? / \ 는 쓸 수 없고 31자까지이며, 작은따옴표로
 * 시작하거나 끝날 수 없다. 대소문자를 가리지 않고 겹치면 " (2)" 를 붙인다.
 */
export function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[[\]:*?/\\\u0000-\u001f]/g, '_').replace(/^'+|'+$/g, '').trim() || 'Sheet';
  if (base.toLowerCase() === 'history') base = 'History_';
  const cut = (text: string, max: number): string => Array.from(text).slice(0, max).join('');
  let name = cut(base, 31);
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = cut(base, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

interface Picked { source: Source; sheet: string; rows: Row[] }

/** 파일마다 고른 시트를 펼친다. 칸 수 한도는 펼치기 전에 영역으로 잰다. */
async function pickTables(sources: Source[], choices: string[], notes: string[]): Promise<Picked[]> {
  if (!sources.length) throw new Error('파일을 골라 주세요.');
  if (sources.length > SHEET_LIMITS.files) throw new Error(`파일은 ${SHEET_LIMITS.files}개까지 합칩니다.`);
  let cells = 0;
  const picked: Picked[] = [];
  for (const [index, source] of sources.entries()) {
    const book = await readBook(source, notes);
    if (!book.SheetNames.length) throw new Error(`${source.name}: 시트가 없습니다.`);
    const choice = choices[index] ?? '';
    const names = choice === ALL_SHEETS ? book.SheetNames : [choice || book.SheetNames[0]!];
    for (const name of names) {
      const sheet = book.Sheets[name];
      if (!sheet) throw new Error(`${source.name}: "${name}" 시트가 없습니다.`);
      cells += sheetArea(sheet);
      if (cells > SHEET_LIMITS.cells) throw new Error('고른 시트의 영역이 합계 50만 칸을 넘습니다. 파일이나 시트를 줄여 주세요.');
      picked.push({ source, sheet: name, rows: sheetRows(sheet) });
    }
  }
  return picked;
}

export async function mergeSheets(sources: Source[], options: MergeOptions): Promise<ToolResult> {
  if (options.mode === 'sheets' && options.format !== 'xlsx') throw new Error('"파일마다 시트 하나로" 는 XLSX 로만 저장합니다 — CSV 는 시트를 하나만 담습니다.');
  const notes: string[] = [];
  const picked = await pickTables(sources, options.sheets, notes);
  // 한 파일에서 여러 시트를 고르면 시트 이름까지 붙여야 어디서 온 줄인지 안다.
  const perFile = new Map<Source, number>();
  for (const table of picked) perFile.set(table.source, (perFile.get(table.source) ?? 0) + 1);
  const label = (table: Picked): string => perFile.get(table.source)! > 1 ? `${table.source.name} · ${table.sheet}` : table.source.name;

  if (options.mode === 'sheets') {
    const used = new Set<string>();
    const sheets = picked.map(table => {
      const base = perFile.get(table.source)! > 1 ? `${stemOf(table.source.name)}-${table.sheet}` : stemOf(table.source.name);
      const name = sheetName(base, used);
      if (name !== base) notes.push(`"${label(table)}" 은 시트 이름 규칙에 맞춰 "${name}" 으로 적었습니다.`);
      return { name, rows: table.rows };
    });
    const empty = picked.filter(table => !table.rows.length).map(label);
    if (empty.length) notes.push(`빈 시트 ${empty.length}개: ${empty.join(', ')}`);
    return finish([{ name: '합친표.xlsx', bytes: writeXlsx(sheets), mime: XLSX_MIME }], [
      `${picked.length}개 시트를 한 통합문서에 담았습니다.`, ...notes, VALUES_NOTE,
    ]);
  }

  const merged = mergeTables(picked.map(table => ({ label: label(table), rows: table.rows })), options.addSource);
  if (!merged.rows.length) throw new Error('고른 시트가 모두 비어 있습니다.');
  const result: string[] = [`${picked.length - merged.empty.length}개 표를 이어 붙여 머리글 1줄 + 데이터 ${merged.rows.length - 1}줄이 되었습니다.`];
  if (merged.differing.length) {
    result.push(`머리글이 첫 표와 달라 열 이름으로 맞춘 표 ${merged.differing.length}개: ${merged.differing.join(', ')}. 없는 열은 빈 칸입니다 — 열 이름의 띄어쓰기·오타를 확인해 주세요.`);
  }
  if (merged.empty.length) result.push(`빈 시트라 건너뜀: ${merged.empty.join(', ')}`);
  result.push(...notes, VALUES_NOTE);
  const file = options.format === 'csv'
    ? { name: '합친표.csv', bytes: new TextEncoder().encode(toCsv(merged.rows)), mime: 'text/csv;charset=utf-8' }
    : { name: '합친표.xlsx', bytes: writeXlsx([{ name: 'Sheet1', rows: merged.rows }]), mime: XLSX_MIME };
  if (options.format === 'csv') result.push(CSV_NOTE);
  return finish([file], result);
}

// --- 나누기 -------------------------------------------------------------------

export interface Part { key: string; rows: Row[] }

/** 데이터 N줄씩. 모든 조각에 머리글을 다시 붙인다. */
export function splitByRows(rows: Row[], size: number): Part[] {
  if (!Number.isInteger(size) || size < 1) throw new Error('나눌 줄 수는 1 이상의 정수여야 합니다.');
  const [header, ...data] = rows;
  if (!header) return [];
  const parts: Part[] = [];
  for (let at = 0; at < data.length; at += size) parts.push({ key: String(parts.length + 1), rows: [header, ...data.slice(at, at + size)] });
  return parts;
}

/** 고른 열의 값마다 하나씩. 처음 나온 순서를 지키고, 빈 칸은 "(빈 값)" 으로 모은다. */
export function splitByColumn(rows: Row[], column: number): Part[] {
  const [header, ...data] = rows;
  if (!header) return [];
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (!Number.isInteger(column) || column < 0 || column >= width) throw new Error('나눌 기준 열을 골라 주세요.');
  const groups = new Map<string, Row[]>();
  for (const row of data) {
    const key = cellText(row[column]).trim() || EMPTY_KEY;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return [...groups].map(([key, list]) => ({ key, rows: [header, ...list] }));
}

/** 조각 파일 이름. 윈도우가 못 쓰는 글자를 바꾸고 겹치면 " (2)" 를 붙인다. */
export function partFileName(stem: string, key: string, ext: string, used: Set<string>): string {
  const clean = (text: string): string => text.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim();
  const cut = Array.from(`${clean(stem)}-${clean(key)}`).slice(0, 100).join('').replace(/[. ]+$/, '') || '조각';
  let name = `${cut}.${ext}`;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${cut} (${n}).${ext}`;
  used.add(name.toLowerCase());
  return name;
}

export async function splitSheet(source: Source, options: SplitOptions): Promise<ToolResult> {
  const notes: string[] = [];
  const [table] = await pickTables([source], [options.sheet], notes);
  const rows = table!.rows;
  if (rows.length < 2) throw new Error('나눌 데이터가 없습니다 — 머리글 아래에 줄이 있어야 합니다.');
  const parts = options.by === 'rows' ? splitByRows(rows, options.size) : splitByColumn(rows, options.column);
  if (parts.length > SHEET_LIMITS.parts) {
    throw new Error(`조각이 ${parts.length}개가 됩니다. 한 번에 ${SHEET_LIMITS.parts}개까지 만듭니다 — ${options.by === 'rows' ? '줄 수를 늘려' : '다른 열을 골라'} 주세요.`);
  }
  const stem = stemOf(source.name);
  const used = new Set<string>();
  const width = String(parts.length).length;
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const part of parts) {
    const key = options.by === 'rows' ? part.key.padStart(width, '0') : part.key;
    const name = partFileName(stem, key, options.format, used);
    const bytes = options.format === 'csv'
      ? new TextEncoder().encode(toCsv(part.rows))
      : writeXlsx([{ name: sheetName(options.by === 'rows' ? 'Sheet1' : part.key, new Set()), rows: part.rows }]);
    // XLSX 는 이미 압축돼 있어 다시 줄이지 않는다.
    entries[name] = [bytes, { level: options.format === 'xlsx' ? 0 : 6 }];
  }
  const zip = zipSync(entries);
  const header = options.by === 'column' ? cellText(rows[0]![options.column]).trim() || `${options.column + 1}번째 열` : '';
  const summary = options.by === 'rows'
    ? `데이터 ${rows.length - 1}줄을 ${options.size}줄씩 ${parts.length}개 파일로 나눴습니다. 파일마다 머리글을 다시 붙였습니다.`
    : `"${header}" 열의 값 ${parts.length}가지로 나눴습니다${parts.some(p => p.key === EMPTY_KEY) ? ` (빈 칸은 "${EMPTY_KEY}" 파일)` : ''}.`;
  const result = [summary, ...notes, VALUES_NOTE];
  if (options.format === 'csv') result.push(CSV_NOTE);
  return finish([{ name: `${stem}-나눔.zip`, bytes: zip, mime: 'application/zip' }], result);
}

// --- 살펴보기 -----------------------------------------------------------------

/** 시트 이름과 머리글(첫 줄)을 돌려준다. 화면이 시트·열 고르기를 채운다. */
export async function inspectSheets(sources: Source[]): Promise<FileInfo[]> {
  if (sources.length > SHEET_LIMITS.files) throw new Error(`파일은 ${SHEET_LIMITS.files}개까지 받습니다.`);
  const infos: FileInfo[] = [];
  for (const source of sources) {
    const notes: string[] = [];
    const book = await readBook(source, notes);
    const sheets = book.SheetNames.slice(0, 100).map(name => {
      const sheet = book.Sheets[name]!;
      const ref = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : undefined;
      // 머리글만 본다 — 첫 줄만 펼쳐 큰 시트에서도 빠르다.
      const headers = ref
        ? (XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, raw: true, defval: null, blankrows: false, range: { s: ref.s, e: { r: Math.min(ref.e.r, ref.s.r + 20), c: Math.min(ref.e.c, ref.s.c + 199) } } })[0] ?? []).map(cell => cellText(cell).trim())
        : [];
      return { name, headers, rows: ref ? ref.e.r - ref.s.r + 1 : 0 };
    });
    infos.push({ name: source.name, sheets, notes });
  }
  return infos;
}

// --- 쓰기 ---------------------------------------------------------------------

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const VALUES_NOTE = '수식은 저장된 계산값만 옮깁니다(다시 계산하지 않습니다). 서식·병합 셀·그림·메모는 옮기지 않고, 빈 줄은 뺍니다.';
export const CSV_NOTE = 'CSV 는 UTF-8(BOM) 로 저장했습니다. =·+·-·@ 로 시작하는 글자 앞에는 수식으로 실행되지 않게 작은따옴표를 붙였습니다.';

export function writeXlsx(sheets: { name: string; rows: Row[] }[]): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const { name, rows } of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows.length ? rows : [[]]), name);
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }));
}

/**
 * 엑셀이 수식으로 실행할 수 있는 글자를 막는다. 숫자 모양 글자(-5, +3.2)는 수식이
 * 될 수 없으니 그대로 둔다 — 음수 열 전체에 따옴표가 붙으면 숫자로 쓸 수 없다.
 */
export function guardFormula(text: string): string {
  if (/^[-+]?\d[\d,]*(\.\d+)?$/.test(text)) return text;
  return /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
}

export function toCsv(rows: Row[]): string {
  const field = (cell: Cell | undefined): string => {
    const text = typeof cell === 'string' ? guardFormula(cell) : cellText(cell);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${rows.map(row => row.map(field).join(',')).join('\r\n')}\r\n`;
}

function finish(files: OutFile[], notes: string[]): ToolResult {
  if (files.reduce((sum, file) => sum + file.bytes.length, 0) > SHEET_LIMITS.output) throw new Error('결과가 32MB 를 넘습니다. 파일을 나눠 주세요.');
  return { files, notes };
}
