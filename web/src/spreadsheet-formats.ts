import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import { readZip } from './zip';
import { escapeXml, MAX_INPUT, SHEET_INPUTS, SHEET_OUTPUTS, type ConversionFile } from './format-catalog';

XLSX.set_cptable(cptable);
export const SHEET_NOTE = '값·기본 셀·시트를 변환합니다. 서식·차트·그림·매크로·외부 연결은 보존하지 않습니다. 수식은 재계산하지 않으며 CSV·JSON 등에는 저장된 계산값만 나옵니다. 숨겨진 시트도 포함됩니다.';
export async function convertSpreadsheet(bytes: Uint8Array, name: string, output: string): Promise<{ files: ConversionFile[]; notes: string[] }> {
  if (!bytes.length || bytes.length > MAX_INPUT) throw new Error('입력은 1바이트~16MB까지 지원합니다.');
  const ext = name.split('.').pop()!.toLowerCase();
  if (!SHEET_INPUTS.includes(ext) || !SHEET_OUTPUTS.includes(output)) throw new Error('지원하지 않는 스프레드시트 형식입니다.');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) await readZip(bytes, { maxEntries: 3000, maxSize: 32 * 1024 * 1024 });
  let book: XLSX.WorkBook;
  const notes = [SHEET_NOTE];
  if (ext === 'json') {
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(data) || !data.length) throw new Error('JSON은 행 배열 또는 객체 배열이어야 합니다.');
    let sheet: XLSX.WorkSheet;
    const primitive = (v: unknown): boolean => v === null || ['string', 'number', 'boolean'].includes(typeof v);
    if (data.every(r => Array.isArray(r) && r.every(primitive))) sheet = XLSX.utils.aoa_to_sheet(data);
    else if (data.every(r => r && typeof r === 'object' && !Array.isArray(r) && Object.values(r).every(primitive))) sheet = XLSX.utils.json_to_sheet(data);
    else throw new Error('JSON의 셀에는 문자열·숫자·참/거짓·null만 넣을 수 있습니다. 중첩 객체는 지원하지 않습니다.');
    book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
  } else if (ext === 'csv' || ext === 'tsv') {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('CSV·TSV는 UTF-8로 바꾼 뒤 올려 주세요.'); }
    book = XLSX.read(text, { type: 'string', raw: true, FS: ext === 'tsv' ? '\t' : ',', cellFormula: false });
    notes.push('CSV·TSV는 앞자리 0과 긴 식별자를 지키기 위해 문자열로 읽습니다.');
  } else book = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true, cellHTML: false, cellStyles: false, bookVBA: false });
  if (!book.SheetNames.length || book.SheetNames.length > 100) throw new Error('시트는 1~100개까지 지원합니다.');
  let cells = 0, uncached = 0;
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name]!;
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const area = (range.e.r + 1) * (range.e.c + 1);
    cells += area;
    if (!Number.isSafeInteger(area) || cells > 500_000 || range.e.c >= 16384) throw new Error('시트 영역 합계가 50만 셀 한도를 초과했습니다.');
    for (const [key, cell] of Object.entries(sheet)) {
      if (key.startsWith('!') || !cell || typeof cell !== 'object') continue;
      if (cell.f && cell.v === undefined) uncached++;
      // Keep data and formulas; remove executable links / comments from all outputs.
      delete cell.l; delete cell.c; delete cell.h;
    }
    if (['xls', 'dif', 'sylk'].includes(output) && (range.e.r >= 65536 || range.e.c >= 256)) throw new Error('대상 형식의 행·열 한도를 넘습니다. XLSX 또는 ODS로 저장하세요.');
  }
  if (uncached) notes.push(`저장된 계산값이 없는 수식 ${uncached}개가 있습니다. 값 전용 형식에서는 빈 셀이 될 수 있습니다.`);
  const stem = name.replace(/\.[^.]+$/, ''); const files: ConversionFile[] = [];
  const encoder = new TextEncoder();
  if (['xlsx', 'xls', 'xlsb', 'ods', 'fods'].includes(output)) {
    files.push({ name: `${stem}.${output}`, bytes: new Uint8Array(XLSX.write(book, { type: 'array', bookType: output as XLSX.BookType, compression: true })), mime: 'application/octet-stream' });
  } else {
    for (const [index, sheetName] of book.SheetNames.entries()) {
      const sheet = book.Sheets[sheetName]!;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: true });
      let text: string; let mime = 'text/plain;charset=utf-8';
      if (output === 'json') { text = JSON.stringify(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true }), null, 2); mime = 'application/json'; }
      else if (output === 'html') {
        text = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><title>${escapeXml(sheetName)}</title></head><body><table>${rows.map(r => `<tr>${r.map(c => `<td>${escapeXml(String(c ?? ''))}</td>`).join('')}</tr>`).join('')}</table></body></html>`; mime = 'text/html;charset=utf-8';
      } else if (output === 'md') {
        const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
        const line = (r: unknown[]): string => `| ${Array.from({ length: width }, (_, i) => String(r[i] ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ').replace(/</g, '&lt;')).join(' | ')} |`;
        text = rows.map((r, i) => line(r) + (i === 0 ? '\n' + line(Array(width).fill('---')) : '')).join('\n'); mime = 'text/markdown;charset=utf-8';
      } else if (output === 'csv' || output === 'tsv') {
        // Safe by default when opened in Excel: text must not turn into formulas.
        const safe = rows.map(r => r.map(c => typeof c === 'string' && /^[=+@\-\t\r]/.test(c) ? `'${c}` : c));
        text = '\ufeff' + XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(safe), { FS: output === 'tsv' ? '\t' : ',' });
      } else {
        text = XLSX.write(book, { type: 'string', bookType: output as XLSX.BookType, sheet: sheetName });
        if (/[^\x00-\x7f]/.test(text)) throw new Error('DIF·SYLK 출력은 영문·숫자(ASCII)만 지원합니다. 한글은 XLSX·ODS·CSV로 저장해 주세요.');
      }
      const safeName = sheetName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80);
      files.push({ name: `${stem}-${index + 1}-${safeName}.${output === 'sylk' ? 'slk' : output}`, bytes: encoder.encode(text), mime });
    }
    notes.push('시트마다 파일을 만듭니다. 여러 시트는 ZIP으로 한 번에 내려받을 수 있습니다.');
    if (output === 'csv' || output === 'tsv') notes.push('수식으로 오인될 수 있는 =, +, -, @ 등으로 시작하는 값 앞에는 작은따옴표를 붙였습니다.');
  }
  if (files.reduce((n, f) => n + f.bytes.length, 0) > 32 * 1024 * 1024) throw new Error('결과가 32MB 한도를 초과했습니다.');
  return { files, notes };
}
