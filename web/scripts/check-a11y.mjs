import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../package.json', import.meta.url));
const browserName = process.env.CHECK_BROWSER ?? 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName), `지원하지 않는 검사 브라우저입니다: ${browserName}`);
const browser = await require('playwright')[browserName].launch({ headless: true });
const base = process.env.A11Y_TEST_URL ?? 'http://127.0.0.1:18592';
const violations = [];
const check = (ok, kind, detail) => { if (!ok) violations.push({ kind, detail }); };

// 이 화면이 쓰는 이름표·ARIA·텍스트를 검사한다. 낭독기 전체의 동작을 흉내 내지는 않는다.
function inspect() {
  const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[aria-hidden="true"]');
  const labelText = el => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input,select,textarea').forEach(node => node.remove());
    return clone.textContent.trim();
  };
  const name = el => {
    const refs = el.getAttribute('aria-labelledby');
    if (refs) return refs.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label').trim();
    if (el.labels?.length) return [...el.labels].map(labelText).join(' ').trim();
    if (el.matches('button,a,summary,[role="button"]')) return labelText(el) || el.querySelector('img')?.alt || el.title;
    if (el.matches('input[type="button"],input[type="submit"],input[type="reset"]')) return el.value;
    return el.title?.trim() ?? '';
  };
  const unnamed = [...document.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],summary,[role="button"]')]
    .filter(visible).filter(el => !name(el)).map(el => el.outerHTML.slice(0, 250));
  const images = [...document.querySelectorAll('img')].filter(el => !el.hasAttribute('alt')).map(el => el.outerHTML);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
  const jumps = headings.filter((el, i) => Number(el.tagName[1]) > (i ? Number(headings[i - 1].tagName[1]) : 0) + 1).map(el => el.textContent);

  // 반투명 바탕은 조상 바탕과 합성한다. CSS 색 문법은 캔버스가 해석하게 한다.
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v); };
  const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])).concat(1);
  const background = el => {
    const layers = []; for (let node = el; node; node = node.parentElement) layers.unshift(rgba(getComputedStyle(node).backgroundColor));
    return layers.reduce((bg, fg) => over(fg, bg), [255, 255, 255, 1]);
  };
  const luminance = color => color.slice(0, 3).map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const lowContrast = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, el = node.parentElement;
    if (!node.textContent.trim() || !visible(el) || el.closest('script,style,option,select,button:disabled,fieldset:disabled')) continue;
    const style = getComputedStyle(el), bg = background(el), fg = over(rgba(style.color), bg);
    const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.6667 && Number(style.fontWeight) >= 700);
    const value = ratio(fg, bg), minimum = large ? 3 : 4.5;
    if (value + 0.01 < minimum) lowContrast.push({ text: node.textContent.trim().slice(0, 80), ratio: value, minimum });
  }
  const vars = getComputedStyle(document.documentElement);
  const muted = rgba(vars.getPropertyValue('--muted'));
  return { unnamed, images, jumps, lowContrast, muted: { surface: ratio(muted, rgba(vars.getPropertyValue('--surface'))), bg: ratio(muted, rgba(vars.getPropertyValue('--bg'))) } };
}

try {
  const page = await browser.newPage();
  await page.goto(base);
  await page.locator('.conv-choice').last().waitFor();
  const ids = await page.locator('.conv-choice').evaluateAll(nodes => nodes.map(node => node.dataset.choice));
  check(ids.length === 25, '도구 수', ids.length);
  const reached = new Set();
  for (let i = 0; i < 100 && reached.size < ids.length; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement, style = getComputedStyle(el);
      return { id: el.dataset?.choice, visible: el.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2 && style.outlineColor !== 'rgba(0, 0, 0, 0)' };
    });
    if (focus.id) { reached.add(focus.id); check(focus.visible, '초점 표시', focus.id); }
  }
  for (const id of ids) check(reached.has(id), 'Tab 도달', id);
  let contrasts;
  for (const id of ids) {
    const button = page.locator(`.conv-choice[data-choice="${id}"]`);
    await button.focus();
    // 고르기 단추로 이동한 스크롤과 도구를 연 뒤의 스크롤을 섞지 않는다.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const scroll = await page.evaluate(() => scrollY);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.conv-tool').length === 1 && !document.querySelector('.conv-empty'));
    const focus = await page.evaluate(() => {
      const title = document.querySelector('.conv-tool h2');
      const stage = document.querySelector('.conv-stage');
      return { title: document.activeElement === title && title?.getAttribute('tabindex') === '-1', region: stage.getAttribute('role') === 'region' && !!stage.getAttribute('aria-labelledby'), scroll: scrollY };
    });
    check(focus.title, '도구 제목 초점', id);
    check(focus.region, '도구 영역 이름', id);
    check(Math.abs(scroll - focus.scroll) <= 1, '선택 시 스크롤 유지', { id, before: scroll, after: focus.scroll });
    const result = await page.evaluate(inspect);
    contrasts = result.muted;
    for (const [field, kind] of [['unnamed', '조작 요소 이름'], ['images', '이미지 대체 텍스트'], ['jumps', '제목 단계'], ['lowContrast', '글자 대비']]) {
      for (const issue of result[field]) check(false, kind, { id, issue });
    }
  }
  check(await page.locator('.conv-group__title:not(h3)').count() === 0, '갈래 제목 계층', '고르기 h2 아래 갈래 h3, 독립 도구 h2');
  check(await page.locator('.conv-footer').count() === 1, '푸터', '파일 보관 약속과 오픈소스 고지');
  console.log('보조 글자 대비:', JSON.stringify(contrasts));

  // 실제 고지 유무와 관계없이 없는 목록·잘못된 목록·외부 링크도 재현한다.
  const actualNotice = await page.locator('.conv-licenses').count();
  console.log('실제 오픈소스 고지 표시:', actualNotice > 0);
  if (actualNotice) {
    const links = await page.locator('.conv-licenses a').evaluateAll(nodes => nodes.map(a => a.href));
    for (const href of links) {
      const response = await page.request.get(href);
      check(response.ok(), '실제 고지 파일', href);
    }
    console.log('실제 고지 파일 수:', links.length);
  }
  for (const [label, body, status, expected] of [
    ['없는 목록', '', 404, false],
    ['잘못된 목록', '{', 200, false],
    ['다른 자료형', '{}', 200, false],
    ['외부 파일', JSON.stringify([{ name: '검사', version: '1', license: 'MIT', file: 'https://example.com/a' }]), 200, false],
    ['정상 목록', JSON.stringify([{ name: '검사 구성요소', version: '1.0', license: 'MIT', file: 'sample.txt' }]), 200, true],
    ['생성기 목록', JSON.stringify({ components: [{ name: '검사 구성요소', version: '1.0', license: 'MIT', file: 'sample.txt' }] }), 200, true],
  ]) {
    await page.route('**/licenses/index.json', route => route.fulfill({ status, contentType: 'application/json', body }));
    await page.goto(base);
    await page.locator('.conv-choice').last().waitFor();
    await page.waitForFunction(() => document.querySelector('.conv-footer')?.dataset.licensesLoaded === 'true', null, { timeout: 1500 }).catch(() => {});
    check((await page.locator('.conv-licenses').count() > 0) === expected, '고지 목록 처리', label);
    if (expected && await page.locator('.conv-licenses').count()) {
      await page.locator('.conv-licenses summary').click();
      check(await page.locator('.conv-licenses').innerText().then(text => /검사 구성요소.*1\.0.*MIT/s.test(text)), '고지 내용', label);
      check(await page.locator('.conv-licenses a').evaluateAll(links => links.every(a => new URL(a.href).origin === location.origin)), '같은 출처 고지', label);
    }
    await page.unroute('**/licenses/index.json');
  }
  // Firefox의 미디어 모의 설정은 새 문서에서 스타일에 반영되므로 다시 연다.
  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
  await page.goto(base);
  await page.locator('.conv-choice').last().waitFor();
  const preferences = await page.evaluate(() => {
    const choice = document.querySelector('.conv-choice'), style = getComputedStyle(choice);
    return { border: style.borderColor, line: style.getPropertyValue('--line').trim(), animation: style.animationName, transition: style.transitionDuration };
  });
  check(preferences.animation === 'none' && preferences.transition.split(',').every(n => parseFloat(n) === 0), '움직임 줄이기', preferences);
  check(preferences.line !== '#2f3542', '대비 높이기', preferences);
  console.log('접근성 위반:', JSON.stringify(violations, null, 2));
  console.log(`${browserName}: 도구 ${ids.length}개, 위반 ${violations.length}건`);
  if (violations.length) process.exitCode = 1;
} finally { await browser.close(); }
