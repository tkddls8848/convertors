/**
 * PDF 문서 정보 보기·지우기 — 화면 없이 도는 부분.
 *
 * 문서 정보는 두 곳에 산다.
 *
 *   Info 사전  — 제목·작성자·만든 프로그램·날짜. 뷰어의 "문서 속성" 이 보여 준다
 *   XMP        — 목록(catalog)의 /Metadata 스트림. 같은 내용이 XML 로 한 번 더 있다
 *
 * 하나만 지우면 다른 쪽에 이름이 그대로 남는다. 그래서 둘 다 지운다.
 *
 * pdf-lib 은 **파일에서 읽은 객체를 전부** 다시 쓴다 — 어디서도 가리키지 않는
 * 객체도. 덧붙여 고친(incremental) 파일의 옛 Info 사전, 목록에서 떼어 낸 XMP
 * 스트림이 그렇게 살아남는다. 그래서 저장 전에 트레일러에서 닿지 않는 객체를
 * 치운다(`dropUnreachable`) — 지웠다고 해 놓고 파일 안에 남기면 이 도구는
 * 거짓말을 하는 것이다.
 *
 * 쪽 안의 글자, 첨부 파일의 이름과 내용, 그림 안의 EXIF 는 건드리지 않는다.
 */
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFStream, PDFString,
  type PDFObject,
} from 'pdf-lib';

import { readPdf } from './pdf';

/** 고칠 수 있는 글자 칸. Info 사전의 열쇠 이름 그대로다. */
export const TEXT_FIELDS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'] as const;
export type TextField = typeof TEXT_FIELDS[number];
export type TextValues = Record<TextField, string>;

export const FIELD_LABELS: Record<TextField, string> = {
  Title: '제목', Author: '작성자', Subject: '주제', Keywords: '키워드', Creator: '만든 프로그램', Producer: 'PDF 변환기',
};

export interface PdfMeta {
  text: TextValues;
  creationDate?: Date | undefined;
  modificationDate?: Date | undefined;
  /** 위 여섯과 두 날짜 밖의 Info 항목 이름(예: Company, SourceModified). 지우기가 함께 지운다. */
  otherKeys: string[];
  pages: number;
  version: string;
  hasXmp: boolean;
  javaScript: boolean;
  attachments: number;
  formFields: number;
}

const NAME = (key: string): PDFName => PDFName.of(key);

/** 머리의 `%PDF-1.7`. 목록의 /Version 이 더 높으면 그쪽이 맞다(규격이 그렇게 정한다). */
export function pdfVersion(bytes: Uint8Array, catalogVersion?: string): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const header = /%PDF-(\d+\.\d+)/.exec(head)?.[1] ?? '';
  const catalog = catalogVersion && /^\d+\.\d+$/.test(catalogVersion) ? catalogVersion : '';
  if (!header) return catalog || '알 수 없음';
  return catalog && Number(catalog) > Number(header) ? catalog : header;
}

function infoDict(document: PDFDocument, create: boolean): PDFDict | undefined {
  const context = document.context;
  const raw = context.trailerInfo.Info ? context.lookup(context.trailerInfo.Info) : undefined;
  const found = raw instanceof PDFDict ? raw : undefined;
  if (found || !create) return found;
  const dict = context.obj({});
  context.trailerInfo.Info = context.register(dict);
  return dict;
}

function textOf(value: PDFObject | undefined): string {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    try { return value.decodeText(); } catch { return value.asString(); }
  }
  return '';
}

function dateOf(value: PDFObject | undefined): Date | undefined {
  if (!(value instanceof PDFString || value instanceof PDFHexString)) return undefined;
  try {
    const date = value.decodeDate();
    return Number.isNaN(date.getTime()) ? undefined : date;
  } catch {
    // 규격을 벗어난 날짜가 흔하다. 못 읽으면 없는 것으로 보인다 — 지우기는 그래도 지운다.
    return undefined;
  }
}

/**
 * 트레일러에서 닿는 객체를 모두 훑는다. 사전마다 `visit` 을 부른다.
 * 재귀 대신 쌓아 두고 돈다 — 쪽 트리가 깊은 파일에서 호출 스택이 넘친다.
 */
function walk(document: PDFDocument, visit?: (dict: PDFDict) => void): Set<PDFRef> {
  const context = document.context;
  const seen = new Set<PDFRef>();
  const stack: PDFObject[] = [];
  for (const root of [context.trailerInfo.Root, context.trailerInfo.Info, context.trailerInfo.Encrypt, context.trailerInfo.ID]) {
    if (root) stack.push(root);
  }
  while (stack.length) {
    const item = stack.pop()!;
    if (item instanceof PDFRef) {
      if (seen.has(item)) continue;
      seen.add(item);
      const target = context.lookup(item);
      if (target) stack.push(target);
    } else if (item instanceof PDFDict) {
      visit?.(item);
      for (const [, value] of item.entries()) stack.push(value);
    } else if (item instanceof PDFArray) {
      stack.push(...item.asArray());
    } else if (item instanceof PDFStream) {
      stack.push(item.dict);
    }
  }
  return seen;
}

/** 어디서도 가리키지 않는 객체를 치운다. 치운 수를 돌려준다. */
export function dropUnreachable(document: PDFDocument): number {
  const reachable = walk(document);
  let dropped = 0;
  for (const [ref] of document.context.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) { document.context.delete(ref); dropped++; }
  }
  return dropped;
}

export function readMetaFrom(document: PDFDocument, bytes: Uint8Array): PdfMeta {
  const info = infoDict(document, false);
  const text = Object.fromEntries(TEXT_FIELDS.map(key => [key, textOf(info?.lookup(NAME(key)))])) as TextValues;
  const known = new Set<string>([...TEXT_FIELDS, 'CreationDate', 'ModDate']);
  const otherKeys = info ? info.keys().map(key => key.decodeText()).filter(key => !known.has(key)) : [];

  const catalog = document.catalog;
  const declared = catalog.lookup(NAME('Version'));
  const version = declared instanceof PDFName ? declared.decodeText() : undefined;

  let javaScript = false;
  let attachments = 0;
  walk(document, dict => {
    // 동작 사전(/S /JavaScript)이든 이름 트리의 스크립트든 /JS 를 품는다.
    if (dict.has(NAME('JS')) || dict.get(NAME('S')) === NAME('JavaScript')) javaScript = true;
    // 첨부는 파일 명세의 /EF(심긴 파일)로 센다. 이름 트리든 주석이든 같은 모양이다.
    if (dict.has(NAME('EF'))) attachments++;
  });
  const names = catalog.lookup(NAME('Names'));
  if (names instanceof PDFDict && names.has(NAME('JavaScript'))) javaScript = true;

  const acroForm = catalog.lookup(NAME('AcroForm'));
  const fields = acroForm instanceof PDFDict ? acroForm.lookup(NAME('Fields')) : undefined;
  const formFields = fields instanceof PDFArray ? fields.size() : 0;

  return {
    text,
    creationDate: dateOf(info?.lookup(NAME('CreationDate'))),
    modificationDate: dateOf(info?.lookup(NAME('ModDate'))),
    otherKeys,
    pages: document.getPageCount(),
    version: pdfVersion(bytes, version),
    hasXmp: catalog.has(NAME('Metadata')),
    javaScript,
    attachments,
    formFields,
  };
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  // readPdf 가 { updateMetadata: false } 로 연다 — 여는 것만으로 Producer 가 pdf-lib 으로 바뀌지 않게.
  return (await readPdf(bytes, 'input.pdf')).document;
}

export async function readMeta(bytes: Uint8Array): Promise<PdfMeta> {
  return readMetaFrom(await load(bytes), bytes);
}

/**
 * 글자 칸을 고쳐 저장한다. 비운 칸은 항목째 지운다 — 빈 글자로 남기면 뷰어에
 * 빈 줄로 뜨고, 없는 것과 같지 않다.
 *
 * XMP 는 Info 와 다른 말을 하게 되므로 고칠 때도 뗀다. 뷰어 대부분은 XMP 가
 * 있으면 그쪽을 먼저 믿어서, 남겨 두면 고친 제목이 안 보인다.
 */
export async function writeMeta(bytes: Uint8Array, values: Partial<TextValues>): Promise<Uint8Array> {
  const document = await load(bytes);
  const info = infoDict(document, true)!;
  for (const key of TEXT_FIELDS) {
    const value = values[key];
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed) info.set(NAME(key), PDFHexString.fromText(trimmed));
    else info.delete(NAME(key));
  }
  removeXmp(document);
  dropUnreachable(document);
  return document.save({ updateFieldAppearances: false });
}

/** Info 사전의 모든 항목과 XMP 를 지운다. */
export async function clearMeta(bytes: Uint8Array): Promise<Uint8Array> {
  const document = await load(bytes);
  const info = infoDict(document, false);
  if (info) for (const key of info.keys()) info.delete(key);
  removeXmp(document);
  dropUnreachable(document);
  return document.save({ updateFieldAppearances: false });
}

function removeXmp(document: PDFDocument): void {
  document.catalog.delete(NAME('Metadata'));
}
