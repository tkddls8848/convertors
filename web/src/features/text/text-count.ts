/**
 * 글자 수 세기.
 *
 * "글자"를 코드 포인트가 아니라 **사람이 한 글자로 보는 단위**(grapheme)로 센다.
 * 👍🏽 는 코드 포인트로 둘, UTF-16 으로 넷이지만 누구도 네 글자라 하지 않는다.
 * `Intl.Segmenter` 가 없는 낡은 브라우저에서는 코드 포인트로 물러난다 — 한글·영문은
 * 같고 이모지·결합 문자에서만 어긋난다.
 *
 * CP949 바이트는 "ASCII 1, 나머지 2" 로 셈한다. 제출 시스템들이 흔히 쓰는 셈법이다.
 * 실제로 CP949 에 없는 글자(이모지, 일부 한자·옛한글)는 그렇게 적을 수 없으므로
 * 따로 모아 보여 준다.
 *
 * 원고지 매수는 **추정**이다. 문장부호를 칸에 어떻게 넣는지, 줄 끝 띄어쓰기를
 * 어떻게 하는지는 쓰는 사람의 규칙이라 여기서 다 흉내 내지 않는다.
 */
import { cp949Table } from './encoding';

export interface TextCount {
  /** 공백·줄바꿈까지 모두 */
  all: number;
  /** 공백은 넣고 줄바꿈은 뺀 수 — 대개 "공백 포함" 이 이것이다 */
  withSpaces: number;
  /** 공백·탭·줄바꿈을 모두 뺀 수 */
  noSpaces: number;
  hangul: number;
  words: number;
  lines: number;
  paragraphs: number;
  utf8Bytes: number;
  cp949Bytes: number;
  /** CP949 로 적을 수 없는 글자(중복 없이). */
  notInCp949: string[];
  manuscript: { rows: number; pages: number };
  /** Intl.Segmenter 로 셌으면 true. false 면 코드 포인트로 센 것이다. */
  graphemeAware: boolean;
}

type Segmenter = { segment(text: string): Iterable<{ segment: string }> };
let segmenter: Segmenter | null | undefined;

function getSegmenter(): Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  const Ctor = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'grapheme' }) => Segmenter }).Segmenter;
  segmenter = Ctor ? new Ctor('ko', { granularity: 'grapheme' }) : null;
  return segmenter;
}

/** 사람이 한 글자로 보는 단위로 자른다. Segmenter 가 없으면 코드 포인트. */
export function graphemes(text: string): string[] {
  const seg = getSegmenter();
  if (!seg) return Array.from(text);
  const out: string[] = [];
  for (const part of seg.segment(text)) out.push(part.segment);
  return out;
}

const NEWLINE = /\r\n|\r|\n/;
const SPACE = /^\s+$/u;

/** 200자 원고지 한 장: 20칸 × 10줄. */
export const MANUSCRIPT = { columns: 20, rows: 10 };

export function countText(text: string): TextCount {
  const units = graphemes(text);
  let newlines = 0;
  let spaces = 0;
  for (const unit of units) {
    if (unit === '\n' || unit === '\r' || unit === '\r\n') newlines++;
    else if (SPACE.test(unit)) spaces++;
  }

  let hangul = 0;
  let cp949Bytes = 0;
  const missing = new Set<string>();
  const map = cp949Table();
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) hangul++;
    if (code < 0x80) { cp949Bytes += 1; continue; }
    cp949Bytes += 2;
    if (!map.has(char)) missing.add(char);
  }

  const lineList = text === '' ? [] : text.split(NEWLINE);
  // 끝의 줄바꿈 하나는 줄을 새로 여는 것이 아니라 마지막 줄을 닫는 것이다(wc 와 같다).
  if (lineList.length > 1 && lineList[lineList.length - 1] === '') lineList.pop();

  let paragraphs = 0;
  let inParagraph = false;
  for (const line of lineList) {
    const blank = line.trim() === '';
    if (!blank && !inParagraph) paragraphs++;
    inParagraph = !blank;
  }

  return {
    all: units.length,
    withSpaces: units.length - newlines,
    noSpaces: units.length - newlines - spaces,
    hangul,
    words: text.split(/\s+/u).filter(Boolean).length,
    lines: lineList.length,
    paragraphs,
    utf8Bytes: new TextEncoder().encode(text).length,
    cp949Bytes,
    notInCp949: [...missing],
    manuscript: manuscript(lineList),
    graphemeAware: getSegmenter() !== null,
  };
}

/**
 * 원고지 줄 수와 매수(추정).
 *
 * 줄바꿈 하나를 새 문단으로 본다 — 원고지에서는 문단마다 새 줄에서 한 칸 들여
 * 시작한다. 빈 줄은 원고지에 옮기지 않는다. 앞뒤 공백은 들여쓰기 한 칸이 대신한다.
 */
function manuscript(lines: string[]): { rows: number; pages: number } {
  let rows = 0;
  for (const line of lines) {
    const body = line.trim();
    if (!body) continue;
    const cells = 1 + graphemes(body).length;
    rows += Math.ceil(cells / MANUSCRIPT.columns);
  }
  return { rows, pages: rows / MANUSCRIPT.rows };
}
