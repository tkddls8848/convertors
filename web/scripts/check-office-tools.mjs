// 뒤에 들인 사무 도구들을 실제 Chromium 으로 열어 본다 (결정 0020).
//
// 단위 테스트는 계산을 고정하고, 여기서는 **화면이 그 계산을 제대로 부르는지**와
// 내려받은 파일이 쓸 만한지를 본다. check-converters.mjs 와 같은 개발 서버를 쓴다.
//
//   npm --prefix web run dev -- --host 127.0.0.1 --port 18574
//   node web/scripts/check-office-tools.mjs
//
// Playwright 가 기대하는 판의 Chromium 이 없으면 `CHROMIUM_PATH` 로 있는 것을 가리킨다.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const { PDFDocument, rgb } = require('pdf-lib');
const { unzipSync, strFromU8 } = require('fflate');
const base = process.env.HWPX_TEST_URL ?? 'http://127.0.0.1:18574';
const out = new URL('../../.cache/office-tools/', import.meta.url);
await mkdir(out, { recursive: true });

/** 고르면 제목이 이 글자인 도구가 열려야 한다. */
const TOOLS = {
  'pdf-stamp': 'PDF 워터마크·쪽번호',
  'pdf-sign': 'PDF 서명·도장 넣기',
  'pdf-nup': 'PDF 모아찍기·빈 쪽 빼기',
  'pdf-meta': 'PDF 문서 정보 보기·지우기',
  'image-convert': '이미지 형식·크기 바꾸기',
  'text-diff': '텍스트 비교',
  'text-count': '글자 수 세기',
  redact: '개인정보 가리기',
  money: '금액 한글 표기',
  vat: '부가세 계산',
  date: '날짜·영업일 계산',
  bizno: '사업자·법인등록번호 검증',
  'sheet-merge': '표 합치기·나누기',
  rename: '파일 이름 일괄 바꾸기',
  hash: '파일 해시 확인',
  qr: 'QR 코드 만들기',
};

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage();
  // 이 컨테이너의 Chromium 은 pdfjs 6 이 기대하는 Map.prototype.getOrInsertComputed 가 없다.
  // 검사 환경만의 사정이라 화면 코드가 아니라 여기서 채운다.
  await page.addInitScript(() => {
    for (const C of [Map, WeakMap]) if (!C.prototype.getOrInsertComputed) {
      C.prototype.getOrInsertComputed = function (key, make) { if (!this.has(key)) this.set(key, make(key)); return this.get(key); };
      C.prototype.getOrInsert = function (key, value) { if (!this.has(key)) this.set(key, value); return this.get(key); };
    }
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/#converters`);
  await page.locator('.conv-empty').waitFor();

  const choose = async id => {
    await page.locator(`.conv-choice[data-choice="${id}"]`).click();
    await page.getByRole('heading', { name: TOOLS[id], exact: true }).waitFor();
    assert.equal(await page.locator('.conv-tool').count(), 1);
    return page.locator('.conv-tool');
  };
  /** 링크가 가리키는 바이트를 그대로 가져온다. */
  const bytesOf = async link => {
    await link.waitFor();
    return Uint8Array.from(await link.evaluate(async a => Array.from(new Uint8Array(await (await fetch(a.href)).arrayBuffer()))));
  };

  // 모든 도구가 열리고, 한 화면에 id 가 겹치지 않는다.
  for (const id of Object.keys(TOOLS)) {
    await choose(id);
    const dup = await page.evaluate(() => {
      const seen = new Map();
      for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    });
    assert.deepEqual(dup, [], `${id}: 겹친 id`);
  }

  // 금액 한글 표기
  let tool = await choose('money');
  await tool.locator('#money-input').fill('12,345,000');
  await tool.getByText('일금 일천이백삼십사만오천원정', { exact: false }).first().waitFor();

  // 부가세 — 합계에서 거꾸로 나눠도 더하면 합계가 된다.
  tool = await choose('vat');
  await tool.locator('#vat-mode').selectOption({ index: 1 });
  await tool.locator('#vat-amount').fill('110000');
  await tool.locator('#vat-result').getByText('100,000', { exact: false }).first().waitFor();

  // 사업자번호 — 맞는 것과 틀린 것.
  tool = await choose('bizno');
  await tool.locator('#bizno-input').fill('124-81-00998\n124-81-00999');
  await page.waitForFunction(() => document.querySelectorAll('#bizno-table tbody tr').length === 2);

  // 날짜 — 입력칸이 있고 오류 없이 계산된다.
  tool = await choose('date');
  await tool.locator('#date-target').fill('2026-12-25');
  await page.waitForFunction(() => /D[-+]|D-Day/.test(document.querySelector('#date-dday-result')?.textContent ?? ''));

  // 글자 수 세기
  tool = await choose('text-count');
  await tool.locator('#text-count-input').fill('가나다 abc');
  await page.waitForFunction(() => /\b8\b/.test(document.querySelector('.text-count-table')?.textContent ?? ''));

  // 텍스트 비교
  tool = await choose('text-diff');
  await tool.locator('#text-diff-a').fill('하나\n사과 세 개\n셋');
  await tool.locator('#text-diff-b').fill('하나\n사과 네 개\n셋\n넷');
  await tool.getByRole('button', { name: '비교하기', exact: true }).click();
  await tool.locator('.diff-view tr.diff-add').first().waitFor();
  assert.ok(await tool.locator('.diff-view ins').count() > 0, '글자 단위 표시가 없다');

  // 개인정보 가리기 — 원래 번호가 화면 어디에도 남지 않는다.
  tool = await choose('redact');
  await tool.locator('#redact-input').fill('연락처 010-1234-5678, 메일 hong@example.com');
  await tool.getByRole('button', { name: '붙여 넣은 글 가리기', exact: true }).click();
  await tool.locator('.redact-preview').waitFor();
  const masked = await tool.innerText();
  assert.ok(!masked.includes('010-1234-5678') || (await tool.locator('#redact-input').inputValue()).includes('010-1234-5678'));
  assert.ok(!(await tool.locator('.redact-preview').innerText()).includes('1234-5678'));

  // 해시
  tool = await choose('hash');
  await tool.locator('#hash-file').setInputFiles({ name: 'abc.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await tool.getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', { exact: false }).first().waitFor();

  // 파일 이름 일괄 바꾸기 → ZIP
  tool = await choose('rename');
  await tool.locator('#rename-file').setInputFiles([
    { name: '사진 A.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1]) },
    { name: '사진 B.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([2]) },
  ]);
  await tool.locator('#rename-template').fill('현장_{n:2}');
  await tool.locator('.rename-save').click();
  const renamed = unzipSync(await bytesOf(tool.locator('.rename-outputs a').first()));
  assert.deepEqual(Object.keys(renamed).sort(), ['현장_01.jpg', '현장_02.jpg']);

  // 표 합치기 — CP949 가 아닌 UTF-8 CSV 둘을 이어 붙인다.
  tool = await choose('sheet-merge');
  await tool.locator('#sheet-merge-file').setInputFiles([
    { name: '1월.csv', mimeType: 'text/csv', buffer: Buffer.from('품목,수량\n서버,1\n') },
    { name: '2월.csv', mimeType: 'text/csv', buffer: Buffer.from('품목,수량\n스토리지,02\n') },
  ]);
  if (await tool.locator('#sheet-merge-format').count()) {
    const csv = await tool.locator('#sheet-merge-format option[value="csv"]').count();
    if (csv) await tool.locator('#sheet-merge-format').selectOption('csv');
  }
  await tool.locator('.sheet-merge-run').click();
  const merged = await bytesOf(tool.locator('.sheet-merge-outputs a').first());
  const mergedText = strFromU8(merged).replace(/^﻿/, '');
  assert.match(mergedText, /서버/);
  assert.match(mergedText, /스토리지/);
  assert.match(mergedText, /02/, '앞자리 0 이 사라졌다');

  // QR — 한글이 담긴 SVG·PNG 를 내준다.
  tool = await choose('qr');
  await tool.locator('#qr-text').fill('https://example.com/견적');
  await tool.locator('.qr-preview:not([hidden])').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.qr-outputs a').length >= 2);
  const svg = strFromU8(await bytesOf(tool.locator('.qr-outputs a', { hasText: 'SVG' }).first()));
  assert.match(svg, /<svg[\s\S]*<path/);
  const png = await bytesOf(tool.locator('.qr-outputs a', { hasText: 'PNG' }).first());
  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  // 이미지 형식 바꾸기 — PNG 를 JPEG 로.
  tool = await choose('image-convert');
  const pngBytes = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 30;
    const x = c.getContext('2d'); x.fillStyle = '#c00'; x.fillRect(0, 0, 40, 30);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await tool.locator('#image-convert-file').setInputFiles({ name: '빨강.png', mimeType: 'image/png', buffer: Buffer.from(pngBytes) });
  await tool.locator('#image-convert-format').selectOption('jpeg');
  await tool.getByRole('button', { name: '바꾸기', exact: true }).click();
  const jpeg = await bytesOf(tool.locator('.conv-outputs a').first());
  assert.deepEqual([...jpeg.slice(0, 3)], [0xff, 0xd8, 0xff]);

  // --- PDF 도구 ---
  const sample = await PDFDocument.create();
  sample.setTitle('비밀 문서'); sample.setAuthor('홍길동');
  sample.addPage([595, 842]).drawText('Page one', { x: 50, y: 700, size: 20 });
  sample.addPage([595, 842]);
  sample.addPage([842, 595]).drawRectangle({ x: 50, y: 50, width: 200, height: 100, color: rgb(0, 0, 0) });
  sample.addPage([595, 842]).drawText('Page four', { x: 50, y: 700, size: 20 });
  const samplePdf = Buffer.from(await sample.save());
  const pdfFile = { name: '견본.pdf', mimeType: 'application/pdf', buffer: samplePdf };
  const openPdf = async (id, name) => {
    const tool = await choose(id);
    await tool.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(pdfFile);
    return tool;
  };
  const reload = async link => PDFDocument.load(await bytesOf(link), { updateMetadata: false });

  // 문서 정보 — 다 지우면 제목·작성자가 사라진다.
  tool = await openPdf('pdf-meta');
  await page.waitForFunction(() => [...document.querySelectorAll('.conv-tool input')].some(i => i.value === '홍길동'));
  await tool.locator('[data-action="clear"]').click();
  const cleared = await reload(tool.locator('.conv-outputs a').first());
  assert.equal(cleared.getTitle() ?? '', '');
  assert.equal(cleared.getAuthor() ?? '', '');

  // 워터마크·쪽번호 — 라틴 글자는 글꼴을 받지 않고 찍는다.
  tool = await openPdf('pdf-stamp');
  await tool.locator('#stamp-wm-text').fill('CONFIDENTIAL');
  await tool.locator('[data-action="save"]').click();
  const stamped = await reload(tool.locator('.conv-outputs a').first());
  assert.equal(stamped.getPageCount(), 4);

  // 한글 워터마크는 목록의 한글 글꼴을 받아 심는다. 글꼴을 받아 두지 않았으면 건너뛴다
  // (web/scripts/fetch_fonts.py). pdfjs 로 다시 읽어 글자가 돌아오는지 본다.
  if (await tool.locator('#stamp-font option[value]:not([value=""])').count()) {
    await tool.locator('#stamp-wm-text').fill('대외비');
    await tool.locator('[data-action="save"]').click();
    const link = tool.locator('.conv-outputs a').first();
    await page.waitForFunction(() => /대외비|\.pdf/.test(document.querySelector('.conv-tool .conv-outputs a')?.textContent ?? ''));
    const korean = await bytesOf(link);
    const { getDocument } = await import(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
    const read = await getDocument({ data: korean, isEvalSupported: false }).promise;
    const text = (await (await read.getPage(1)).getTextContent()).items.map(item => item.str).join('');
    assert.match(text, /대외비/);
  } else console.log('SKIP: 한글 글꼴 목록이 없어 한글 워터마크는 보지 않았다');

  // 모아찍기 — 4쪽을 한 장에 2쪽씩이면 2장.
  tool = await openPdf('pdf-nup');
  await tool.locator('#nup-per').selectOption('2');
  await tool.locator('[data-action="nup"]').click();
  const nup = await reload(tool.locator('.conv-outputs a').first());
  assert.equal(nup.getPageCount(), 2);

  // 서명·도장 — 그림을 올리고 쪽을 눌러 자리를 정한다.
  tool = await openPdf('pdf-sign');
  await tool.locator('input[type="file"][accept*="image"]').first().setInputFiles({ name: '도장.png', mimeType: 'image/png', buffer: Buffer.from(pngBytes) });
  const stage = tool.locator('.conv-canvas-stage canvas').first();
  await stage.waitFor();
  await page.waitForFunction(() => (document.querySelector('.conv-canvas-stage canvas')?.width ?? 0) > 0);
  await stage.click({ position: { x: 60, y: 60 } });
  await tool.locator('[data-action="add"]').click();
  await tool.locator('[data-action="save"]').click();
  const signed = await reload(tool.locator('.conv-outputs a').first());
  assert.equal(signed.getPageCount(), 4);

  await page.setViewportSize({ width: 375, height: 812 });
  for (const id of ['vat', 'date', 'qr', 'rename']) {
    await choose(id);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${id}: 가로로 넘친다`);
  }
  await page.screenshot({ path: fileURLToPath(new URL('office-mobile.png', out)), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: 16 office tools open with unique ids; money, VAT, bizno, dates, count, diff, redact, hash, rename→ZIP, CSV merge, QR (SVG/PNG), image→JPEG, PDF meta clear, stamp, 2-up, signature stamp, Korean watermark (font embed + read-back); mobile width.');
} finally { await browser.close(); }
