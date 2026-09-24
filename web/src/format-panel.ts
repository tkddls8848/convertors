import { reason } from './errors';
import { DOCUMENT_INPUTS, DOCUMENT_OUTPUTS, SHEET_INPUTS, SHEET_OUTPUTS, MAX_INPUT, CONTENT_NOTE, type ConversionFile } from './format-catalog';

// Keep SheetJS out of the UI bundle; the dedicated worker owns that engine.
export const documentTool = (): HTMLElement => formatTool(false);
export const spreadsheetTool = (): HTMLElement => formatTool(true);
function formatTool(spreadsheet: boolean): HTMLElement {
  const id = spreadsheet ? 'spreadsheet' : 'document';
  const inputs = spreadsheet ? SHEET_INPUTS : DOCUMENT_INPUTS;
  const outputs = spreadsheet ? SHEET_OUTPUTS : DOCUMENT_OUTPUTS;
  const tool = document.createElement('section'); tool.className = `conv-tool conv-${id}`;
  tool.innerHTML = `<h2>${spreadsheet ? '스프레드시트 변환' : '문서·전자책 변환'}</h2>
    <p class="conv-note">${spreadsheet ? 'Excel·OpenDocument·CSV·JSON을 서로 변환합니다. 서식·차트·그림·매크로는 보존하지 않습니다. 수식은 재계산하지 않습니다. 값 전용 형식은 시트마다 저장합니다.' : CONTENT_NOTE}</p>
    <p class="conv-note">입력: ${inputs.map(s => s.toUpperCase()).join(' · ')}<br>파일당 16MB, 결과 32MB까지. ${spreadsheet ? '최대 100시트·50만 셀. CSV·TSV는 UTF-8. DIF·SYLK 출력은 영문·숫자(ASCII)만 지원합니다.' : '최대 200만 자. PDF는 200쪽까지 텍스트를 추출하며 OCR은 지원하지 않습니다. DOC·HWP 바이너리와 원본 배치를 보존하는 Office → PDF 변환은 지원하지 않습니다.'}</p>
    <label class="conv-drop" for="conv-${id}-file"><input id="conv-${id}-file" type="file" accept="${inputs.map(s => '.' + s).join(',')}"/><span>파일을 고르거나 여기에 끌어다 놓으세요</span></label>
    <p class="format-source"></p>
    <div class="conv-actions"><label>저장 형식 <select class="format-target">${outputs.map(s => `<option value="${s}">${s.toUpperCase()}</option>`).join('')}</select></label><button class="conv-download format-run" disabled>변환하기</button>${spreadsheet ? '<button class="format-cancel" disabled>취소</button>' : ''}</div>
    <p class="conv-status" role="status" aria-live="polite"></p><ul class="format-notes"></ul><div class="format-outputs conv-actions" aria-label="변환 결과"></div>`;
  const input = tool.querySelector<HTMLInputElement>('input')!, target = tool.querySelector<HTMLSelectElement>('select')!;
  const run = tool.querySelector<HTMLButtonElement>('.format-run')!, cancel = tool.querySelector<HTMLButtonElement>('.format-cancel');
  const status = tool.querySelector<HTMLElement>('.conv-status')!, links = tool.querySelector<HTMLElement>('.format-outputs')!, notes = tool.querySelector<HTMLElement>('.format-notes')!;
  let file: File | undefined, busy = false, urls: string[] = [], abort: (() => void) | undefined;
  const clear = (): void => { urls.forEach(URL.revokeObjectURL); urls = []; links.replaceChildren(); notes.replaceChildren(); };
  const choose = (chosen: File): void => {
    if (busy) return;
    clear(); file = undefined; run.disabled = true;
    tool.querySelector('.format-source')!.textContent = chosen.name;
    if (!inputs.includes(chosen.name.split('.').pop()!.toLowerCase())) { status.textContent = '지원하지 않는 입력 형식입니다.'; return; }
    if (!chosen.size || chosen.size > MAX_INPUT) { status.textContent = '파일은 1바이트~16MB까지 지원합니다.'; return; }
    file = chosen; run.disabled = false; status.textContent = '저장 형식을 고르고 변환하기를 누르세요.';
  };
  input.addEventListener('change', () => { if (input.files?.[0]) choose(input.files[0]); input.value = ''; });
  target.addEventListener('change', clear);
  const drop = tool.querySelector<HTMLElement>('.conv-drop')!;
  for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, e => e.preventDefault());
  drop.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files[0]) choose(e.dataTransfer.files[0]); });
  cancel?.addEventListener('click', () => abort?.());
  const addLink = (f: ConversionFile): void => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([new Uint8Array(f.bytes)], { type: f.mime }));
    urls.push(a.href); a.download = f.name; a.textContent = `${f.name} 내려받기`; links.append(a);
  };
  run.addEventListener('click', () => { void (async () => {
    if (!file || busy) return;
    busy = true; run.disabled = true; input.disabled = true; target.disabled = true; clear();
    status.dataset['tone'] = ''; status.textContent = '변환 중…';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let result: { files: ConversionFile[]; notes: string[] };
      if (spreadsheet) {
        result = await new Promise((resolve, reject) => {
          const worker = new Worker(new URL('./spreadsheet.worker.ts', import.meta.url), { type: 'module' });
          const cleanup = (): void => { clearTimeout(timer); worker.terminate(); abort = undefined; if (cancel) cancel.disabled = true; };
          const timer = setTimeout(() => { cleanup(); reject(new Error('60초 제한을 초과했습니다. 더 작은 파일을 사용해 주세요.')); }, 60000);
          abort = () => { cleanup(); reject(new Error('변환을 취소했습니다.')); }; if (cancel) cancel.disabled = false;
          worker.onmessage = event => { cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
          worker.onerror = () => { cleanup(); reject(new Error('변환 엔진을 실행하지 못했습니다.')); };
          worker.postMessage({ bytes, name: file!.name, format: target.value }, [bytes.buffer]);
        });
      } else {
        const { readContent, writeContent } = await import('./document-formats');
        const doc = await readContent(bytes, file.name);
        result = { files: [await writeContent(doc, target.value)], notes: doc.notes };
        if (['rtf', 'fb2'].includes(target.value)) result.notes.push('이 출력에서는 표를 탭으로 구분한 텍스트로 옮깁니다.');
      }
      for (const note of result.notes) { const li = document.createElement('li'); li.textContent = note; notes.append(li); }
      if (result.files.length > 1) {
        const { zipSync } = await import('fflate');
        addLink({ name: `${file.name.replace(/\.[^.]+$/, '')}-${target.value}.zip`, bytes: zipSync(Object.fromEntries(result.files.map(f => [f.name, f.bytes]))), mime: 'application/zip' });
      }
      result.files.forEach(addLink); status.textContent = `${result.files.length}개 파일을 만들었습니다. 내용을 확인한 뒤 사용해 주세요.`; status.dataset['tone'] = 'ok';
    } catch (error) { clear(); status.textContent = reason(error); status.dataset['tone'] = 'error'; }
    finally { busy = false; run.disabled = !file; input.disabled = false; target.disabled = false; }
  })(); });
  return tool;
}
