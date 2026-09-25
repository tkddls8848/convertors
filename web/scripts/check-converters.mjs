import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../package.json', import.meta.url));
const browserName = process.env.CHECK_BROWSER ?? 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName), `지원하지 않는 검사 브라우저입니다: ${browserName}`);
const browserType = require('playwright')[browserName];
const { PDFDocument, rgb } = require('pdf-lib');
const { unzipSync, zipSync, strToU8, strFromU8 } = require('fflate');
const base = process.env.HWPX_TEST_URL ?? 'http://127.0.0.1:18574';
const out = new URL('../../.cache/hwpx-validation/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await browserType.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/#converters`);
  // 이제 여섯이 한꺼번에 서 있지 않다. 고르기 전에는 도구가 하나도 없어야 한다.
  await page.locator('.conv-empty').waitFor();
  assert.equal(await page.locator('.conv-tool').count(), 0);
  /** 변환을 고른다. 고른 것 하나만 화면에 남는다. */
  const choose = async id => {
    await page.locator(`.conv-choice[data-choice="${id}"]`).click();
    await page.waitForFunction(() => document.querySelectorAll('.conv-tool').length === 1);
  };
  await choose('pdf');
  await page.getByRole('heading', { name: 'PDF 편집기', exact: true }).waitFor();
  const doc = await PDFDocument.create();
  const first = doc.addPage([400, 500]);
  first.drawText('Title < & >', { x: 30, y: 450, size: 12 });
  for (const [text, x, y] of [['A',30,400],['B',200,400],['C',30,375],['D',200,375]]) first.drawText(text, { x, y, size: 10 });
  doc.addPage([500, 300]).drawText('Second page', { x: 20, y: 100, size: 12 });
  doc.addPage([300, 400]).drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: rgb(0.2,0.4,0.9) });
  await page.locator('#conv-pdf-file').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByText('1개 파일에서 3쪽을 추가했습니다.', { exact: true }).waitFor();
  const result = page.locator('.pdf-outputs a');
  // 링크를 눌러 실제로 내려받고, 같은 바이트를 검사용으로도 가져온다.
  const grab = async (link, name) => {
    await link.waitFor();
    const pending = page.waitForEvent('download'); await link.click();
    await (await pending).saveAs(fileURLToPath(new URL(name, out)));
    return Uint8Array.from(await link.evaluate(async a => Array.from(new Uint8Array(await (await fetch(a.href)).arrayBuffer()))));
  };
  const save = async name => unzipSync(await grab(result, name));
  await page.getByRole('button', { name: 'HWPX 이미지로 저장', exact: true }).click();
  const images = await save('multi-image.hwpx');
  assert.equal(Object.keys(images).filter(n => /section\d+.xml$/.test(n)).length, 3);
  assert.equal(Object.keys(images).filter(n => n.startsWith('BinData/')).length, 3);
  assert.match(strFromU8(images['Contents/header.xml']), /secCnt="3"/);
  await page.getByRole('button', { name: 'HWPX 텍스트로 저장', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.conv-pdf .conv-status').textContent.includes('3쪽에서 텍스트를 찾지 못했습니다'));
  assert.equal(await result.count(), 0);
  await page.locator('#pdf-hwpx-empty').selectOption('image');
  await page.locator('#pdf-hwpx-tables').check();
  await page.getByRole('button', { name: 'HWPX 텍스트로 저장', exact: true }).click();
  const text = await save('multi-text.hwpx');
  const xml = strFromU8(text['Contents/section0.xml']);
  assert.match(xml, /Title &lt; &amp; &gt;/);
  assert.match(xml, /<hp:tbl/);
  assert.match(xml, /rowCnt="2" colCnt="2"/);
  assert.equal(Object.keys(text).filter(n => n.startsWith('BinData/')).length, 1);
  assert.match(await page.locator('.pdf-hwpx-warnings').innerText(), /3쪽: 텍스트 없음 → 이미지로 저장/);
  await page.locator('#pdf-hwpx-empty').selectOption('skip');
  await page.getByRole('button', { name: 'HWPX 텍스트로 저장', exact: true }).click();
  assert.match(strFromU8((await save('skip-text.hwpx'))['Contents/header.xml']), /secCnt="2"/);

  await page.locator('.pdf-pages input').nth(1).check();
  await page.getByRole('button', { name: '선택 쪽 ↻ 90°', exact: true }).click();
  await page.getByRole('button', { name: 'HWPX 이미지로 저장', exact: true }).click();
  const selected = await save('selected-image.hwpx');
  assert.match(strFromU8(selected['Contents/section0.xml']), /width="30000" height="50000"/);
  assert.match(strFromU8(selected['Contents/header.xml']), /secCnt="1"/);
  await page.getByRole('button', { name: 'HWPX 이미지로 저장', exact: true }).click();
  await page.getByRole('button', { name: '변환 취소', exact: true }).click();
  await page.getByText('HWPX 변환을 취소했습니다.', { exact: true }).waitFor();

  // PDF → 이미지: 여러 쪽이면 ZIP, 한 쪽이면 그림 하나.
  await page.getByRole('button', { name: '선택 해제', exact: true }).click();
  await page.locator('#pdf-image-dpi').selectOption('150');
  await page.getByRole('button', { name: '이미지로 저장', exact: true }).click();
  const pack = unzipSync(await grab(result, 'pages.zip'));
  assert.deepEqual(Object.keys(pack), ['page-1.png', 'page-2.png', 'page-3.png']);
  // PNG 서명이 있어야 진짜 그림이다.
  assert.deepEqual([...pack['page-1.png'].subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  await page.locator('.pdf-pages input').first().check();
  await page.locator('#pdf-image-format').selectOption('jpeg');
  await page.getByRole('button', { name: '이미지로 저장', exact: true }).click();
  const jpeg = await grab(result, 'page-1.jpg');
  assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.match(await page.locator('.conv-pdf .conv-status').innerText(), /1장을 만들었습니다/);

  // 이미지 → PDF: 방금 만든 PNG 두 장을 도로 PDF 로 묶는다.
  // PDF 글자 고치기: 글자를 눌러 한글로 바꾸고, 저장한 PDF 에서 그 글자를 다시 뽑는다.
  await choose('pdf-edit');
  const edit = page.locator('.conv-pdf-edit');
  const source = await PDFDocument.create();
  source.addPage([400, 300]).drawText('BEFORE', { x: 40, y: 200, size: 18 });
  await edit.locator('#conv-edit-file').setInputFiles({ name: 'edit.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) });
  await edit.getByText('edit.pdf · 1쪽. 고칠 글자를 누르세요.', { exact: true }).waitFor();

  // 글자 상자는 **비어 있어야** 한다. 상자에 바탕색이 깔리면 조각마다 불투명한
  // 판이 얹혀 쪽이 통째로 먹칠된 것처럼 보인다 — 무엇을 고치는지 보이지 않는다.
  const spanBackground = await edit.locator('.edit-span').first()
    .evaluate(node => getComputedStyle(node).backgroundColor);
  assert.match(spanBackground, /rgba\(0, 0, 0, 0\)|transparent/, `글자 상자가 쪽을 가립니다: ${spanBackground}`);

  // 고치기 전의 쪽 그림. 아래에서 "고친 뒤에 글자가 남았는지" 를 재는 잣대가 된다.
  const ink = () => edit.locator('.edit-canvas').evaluate(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let at = 0; at < data.length; at += 4) if (data[at] < 128 && data[at + 1] < 128 && data[at + 2] < 128) dark++;
    return dark;
  });
  const before = await ink();
  assert.ok(before > 0, '쪽이 그려지지 않았습니다.');

  // 쪽 위의 글자 상자를 누르면 그 자리의 원래 글자가 칸에 들어온다.
  await edit.locator('.edit-span').first().click();
  await edit.getByText('원래 글자: BEFORE', { exact: true }).waitFor();

  // 한글을 고르면 글꼴을 받아 심는다. 목록이 있어야 이 길을 지난다.
  const korean = await edit.locator('.edit-font option[value="nanum-gothic"]').count();
  assert.equal(korean, 1, '글꼴 목록을 읽지 못했습니다 (web/scripts/fetch_fonts.py 를 먼저 돌리세요)');
  await edit.locator('.edit-font').selectOption('nanum-gothic');
  await edit.locator('#conv-edit-text').fill('고친 글자');
  await edit.getByRole('button', { name: '이 자리 고치기', exact: true }).click();
  await edit.getByText('고쳤습니다. 아래 미리보기가 저장될 모습입니다.', { exact: true }).waitFor();
  assert.match(await edit.locator('.edit-list li').first().innerText(), /1쪽 · “BEFORE” → “고친 글자” · 나눔고딕/);

  // 고친 자리에 **글자가 남아 있어야** 한다. 심은 글꼴의 글리프가 밀리면(서브셋
  // loca, sfnt.ts 참고) 원래 글자는 덮이고 새 글자는 그려지지 않아 자리가 빈다.
  // 글자를 뽑아 보는 검사로는 이것을 잡지 못한다 — ToUnicode 는 멀쩡하기 때문이다.
  const after = await ink();
  assert.ok(after > before * 0.5, `고친 자리에 글자가 그려지지 않았습니다 (먹 ${before} → ${after}).`);

  await edit.getByRole('button', { name: '고친 PDF 저장', exact: true }).click();
  const editedBytes = await grab(edit.locator('.edit-outputs a'), 'edited.pdf');
  const edited = await PDFDocument.load(editedBytes);
  assert.equal(edited.getPageCount(), 1);
  // 되돌리면 고친 자리가 사라진다.
  await edit.getByRole('button', { name: '모두 되돌리기', exact: true }).click();
  await edit.getByText('고친 자리를 모두 되돌렸습니다.', { exact: true }).waitFor();
  assert.match(await edit.locator('.edit-list').innerText(), /아직 고친 자리가 없습니다/);

  // 심은 한글이 정말 글자로 들어갔는지 — 저장한 PDF 를 이 도구에 도로 넣어 본다.
  // 글자 상자는 PDF.js 가 뽑은 글자로 만들어지므로, 상자에 그 글자가 보이면
  // 그림이 아니라 **찾고 복사할 수 있는 글자** 로 들어간 것이다.
  await edit.locator('#conv-edit-file').setInputFiles({ name: 'edited.pdf', mimeType: 'application/pdf', buffer: Buffer.from(editedBytes) });
  await edit.getByText('edited.pdf · 1쪽. 고칠 글자를 누르세요.', { exact: true }).waitFor();
  const backTitles = await edit.locator('.edit-span').evaluateAll(nodes => nodes.map(node => node.title).join('|'));
  assert.match(backTitles, /고친 글자/, `저장한 PDF 에서 고친 글자를 찾지 못했습니다: ${backTitles}`);
  // 덮어쓰기는 원래 글자를 지우지 않는다. 화면이 그렇게 약속했으니 그대로여야 한다.
  assert.match(backTitles, /BEFORE/, '덮인 원래 글자가 사라졌습니다 — 화면의 설명과 어긋납니다.');

  // 원본 글꼴 그대로 고치기. 방금 저장한 PDF 는 한글 글꼴을 갖고 있으므로,
  // 그 글꼴을 **다시 심지 않고 가리켜** 같은 글꼴로 고칠 수 있어야 한다.
  const koreanSpan = await edit.locator('.edit-span').evaluateAll(nodes => nodes.findIndex(node => node.title.includes('고친 글자')));
  await edit.locator('.edit-span').nth(koreanSpan).click();
  const origin = edit.locator('.edit-font optgroup[data-origin] option');
  assert.equal(await origin.count(), 1, '원본 글꼴을 고를 수 없습니다.');
  assert.match(await edit.locator('.edit-font').inputValue(), /^원본:/, '원본 글꼴이 기본값이 아닙니다.');
  assert.match(await origin.innerText(), /NanumGothic/);

  // 원본에 없는 글자는 그리기 전에 막고, 닮은 글꼴로 바꿔 둔다.
  await edit.locator('#conv-edit-text').fill('없던글자');
  assert.match(await edit.locator('.edit-fit').innerText(), /원본 글꼴에 없는 글자/);
  await edit.getByRole('button', { name: '이 자리 고치기', exact: true }).click();
  await edit.getByText(/원본 글꼴에 없는 글자가 있습니다/).waitFor();
  assert.match(await edit.locator('.edit-list').innerText(), /아직 고친 자리가 없습니다/, '막아야 할 고치기가 들어갔습니다.');
  assert.doesNotMatch(await edit.locator('.edit-font').inputValue(), /^원본:/, '닮은 글꼴로 바꾸지 않았습니다.');

  // 원본에 있는 글자만 쓰면 그대로 들어간다. 글꼴을 심지 않으므로 파일이 거의 그대로다.
  await edit.locator('.edit-span').nth(koreanSpan).click();
  await edit.locator('#conv-edit-text').fill('고친 자');
  await edit.getByRole('button', { name: '이 자리 고치기', exact: true }).click();
  await edit.getByText('고쳤습니다. 아래 미리보기가 저장될 모습입니다.', { exact: true }).waitFor();
  assert.match(await edit.locator('.edit-list li').first().innerText(), /원본 그대로 · \S*NanumGothic/);
  await edit.getByRole('button', { name: '고친 PDF 저장', exact: true }).click();
  const reused = await grab(edit.locator('.edit-outputs a'), 'edited-source-font.pdf');
  assert.ok(reused.length < editedBytes.length + 4096,
    `원본 글꼴을 가리키지 않고 새로 심었습니다 (${editedBytes.length} → ${reused.length}).`);
  // 그 글자가 정말 그려졌는지 — 저장한 것을 도로 열어 글자를 뽑는다.
  await edit.locator('#conv-edit-file').setInputFiles({ name: 'reused.pdf', mimeType: 'application/pdf', buffer: Buffer.from(reused) });
  await edit.getByText('reused.pdf · 1쪽. 고칠 글자를 누르세요.', { exact: true }).waitFor();
  const reusedTitles = await edit.locator('.edit-span').evaluateAll(nodes => nodes.map(node => node.title).join('|'));
  assert.match(reusedTitles, /고친 자/, `원본 글꼴로 쓴 글자를 찾지 못했습니다: ${reusedTitles}`);

  await choose('images-pdf');
  const imgTool = page.locator('.conv-images-pdf');
  await imgTool.locator('#conv-img-file').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(pack['page-1.png']) },
    { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(pack['page-2.png']) },
  ]);
  await imgTool.getByText('2장을 추가했습니다.', { exact: true }).waitFor();
  await imgTool.getByRole('button', { name: 'PDF 로 묶기', exact: true }).click();
  const bundled = await PDFDocument.load(await grab(imgTool.locator('.img-outputs a'), 'images.pdf'));
  assert.equal(bundled.getPageCount(), 2);
  // '그림 크기 그대로' 는 쪽을 그림 픽셀에 맞춘다. 150 DPI 로 그린 400×500pt 쪽이다.
  assert.deepEqual(bundled.getPage(0).getSize(), { width: 834, height: 1042 });
  await imgTool.locator('.img-fit').selectOption('a4');
  await imgTool.getByRole('button', { name: 'PDF 로 묶기', exact: true }).click();
  const a4 = await PDFDocument.load(await grab(imgTool.locator('.img-outputs a'), 'images-a4.pdf'));
  assert.equal(Math.round(a4.getPage(0).getSize().width), 595);

  // 텍스트 → HWPX: 표와 제목이 든 Markdown 을 한글 문서로 짓는다.
  await choose('text-hwpx');
  const textTool = page.locator('.conv-text-hwpx');
  await textTool.locator('#conv-text-input').fill('# 과업 내용\n\n| 품목 | 수량 |\n| --- | --- |\n| 볼펜 | 3 |');
  await textTool.getByRole('button', { name: 'HWPX 로 저장', exact: true }).click();
  const hwpx = unzipSync(await grab(textTool.locator('.text-outputs a'), 'text.hwpx'));
  const section = strFromU8(hwpx['Contents/section0.xml']);
  assert.match(section, /과업 내용/);
  assert.match(section, /<hp:tbl/);
  assert.match(section, /rowCnt="2" colCnt="2"/);
  assert.match(strFromU8(hwpx['Contents/header.xml']), /secCnt="1"/);
  // 그림이 없는 문서에는 BinData 가 없어야 한다.
  assert.equal(Object.keys(hwpx).filter(n => n.startsWith('BinData/')).length, 0);
  assert.match(await textTool.locator('.text-notes').innerText(), /제목은 문단으로 들어갑니다/);

  // 인코딩: CP949 CSV 를 읽어 UTF-8 로 내보낸다.
  await choose('encoding');
  const enc = page.locator('.conv-encoding');
  const cp949 = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x31, 0x0d, 0x0a]); // "한글,1\r\n"
  await enc.locator('#conv-enc-file').setInputFiles({ name: '명부.csv', mimeType: 'text/csv', buffer: cp949 });
  await enc.getByText('명부.csv 를 읽었습니다.', { exact: true }).waitFor();
  assert.match(await enc.locator('.enc-detected').innerText(), /CP949 \(EUC-KR·완성형\).*추정입니다/);
  assert.match(await enc.locator('.enc-preview').innerText(), /한글,1/);
  assert.equal(await enc.locator('.enc-target').inputValue(), 'utf-8');
  await enc.locator('.enc-newline').selectOption('lf');
  await enc.getByRole('button', { name: '변환해 내려받기', exact: true }).click();
  const converted = await grab(enc.locator('.enc-outputs a'), 'encoded.csv');
  assert.deepEqual([...converted], [0xef, 0xbb, 0xbf, ...Buffer.from('한글,1\n', 'utf8')]);
  // 거꾸로 CP949 로 내보낼 때, 담을 수 없는 글자는 조용히 버리지 않고 멈춘다.
  await enc.locator('#conv-enc-file').setInputFiles({ name: 'emoji.txt', mimeType: 'text/plain', buffer: Buffer.from('값 😀', 'utf8') });
  await enc.getByText('emoji.txt 를 읽었습니다.', { exact: true }).waitFor();
  assert.equal(await enc.locator('.enc-target').inputValue(), 'euc-kr');
  await enc.getByRole('button', { name: '변환해 내려받기', exact: true }).click();
  await enc.getByText(/CP949로 적을 수 없는 글자가 1종 있습니다/).waitFor();
  assert.equal(await enc.locator('.enc-outputs a').count(), 0);

  // ZIP: 묶고, 그것을 도로 풀어 같은 내용인지 본다.
  await choose('zip');
  const zip = page.locator('.conv-zip');
  await zip.locator('#conv-zip-pack').setInputFiles([
    { name: '보고서.txt', mimeType: 'text/plain', buffer: Buffer.from('내용', 'utf8') },
    { name: '표.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n', 'utf8') },
  ]);
  await zip.getByRole('button', { name: 'ZIP 으로 묶기', exact: true }).click();
  const packed = unzipSync(await grab(zip.locator('.zip-pack-outputs a'), 'archive.zip'));
  assert.deepEqual(Object.keys(packed).sort(), ['보고서.txt', '표.csv']);
  assert.equal(strFromU8(packed['보고서.txt']), '내용');
  await zip.locator('#conv-zip-open').setInputFiles({
    name: 'sample.zip', mimeType: 'application/zip',
    buffer: Buffer.from(zipSync({ 'doc/메모.txt': strToU8('한 줄'), 'bin.dat': new Uint8Array([1, 2, 3]) })),
  });
  await zip.getByText('2개 파일을 풀었습니다. 이름을 눌러 하나씩 내려받으세요.', { exact: true }).waitFor();
  assert.deepEqual(await zip.locator('.zip-open-list a').allInnerTexts(), ['doc/메모.txt (7B)', 'bin.dat (3B)']);

  // 다시 PDF 편집기로 돌아오면 아까 올린 3쪽이 그대로 있어야 한다.
  await choose('pdf');
  assert.equal(await page.locator('.pdf-pages li').count(), 3);
  assert.equal(await page.locator('.conv-choice[data-choice="pdf"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.conv-choice[data-choice="zip"]').getAttribute('aria-pressed'), 'false');

  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL('converters-mobile.png', out)), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: chooser (one tool at a time, state kept), PDF text overwrite (Korean font embed + extract-back, source-font reuse + missing-glyph refusal), HWPX image/text exports, tables, mixed page sizes, scanned-page error/image/skip, selection/rotation, cancellation, PDF→image (zip/single), image→PDF (native/A4), text→HWPX, encoding detect/convert/refuse, ZIP pack/unpack, mobile layout.');
} finally { await browser.close(); }
