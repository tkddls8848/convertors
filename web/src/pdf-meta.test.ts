import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { clearMeta, pdfVersion, readMeta, writeMeta } from './pdf-meta';

/** 정보를 잔뜩 적은 PDF. XMP 스트림과 덧붙여 고친 옛 Info 까지 흉내 낸다. */
async function sample(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([200, 200]).drawText('body text stays');
  document.setTitle('Secret Plan');
  document.setAuthor('홍길동');
  document.setSubject('Quarterly');
  document.setKeywords(['alpha', 'beta']);
  document.setCreator('Hangul 2024');
  document.setProducer('Acme PDF');
  document.setCreationDate(new Date(Date.UTC(2024, 0, 2, 3, 4, 5)));
  document.setModificationDate(new Date(Date.UTC(2024, 5, 6, 7, 8, 9)));
  const info = document.context.lookup(document.context.trailerInfo.Info) as unknown as { set(k: PDFName, v: PDFHexString): void };
  info.set(PDFName.of('Company'), PDFHexString.fromText('ACME Corp'));
  const xmp = document.context.stream('<x:xmpmeta><dc:creator>XMP-AUTHOR-NAME</dc:creator></x:xmpmeta>', {
    Type: 'Metadata', Subtype: 'XML',
  });
  document.catalog.set(PDFName.of('Metadata'), document.context.register(xmp));
  // 앞 판의 Info 가 가리키는 이 없이 남아 있는 모양.
  document.context.register(document.context.obj({ Author: PDFHexString.fromText('OLD-REVISION-AUTHOR') }));
  return document.save({ useObjectStreams: false });
}

const latin = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);
const utf16 = (text: string): string => [...text].map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();

describe('readMeta', () => {
  it('Info 사전과 XMP 유무, 판을 읽는다', async () => {
    const meta = await readMeta(await sample());
    expect(meta.text).toEqual({
      Title: 'Secret Plan', Author: '홍길동', Subject: 'Quarterly', Keywords: 'alpha beta',
      Creator: 'Hangul 2024', Producer: 'Acme PDF',
    });
    expect(meta.creationDate?.toISOString()).toBe('2024-01-02T03:04:05.000Z');
    expect(meta.modificationDate?.toISOString()).toBe('2024-06-06T07:08:09.000Z');
    expect(meta.otherKeys).toEqual(['Company']);
    expect(meta.hasXmp).toBe(true);
    expect(meta.pages).toBe(1);
    expect(meta.version).toBe('1.7');
    expect(meta.javaScript).toBe(false);
    expect(meta.attachments).toBe(0);
    expect(meta.formFields).toBe(0);
  });

  it('첨부·스크립트·양식을 알아본다', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    await document.attach(new TextEncoder().encode('hello'), 'note.txt', { mimeType: 'text/plain' });
    document.addJavaScript('greet', 'app.alert("hi")');
    document.getForm().createTextField('name').addToPage(document.getPage(0));
    const meta = await readMeta(await document.save());
    expect(meta.attachments).toBe(1);
    expect(meta.javaScript).toBe(true);
    expect(meta.formFields).toBe(1);
  });

  it('머리의 판과 목록의 판 중 높은 것을 쓴다', () => {
    const head = new TextEncoder().encode('%PDF-1.4\n%âãÏÓ\n');
    expect(pdfVersion(head)).toBe('1.4');
    expect(pdfVersion(head, '1.7')).toBe('1.7');
    expect(pdfVersion(head, '1.3')).toBe('1.4');
    expect(pdfVersion(new Uint8Array(0))).toBe('알 수 없음');
  });
});

describe('clearMeta', () => {
  it('모든 항목과 XMP 를 지우고, 파일 안에도 남기지 않는다', async () => {
    const source = await sample();
    expect(latin(source)).toContain('XMP-AUTHOR-NAME');
    const cleared = await clearMeta(source);
    const meta = await readMeta(cleared);
    expect(Object.values(meta.text).every(value => value === '')).toBe(true);
    expect(meta.creationDate).toBeUndefined();
    expect(meta.modificationDate).toBeUndefined();
    expect(meta.otherKeys).toEqual([]);
    expect(meta.hasXmp).toBe(false);
    const text = latin(cleared);
    expect(text).not.toContain('XMP-AUTHOR-NAME');
    expect(text).not.toContain('/Metadata');
    // pdf-lib 이 제 이름을 Producer 로 적지 않는다.
    expect(text).not.toMatch(/pdf-lib/i);
    // 가리키는 이 없던 옛 Info 도 사라진다.
    expect(text).not.toContain(utf16('OLD-REVISION-AUTHOR'));
    expect(text).not.toContain(utf16('Secret Plan'));
    // 쪽 내용은 그대로다.
    expect((await PDFDocument.load(cleared)).getPageCount()).toBe(1);
  });
});

describe('writeMeta', () => {
  it('한글까지 왕복하고, 비운 칸은 항목째 지운다', async () => {
    const written = await writeMeta(await sample(), { Title: '견적서 2026 — 최종', Author: '', Keywords: '견적, 조달' });
    const meta = await readMeta(written);
    expect(meta.text.Title).toBe('견적서 2026 — 최종');
    expect(meta.text.Author).toBe('');
    expect(meta.text.Keywords).toBe('견적, 조달');
    // 건드리지 않은 칸은 그대로다.
    expect(meta.text.Producer).toBe('Acme PDF');
    expect(meta.hasXmp).toBe(false);
    const document = await PDFDocument.load(written, { updateMetadata: false });
    const info = document.context.lookup(document.context.trailerInfo.Info) as unknown as { has(key: PDFName): boolean };
    expect(info.has(PDFName.of('Author'))).toBe(false);
  });
});
