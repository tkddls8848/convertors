/**
 * Picture geometry adapted from python-hwpx (Copyright 2025-2026 airmang),
 * Apache-2.0. See assets/python-hwpx.LICENSE and assets/python-hwpx.NOTICE.
 * Adaptation: TypeScript DOM construction and full-page PDF image placement.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { TextBlock } from './pdf-text';

export interface ImagePage {
  png: Uint8Array;
  /** PDF point (1/72 inch), after rotation. */
  width: number;
  height: number;
}
export type DocumentPage = ImagePage | { width: number; height: number; blocks: TextBlock[] };

const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const HC = 'http://www.hancom.co.kr/hwpml/2011/core';
const OPF = 'http://www.idpf.org/2007/opf/';
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

function xml(bytes: Uint8Array): XMLDocument {
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('HWPX 템플릿 XML이 올바르지 않습니다.');
  return doc;
}

/** Single image page; also used as the package template for multi-page output. */
function imagePageToHwpx(template: Uint8Array, page: ImagePage): Uint8Array {
  if (![page.width, page.height].every(n => Number.isFinite(n) && n >= 1 && n <= 14400)) {
    throw new Error('지원하지 않는 쪽 크기입니다.');
  }
  if (page.png.length < 24 || !PNG.every((byte, i) => page.png[i] === byte)) {
    throw new Error('PNG 그림이 필요합니다.');
  }
  if (page.png.length > 64 * 1024 * 1024) throw new Error('그림이 64MB 한도를 초과했습니다.');
  const entries = unzipSync(template);
  const section = xml(entries['Contents/section0.xml']!);
  const manifest = xml(entries['Contents/content.hpf']!);
  const width = Math.round(page.width * 100);
  const height = Math.round(page.height * 100);
  const pagePr = section.getElementsByTagNameNS(HP, 'pagePr')[0]!;
  // Dimensions are already rotated: WIDELY leaves width/height as supplied.
  pagePr.setAttribute('landscape', 'WIDELY');
  pagePr.setAttribute('width', String(width));
  pagePr.setAttribute('height', String(height));
  const margin = pagePr.getElementsByTagNameNS(HP, 'margin')[0]!;
  for (const name of ['header', 'footer', 'gutter', 'left', 'right', 'top', 'bottom']) margin.setAttribute(name, '0');
  const paragraph = section.getElementsByTagNameNS(HP, 'p')[0]!;
  paragraph.setAttribute('id', '0');
  for (const run of Array.from(paragraph.getElementsByTagNameNS(HP, 'run'))) {
    if (!run.getElementsByTagNameNS(HP, 'secPr').length) run.remove();
  }
  for (const segments of Array.from(paragraph.getElementsByTagNameNS(HP, 'linesegarray'))) segments.remove();
  const append = (parent: Element, name: string, attrs: Record<string, string | number> = {}): Element => {
    const el = section.createElementNS(name.startsWith('hc:') ? HC : HP, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    parent.append(el);
    return el;
  };
  const run = append(paragraph, 'hp:run', { charPrIDRef: 0 });
  // Picture geometry follows python-hwpx's corpus-derived OWPML shape layout.
  const picture = append(run, 'hp:pic', {
    id: 1, instid: 1, zOrder: 0, numberingType: 'PICTURE', textWrap: 'BEHIND_TEXT',
    textFlow: 'BOTH_SIDES', lock: 0, dropcapstyle: 'None', href: '', groupLevel: 0, reverse: 0,
  });
  append(picture, 'hp:offset', { x: 0, y: 0 });
  append(picture, 'hp:orgSz', { width, height });
  append(picture, 'hp:curSz', { width, height });
  append(picture, 'hp:flip', { horizontal: 0, vertical: 0 });
  append(picture, 'hp:rotationInfo', { angle: 0, centerX: Math.floor(width / 2), centerY: Math.floor(height / 2), rotateimage: 1 });
  const rendering = append(picture, 'hp:renderingInfo');
  for (const name of ['transMatrix', 'scaMatrix', 'rotMatrix']) {
    append(rendering, `hc:${name}`, { e1: 1, e2: 0, e3: 0, e4: 0, e5: 1, e6: 0 });
  }
  const rect = append(picture, 'hp:imgRect');
  [[0, 0], [width, 0], [width, height], [0, height]].forEach(([x, y], i) => append(rect, `hc:pt${i}`, { x: x!, y: y! }));
  append(picture, 'hp:imgClip', { left: 0, right: width, top: 0, bottom: height });
  append(picture, 'hp:inMargin', { left: 0, right: 0, top: 0, bottom: 0 });
  append(picture, 'hp:imgDim', { dimwidth: width, dimheight: height });
  append(picture, 'hc:img', { binaryItemIDRef: 'pdf-page', bright: 0, contrast: 0, effect: 'REAL_PIC', alpha: 0 });
  append(picture, 'hp:effects');
  append(picture, 'hp:sz', { width, height, widthRelTo: 'ABSOLUTE', heightRelTo: 'ABSOLUTE', protect: 0 });
  append(picture, 'hp:pos', {
    treatAsChar: 0, affectLSpacing: 0, flowWithText: 0, allowOverlap: 1, holdAnchorAndSO: 0,
    vertRelTo: 'PAPER', horzRelTo: 'PAPER', vertAlign: 'TOP', horzAlign: 'LEFT', vertOffset: 0, horzOffset: 0,
  });
  append(picture, 'hp:outMargin', { left: 0, right: 0, top: 0, bottom: 0 });
  append(picture, 'hp:shapeComment').textContent = 'PDF 쪽 이미지 (텍스트 편집 불가)';
  append(run, 'hp:t');
  const metadata = manifest.getElementsByTagNameNS(OPF, 'metadata')[0]!;
  metadata.replaceChildren();
  const title = manifest.createElementNS(OPF, 'opf:title');
  title.textContent = 'PDF 이미지 변환';
  metadata.append(title);
  const item = manifest.createElementNS(OPF, 'opf:item');
  for (const [key, value] of Object.entries({ id: 'pdf-page', href: 'BinData/pdf-page.png', 'media-type': 'image/png', 'isEmbeded': '1' })) item.setAttribute(key, value);
  manifest.getElementsByTagNameNS(OPF, 'manifest')[0]!.append(item);
  const serialize = (doc: XMLDocument): Uint8Array => strToU8(new XMLSerializer().serializeToString(doc));
  entries['Contents/section0.xml'] = new Uint8Array(serialize(section));
  entries['Contents/content.hpf'] = new Uint8Array(serialize(manifest));
  entries['BinData/pdf-page.png'] = new Uint8Array(page.png);
  entries['Preview/PrvText.txt'] = strToU8('PDF 이미지 변환 — 글자와 표를 직접 편집할 수 없습니다.');
  delete entries['Preview/PrvImage.png'];
  // The mimetype MUST be the first entry and must be stored, not compressed.
  const files: Zippable = { mimetype: [strToU8('application/hwp+zip'), { level: 0 }] };
  for (const [name, bytes] of Object.entries(entries)) if (name !== 'mimetype') files[name] = [bytes, { level: name.endsWith('.png') ? 0 : 6 }];
  return zipSync(files);
}

/** One section per source page preserves mixed paper sizes. */
export function documentToHwpx(template: Uint8Array, pages: DocumentPage[]): Uint8Array {
  if (!pages.length) throw new Error('저장할 쪽이 없습니다.');
  if (pages.length > 100) throw new Error('HWPX는 100쪽까지 변환할 수 있습니다.');
  const entries = unzipSync(template);
  const packageDoc = xml(entries['Contents/content.hpf']!);
  const manifest = packageDoc.getElementsByTagNameNS(OPF, 'manifest')[0]!;
  const spine = packageDoc.getElementsByTagNameNS(OPF, 'spine')[0]!;
  for (const el of Array.from(manifest.children)) if (el.getAttribute('id')?.startsWith('section')) el.remove();
  for (const el of Array.from(spine.children)) if (el.getAttribute('idref') !== 'header') el.remove();
  packageDoc.getElementsByTagNameNS(OPF, 'metadata')[0]!.replaceChildren();
  let nextId = 10;
  let totalBytes = 0;
  const preview: string[] = [];
  const opf = (parent: Element, name: string, attributes: Record<string, string>): void => {
    const el = packageDoc.createElementNS(OPF, `opf:${name}`);
    Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
    parent.append(el);
  };
  pages.forEach((page, n) => {
    // Only used to build the base XML for text pages; never emitted as an image.
    const placeholder = new Uint8Array(24); placeholder.set(PNG);
    const single = unzipSync(imagePageToHwpx(template, { ...page, png: 'png' in page ? page.png : placeholder }));
    const section = xml(single['Contents/section0.xml']!);
    const add = (parent: Element, name: string, attrs: Record<string, string | number> = {}): Element => {
      const el = section.createElementNS(HP, `hp:${name}`);
      Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
      parent.append(el); return el;
    };
    const paragraph = (parent: Element, text: string): Element => {
      const p = add(parent, 'p', { id: nextId++, paraPrIDRef: 0, styleIDRef: 0, pageBreak: 0, columnBreak: 0, merged: 0 });
      add(add(p, 'run', { charPrIDRef: 0 }), 't').textContent = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
      return p;
    };
    section.getElementsByTagNameNS(HP, 'secPr')[0]!.setAttribute('id', String(n));
    if ('png' in page) {
      const imageId = `image${n}`;
      section.getElementsByTagNameNS(HC, 'img')[0]!.setAttribute('binaryItemIDRef', imageId);
      const pic = section.getElementsByTagNameNS(HP, 'pic')[0]!;
      pic.setAttribute('id', String(nextId)); pic.setAttribute('instid', String(nextId++));
      entries[`BinData/${imageId}.png`] = new Uint8Array(page.png);
      opf(manifest, 'item', { id: imageId, href: `BinData/${imageId}.png`, 'media-type': 'image/png', isEmbeded: '1' });
      totalBytes += page.png.length;
      preview.push(`[${n + 1}쪽 이미지]`);
    } else {
      section.getElementsByTagNameNS(HP, 'pic')[0]!.remove();
      const margin = section.getElementsByTagNameNS(HP, 'margin')[0]!;
      const inset = Math.round(Math.min(24, page.width / 10, page.height / 10) * 100);
      for (const side of ['left', 'right', 'top', 'bottom']) margin.setAttribute(side, String(inset));
      for (const block of page.blocks) {
        if (block.kind === 'paragraph') { paragraph(section.documentElement, block.text); preview.push(block.text); continue; }
        if (!block.rows.length || !block.rows[0]!.length || block.rows.some(row => row.length !== block.rows[0]!.length)) throw new Error('표의 행과 열 수가 일치하지 않습니다.');
        const cols = block.rows[0]!.length;
        const width = Math.round(page.width * 100) - inset * 2;
        const height = block.rows.length * 2400;
        const p = paragraph(section.documentElement, '');
        const run = p.getElementsByTagNameNS(HP, 'run')[0]!;
        const table = add(run, 'tbl', { id: nextId++, zOrder: 0, numberingType: 'TABLE', textWrap: 'TOP_AND_BOTTOM', textFlow: 'BOTH_SIDES', lock: 0, dropcapstyle: 'None', pageBreak: 'CELL', repeatHeader: 0, rowCnt: block.rows.length, colCnt: cols, cellSpacing: 0, borderFillIDRef: 1, noAdjust: 0 });
        add(table, 'sz', { width, height, widthRelTo: 'ABSOLUTE', heightRelTo: 'ABSOLUTE', protect: 0 });
        add(table, 'pos', { treatAsChar: 1, affectLSpacing: 0, flowWithText: 1, allowOverlap: 0, holdAnchorAndSO: 0, vertRelTo: 'PARA', horzRelTo: 'COLUMN', vertAlign: 'TOP', horzAlign: 'LEFT', vertOffset: 0, horzOffset: 0 });
        add(table, 'outMargin', { left: 0, right: 0, top: 0, bottom: 0 });
        add(table, 'inMargin', { left: 100, right: 100, top: 100, bottom: 100 });
        block.rows.forEach((row, r) => {
          const tr = add(table, 'tr');
          row.forEach((text, c) => {
            const tc = add(tr, 'tc', { name: '', header: 0, hasMargin: 0, protect: 0, editable: 0, dirty: 0, borderFillIDRef: 1 });
            const sub = add(tc, 'subList', { id: '', textDirection: 'HORIZONTAL', lineWrap: 'BREAK', vertAlign: 'CENTER', linkListIDRef: 0, linkListNextIDRef: 0, textWidth: 0, textHeight: 0, hasTextRef: 0, hasNumRef: 0 });
            paragraph(sub, text);
            add(tc, 'cellAddr', { colAddr: c, rowAddr: r });
            add(tc, 'cellSpan', { colSpan: 1, rowSpan: 1 });
            add(tc, 'cellSz', { width: Math.floor(width / cols) + (c === cols - 1 ? width % cols : 0), height: 2400 });
            add(tc, 'cellMargin', { left: 100, right: 100, top: 100, bottom: 100 });
          });
          preview.push(row.join('\t'));
        });
      }
    }
    for (const p of Array.from(section.getElementsByTagNameNS(HP, 'p'))) p.setAttribute('id', String(nextId++));
    const name = `Contents/section${n}.xml`;
    entries[name] = strToU8(new XMLSerializer().serializeToString(section));
    totalBytes += entries[name]!.length;
    if (totalBytes > 64 * 1024 * 1024) throw new Error('출력이 64MB를 초과했습니다. 쪽 수 또는 해상도를 줄여 주세요.');
    opf(manifest, 'item', { id: `section${n}`, href: name, 'media-type': 'application/xml' });
    opf(spine, 'itemref', { idref: `section${n}`, linear: 'yes' });
  });
  const header = xml(entries['Contents/header.xml']!);
  header.documentElement.setAttribute('secCnt', String(pages.length));
  entries['Contents/header.xml'] = strToU8(new XMLSerializer().serializeToString(header));
  entries['Contents/content.hpf'] = strToU8(new XMLSerializer().serializeToString(packageDoc));
  entries['Preview/PrvText.txt'] = strToU8(preview.join('\n').slice(0, 20000));
  delete entries['Preview/PrvImage.png'];
  const files: Zippable = { mimetype: [strToU8('application/hwp+zip'), { level: 0 }] };
  for (const [name, bytes] of Object.entries(entries)) if (name !== 'mimetype') files[name] = [bytes, { level: name.endsWith('.png') ? 0 : 6 }];
  return zipSync(files);
}
