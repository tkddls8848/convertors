/**
 * 고친 숫자 칸에 딸린 수식 칸만 다시 계산한다.
 *
 * 견적서 하나에는 고친 칸과 상관없는 수식도 많다. 그것까지 다시 계산해 써 넣으면
 * 우리 계산기가 모르는 함수 하나 때문에 멀쩡한 칸을 건드리게 된다. 그래서 고친 칸에서
 * 출발해 그 칸을 (직접·간접으로) 읽는 수식만 고른다. 계산하지 못한 칸은 값을 바꾸지
 * 않고 까닭을 남기며, 그 칸을 읽는 칸도 함께 멈춘다 — 옛 값을 읽어 틀린 합계를 내지
 * 않게.
 */
import type * as XLSX from 'xlsx';

import {
  addressOf, evaluate, parseFormula, referencesOf, UnsupportedFormula,
  type CellValue, type Formula, type Reference,
} from './formula';

export interface CellModel { value: CellValue; formula?: string }
export interface SheetModel { name: string; rows: number; cols: number; cells: Map<string, CellModel> }
export interface Edit { sheet: string; address: string; value: number | string }
export interface Change { sheet: string; address: string; before: CellValue; after: CellValue; formula: boolean }
export interface Problem { sheet: string; address: string; reason: string }

/** SheetJS 가 읽은 책을 계산용 모양으로. 날짜도 숫자(일련번호) 그대로 둔다. */
export function fromWorkbook(workbook: XLSX.WorkBook): SheetModel[] {
  return workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name]!;
    const cells = new Map<string, CellModel>();
    let rows = 0;
    let cols = 0;
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!')) continue;
      const c = cell as XLSX.CellObject;
      const value: CellValue = c.t === 'n' ? Number(c.v)
        : c.t === 'b' ? Boolean(c.v)
        : c.t === 'e' ? { error: c.w ?? '#VALUE!' }
        : c.t === 'z' || c.v === undefined ? null
        : String(c.v);
      cells.set(address, c.f ? { value, formula: c.f } : { value });
      const match = /^([A-Z]+)(\d+)$/.exec(address);
      if (match) {
        rows = Math.max(rows, Number(match[2]));
        cols = Math.max(cols, match[1]!.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0));
      }
    }
    return { name, rows, cols, cells };
  });
}

const key = (sheet: string, address: string): string => `${sheet}\u0000${address}`;
const sameValue = (a: CellValue, b: CellValue): boolean =>
  a === b || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && a.error === b.error);

class Blocked extends Error {}

export function recalc(sheets: SheetModel[], edits: Edit[]): { changes: Change[]; problems: Problem[] } {
  const bySheet = new Map(sheets.map(sheet => [sheet.name, sheet]));
  const edited = new Map(edits.map(edit => [key(edit.sheet, edit.address), edit.value]));

  // 수식은 한 번만 읽는다. 읽지 못한 수식은 무엇을 읽는지 몰라 고를 수 없다 — 따로 모은다.
  const formulas: Array<{ sheet: string; address: string; tree?: Formula; refs: Reference[]; unreadable?: string }> = [];
  for (const sheet of sheets) {
    for (const [address, cell] of sheet.cells) {
      if (!cell.formula) continue;
      try {
        const tree = parseFormula(cell.formula);
        formulas.push({ sheet: sheet.name, address, tree, refs: referencesOf(tree, sheet.name) });
      } catch (error) {
        formulas.push({ sheet: sheet.name, address, refs: [], unreadable: (error as Error).message });
      }
    }
  }

  // 고친 칸에서 출발해 그 칸을 읽는 수식을 끝까지 따라간다.
  const dirty = new Set(edited.keys());
  const covers = (ref: Reference, sheet: string, address: string): boolean => {
    if (ref.sheet !== sheet) return false;
    const m = /^([A-Z]+)(\d+)$/.exec(address)!;
    const row = Number(m[2]) - 1;
    const col = m[1]!.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return row >= ref.from.row && row <= ref.to.row && col >= ref.from.col && col <= ref.to.col;
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const f of formulas) {
      const k = key(f.sheet, f.address);
      if (dirty.has(k)) continue;
      const hit = f.refs.some(ref => [...dirty].some(d => { const [s, a] = d.split('\u0000'); return covers(ref, s!, a!); }));
      if (hit) { dirty.add(k); grew = true; }
    }
  }

  const problems: Problem[] = [];
  const failed = new Map<string, string>();
  const done = new Map<string, CellValue>();
  const visiting = new Set<string>();
  const byKey = new Map(formulas.map(f => [key(f.sheet, f.address), f]));

  const valueOf = (sheet: string, address: string): CellValue => {
    const k = key(sheet, address);
    if (edited.has(k)) return edited.get(k)!;
    const f = byKey.get(k);
    if (f && dirty.has(k)) {
      compute(f);
      if (failed.has(k)) throw new Blocked(address);
      return done.get(k)!;
    }
    return bySheet.get(sheet)?.cells.get(address)?.value ?? null;
  };

  const compute = (f: (typeof formulas)[number]): void => {
    const k = key(f.sheet, f.address);
    if (done.has(k) || failed.has(k)) return;
    if (visiting.has(k)) { failed.set(k, '순환 참조라 계산할 수 없습니다.'); return; }
    if (!f.tree) { failed.set(k, `${f.unreadable} — 엑셀에서 열면 다시 계산됩니다.`); return; }
    visiting.add(k);
    try {
      let value = evaluate(f.tree, {
        sheet: f.sheet,
        cell: valueOf,
        bounds: name => ({ rows: bySheet.get(name)?.rows ?? 0, cols: bySheet.get(name)?.cols ?? 0 }),
      });
      if (typeof value === 'number' && !Number.isFinite(value)) value = { error: '#NUM!' };
      if (!failed.has(k)) done.set(k, value);
    } catch (error) {
      if (!failed.has(k)) failed.set(k, error instanceof Blocked
        ? `읽는 칸 ${error.message} 을(를) 다시 계산하지 못해 함께 멈췄습니다.`
        : error instanceof UnsupportedFormula ? `${error.message} — 엑셀에서 열면 다시 계산됩니다.` : String(error));
    } finally { visiting.delete(k); }
  };

  const changes: Change[] = [];
  for (const sheet of sheets) {
    // 고친 칸과 수식 칸을 시트 안의 행·열 순서로 내놓는다.
    const order = [...sheet.cells.keys()].filter(a => dirty.has(key(sheet.name, a)));
    for (const edit of edits) if (edit.sheet === sheet.name && !sheet.cells.has(edit.address)) order.push(edit.address);
    order.sort((a, b) => position(a) - position(b));
    for (const address of order) {
      const k = key(sheet.name, address);
      const before = sheet.cells.get(address)?.value ?? null;
      if (edited.has(k)) {
        const after = edited.get(k)!;
        if (!sameValue(before, after)) changes.push({ sheet: sheet.name, address, before, after, formula: false });
        continue;
      }
      const f = byKey.get(k)!;
      compute(f);
      if (failed.has(k)) { problems.push({ sheet: sheet.name, address, reason: failed.get(k)! }); continue; }
      const after = done.get(k)!;
      if (!sameValue(before, after)) changes.push({ sheet: sheet.name, address, before, after, formula: true });
    }
  }
  return { changes, problems };
}

function position(address: string): number {
  const m = /^([A-Z]+)(\d+)$/.exec(address)!;
  return Number(m[2]) * 20000 + m[1]!.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

export { addressOf };
