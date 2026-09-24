/** Content conversion, not a page-layout engine. No uploaded HTML is executed. */
import { strToU8, zipSync, type Zippable } from 'fflate';
import { readZip, type ZipEntries } from './zip';
import { parseMarkdown } from './markdown';
import type { TextBlock } from './pdf-text';
import { DOCUMENT_INPUTS, DOCUMENT_OUTPUTS, MAX_INPUT, CONTENT_NOTE, escapeXml, type ConversionFile } from './format-catalog';

export interface ContentDocument { title: string; blocks: TextBlock[]; notes: string[] }
const MAX_TEXT = 2_000_000;
const decode = (b: Uint8Array): string => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { throw new Error('UTF-8 문서가 아닙니다. 인코딩 변환 도구에서 UTF-8로 바꿔 주세요.'); }
};
function xml(s: string): XMLDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw new Error('DTD·외부 엔티티가 있는 XML은 지원하지 않습니다.');
  const d = new DOMParser().parseFromString(s, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) throw new Error('문서 XML이 손상되었습니다.');
  return d;
}
const elements = (e: Document | Element, name: string): Element[] => Array.from(e.getElementsByTagNameNS('*', name));
function part(entries: ZipEntries, name: string): XMLDocument {
  const b = entries.get(name);
  if (!b) throw new Error(`문서 구성 파일이 없습니다: ${name}`);
  return xml(decode(b));
}
function textOf(e: Element): string {
  if (['script', 'style', 'iframe', 'object', 'binary', 'annotation'].includes(e.localName)) return '';
  if (['br', 'line-break'].includes(e.localName)) return '\n';
  if (e.localName === 'tab') return '\t';
  if (e.localName === 's') return ' '.repeat(Math.min(1000, Number(e.getAttribute('text:c') || 1) || 1));
  return Array.from(e.childNodes).map(n => n.nodeType === 3 ? n.textContent : n.nodeType === 1 ? textOf(n as Element) : '').join('');
}
/** Traverse blocks once; table contents must not also appear as body paragraphs. */
function blocksOf(root: Element): TextBlock[] {
  const blocks: TextBlock[] = [];
  const visit = (e: Element): void => {
    if (['script', 'style', 'iframe', 'object', 'binary', 'annotation', 'del', 'head', 'title', 'meta', 'link'].includes(e.localName)) return;
    if (['table', 'tbl'].includes(e.localName)) {
      const rows = Array.from(e.getElementsByTagNameNS('*', '*')).filter(n => ['tr', 'table-row'].includes(n.localName));
      const values = rows.map(r => Array.from(r.children).filter(c => ['td', 'th', 'tc', 'table-cell', 'covered-table-cell'].includes(c.localName)).map(c => {
        const paragraphs = elements(c, 'p');
        return paragraphs.length ? paragraphs.map(textOf).join('\n') : textOf(c).trim();
      }));
      if (values.some(r => r.length)) blocks.push({ kind: 'table', rows: values });
      return;
    }
    if (['p', 'h', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'subtitle', 'v'].includes(e.localName)) {
      blocks.push({ kind: 'paragraph', text: textOf(e) }); return;
    }
    for (const child of Array.from(e.childNodes)) {
      if (child.nodeType === 1) visit(child as Element);
      else if (child.nodeType === 3 && child.textContent?.trim()) blocks.push({ kind: 'paragraph', text: child.textContent.trim() });
    }
  };
  visit(root); return blocks;
}
function htmlBlocks(s: string): TextBlock[] {
  // Template is inert: unlike live DOM, remote images/frames are never loaded.
  const template = document.createElement('template'); template.innerHTML = s;
  const container = document.createElement('div'); container.append(template.content);
  return blocksOf(container);
}
function relative(base: string, href: string): string {
  if (/^[a-z]+:|^\/|\\/i.test(href)) throw new Error('외부 문서 참조는 지원하지 않습니다.');
  const path = base.split('/'); path.pop();
  for (const segment of decodeURIComponent(href.split('#')[0]!).split('/')) {
    if (segment === '..') { if (!path.length) throw new Error('문서 경로가 잘못되었습니다.'); path.pop(); }
    else if (segment && segment !== '.') path.push(segment);
  }
  return path.join('/');
}
export async function readContent(bytes: Uint8Array, name: string): Promise<ContentDocument> {
  if (!bytes.length || bytes.length > MAX_INPUT) throw new Error('입력은 1바이트~16MB까지 지원합니다.');
  const ext = name.split('.').pop()!.toLowerCase();
  if (!DOCUMENT_INPUTS.includes(ext)) throw new Error('지원하지 않는 입력 형식입니다. DOC·HWP 바이너리는 지원하지 않습니다.');
  let blocks: TextBlock[] = []; const notes = [CONTENT_NOTE];
  if (['txt', 'md', 'markdown'].includes(ext)) {
    const parsed = parseMarkdown(decode(bytes), { markdown: ext !== 'txt' }); blocks = parsed.blocks; notes.push(...parsed.notes);
  } else if (['html', 'htm'].includes(ext)) blocks = htmlBlocks(decode(bytes));
  else if (ext === 'fb2') {
    const d = xml(decode(bytes)); for (const body of elements(d, 'body')) blocks.push(...blocksOf(body));
  } else if (ext === 'fodt') {
    const d = xml(decode(bytes)); const body = elements(d, 'body')[0]; if (!body) throw new Error('ODF 본문이 없습니다.'); blocks = blocksOf(body);
  } else if (ext === 'hwpx') {
    const { hwpxToMarkdown } = await import('./hwpx'); blocks = parseMarkdown((await hwpxToMarkdown(bytes)).markdown).blocks;
  } else if (ext === 'pdf') {
    const { openPdf } = await import('./pdf-render'); const { reconstructText } = await import('./pdf-text');
    const task = openPdf(bytes);
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 200) throw new Error('PDF 텍스트 변환은 200쪽까지 지원합니다.');
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        try {
          const viewport = page.getViewport({ scale: 1 }); const content = await page.getTextContent();
          const found = reconstructText(content.items.flatMap(i => {
            if (!('str' in i)) return [];
            const [x, y] = viewport.convertToViewportPoint(i.transform[4]!, i.transform[5]!);
            return [{ text: i.str, x: x!, y: y!, width: i.width, height: Math.max(1, i.height) }];
          }), false);
          if (!found.length) notes.push(`${n}쪽에는 추출 가능한 글자가 없습니다. OCR은 지원하지 않습니다.`);
          blocks.push(...found);
        } finally { page.cleanup(); }
      }
    } finally { await task.destroy(); }
    notes.push('PDF의 읽는 순서는 추정입니다. 표는 일반 텍스트로 옮깁니다.');
  } else {
    const entries = await readZip(bytes, { maxSize: 32 * 1024 * 1024, maxEntries: 3000 });
    if (['docx', 'docm', 'dotx'].includes(ext)) {
      const d = part(entries, 'word/document.xml'); const body = elements(d, 'body')[0];
      if (!body) throw new Error('Word 본문이 없습니다.'); blocks = blocksOf(body);
    } else if (['odt', 'ott', 'odp'].includes(ext)) {
      const body = elements(part(entries, 'content.xml'), 'body')[0];
      if (!body) throw new Error('ODF 본문이 없습니다.'); blocks = blocksOf(body);
      notes.push('ODF 반복 셀·중첩 표는 원본과 대조해 주세요.');
    } else if (ext === 'epub') {
      if (entries.has('META-INF/encryption.xml')) throw new Error('암호화된 EPUB은 지원하지 않습니다.');
      const root = elements(part(entries, 'META-INF/container.xml'), 'rootfile')[0]?.getAttribute('full-path');
      if (!root) throw new Error('EPUB 목차 파일이 없습니다.');
      const opf = part(entries, root); const items = new Map(elements(opf, 'item').map(e => [e.getAttribute('id'), e.getAttribute('href')]));
      for (const item of elements(opf, 'itemref')) {
        const href = items.get(item.getAttribute('idref')); if (!href) throw new Error('EPUB 읽기 순서가 손상되었습니다.');
        const data = entries.get(relative(root, href)); if (!data) throw new Error('EPUB 본문이 없습니다.');
        blocks.push(...htmlBlocks(decode(data)));
      }
    } else {
      const d = part(entries, 'ppt/presentation.xml');
      const rels = new Map(elements(part(entries, 'ppt/_rels/presentation.xml.rels'), 'Relationship').map(e => [e.getAttribute('Id'), e.getAttribute('Target')]));
      for (const slide of elements(d, 'sldId')) {
        const id = slide.getAttribute('r:id') ?? slide.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        const target = rels.get(id); if (!target) throw new Error('슬라이드 순서가 손상되었습니다.');
        blocks.push(...blocksOf(part(entries, relative('ppt/presentation.xml', target)).documentElement));
      }
      notes.push('슬라이드의 글·표를 문서로 추출합니다. 슬라이드 배치·발표자 노트·애니메이션은 옮기지 않습니다.');
    }
  }
  const size = blocks.reduce((n, b) => n + (b.kind === 'paragraph' ? b.text.length : b.rows.flat().join('').length), 0);
  if (!size) throw new Error('추출 가능한 본문이 없습니다. 스캔 문서는 OCR이 필요합니다.');
  if (size > MAX_TEXT || blocks.length > 30000) throw new Error('본문은 200만 자·30,000개 문단/표까지 지원합니다.');
  return { title: name.replace(/\.[^.]+$/, ''), blocks, notes };
}
export function contentHtml(doc: ContentDocument): string {
  return doc.blocks.map(b => b.kind === 'paragraph' ? `<p>${escapeXml(b.text).replace(/\n/g, '<br />')}</p>` : `<table>${b.rows.map(r => `<tr>${r.map(c => `<td>${escapeXml(c)}</td>`).join('')}</tr>`).join('')}</table>`).join('\n');
}
export function contentText(doc: ContentDocument): string {
  return doc.blocks.map(b => b.kind === 'paragraph' ? b.text : b.rows.map(r => r.join('\t')).join('\n')).join('\n\n');
}
function pack(files: Record<string, string>, mimetype?: string): Uint8Array {
  const entries: Zippable = {};
  if (mimetype) entries['mimetype'] = [strToU8(mimetype), { level: 0 }];
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return zipSync(entries);
}
const odfNamespaces = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';
export async function writeContent(doc: ContentDocument, format: string): Promise<ConversionFile> {
  if (!DOCUMENT_OUTPUTS.includes(format)) throw new Error('지원하지 않는 출력 형식입니다.');
  const title = escapeXml(doc.title); const html = contentHtml(doc); let bytes: Uint8Array; let mime = 'application/octet-stream';
  if (format === 'txt') { bytes = strToU8(contentText(doc)); mime = 'text/plain;charset=utf-8'; }
  else if (format === 'md') {
    const cell = (s: string): string => s.replace(/\\/g, '\\\\').replace(/([`*_{}\[\]<>#])/g, '\\$1').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    bytes = strToU8(doc.blocks.map(b => b.kind === 'paragraph' ? cell(b.text) : b.rows.map((r, i) => `| ${r.map(cell).join(' | ')} |${i === 0 ? `\n| ${r.map(() => '---').join(' | ')} |` : ''}`).join('\n')).join('\n\n')); mime = 'text/markdown;charset=utf-8';
  } else if (format === 'html') {
    bytes = strToU8(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title><style>body{max-width:900px;margin:2em auto;font-family:sans-serif}p,td{white-space:pre-wrap}table{border-collapse:collapse}td{border:1px solid #888;padding:.4em}</style></head><body>${html}</body></html>`); mime = 'text/html;charset=utf-8';
  } else if (format === 'rtf') {
    let body = ''; for (let i = 0, s = contentText(doc); i < s.length; i++) {
      const c = s[i]!, n = s.charCodeAt(i);
      body += c === '\n' ? '\\par\n' : c === '\t' ? '\\tab ' : /[\\{}]/.test(c) ? `\\${c}` : n > 127 ? `\\u${n > 32767 ? n - 65536 : n}?` : c;
    }
    bytes = strToU8(`{\\rtf1\\ansi\\deff0\\uc1 ${body}}`); mime = 'application/rtf';
  } else if (format === 'docx') {
    const p = (s: string): string => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(s).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">').replace(/\t/g, '</w:t><w:tab/><w:t xml:space="preserve">')}</w:t></w:r></w:p>`;
    const body = doc.blocks.map(b => b.kind === 'paragraph' ? p(b.text) : `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${Array.from({ length: Math.max(...b.rows.map(r => r.length)) }, () => '<w:gridCol w:w="2400"/>').join('')}</w:tblGrid>${b.rows.map(r => `<w:tr>${r.map(c => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`).join('');
    bytes = pack({ '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', 'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>` });
    mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else if (format === 'odt' || format === 'fodt') {
    const p = (s: string): string => `<text:p>${escapeXml(s).replace(/ /g, '<text:s/>').replace(/\t/g, '<text:tab/>').replace(/\n/g, '<text:line-break/>')}</text:p>`;
    const body = doc.blocks.map((b, i) => b.kind === 'paragraph' ? p(b.text) : `<table:table table:name="Table${i}">${b.rows.map(r => `<table:table-row>${r.map(c => `<table:table-cell office:value-type="string">${p(c)}</table:table-cell>`).join('')}</table:table-row>`).join('')}</table:table>`).join('');
    const tag = format === 'fodt' ? 'document' : 'document-content';
    const content = `<office:${tag} ${odfNamespaces} office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.text"><office:body><office:text>${body}</office:text></office:body></office:${tag}>`;
    mime = 'application/vnd.oasis.opendocument.text';
    bytes = format === 'fodt' ? strToU8(content) : pack({ 'content.xml': content, 'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>' }, mime);
  } else if (format === 'epub') {
    mime = 'application/epub+zip';
    bytes = pack({ 'META-INF/container.xml': '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', 'OEBPS/content.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:${crypto.randomUUID()}</dc:identifier><dc:title>${title}</dc:title><dc:language>ko</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="body"/></spine></package>`, 'OEBPS/body.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${html}</body></html>`, 'OEBPS/nav.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>목차</title></head><body><nav epub:type="toc"><ol><li><a href="body.xhtml">${title}</a></li></ol></nav></body></html>` }, mime);
  } else if (format === 'fb2') {
    bytes = strToU8(`<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>prose_contemporary</genre><author><nickname>Unknown</nickname></author><book-title>${title}</book-title><lang>ko</lang></title-info><document-info><author><nickname>Document Converter</nickname></author><date>${new Date().toISOString().slice(0,10)}</date><id>${crypto.randomUUID()}</id><version>1.0</version></document-info></description><body><section>${contentText(doc).split('\n').map(s => s ? `<p>${escapeXml(s)}</p>` : '<empty-line/>').join('')}</section></body></FictionBook>`); mime = 'application/xml';
  } else {
    const [{ documentToHwpx }, { default: templateUrl }] = await Promise.all([import('./hwpx-writer'), import('./assets/Skeleton.hwpx?url')]);
    const response = await fetch(templateUrl); if (!response.ok) throw new Error('HWPX 템플릿을 읽지 못했습니다.');
    bytes = documentToHwpx(new Uint8Array(await response.arrayBuffer()), [{ width: 595.28, height: 841.89, blocks: doc.blocks }]); mime = 'application/hwp+zip';
  }
  if (bytes.length > 32 * 1024 * 1024) throw new Error('결과가 32MB 한도를 초과했습니다.');
  return { name: `${doc.title}.${format}`, bytes, mime };
}
