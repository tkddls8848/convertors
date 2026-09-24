/**
 * 이미지 형식·크기 바꾸기 화면.
 *
 * 그림을 캔버스에 **다시 그려** 내보낸다. 그래서 EXIF(촬영 위치·기기 정보)가
 * 따라오지 않는다 — 사진을 남에게 보낼 때는 오히려 바라는 일이라 화면에 그렇게
 * 적는다. 대신 색 프로파일(Display P3 등)도 함께 떨어져 색이 조금 달라질 수 있다.
 *
 * 폰 사진은 EXIF 의 방향 값으로 세워 보이는데, 다시 그리면 그 값이 없어진다.
 * `imageOrientation: 'from-image'` 로 **픽셀을 돌려서** 그리므로 결과도 서 있다.
 *
 * WebP 인코딩은 사파리 일부 판이 못 한다. 못 하는 브라우저는 캔버스가 조용히
 * PNG 를 내놓으므로, 미리 알아보고 그 선택지를 감춘다.
 */
import { zipSync, type Zippable } from 'fflate';

import { reason } from './errors';
import {
  FORMATS, IMAGE_CONVERT_LIMITS, looksLikeImage, outputName, qualityValue, sizeProblem, targetSize, uniqueNames,
  type OutputFormat, type Resize, type Size,
} from './image-convert';
import { filePicker, need, outputs, size, statusLine, toolSection, yieldToPaint } from './kit';

interface Converted { name: string; bytes: Uint8Array; from: Size; to: Size }

let webpSupport: boolean | undefined;
function canEncodeWebp(): boolean {
  if (webpSupport !== undefined) return webpSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch { webpSupport = false; }
  return webpSupport;
}

function blank(size: Size): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('캔버스를 만들지 못했습니다. 그림이 너무 크거나 메모리가 모자랍니다.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

/**
 * 크게 줄일 때는 반씩 여러 번 줄인다. 한 번에 1/8 로 그리면 브라우저가 화소를
 * 건너뛰어 글씨·선이 깨진다.
 */
function scaled(source: CanvasImageSource, from: Size, to: Size): HTMLCanvasElement | null {
  let current: CanvasImageSource = source;
  let currentSize = from;
  let previous: HTMLCanvasElement | null = null;
  while (currentSize.width / 2 >= to.width && currentSize.height / 2 >= to.height) {
    const half = { width: Math.round(currentSize.width / 2), height: Math.round(currentSize.height / 2) };
    const { canvas, context } = blank(half);
    context.drawImage(current, 0, 0, half.width, half.height);
    if (previous) { previous.width = 0; previous.height = 0; }
    previous = canvas; current = canvas; currentSize = half;
  }
  return previous;
}

async function convert(file: File, format: OutputFormat, quality: number, resize: Resize): Promise<Omit<Converted, 'name'>> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('이 브라우저가 열 수 없는 그림입니다.'); }
  const steps: HTMLCanvasElement[] = [];
  try {
    const from = { width: bitmap.width, height: bitmap.height };
    const problem = sizeProblem(from, '원본');
    if (problem) throw new Error(problem);
    const to = targetSize(from, resize);
    const late = sizeProblem(to, '결과');
    if (late) throw new Error(late);

    const step = scaled(bitmap, from, to);
    if (step) steps.push(step);
    const { canvas, context } = blank(to);
    steps.push(canvas);
    // JPEG 에는 투명이 없다. 칠하지 않으면 투명한 곳이 검게 나온다.
    if (format === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, to.width, to.height); }
    context.drawImage(step ?? bitmap, 0, 0, to.width, to.height);
    const { mime, lossy } = FORMATS[format];
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('그림을 저장하지 못했습니다. 메모리가 모자랄 수 있습니다.')), mime, lossy ? quality : undefined));
    // 모르는 형식을 받으면 캔버스는 말없이 PNG 를 낸다. 이름과 내용이 어긋나지 않게 막는다.
    if (blob.type !== mime) throw new Error(`이 브라우저는 ${FORMATS[format].label} 로 저장하지 못합니다.`);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), from, to };
  } finally {
    bitmap.close();
    for (const canvas of steps) { canvas.width = 0; canvas.height = 0; }
  }
}

export function imageConvertTool(): HTMLElement {
  const tool = toolSection('conv-image-convert', `
    <h2>이미지 형식·크기 바꾸기</h2>
    <p class="conv-note">사진·그림을 PNG·JPEG·WebP 로 바꾸고 크기와 용량을 줄입니다. 합계 64MB · 200장, 한 장 5천만 화소까지.
      <strong>다시 그려 저장하므로 촬영 위치·기기 정보(EXIF)는 지워집니다</strong> — 남에게 보낼 사진이라면 오히려 좋은 일입니다.
      색 프로파일이 빠져 색이 조금 달라질 수 있고, 움직이는 GIF 는 첫 장면만 남습니다.
      HEIC·AVIF 는 이 브라우저가 열 수 있을 때만 됩니다. 원본 파일은 바뀌지 않습니다.</p>
    <label class="conv-drop" for="image-convert-file">
      <input id="image-convert-file" type="file" accept="image/*" multiple />
      <span>그림 파일을 고르거나 여기에 끌어다 놓으세요 (여러 개 가능)</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <ul class="conv-list image-convert-list" aria-label="바꿀 그림"></ul>
    <fieldset class="image-convert-controls" disabled>
      <legend>바꾸기</legend>
      <div class="conv-form">
        <label for="image-convert-format">형식</label>
        <select id="image-convert-format">
          <option value="jpeg" selected>JPEG (사진, 가장 널리 열림)</option>
          <option value="png">PNG (투명·글씨, 화질 그대로)</option>
          <option value="webp">WebP (JPEG 보다 작음)</option>
        </select>
        <label for="image-convert-quality">화질</label>
        <div><input id="image-convert-quality" type="range" min="10" max="100" step="1" value="85" />
          <output class="image-convert-quality-value" for="image-convert-quality">85</output></div>
        <label for="image-convert-resize">크기</label>
        <select id="image-convert-resize">
          <option value="original" selected>원본 크기</option>
          <option value="fit">최대 가로·세로 (px)</option>
          <option value="percent">비율 (%)</option>
        </select>
        <label for="image-convert-width" class="image-convert-fit">최대 가로</label>
        <input id="image-convert-width" class="image-convert-fit" type="number" min="1" step="1" placeholder="예: 1920" />
        <label for="image-convert-height" class="image-convert-fit">최대 세로</label>
        <input id="image-convert-height" class="image-convert-fit" type="number" min="1" step="1" placeholder="비우면 가로만 봄" />
        <label for="image-convert-percent" class="image-convert-percent">비율</label>
        <input id="image-convert-percent" class="image-convert-percent" type="number" min="1" max="400" step="1" value="50" />
      </div>
      <label class="image-convert-fit"><input id="image-convert-upscale" type="checkbox" /> 한도보다 작은 그림도 키우기</label>
      <p class="conv-note image-convert-alpha">JPEG 에는 투명이 없어 투명한 곳은 흰색으로 채웁니다.</p>
      <div class="conv-actions">
        <button type="button" class="conv-download" data-action="run">바꾸기</button>
        <button type="button" data-action="reset">초기화</button>
      </div>
    </fieldset>
    <div class="conv-table-wrap" hidden><table class="conv-table image-convert-table">
      <thead><tr><th>파일</th><th class="num">원본</th><th class="num">결과</th><th>크기(px)</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <div class="conv-outputs conv-actions" aria-label="저장 결과"></div>
  `);

  const input = need<HTMLInputElement>(tool, '#image-convert-file');
  const say = statusLine(need(tool, '.conv-status'));
  const list = need<HTMLUListElement>(tool, '.image-convert-list');
  const controls = need<HTMLFieldSetElement>(tool, '.image-convert-controls');
  const format = need<HTMLSelectElement>(tool, '#image-convert-format');
  const quality = need<HTMLInputElement>(tool, '#image-convert-quality');
  const qualityShown = need<HTMLOutputElement>(tool, '.image-convert-quality-value');
  const resizeMode = need<HTMLSelectElement>(tool, '#image-convert-resize');
  const maxWidth = need<HTMLInputElement>(tool, '#image-convert-width');
  const maxHeight = need<HTMLInputElement>(tool, '#image-convert-height');
  const percent = need<HTMLInputElement>(tool, '#image-convert-percent');
  const upscale = need<HTMLInputElement>(tool, '#image-convert-upscale');
  const tableWrap = need<HTMLElement>(tool, '.conv-table-wrap');
  const tbody = need<HTMLElement>(tool, '.image-convert-table tbody');
  const out = outputs(need(tool, '.conv-outputs'));

  if (!canEncodeWebp()) format.querySelector('option[value="webp"]')?.remove();

  let files: File[] = [];
  let busy = false;

  const clearResults = (): void => { out.clear(); tbody.replaceChildren(); tableWrap.hidden = true; };
  const sync = (): void => {
    controls.disabled = busy || !files.length;
    input.disabled = busy;
    const lossy = FORMATS[format.value as OutputFormat].lossy;
    quality.disabled = !lossy;
    qualityShown.textContent = lossy ? quality.value : '—';
    tool.querySelectorAll<HTMLElement>('.image-convert-fit').forEach(element => { element.hidden = resizeMode.value !== 'fit'; });
    tool.querySelectorAll<HTMLElement>('.image-convert-percent').forEach(element => { element.hidden = resizeMode.value !== 'percent'; });
    need<HTMLElement>(tool, '.image-convert-alpha').hidden = format.value !== 'jpeg';
  };
  const render = (): void => {
    list.replaceChildren();
    files.forEach((file, index) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${file.name} (${size(file.size)})`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '빼기';
      remove.setAttribute('aria-label', `${file.name} 빼기`);
      remove.addEventListener('click', () => { if (busy) return; files.splice(index, 1); clearResults(); render(); });
      row.append(label, remove);
      list.append(row);
    });
    sync();
  };

  const add = (picked: File[]): void => {
    if (busy) return;
    const images = picked.filter(file => looksLikeImage(file.name, file.type));
    const rejected = picked.length - images.length;
    const total = [...files, ...images].reduce((sum, file) => sum + file.size, 0);
    if (total > IMAGE_CONVERT_LIMITS.totalBytes) { say('그림은 합계 64MB까지 넣을 수 있습니다.', 'error'); return; }
    if (files.length + images.length > IMAGE_CONVERT_LIMITS.count) { say(`그림은 ${IMAGE_CONVERT_LIMITS.count}장까지 넣을 수 있습니다.`, 'error'); return; }
    files.push(...images);
    clearResults();
    say(`${files.length}장 · ${size(total)}${rejected ? ` — 그림이 아닌 파일 ${rejected}개는 넣지 않았습니다.` : ''}`, rejected ? 'error' : undefined);
    render();
  };

  const readResize = (): Resize => {
    if (resizeMode.value === 'fit') {
      const number = (field: HTMLInputElement): number | null => field.value.trim() === '' ? null : Number(field.value);
      return { mode: 'fit', maxWidth: number(maxWidth), maxHeight: number(maxHeight), upscale: upscale.checked };
    }
    if (resizeMode.value === 'percent') return { mode: 'percent', percent: Number(percent.value) };
    return { mode: 'original' };
  };

  filePicker(input, add, () => busy);
  for (const control of [format, quality, resizeMode, maxWidth, maxHeight, percent, upscale]) {
    control.addEventListener('input', () => { sync(); clearResults(); });
  }

  const cell = (text: string, className?: string): HTMLTableCellElement => {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  };

  controls.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset['action'];
    if (!action || busy) return;
    if (action === 'reset') { files = []; clearResults(); say(''); render(); return; }
    void (async () => {
      const chosen = format.value as OutputFormat;
      let resize: Resize;
      try {
        resize = readResize();
        targetSize({ width: 100, height: 100 }, resize); // 적은 값이 맞는지 먼저 본다
      } catch (error) { say(reason(error), 'error'); return; }

      busy = true; sync(); clearResults();
      tableWrap.hidden = false;
      const done: Converted[] = [];
      const names = uniqueNames(files.map(file => outputName(file.name, chosen)));
      let failed = 0;
      try {
        for (const [index, file] of files.entries()) {
          say(`${index + 1}/${files.length} ${file.name} 바꾸는 중…`);
          await yieldToPaint();
          const row = document.createElement('tr');
          row.append(cell(file.name), cell(size(file.size), 'num'));
          try {
            const result = await convert(file, chosen, qualityValue(Number(quality.value)), resize);
            done.push({ name: names[index]!, ...result });
            const grew = result.bytes.length > file.size;
            const after = cell(`${size(result.bytes.length)}${grew ? ' (커짐)' : ''}`, 'num');
            if (grew) after.title = '원본보다 커졌습니다. 이미 압축된 사진을 PNG 로 바꾸거나 화질을 높이면 그렇습니다.';
            row.append(after, cell(`${result.from.width}×${result.from.height} → ${result.to.width}×${result.to.height}`));
          } catch (error) {
            failed++;
            const problem = cell(`바꾸지 못했습니다: ${reason(error)}`);
            problem.colSpan = 2;
            problem.className = 'conv-bad';
            row.append(problem);
          }
          tbody.append(row);
        }

        const mime = FORMATS[chosen].mime;
        if (done.length > 1) {
          say('ZIP 으로 묶는 중…');
          await yieldToPaint();
          // 이미 압축된 그림이라 다시 줄지 않는다. 묶기만 한다.
          const zippable: Zippable = {};
          for (const item of done) zippable[item.name] = [item.bytes, { level: 0 }];
          out.add(zipSync(zippable), 'images.zip', 'application/zip', `images.zip 로 한꺼번에 내려받기 (${done.length}장)`);
        }
        for (const item of done) out.add(item.bytes, item.name, mime);

        const before = files.reduce((sum, file) => sum + file.size, 0);
        const after = done.reduce((sum, item) => sum + item.bytes.length, 0);
        if (!done.length) say('한 장도 바꾸지 못했습니다. 표의 까닭을 보세요.', 'error');
        else if (failed) say(`${done.length}장을 바꿨고 ${failed}장은 바꾸지 못했습니다. 표를 확인하세요.`, 'error');
        else say(`${done.length}장을 바꿨습니다 (${size(before)} → ${size(after)}). 아래 링크를 눌러 내려받으세요.`, 'ok');
      } catch (error) {
        out.clear();
        say(reason(error), 'error');
      } finally { busy = false; sync(); }
    })();
  });

  render();
  return tool;
}
