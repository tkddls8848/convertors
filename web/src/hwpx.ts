/**
 * HWPX(OWPML) 읽기 — 문단과 표를 Markdown 으로 옮긴다.
 *
 * gong-go 저장소의 `converter/hwpx-table.js` 를 옮겨 온 것이다. 그쪽은 공고
 * 첨부(제안요청서·과업내용서)에서 ECR 규격표를 뽑으려고 만들었고, 실제 문서
 * 수천 건을 통과한 코드다. 규칙은 그대로 두고 타입과 비동기만 입혔다.
 *
 * **XML 파서를 쓰지 않는 이유.** `DOMParser` 는 브라우저에만 있고 워커·Node
 * 테스트에서는 없다. 우리가 보는 것은 `hp:p`(문단)·`hp:tbl`(표)·`hp:tc`(칸)
 * 세 가지뿐이라, 여는 태그를 찾아 짝이 맞는 닫는 태그까지 잘라 내는 방식이면
 * 충분하고 어디서든 같은 결과가 나온다.
 *
 * **보장하는 것**: 글의 순서, 표의 칸 구조(병합 포함), 글머리표 개수.
 * **보장하지 않는 것**: 글꼴·크기·색·정렬 같은 꾸밈과 페이지 배치. 그것은
 * 원본 레이아웃이지 내용이 아니라서 Markdown 으로 옮기지 않는다.
 */

import { readZip, type ZipEntries } from './zip';

export interface HwpxStats {
  sections: number;
  tables: number;
  rows: number;
  cells: number;
  /** 규격서에서 항목을 세는 단위라 따로 센다. */
  bullets: number;
}

export interface HwpxResult {
  markdown: string;
  stats: HwpxStats;
}

interface Block {
  tag: string;
  xml: string;
}

const SECTION = /^Contents\/section\d+\.xml$/i;

export async function hwpxToMarkdown(input: Uint8Array | ZipEntries): Promise<HwpxResult> {
  const entries = input instanceof Map ? input : await readZip(input);
  const names = [...entries.keys()].filter((name) => SECTION.test(name)).sort(natural);
  if (!names.length) {
    throw new Error('HWPX 가 아닙니다. Contents/sectionN.xml 을 찾지 못했습니다.');
  }

  const stats: HwpxStats = { sections: names.length, tables: 0, rows: 0, cells: 0, bullets: 0 };
  const parts: string[] = [];
  const decoder = new TextDecoder();

  for (const name of names) {
    const xml = decoder.decode(entries.get(name)!);
    parts.push(`<!-- ${name} -->`);
    for (const block of topBlocks(xml, ['hp:p', 'hp:tbl'])) {
      if (block.tag === 'hp:p') {
        const text = textOf(block.xml);
        if (!text) continue;
        stats.bullets += (text.match(/◦/g) ?? []).length;
        parts.push(text);
      } else {
        const table = tableOf(block.xml, stats);
        if (table.length) parts.push(markdownTable(table));
      }
    }
  }
  return { markdown: `${parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`, stats };
}

/** 같은 깊이에 있는 블록만 모은다. 표 안의 문단이 바깥 문단으로 새지 않게 한다. */
function topBlocks(xml: string, tags: string[]): Block[] {
  const found: Block[] = [];
  const pattern = new RegExp(`<(${tags.map(escapeRe).join('|')})(?:\\s[^>]*)?>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const tag = match[1]!;
    const end = matchingEnd(xml, tag, match.index);
    found.push({ tag, xml: xml.slice(match.index, end) });
    pattern.lastIndex = end;
  }
  return found;
}

/** 같은 이름의 태그가 겹쳐 있을 수 있다. 깊이를 세어 짝이 맞는 곳을 찾는다. */
function matchingEnd(xml: string, tag: string, start: number): number {
  const pattern = new RegExp(`<\\/?${escapeRe(tag)}(?:\\s[^>]*)?>`, 'g');
  pattern.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    if (match[0][1] === '/') {
      depth -= 1;
      if (!depth) return pattern.lastIndex;
    } else if (!/\/>$/.test(match[0])) {
      depth += 1;
    }
  }
  throw new Error(`닫히지 않은 XML 태그: ${tag}`);
}

/**
 * 표를 격자로 편다. 병합된 칸은 **덮는 자리마다 같은 값을 채운다** — 빈칸으로
 * 두면 열이 밀려 "CPU | 16 core" 가 한 칸씩 어긋난다.
 */
function tableOf(xml: string, stats: HwpxStats): string[][] {
  stats.tables += 1;
  const rows = topBlocks(xml, ['hp:tr']);
  const grid: string[][] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const cells = topBlocks(rows[rowIndex]!.xml, ['hp:tc']);
    const target = grid[rowIndex] ?? (grid[rowIndex] = []);
    let column = 0;
    for (const cell of cells) {
      while (target[column] !== undefined) column += 1;
      const attrs = cell.xml.slice(0, cell.xml.indexOf('>') + 1);
      const colSpan = Math.max(1, numberAttr(attrs, 'colSpan'));
      const rowSpan = Math.max(1, numberAttr(attrs, 'rowSpan'));
      const value = textOf(cell.xml);
      stats.cells += 1;
      for (let y = 0; y < rowSpan; y += 1) {
        const line = grid[rowIndex + y] ?? (grid[rowIndex + y] = []);
        for (let x = 0; x < colSpan; x += 1) line[column + x] = value;
      }
      column += colSpan;
    }
    stats.rows += 1;
  }

  const width = Math.max(0, ...grid.map((row) => row.length));
  return grid.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
}

function numberAttr(startTag: string, name: string): number {
  const match = startTag.match(new RegExp(`\\b${name}=["'](\\d+)["']`, 'i'));
  return match ? Number(match[1]) : 1;
}

/** 태그를 걷어내고 글자만 남긴다. 표 안에 든 표는 바깥 글로 세지 않는다. */
function textOf(xml: string): string {
  const text = xml.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return decodeXml(text)
    .replace(/[\t\r\n ]+/g, ' ')
    .replace(/ *([◦•]) */g, ' $1 ')
    .trim();
}

function markdownTable(rows: string[][]): string {
  if (!rows.length || !rows[0]!.length) return '';
  const escaped = rows.map((row) => row.map((cell) => cell.replace(/\|/g, '\\|').replace(/\n/g, '<br>') || ' '));
  const header = escaped[0]!;
  const body = escaped.slice(1);
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity);
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** section2 가 section10 보다 앞이다. 문자열 순서로는 뒤집힌다. */
function natural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}
