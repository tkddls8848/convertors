/**
 * PDF 안의 글자를 **진짜로** 지운다 — PDFium(EmbedPDF 판) 의 `EPDFText_RedactInRect`.
 *
 * 덮어 가리는 것이 아니다. 콘텐츠 스트림에서 그 글자의 글리프 코드를 빼고, 같은
 * 줄의 남은 글자가 밀리지 않게 그 폭만큼 간격(TJ 의 숫자)을 넣는다. 그래서 지운
 * 글자는 뽑아도 나오지 않고, 밑에 깔린 그림·무늬는 그대로 보인다.
 *
 * PDFium 은 **글리프 상자가 사각형에 조금이라도 겹치면** 지운다. 조각 상자를 그대로
 * 넘기면 줄 간격이 좁은 문서에서 윗줄 꼬리나 아랫줄 머리까지 지운다. 그래서 기준선
 * 근처의 얇은 띠만 넘긴다(`redactBand`).
 *
 * 그리고 **지운 뒤에 확인한다.** 띠와 PDFium 의 판정이 어긋날 수 있다 — 기준선에
 * 붙은 마침표, 글꼴마다 다른 글리프 상자. 확인은 둘이다.
 *
 *   - 그 조각의 글자(기준점이 조각 안, 기준선 근처)가 하나도 남지 않았는가
 *   - 조각 밖의 글자가 하나도 사라지지 않았는가
 *
 * 어긋나면 저장하지 않고 멈춘다. 덮기로 물러나지 않는다 — 지웠다고 믿었는데
 * 남아 있는 것이 이 기능에서 가장 나쁜 실패다.
 *
 * 이 파일은 엔진을 받아 쓰기만 한다. 띄우는 것은 워커(`pdf-redact.worker.ts`)와
 * 테스트(`pdf-redact-node.ts`)가 한다.
 */
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

/** 지울 글자 조각 하나. 좌표는 **회전을 적용하지 않은** PDF 사용자 공간이다. */
export interface RedactArea {
  /** 1부터 센 쪽 번호. */
  page: number;
  /** 조각 기준선의 왼쪽 끝과 폭. */
  x: number;
  y: number;
  width: number;
  /** 조각의 글자 크기. 띠의 높이와 "기준선 근처" 를 이것으로 잡는다. */
  size: number;
  /** 멈출 때 어느 자리였는지 알리는 이름. 예) `2번째(3쪽)` */
  label: string;
}

interface Rect { left: number; bottom: number; right: number; top: number }
interface Char { code: number; x: number; y: number }
type Memory = { malloc(size: number): number; free(pointer: number): void; memory: WebAssembly.Memory };

/** FPDF_GetLastError 의 암호 오류. */
const PASSWORD_ERROR = 4;

/**
 * PDFium 에 넘길 띠. 기준선 살짝 아래부터 글자 크기의 절반까지다.
 *
 * 아래를 기준선보다 조금 내리는 이유는 쉼표·마침표다. 그 잉크는 기준선 바로 위에만
 * 있어서 띠가 기준선 위에서 시작하면 걸리지 않는다. 가로는 양끝을 조금 들인다 —
 * 옆 조각의 첫 글자와 경계가 닿아 있는 경우가 많다.
 */
export function redactBand(area: RedactArea): Rect {
  const inset = Math.min(0.5, area.width / 4);
  return {
    left: area.x + inset,
    right: area.x + area.width - inset,
    bottom: area.y - area.size * 0.1,
    top: area.y + area.size * 0.5,
  };
}

/** 지울 자리들을 지운 새 PDF 바이트. 지울 자리가 없으면 원본을 그대로 돌려준다. */
export function redactWith(engine: WrappedPdfiumModule, source: Uint8Array, areas: RedactArea[]): Uint8Array {
  if (!areas.length) return source;
  const byPage = new Map<number, RedactArea[]>();
  for (const area of areas) {
    const list = byPage.get(area.page) ?? [];
    // 같은 조각을 두 번 넘기면 두 번째는 지울 것이 없어 실패로 보인다. 한 번만 지운다.
    if (!list.some(seen => seen.x === area.x && seen.y === area.y && seen.width === area.width)) list.push(area);
    byPage.set(area.page, list);
  }

  const before = new Map<number, Char[]>();
  const document = open(engine, source, areas[0]!.label);
  let out: Uint8Array;
  try {
    const count = engine.FPDF_GetPageCount(document.handle);
    for (const [number, list] of byPage) {
      if (!Number.isInteger(number) || number < 1 || number > count) throw new Error(`${list[0]!.label}: 쪽 번호가 1~${count} 밖입니다.`);
      const page = engine.FPDF_LoadPage(document.handle, number - 1);
      if (!page) throw new Error(`${list[0]!.label}: 쪽을 읽지 못했습니다.`);
      try {
        const chars = readChars(engine, page);
        before.set(number, chars);
        for (const area of list) {
          // 지울 것이 없다는 것은 글자가 글자가 아니라는 뜻이다(그림·윤곽선). 덮지 않는다.
          if (!chars.some(char => owns(area, char))) {
            throw new Error(`${area.label}: 지울 글자를 찾지 못했습니다. 글자가 그림이나 선으로 그려진 문서일 수 있습니다.`);
          }
          if (!redactRect(engine, page, redactBand(area))) throw new Error(`${area.label}: 원래 글자를 지우지 못했습니다.`);
        }
        if (!engine.FPDFPage_GenerateContent(page)) throw new Error(`${list[0]!.label}: 지운 쪽을 다시 쓰지 못했습니다.`);
      } finally {
        engine.FPDF_ClosePage(page);
      }
    }
    out = save(engine, document.handle);
  } finally {
    close(engine, document);
  }

  verify(engine, out, byPage, before);
  return out;
}

/** 쪽의 글자를 이어 붙인 것. 빈칸과 PDFium 이 끼워 넣은 글자는 뺀다. 테스트가 쓴다. */
export function pageText(engine: WrappedPdfiumModule, bytes: Uint8Array, pageNumber: number): string {
  const document = open(engine, bytes, `${pageNumber}쪽`);
  try {
    const page = engine.FPDF_LoadPage(document.handle, pageNumber - 1);
    if (!page) throw new Error(`${pageNumber}쪽을 읽지 못했습니다.`);
    try {
      return readChars(engine, page).map(char => String.fromCodePoint(char.code)).join('');
    } finally {
      engine.FPDF_ClosePage(page);
    }
  } finally {
    close(engine, document);
  }
}

/** 그 조각의 글자인가 — 기준점이 조각의 가로 범위 안에 있고 기준선 근처에 있다. */
function owns(area: RedactArea, char: Char): boolean {
  return char.x >= area.x - 0.5 && char.x < area.x + area.width - 0.05
    && Math.abs(char.y - area.y) <= area.size * 0.3;
}

/** 저장한 결과를 다시 열어, 지울 글자는 다 사라지고 나머지는 그대로인지 본다. */
function verify(engine: WrappedPdfiumModule, out: Uint8Array, byPage: Map<number, RedactArea[]>, before: Map<number, Char[]>): void {
  const document = open(engine, out, '지운 결과');
  try {
    for (const [number, list] of byPage) {
      const page = engine.FPDF_LoadPage(document.handle, number - 1);
      if (!page) throw new Error(`${number}쪽: 지운 결과를 다시 읽지 못했습니다.`);
      try {
        const after = readChars(engine, page);
        for (const area of list) {
          const left = after.filter(char => owns(area, char));
          if (left.length) throw new Error(`${area.label}: 원래 글자 일부를 지우지 못했습니다 — “${letters(left)}”. 저장하지 않았습니다.`);
        }
        const kept = before.get(number)!.filter(char => !list.some(area => owns(area, char)));
        const lost = missing(kept, after);
        if (lost.length) {
          throw new Error(`${list.map(area => area.label).join(', ')}: 지우는 중에 다른 글자까지 사라졌습니다 — “${letters(lost)}”. 저장하지 않았습니다.`);
        }
      } finally {
        engine.FPDF_ClosePage(page);
      }
    }
  } finally {
    close(engine, document);
  }
}

/** `kept` 가운데 `after` 에서 찾지 못한 글자. 같은 글자가 0.5pt 안에 있으면 찾은 것이다. */
function missing(kept: Char[], after: Char[]): Char[] {
  const pool = new Map<number, Char[]>();
  for (const char of after) pool.set(char.code, [...(pool.get(char.code) ?? []), char]);
  return kept.filter(char => {
    const candidates = pool.get(char.code) ?? [];
    const at = candidates.findIndex(other => Math.abs(other.x - char.x) <= 0.5 && Math.abs(other.y - char.y) <= 0.5);
    if (at < 0) return true;
    candidates.splice(at, 1);
    return false;
  });
}

function letters(chars: Char[]): string {
  const unique = [...new Set(chars.map(char => String.fromCodePoint(char.code)))];
  return unique.length > 20 ? `${unique.slice(0, 20).join('')}…` : unique.join('');
}

function memory(engine: WrappedPdfiumModule): Memory {
  return engine.pdfium.wasmExports as unknown as Memory;
}

/** 쪽의 글자와 기준점. 빈칸, PDFium 이 끼워 넣은 글자, 코드가 없는 글자는 뺀다. */
function readChars(engine: WrappedPdfiumModule, page: number): Char[] {
  const text = engine.FPDFText_LoadPage(page);
  if (!text) return [];
  const { malloc, free } = memory(engine);
  const point = malloc(16);
  try {
    const chars: Char[] = [];
    const count = engine.FPDFText_CountChars(text);
    for (let index = 0; index < count; index++) {
      if (engine.FPDFText_IsGenerated(text, index) === 1) continue;
      const code = engine.FPDFText_GetUnicode(text, index);
      if (!code || code > 0x10ffff || /\s/u.test(String.fromCodePoint(code))) continue;
      if (!engine.FPDFText_GetCharOrigin(text, index, point, point + 8)) continue;
      chars.push({ code, x: engine.pdfium.getValue(point, 'double'), y: engine.pdfium.getValue(point + 8, 'double') });
    }
    return chars;
  } finally {
    free(point);
    engine.FPDFText_ClosePage(text);
  }
}

function redactRect(engine: WrappedPdfiumModule, page: number, band: Rect): boolean {
  const { malloc, free } = memory(engine);
  // FS_RECTF { left, top, right, bottom } — float 넷.
  const rect = malloc(16);
  try {
    engine.pdfium.setValue(rect, band.left, 'float');
    engine.pdfium.setValue(rect + 4, band.top, 'float');
    engine.pdfium.setValue(rect + 8, band.right, 'float');
    engine.pdfium.setValue(rect + 12, band.bottom, 'float');
    // 폼 XObject 안의 글자도 지운다. 쪽 내용을 통째로 XObject 에 넣어 두는 프로그램이 있다.
    // 검은 상자는 그리지 않는다 — 지운 자리는 밑에 있던 것이 그대로 보여야 한다.
    return engine.EPDFText_RedactInRect(page, rect, true, false);
  } finally {
    free(rect);
  }
}

/** PDFium 이 문서를 여는 동안 바이트는 wasm 메모리에 머물러야 한다. 닫을 때 놓는다. */
function open(engine: WrappedPdfiumModule, bytes: Uint8Array, label: string): { handle: number; pointer: number } {
  const { malloc, free } = memory(engine);
  const pointer = malloc(bytes.length);
  new Uint8Array(memory(engine).memory.buffer).set(bytes, pointer);
  const handle = engine.FPDF_LoadMemDocument(pointer, bytes.length, '');
  if (!handle) {
    const error = engine.FPDF_GetLastError();
    free(pointer);
    if (error === PASSWORD_ERROR) throw new Error('암호화된 PDF입니다. 암호와 보안을 해제한 사본을 올려 주세요.');
    throw new Error(`${label}: 글자를 지우려고 PDF를 열지 못했습니다 (PDFium 오류 ${error}).`);
  }
  return { handle, pointer };
}

function close(engine: WrappedPdfiumModule, document: { handle: number; pointer: number }): void {
  engine.FPDF_CloseDocument(document.handle);
  memory(engine).free(document.pointer);
}

/** 통째로 다시 쓴다. 증분 저장이면 지운 글자가 담긴 옛 스트림이 파일에 남는다. */
function save(engine: WrappedPdfiumModule, handle: number): Uint8Array {
  const writer = engine.PDFiumExt_OpenFileWriter();
  try {
    if (!engine.PDFiumExt_SaveAsCopy(handle, writer)) throw new Error('지운 PDF를 저장하지 못했습니다.');
    const size = engine.PDFiumExt_GetFileWriterSize(writer);
    const { malloc, free } = memory(engine);
    const buffer = malloc(size);
    try {
      engine.PDFiumExt_GetFileWriterData(writer, buffer, size);
      return new Uint8Array(memory(engine).memory.buffer).slice(buffer, buffer + size);
    } finally {
      free(buffer);
    }
  } finally {
    engine.PDFiumExt_CloseFileWriter(writer);
  }
}
