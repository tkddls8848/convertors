/**
 * PDF 글자 고치기 — **지우고 다시 쓰는** 방식.
 *
 * PDF 안의 글자를 제자리에서 고치는 것은 원리상 되지 않는다. 이유가 둘이다.
 *
 *   - 한글 PDF 는 CID 글꼴을 **서브셋**으로 심는다. 원본에 쓰이지 않은 글자는
 *     글리프 자체가 파일에 없어서 바꿔 넣을 수가 없다
 *   - 글자 폭이 바뀌면 줄이 밀린다. PDF 에는 문단·줄바꿈 개념이 없어 다시
 *     흘려 넣는 것이 불가능하다
 *
 * 그래서 두 단계로 나눈다.
 *
 *   1. 바꾸기·지우기 자리의 원래 글자를 PDFium 으로 **콘텐츠 스트림에서 뺀다**
 *      (`pdf-redact-core.ts`). 뽑아도 나오지 않고, 밑에 깔린 그림은 그대로다
 *   2. 그 결과 위에 pdf-lib 으로 새 글자를 그린다. 원본 글꼴을 다시 쓸 수도 있다
 *
 * 1 이 실패하면 저장하지 않고 멈춘다. 덮어 가리는 길로 물러나지 않는다 — 지웠다고
 * 믿었는데 남아 있는 것이 가장 나쁘다. 빈 곳에 넣는 글자는 1 을 거치지 않는다.
 */
import { PDFDocument, EncryptedPDFError, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

import { reason } from '../../shared/errors';
import { carrySourceFont, drawWithSourceFont, type SourceFont } from './pdf-source-font';
import { stripLayoutTables } from './sfnt';

import type { RedactArea } from './pdf-redact-core';

export const EDIT_LIMITS = {
  inputBytes: 64 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
  /** 한 번에 고칠 자리. 이보다 많으면 도구가 아니라 다른 것이 필요하다. */
  edits: 500,
  chars: 500,
  /** 이보다 작으면 종이에서 읽기 어렵다. 막지는 않고 그렇다고 적는다. */
  legibleSize: 6,
  fontBytes: 32 * 1024 * 1024,
  minSize: 1,
  maxSize: 400,
};

export interface Rgb { r: number; g: number; b: number }

/**
 * 고칠 자리의 종류.
 *
 *   replace — 원래 글자를 지우고 새 글자를 쓴다
 *   add     — 빈 곳에 새 글자를 쓴다. 지울 것이 없다
 *   erase   — 원래 글자를 지우기만 한다
 */
export type EditKind = 'replace' | 'add' | 'erase';

/** 원래 글자 조각. 좌표는 **회전을 적용하지 않은** PDF 사용자 공간이다. */
export interface SpanBox {
  /** 기준선의 왼쪽 끝과 폭. */
  x: number;
  y: number;
  width: number;
  /** 원본이 이 조각을 그린 글자 크기. */
  size: number;
}

/** 고칠 자리 하나. */
export interface TextEdit {
  kind: EditKind;
  /** 1부터 센 쪽 번호. */
  page: number;
  /** 지울 원래 글자 조각. 바꾸기·지우기에 있고 넣기에는 없다. */
  span?: SpanBox;
  /** 새 글자를 쓸 기준선의 왼쪽 끝. 지우기는 보지 않는다. */
  x: number;
  y: number;
  text: string;
  size: number;
  fontId: string;
  color: Rgb;
  /** 원래 글자 — 목록에 보여 주기 위한 것이고 계산에는 쓰지 않는다. */
  original: string;
}

/** 원본 바이트에서 지울 자리들을 지운 새 바이트를 돌려준다. 화면은 워커를, 테스트는 Node 엔진을 넘긴다. */
export type Redactor = (source: Uint8Array, areas: RedactArea[]) => Promise<Uint8Array>;

/**
 * 원본 PDF 가 이미 갖고 있는 글꼴을 가리키는 표. `fontId` 에 이 꼴로 적는다.
 *
 * 심는 글꼴과 한 칸에서 다루기 위해 같은 `fontId` 를 쓴다 — 목록에서 고르는 것도,
 * 고친 자리에 적히는 것도 하나뿐이어야 되돌리기와 다시 그리기가 갈리지 않는다.
 */
export const sourceFontId = (resource: string): string => `원본:${resource}`;
export const sourceFontResource = (fontId: string): string | null =>
  (fontId.startsWith('원본:') ? fontId.slice(3) : null);

/** 심을 글꼴 하나. `bytes` 가 없으면 PDF 가 이미 아는 기본 글꼴이다. */
export interface FontSource {
  id: string;
  label: string;
  standard?: keyof typeof StandardFonts;
  bytes?: Uint8Array;
}

export interface EditResult { bytes: Uint8Array; warnings: string[] }

/**
 * 원래 자리에 들어가도록 글자 크기를 줄인다.
 *
 * 0.5pt 씩 내려가며 처음 들어가는 크기를 찾는다. 이분 탐색을 하지 않는 이유는
 * 폭이 크기에 정비례하지 않기 때문이다(힌팅·커닝). 한 자리 고치는 데 수십 번은
 * 아무것도 아니다.
 */
export function shrinkToFit(measure: (size: number) => number, maxWidth: number, size: number, min = 4): number {
  if (maxWidth <= 0 || measure(size) <= maxWidth) return size;
  for (let next = size - 0.5; next >= min; next -= 0.5) {
    if (measure(next) <= maxWidth) return Number(next.toFixed(1));
  }
  return min;
}

/** 고칠 자리들을 한 번에 적용해 새 PDF 바이트를 만든다. */
export async function applyTextEdits(source: Uint8Array, edits: TextEdit[], fonts: FontSource[], redact: Redactor): Promise<EditResult> {
  if (!source.length || source.length > EDIT_LIMITS.inputBytes) throw new Error('PDF 입력은 64MB까지 지원합니다.');
  if (!edits.length) throw new Error('고친 자리가 없습니다.');
  if (edits.length > EDIT_LIMITS.edits) throw new Error(`한 번에 ${EDIT_LIMITS.edits}자리까지 고칠 수 있습니다.`);

  const original = await load(source);
  const count = original.getPageCount();
  const where = (index: number): string => `${index + 1}번째(${edits[index]!.page}쪽)`;

  // 지우기 전에 다 따져 본다. 지우는 데는 시간이 들고, 지운 뒤에 멈추면 그 시간이 헛것이 된다.
  const areas: RedactArea[] = [];
  for (const [index, edit] of edits.entries()) {
    if (!Number.isInteger(edit.page) || edit.page < 1 || edit.page > count) throw new Error(`${where(index)}: 쪽 번호가 1~${count} 밖입니다.`);
    if (edit.kind !== 'add') {
      if (!edit.span) throw new Error(`${where(index)}: 지울 원래 글자가 없습니다.`);
      areas.push({ page: edit.page, ...edit.span, label: where(index) });
    }
    if (edit.kind === 'erase') continue;
    if (!edit.text.length) throw new Error(`${where(index)}: 고칠 글자가 비어 있습니다.`);
    if (edit.text.length > EDIT_LIMITS.chars) throw new Error(`${where(index)}: 한 자리에 ${EDIT_LIMITS.chars}자까지 넣을 수 있습니다.`);
    if (!Number.isFinite(edit.size) || edit.size < EDIT_LIMITS.minSize || edit.size > EDIT_LIMITS.maxSize) {
      throw new Error(`${where(index)}: 글자 크기는 ${EDIT_LIMITS.minSize}~${EDIT_LIMITS.maxSize} 사이여야 합니다.`);
    }
  }

  // 새 글자는 **지운 결과** 위에 그린다. 지울 자리가 없으면 원본 위에 그린다.
  const document = areas.length ? await load(await redact(source, areas)) : original;

  // 글꼴은 **쓰는 것만** 심는다. 목록에 있다고 다 심으면 안 쓴 글꼴이 파일에 남는다.
  // 지우기는 글자를 쓰지 않으니 글꼴도 쓰지 않는다.
  const used = new Set(edits.filter((edit) => edit.kind !== 'erase').map((edit) => edit.fontId));
  const embedded = new Map<string, PDFFont>();
  let fontkitRegistered = false;
  for (const font of fonts) {
    // 원본 글꼴은 심을 것이 없다. 이미 그 문서 안에 있고 우리는 가리키기만 한다.
    if (!used.has(font.id) || sourceFontResource(font.id)) continue;
    if (font.standard) {
      embedded.set(font.id, await document.embedFont(StandardFonts[font.standard]));
      continue;
    }
    if (!font.bytes?.length) throw new Error(`${font.label}: 글꼴 파일을 읽지 못했습니다.`);
    if (font.bytes.length > EDIT_LIMITS.fontBytes) throw new Error(`${font.label}: 글꼴이 32MB를 넘습니다.`);
    if (!fontkitRegistered) {
      // fontkit 은 400KB 가 넘는다. 글꼴을 실제로 심는 사람만 받는다.
      document.registerFontkit((await import('@pdf-lib/fontkit')).default);
      fontkitRegistered = true;
    }
    try {
      // 배치 테이블을 떼는 이유는 sfnt.ts 에 적혀 있다.
      embedded.set(font.id, await document.embedFont(stripLayoutTables(font.bytes), { subset: true }));
    } catch (error) {
      throw new Error(`${font.label}: 심지 못했습니다 — ${reason(error)}`);
    }
  }

  // 원본 글꼴은 **원본** 쪽에서 찾아 그릴 쪽으로 옮겨 온다. 지운 문서는 PDFium 이
  // 다시 쓴 것이라 자원 이름이 다르다. 쪽마다 글꼴마다 한 번만 옮긴다.
  const carried = new Map<string, SourceFont | undefined>();
  const sourceFontOn = (number: number, resource: string): SourceFont | undefined => {
    const key = `${number}:${resource}`;
    if (!carried.has(key)) carried.set(key, carrySourceFont(original.getPage(number - 1), resource, document.getPage(number - 1)));
    return carried.get(key);
  };

  const warnings: string[] = [];
  for (const [index, edit] of edits.entries()) {
    if (edit.kind === 'erase') continue;
    const page = document.getPage(edit.page - 1);

    // 줄바꿈이 든 글자는 여러 줄로 그린다. PDF 에는 문단이 없으니 우리가 줄 간격을 정한다.
    const lines = edit.text.split('\n');
    const resource = sourceFontResource(edit.fontId);
    let width: number;
    let write: (line: string, x: number, y: number) => void;

    if (resource !== null) {
      const font = sourceFontOn(edit.page, resource);
      if (!font) throw new Error(`${where(index)}: 원본 글꼴을 찾지 못했습니다. 다른 글꼴을 골라 주세요.`);
      // 원본 글꼴은 그 문서에 쓰인 글자의 모양만 갖고 있다. 없는 글자를 넘기면
      // 빈칸이 찍히므로 여기서 멈춘다 — 조용히 사라지게 두지 않는다.
      const missing = font.missing(edit.text);
      if (missing.length) {
        throw new Error(`${where(index)}: 원본 글꼴에 없는 글자가 있습니다 — ${missing.join(' ')}. 다른 글꼴을 골라 주세요.`);
      }
      width = Math.max(...lines.map((line) => font.widthOfTextAtSize(line, edit.size)));
      write = (line, x, y) => drawWithSourceFont(page, font, line, { x, y, size: edit.size, color: edit.color });
    } else {
      const font = embedded.get(edit.fontId);
      if (!font) throw new Error(`${where(index)}: 고른 글꼴을 찾지 못했습니다.`);
      try {
        width = Math.max(...lines.map((line) => font.widthOfTextAtSize(line, edit.size)));
      } catch (error) {
        throw new Error(`${where(index)}: 고른 글꼴에 없는 글자가 있습니다 — ${reason(error)}`);
      }
      write = (line, x, y) => page.drawText(line, {
        x, y, size: edit.size, font, color: rgb(edit.color.r, edit.color.g, edit.color.b),
      });
    }

    lines.forEach((line, row) => write(line, edit.x, edit.y - row * edit.size * 1.35));

    // 빈 곳에 넣은 글자는 원래 자리가 없다. 넓이를 견줄 것이 없다.
    if (edit.span && width > edit.span.width + 0.5) {
      const percent = Math.round((width / Math.max(edit.span.width, 1) - 1) * 100);
      warnings.push(`${where(index)}: 새 글자가 원래 자리보다 ${percent}% 넓어 옆 내용과 겹칠 수 있습니다.`);
    }
    if (lines.length > 1) warnings.push(`${where(index)}: 여러 줄은 글자 크기의 1.35배 간격으로 내려 씁니다. 아래 내용과 겹치는지 확인하세요.`);
    // 자리에 맞추려고 줄이다 보면 읽을 수 없는 크기가 된다. 줄여 넣고 아무 말도
    // 하지 않으면 화면에서는 글자가 사라진 것처럼 보인다.
    if (edit.size < EDIT_LIMITS.legibleSize) {
      warnings.push(`${where(index)}: 글자 크기가 ${edit.size}pt 라 읽기 어렵습니다. 자리에 맞추려면 글자를 줄이거나 자동 줄임을 끄고 옮겨 보세요.`);
    }
  }

  const bytes = await document.save();
  if (bytes.length > EDIT_LIMITS.outputBytes) throw new Error('출력이 64MB 한도를 넘었습니다.');
  return { bytes, warnings };
}

async function load(source: Uint8Array): Promise<PDFDocument> {
  try {
    const document = await PDFDocument.load(source, { updateMetadata: false });
    if (!document.getPageCount()) throw new Error('쪽이 없는 PDF입니다.');
    return document;
  } catch (error) {
    if (error instanceof EncryptedPDFError) throw new Error('암호화된 PDF입니다. 암호와 보안을 해제한 사본을 올려 주세요.');
    throw error instanceof Error ? error : new Error(String(error));
  }
}
