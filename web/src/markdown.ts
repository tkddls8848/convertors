/**
 * Markdown·텍스트 → 문단과 표.
 *
 * 여기서 나온 `TextBlock[]` 을 `hwpx-writer.ts` 가 HWPX 로 짓는다. PDF → HWPX
 * 텍스트 방식이 쓰는 것과 **같은 블록 형태**라 쓰는 쪽이 한 벌이다.
 *
 * DOM 을 쓰지 않는다 — 브라우저 밖(Node 테스트)에서도 같은 결과가 나와야 하고,
 * 그래야 규칙을 테스트로 못박을 수 있다.
 *
 * **보장하는 것**: 글의 순서, 표의 행·열, 목록의 항목 수.
 * **보장하지 않는 것**: 글꼴·크기·색·굵기·기울임. HWPX 로 옮기는 것은 글이지
 * 꾸밈이 아니다. 무엇을 버렸는지는 `notes` 로 돌려주고 화면이 그것을 적는다.
 */
import type { TextBlock } from './pdf-text';

export interface MarkdownResult {
  blocks: TextBlock[];
  /** 옮기지 못한 것. 화면에 그대로 적는다. */
  notes: string[];
}

const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(?:```|~~~)/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** 표 한 줄을 칸으로 가른다. `\|` 는 칸을 나누지 않는다. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '\\' && line[i + 1] === '|') { cell += '|'; i++; continue; }
    if (char === '|') { cells.push(cell); cell = ''; continue; }
    cell += char;
  }
  cells.push(cell);
  // 양끝의 `|` 가 만든 빈 칸은 칸이 아니다.
  if (cells.length > 1 && !cells[0]!.trim()) cells.shift();
  if (cells.length > 1 && !cells[cells.length - 1]!.trim()) cells.pop();
  return cells.map(text => inline(text).trim());
}

/** 인라인 꾸밈을 벗긴다. 링크는 주소를 괄호로 남긴다 — HWPX 에 링크가 없어서다. */
export function inline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_, label: string, href: string) =>
      href && label !== href ? `${label} (${href})` : label || href)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/<[^>\s][^>]*>/g, '');
}

export interface MarkdownOptions {
  /** false 면 줄 하나가 문단 하나다. 표·목록·제목을 해석하지 않는다. */
  markdown: boolean;
}

export function parseMarkdown(source: string, options: MarkdownOptions = { markdown: true }): MarkdownResult {
  // 제어 문자는 HWPX 의 XML 에 넣을 수 없다. 탭과 줄바꿈만 남긴다.
  const lines = source
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .split('\n');
  const blocks: TextBlock[] = [];
  const notes = new Set<string>();

  if (!options.markdown) {
    for (const line of lines) blocks.push({ kind: 'paragraph', text: line });
    return { blocks, notes: [] };
  }

  const paragraph: string[] = [];
  const flush = (): void => {
    if (!paragraph.length) return;
    // 이어진 줄은 한 문단이다 — Markdown 의 규칙이고, 한글에서도 그렇게 흐른다.
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph.length = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      flush();
      notes.add('코드 블록은 글꼴 없이 문단으로 옮깁니다.');
      for (i++; i < lines.length && !FENCE.test(lines[i]!); i++) blocks.push({ kind: 'paragraph', text: lines[i]! });
      continue;
    }

    if (!line.trim()) { flush(); continue; }

    if (RULE.test(line)) { flush(); blocks.push({ kind: 'paragraph', text: '─'.repeat(30) }); continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      notes.add('제목은 문단으로 들어갑니다 — 제목 스타일·크기는 옮기지 않습니다.');
      blocks.push({ kind: 'paragraph', text: inline(heading[2]!).trim() });
      continue;
    }

    // 표: 머리글 줄 바로 다음이 구분선일 때만 표로 본다. 본문의 `|` 를 표로 오인하지 않는다.
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!)) {
      flush();
      const rows: string[][] = [splitRow(line)];
      for (i += 2; i < lines.length && lines[i]!.includes('|') && lines[i]!.trim(); i++) rows.push(splitRow(lines[i]!));
      i--;
      // HWPX 의 표는 직사각형이어야 한다. 모자란 칸은 빈 칸으로 채우고 그 사실을 적는다.
      const columns = Math.max(...rows.map(row => row.length));
      if (rows.some(row => row.length !== columns)) notes.add('칸 수가 다른 표의 줄은 빈 칸을 채워 맞췄습니다.');
      blocks.push({ kind: 'table', rows: rows.map(row => [...row, ...Array<string>(columns - row.length).fill('')]) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet ? undefined : ORDERED.exec(line);
    if (bullet || ordered) {
      flush();
      const [, indent, marker, text] = (bullet ?? ordered)!;
      notes.add('목록은 글머리표 모양의 문단입니다 — 한글의 자동 번호 매김이 아닙니다.');
      const depth = Math.floor(indent!.length / 2);
      blocks.push({ kind: 'paragraph', text: `${'  '.repeat(depth)}${bullet ? '•' : `${marker}.`} ${inline(text!).trim()}` });
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { flush(); blocks.push({ kind: 'paragraph', text: inline(quote[1]!).trim() }); continue; }

    if (/!\[[^\]]*\]\([^)]*\)/.test(line)) notes.add('그림은 옮기지 않습니다 — HWPX 에 그림 파일을 담을 방법이 없습니다.');
    paragraph.push(inline(line).trim());
  }
  flush();
  return { blocks, notes: [...notes] };
}
