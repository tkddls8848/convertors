import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const { unzipSync, strFromU8 } = require('fflate');
const { PDFDocument } = require('pdf-lib');
const base = process.env.FORMAT_TEST_URL ?? 'http://127.0.0.1:18574';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(base + '/')) external.push(r.url()); });
  await page.goto(`${base}/#converters`);
  await page.locator('[data-choice="document"]').click();
  await page.locator('#conv-document-file').setInputFiles({ name: '한글.md', mimeType: 'text/markdown', buffer: Buffer.from('# 제목\n\n본문 한글\n\n| 품목 | 수량 |\n| --- | --- |\n| 연필 | 3 |') });
  const download = async () => {
    const link = page.locator('.format-outputs a').last();
    await link.waitFor();
    const pending = page.waitForEvent('download'); await link.click(); await pending;
    return Buffer.from(await link.evaluate(async a => [...new Uint8Array(await (await fetch(a.href)).arrayBuffer())]));
  };
  for (const format of ['docx', 'odt', 'fodt', 'txt', 'md', 'html', 'rtf', 'epub', 'fb2', 'hwpx']) {
    await page.locator('.format-target').selectOption(format); await page.locator('.format-run').click();
    await page.waitForFunction(() => document.querySelector('.conv-document .conv-status').dataset.tone === 'ok');
    const bytes = await download(); assert.ok(bytes.length > 10, format);
    if (format === 'docx') assert.match(strFromU8(unzipSync(bytes)['word/document.xml']), /본문 한글/);
    if (format === 'hwpx') assert.match(strFromU8(unzipSync(bytes)['Contents/section0.xml']), /본문 한글/);
  }
  const pdf = await PDFDocument.create(); pdf.addPage().drawText('Extract this text'); pdf.addPage();
  await page.locator('#conv-document-file').setInputFiles({ name: 'text.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.locator('.format-target').selectOption('txt'); await page.locator('.format-run').click();
  await page.waitForFunction(() => document.querySelector('.conv-document .conv-status').dataset.tone === 'ok');
  assert.match((await download()).toString('utf8'), /Extract this text/);
  assert.match(await page.locator('.format-notes').innerText(), /2쪽에는/);
  await page.locator('[data-choice="spreadsheet"]').click();
  const book = XLSX.utils.book_new();
  for (const name of ['한글', 'Sheet2']) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['이름', '값'], ['테스트', 3]]), name);
  await page.locator('#conv-spreadsheet-file').setInputFiles({ name: 'sample.xlsx', mimeType: 'application/octet-stream', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
  await page.locator('.format-target').selectOption('csv'); await page.locator('.format-run').click();
  await page.waitForFunction(() => document.querySelector('.conv-spreadsheet .conv-status').dataset.tone === 'ok');
  assert.equal(await page.locator('.format-outputs a').count(), 3);
  assert.match((await download()).toString('utf8'), /테스트,3/);
  const zip = Buffer.from(await page.locator('.format-outputs a').first().evaluate(async a => [...new Uint8Array(await (await fetch(a.href)).arrayBuffer())]));
  assert.equal(Object.keys(unzipSync(zip)).length, 2);
  await page.locator('.format-target').selectOption('ods'); await page.locator('.format-run').click();
  await page.waitForFunction(() => document.querySelector('.conv-spreadsheet .conv-status').dataset.tone === 'ok');
  assert.deepEqual(XLSX.read(await download()).SheetNames, ['한글', 'Sheet2']);
  // New failed input must invalidate an old download.
  await page.locator('#conv-spreadsheet-file').setInputFiles({ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') });
  assert.equal(await page.locator('.format-outputs a').count(), 0);
  assert.equal(await page.locator('.format-run').isDisabled(), true);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: 10 document exports, PDF text/empty-page warning, spreadsheet worker, multiple sheets, real downloads, no external requests.');
} finally { await browser.close(); }
