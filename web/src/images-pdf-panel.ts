/**
 * 이미지 → PDF 화면.
 *
 * PNG·JPEG 가 아닌 그림(WebP·GIF·BMP, 사파리의 HEIC)은 **여기서** 캔버스를 거쳐
 * PNG 로 바꾼다. `images-pdf.ts` 는 브라우저 없이도 돌아야 하므로 그 일을 맡지
 * 않는다. 바꿀 수 없는 파일은 이름을 대고 멈춘다.
 */
import { reason } from './errors';
import { imageKind, imagesToPdf, IMAGES_PDF_LIMITS, type ImageInput, type PageFit } from './images-pdf';

interface Picked { name: string; file: File }

/** 캔버스를 거치면 원본 화질이 아니다. PNG·JPEG 는 손대지 않는 이유다. */
async function toPng(file: File): Promise<Uint8Array> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error(`${file.name}: 이 브라우저가 열 수 없는 그림입니다. PNG 또는 JPEG 로 저장해 주세요.`); }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('캔버스를 만들지 못했습니다.');
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(value => value ? resolve(value) : reject(new Error(`${file.name}: PNG 로 바꾸지 못했습니다.`)), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}

export function imagesPdfTool(): HTMLElement {
  const tool = document.createElement('section');
  tool.className = 'conv-tool conv-images-pdf';
  tool.innerHTML = `
    <h2>이미지 → PDF</h2>
    <p class="conv-note">사진·스캔 여러 장을 고른 순서대로 한 PDF 로 묶습니다. 합계 64MB · 200장까지.
      PNG·JPEG 는 <strong>다시 압축하지 않고 그대로 넣어</strong> 화질이 그대로입니다.
      OCR 은 하지 않으므로 만들어진 PDF 에서 글자를 찾거나 복사할 수는 없습니다.</p>
    <label class="conv-drop" for="conv-img-file">
      <input id="conv-img-file" type="file" accept="image/*" multiple />
      <span>그림 파일을 고르거나 여기에 끌어다 놓으세요 (여러 개 가능)</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <fieldset class="img-controls" disabled>
      <legend>쪽 만들기</legend>
      <ol class="img-list" aria-label="묶을 순서"></ol>
      <div class="conv-actions">
        <label>쪽 크기
          <select class="img-fit">
            <option value="image" selected>그림 크기 그대로</option>
            <option value="a4">A4 세로</option>
            <option value="a4-landscape">A4 가로</option>
            <option value="letter">Letter</option>
          </select>
        </label>
        <label>여백
          <select class="img-margin">
            <option value="0" selected>없음</option>
            <option value="18">6mm</option>
            <option value="36">13mm</option>
            <option value="72">25mm</option>
          </select>
        </label>
        <button type="button" class="conv-download" data-action="save">PDF 로 묶기</button>
        <button type="button" data-action="reset">초기화</button>
      </div>
      <p class="conv-note">여백은 A4·Letter 에서만 씁니다. 그림 크기 그대로는 픽셀 하나를 1pt 로 보아 쪽을 그림에 맞춥니다.</p>
    </fieldset>
    <div class="img-outputs conv-actions" aria-label="저장 결과"></div>
  `;

  const input = tool.querySelector<HTMLInputElement>('#conv-img-file')!;
  const drop = tool.querySelector<HTMLElement>('.conv-drop')!;
  const status = tool.querySelector<HTMLElement>('.conv-status')!;
  const controls = tool.querySelector<HTMLFieldSetElement>('.img-controls')!;
  const list = tool.querySelector<HTMLOListElement>('.img-list')!;
  const fit = tool.querySelector<HTMLSelectElement>('.img-fit')!;
  const marginSelect = tool.querySelector<HTMLSelectElement>('.img-margin')!;
  const outputs = tool.querySelector<HTMLElement>('.img-outputs')!;

  let picked: Picked[] = [];
  let busy = false;
  let urls: string[] = [];

  const message = (text: string, error = false): void => {
    status.textContent = text;
    status.dataset['tone'] = error ? 'error' : '';
  };
  const clearOutputs = (): void => {
    urls.forEach(url => URL.revokeObjectURL(url));
    urls = [];
    outputs.replaceChildren();
  };
  const render = (): void => {
    controls.disabled = busy || !picked.length;
    input.disabled = busy;
    marginSelect.disabled = fit.value === 'image';
    list.replaceChildren();
    picked.forEach((item, index) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${item.name} (${kb(item.file.size)})`;
      row.append(label);
      for (const [title, delta] of [['위로', -1], ['아래로', 1]] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = title;
        button.setAttribute('aria-label', `${index + 1}번 ${title}`);
        button.disabled = index + delta < 0 || index + delta >= picked.length;
        button.addEventListener('click', () => {
          [picked[index], picked[index + delta]] = [picked[index + delta]!, item];
          clearOutputs();
          render();
          list.children[index + delta]?.querySelectorAll('button')[delta === -1 ? 0 : 1]?.focus();
        });
        row.append(button);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '빼기';
      remove.setAttribute('aria-label', `${index + 1}번 빼기`);
      remove.addEventListener('click', () => { picked.splice(index, 1); clearOutputs(); render(); });
      row.append(remove);
      list.append(row);
    });
  };

  const add = (files: File[]): void => {
    if (busy || !files.length) return;
    const images = files.filter(file => file.type.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp|heic|heif)$/i.test(file.name));
    const rejected = files.length - images.length;
    const total = [...picked.map(item => item.file), ...images].reduce((sum, file) => sum + file.size, 0);
    if (total > IMAGES_PDF_LIMITS.totalBytes) { message('그림은 합계 64MB까지 묶을 수 있습니다.', true); return; }
    if (picked.length + images.length > IMAGES_PDF_LIMITS.count) { message(`그림은 ${IMAGES_PDF_LIMITS.count}장까지 묶을 수 있습니다.`, true); return; }
    picked.push(...images.map(file => ({ name: file.name, file })));
    clearOutputs();
    message(`${images.length}장을 추가했습니다.${rejected ? ` 그림이 아닌 파일 ${rejected}개는 넣지 않았습니다.` : ''}`, rejected > 0);
    render();
  };

  input.addEventListener('change', () => { add(Array.from(input.files ?? [])); input.value = ''; });
  for (const type of ['dragenter', 'dragover'] as const) drop.addEventListener(type, event => {
    event.preventDefault();
    if (!busy) drop.dataset['over'] = 'yes';
  });
  drop.addEventListener('dragleave', () => delete drop.dataset['over']);
  drop.addEventListener('drop', event => {
    event.preventDefault();
    delete drop.dataset['over'];
    add(Array.from(event.dataTransfer?.files ?? []));
  });
  fit.addEventListener('change', () => { clearOutputs(); render(); });
  marginSelect.addEventListener('change', clearOutputs);

  controls.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset['action'];
    if (!action || busy) return;
    if (action === 'reset') { picked = []; clearOutputs(); message(''); render(); return; }
    if (action !== 'save') return;
    void (async () => {
      busy = true; render(); clearOutputs();
      try {
        const images: ImageInput[] = [];
        for (const [index, item] of picked.entries()) {
          message(`${index + 1}/${picked.length}장 읽는 중…`);
          const bytes = new Uint8Array(await item.file.arrayBuffer());
          // 확장자가 아니라 바이트로 가린다. .jpg 라고 적힌 WebP 가 흔하다.
          images.push({ name: item.name, bytes: imageKind(bytes) ? bytes : await toPng(item.file) });
        }
        message('PDF 만드는 중…');
        const bytes = await imagesToPdf(images, {
          fit: fit.value as PageFit,
          margin: fit.value === 'image' ? 0 : Number(marginSelect.value),
        });
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
        urls.push(url);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'images.pdf';
        link.textContent = `images.pdf 내려받기 (${images.length}쪽 · ${kb(bytes.length)})`;
        outputs.append(link);
        message(`${images.length}쪽 PDF 를 만들었습니다. 아래 링크를 눌러 내려받으세요.`);
      } catch (error) {
        clearOutputs();
        message(reason(error), true);
      } finally { busy = false; render(); }
    })();
  });

  render();
  return tool;
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
