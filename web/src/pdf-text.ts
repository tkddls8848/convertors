export interface TextSpan { text: string; x: number; y: number; width: number; height: number }
export type TextBlock = { kind: 'paragraph'; text: string } | { kind: 'table'; rows: string[][] };

/** Conservative geometric grouping. This reconstructs reading order, not exact layout. */
export function reconstructText(spans: TextSpan[], tables: boolean): TextBlock[] {
  const lines: TextSpan[][] = [];
  for (const span of [...spans].filter(s => s.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0]!.y - span.y) <= Math.max(2, Math.min(line[0]!.height, span.height) * 0.35)) line.push(span);
    else lines.push([span]);
  }
  const rows = lines.map(line => {
    const cells: { text: string; x: number; end: number }[] = [];
    for (const span of line.sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1];
      const gap = last ? span.x - last.end : 0;
      if (last && gap < Math.max(18, span.height * 1.8)) {
        last.text += (gap > span.height * 0.15 && !/\s$/.test(last.text) ? ' ' : '') + span.text;
        last.end = span.x + span.width;
      } else cells.push({ text: span.text, x: span.x, end: span.x + span.width });
    }
    return { cells, y: line[0]!.y, height: line[0]!.height };
  });
  const blocks: TextBlock[] = [];
  for (let i = 0; i < rows.length;) {
    const first = rows[i]!;
    let end = i + 1;
    if (tables && first.cells.length >= 2 && first.cells.length <= 12) {
      while (end < rows.length) {
        const row = rows[end]!;
        if (row.y - rows[end - 1]!.y > Math.max(40, first.height * 3) || row.cells.length !== first.cells.length ||
            !row.cells.every((cell, c) => Math.abs(cell.x - first.cells[c]!.x) <= 6)) break;
        end++;
      }
    }
    if (end - i >= 2) {
      blocks.push({ kind: 'table', rows: rows.slice(i, end).map(row => row.cells.map(cell => cell.text)) });
      i = end;
    } else {
      blocks.push({ kind: 'paragraph', text: first.cells.map(cell => cell.text).join('    ') });
      i++;
    }
  }
  return blocks;
}
