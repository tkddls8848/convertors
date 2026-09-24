/** Run from any directory; Vite must be running. Only synthetic documents are used. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const { PDFDocument, degrees, rgb } = require('pdf-lib');
const { unzipSync, strFromU8 } = require('fflate');
const base = process.env.HWPX_TEST_URL ?? 'http://127.0.0.1:18574';
const out = new URL('../../.cache/hwpx-validation/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/@fs/${fileURLToPath(new URL('../probe.html', import.meta.url)).replaceAll('\\', '/')}`);
  await page.locator('#convert').waitFor();
  const source = await PDFDocument.create();
  const first = source.addPage([300, 400]);
  first.drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: rgb(0.8, 0.9, 1) });
  first.drawText('PDF to HWPX - Page 1', { x: 20, y: 200, size: 16 });
  const second = source.addPage([500, 200]);
  second.setRotation(degrees(90));
  second.drawText('Rotated Page 2', { x: 20, y: 80, size: 20 });
  const sourceBytes = Buffer.from(await source.save());
  await writeFile(new URL('source.pdf', out), sourceBytes);
  await page.locator('#file').setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer: sourceBytes });

  for (const [number, rotation, width, height, dpi] of [[1, 0, 30000, 40000, 150], [2, 90, 50000, 20000, 200], [1, 90, 40000, 30000, 300]]) {
    await page.locator('#page').fill(String(number));
    await page.locator('#rotation').selectOption(String(rotation));
    await page.locator('#dpi').selectOption(String(dpi));
    const start = Date.now();
    await page.locator('#convert').click();
    await page.locator('#download').waitFor({ state: 'visible' });
    const downloading = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloading;
    const name = `page-${number}-rotate-${rotation}-${dpi}dpi.hwpx`;
    const path = fileURLToPath(new URL(name, out));
    await download.saveAs(path);
    const bytes = await readFile(path);
    const zip = unzipSync(bytes);
    assert.equal(bytes.readUInt16LE(8), 0, 'mimetype must be stored');
    assert.equal(bytes.subarray(30, 38).toString(), 'mimetype');
    assert.equal(strFromU8(zip.mimetype), 'application/hwp+zip');
    const inspection = await page.evaluate(({ section, manifest }) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(section, 'application/xml');
      const packageDoc = parser.parseFromString(manifest, 'application/xml');
      const hp = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
      const pagePr = doc.getElementsByTagNameNS(hp, 'pagePr')[0];
      return { invalid: !!doc.querySelector('parsererror') || !!packageDoc.querySelector('parsererror'), width: Number(pagePr.getAttribute('width')), height: Number(pagePr.getAttribute('height')), pics: doc.getElementsByTagNameNS(hp, 'pic').length };
    }, { section: strFromU8(zip['Contents/section0.xml']), manifest: strFromU8(zip['Contents/content.hpf']) });
    assert.deepEqual(inspection, { invalid: false, width, height, pics: 1 });
    const image = Buffer.from(zip['BinData/image0.png']);
    assert.equal(image.readUInt32BE(16), Math.ceil(width / 100 * dpi / 72));
    assert.equal(image.readUInt32BE(20), Math.ceil(height / 100 * dpi / 72));
    await writeFile(new URL(name + '.png', out), image);
    console.log(`${name}: ${bytes.length} bytes, ${Date.now() - start} ms`);
  }

  await page.locator('#page').fill('999');
  await page.locator('#convert').click();
  await page.getByText('실패: 쪽 번호는 1~2 사이여야 합니다.', { exact: true }).waitFor();
  assert.equal(await page.locator('#download').isHidden(), true);
  await page.locator('#page').fill('1');
  await page.locator('#convert').click();
  await page.locator('#cancel').click();
  await page.getByText('취소했습니다.', { exact: true }).waitFor();
  assert.equal(await page.locator('#download').isHidden(), true);
  await page.locator('#file').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await page.locator('#convert').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('실패:'));
  assert.deepEqual(errors, []);
  console.log('PASS: PNG embedding, package XML, dimensions, rotations, DPI, download, invalid page, cancellation, invalid PDF. Hancom compatibility remains a separate gate.');
} finally { await browser.close(); }
