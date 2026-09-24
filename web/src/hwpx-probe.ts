import { reason } from './errors';
import { pdfPageToHwpx, IMAGE_LIMITS } from './pdf-hwpx';

const file = document.querySelector<HTMLInputElement>('#file')!;
const convert = document.querySelector<HTMLButtonElement>('#convert')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const status = document.querySelector<HTMLElement>('#status')!;
const download = document.querySelector<HTMLAnchorElement>('#download')!;
let controller: AbortController | undefined;
let url: string | undefined;
cancel.addEventListener('click', () => controller?.abort());
convert.addEventListener('click', async () => {
  const input = file.files?.[0];
  if (!input) { status.textContent = 'PDF를 선택하세요.'; return; }
  if (input.size > IMAGE_LIMITS.inputBytes) { status.textContent = 'PDF 입력은 64MB까지 지원합니다.'; return; }
  if (url) URL.revokeObjectURL(url);
  download.hidden = true;
  controller = new AbortController();
  convert.disabled = true;
  cancel.disabled = false;
  try {
    const bytes = await pdfPageToHwpx(new Uint8Array(await input.arrayBuffer()), {
      page: Number(document.querySelector<HTMLInputElement>('#page')!.value),
      dpi: Number(document.querySelector<HTMLSelectElement>('#dpi')!.value) as 150 | 200 | 300,
      rotation: Number(document.querySelector<HTMLSelectElement>('#rotation')!.value),
      signal: controller.signal,
      progress: message => { status.textContent = message; },
    });
    url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/hwp+zip' }));
    download.href = url;
    download.download = 'pdf-page-probe.hwpx';
    download.hidden = false;
    status.textContent = '검증 파일 생성 완료. 한글에서 쪽 크기·그림 잘림·빈 쪽 여부를 확인하세요.';
  } catch (error) {
    status.textContent = controller.signal.aborted ? '취소했습니다.' : `실패: ${reason(error)}`;
  } finally { convert.disabled = false; cancel.disabled = true; }
});
