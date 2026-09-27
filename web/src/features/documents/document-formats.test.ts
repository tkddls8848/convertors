// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import { readContent, writeContent, contentText, type ContentDocument } from './document-formats';

const doc: ContentDocument = { title: '한글 & test', notes: [], blocks: [
  { kind: 'paragraph', text: '한글 <본문> & 😀\n둘째 줄' },
  { kind: 'table', rows: [['품목', '수량'], ['연필', '03']] },
] };
describe('content formats', () => {
  for (const format of ['docx', 'odt', 'fodt', 'epub']) it(`${format}: Korean, escaping, paragraphs and table round trip`, async () => {
    const file = await writeContent(doc, format);
    const read = await readContent(file.bytes, file.name);
    expect(read.blocks).toEqual(doc.blocks);
    if (format === 'epub' || format === 'odt') {
      const entries = unzipSync(file.bytes);
      expect(strFromU8(entries['mimetype']!)).toContain(format === 'epub' ? 'epub' : 'opendocument');
      expect(new DataView(file.bytes.buffer as ArrayBuffer).getUint16(8, true)).toBe(0);
    }
  });
  it('writes real OOXML content types and root relationship', async () => {
    const entries = unzipSync((await writeContent(doc, 'docx')).bytes);
    expect(strFromU8(entries['[Content_Types].xml']!)).toContain('/word/document.xml');
    expect(strFromU8(entries['_rels/.rels']!)).toContain('Target="word/document.xml"');
  });
  it('HTML input never retains scripts, events, images or remote links', async () => {
    const read = await readContent(strToU8('<p onclick="alert(1)">본문</p><script>alert(1)</script><img src="https://bad.invalid/pixel"><table><tr><td>A</td><td>B</td></tr></table>'), 'x.html');
    expect(read.blocks).toEqual([{ kind: 'paragraph', text: '본문' }, { kind: 'table', rows: [['A', 'B']] }]);
    const html = strFromU8((await writeContent(read, 'html')).bytes);
    expect(html).not.toMatch(/onclick|bad.invalid|alert\(1\)/);
  });
  it('RTF unicode uses signed UTF-16 and escapes control syntax', async () => {
    const rtf = strFromU8((await writeContent({ ...doc, blocks: [{ kind: 'paragraph', text: '{한}😀\\' }] }, 'rtf')).bytes);
    expect(rtf).toContain('\\{\\u-10916?\\}');
    expect(rtf).toContain('\\u-10179?\\u-8704?');
  });
  it('FB2 and TXT retain Korean body', async () => {
    expect(contentText(await readContent((await writeContent(doc, 'fb2')).bytes, 'x.fb2'))).toContain('한글 <본문> & 😀');
    expect(strFromU8((await writeContent(doc, 'txt')).bytes)).toContain('연필\t03');
  });
  it('uses PPTX relationship order, not ZIP filename order', async () => {
    const bytes = zipSync(Object.fromEntries(Object.entries({
      'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="b"/><p:sldId r:id="a"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="a" Target="slides/slide1.xml"/><Relationship Id="b" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<s xmlns:a="a"><a:p><a:r><a:t>first</a:t></a:r></a:p></s>',
      'ppt/slides/slide2.xml': '<s xmlns:a="a"><a:p><a:r><a:t>second</a:t></a:r></a:p></s>',
    }).map(([k, v]) => [k, [strToU8(v), { level: 0 }]])) as never);
    expect((await readContent(bytes, 'x.pptx')).blocks).toEqual([{ kind: 'paragraph', text: 'second' }, { kind: 'paragraph', text: 'first' }]);
  });
  it('rejects binary DOC, invalid XML and non UTF-8 text', async () => {
    await expect(readContent(strToU8('fake'), 'x.doc')).rejects.toThrow('지원하지');
    await expect(readContent(strToU8('<broken'), 'x.fodt')).rejects.toThrow('손상');
    await expect(readContent(new Uint8Array([0xff, 0xff]), 'x.txt')).rejects.toThrow('UTF-8');
  });
});
