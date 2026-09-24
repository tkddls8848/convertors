import { reason } from './errors';
import { MAX_PDF_BYTES, MAX_PDF_PAGES, readPdf, savePdf, splitRanges, type PdfPageRef } from './pdf';

export function pdfTool(): HTMLElement {
  const tool = document.createElement('section');
  tool.className = 'conv-tool conv-pdf';
  tool.innerHTML = `
    <h2>PDF 편집기</h2>
    <p class="conv-note">여러 파일을 추가해 병합하거나, 쪽을 회전하고 순서를 바꿔 저장하세요. 합계 64MB · 1,000쪽까지 지원합니다.</p>
    <label class="conv-drop" for="conv-pdf-file">
      <input id="conv-pdf-file" type="file" accept=".pdf,application/pdf" multiple />
      <span>PDF 파일을 고르거나 여기에 끌어다 놓으세요 (여러 개 가능)</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <fieldset class="pdf-controls" disabled>
      <legend>쪽 편집</legend>
      <div class="conv-actions">
        <button type="button" data-action="all">전체 선택</button>
        <button type="button" data-action="none">선택 해제</button>
        <button type="button" data-action="rotate">선택 쪽 ↻ 90°</button>
        <button type="button" data-action="remove">선택 쪽 삭제</button>
        <button type="button" data-action="reset">초기화</button>
      </div>
      <p class="pdf-summary"></p>
      <ol class="pdf-pages" aria-label="저장할 쪽 순서"></ol>
      <div class="conv-actions">
        <button type="button" class="conv-download" data-action="save">전체 병합·저장</button>
        <button type="button" data-action="extract">선택 쪽만 저장</button>
      </div>
      <label for="pdf-ranges">분할 범위 (현재 목록의 쪽 번호 기준)</label>
      <div class="conv-actions">
        <input id="pdf-ranges" type="text" placeholder="예: 1-3; 4-6; 7,9" />
        <button type="button" data-action="split">범위별 분할</button>
      </div>
      <p class="conv-note">쉼표(,)로 쪽을 묶고 세미콜론(;)으로 파일을 나눕니다. 예: 1-3; 4,6 → PDF 2개.</p>
      <h3>PDF → HWPX</h3>
      <p class="conv-note">현재 순서·회전을 반영합니다. 선택한 쪽이 있으면 선택 쪽만, 없으면 전체를 변환합니다. 최대 100쪽·출력 64MB. 최신 한글에서의 호환성 검증은 진행 중입니다.</p>
      <div class="conv-actions">
        <label>이미지 해상도 <select id="pdf-hwpx-dpi"><option value="150">150 DPI</option><option value="200" selected>200 DPI</option><option value="300">300 DPI</option></select></label>
        <button type="button" data-action="hwpx-image">HWPX 이미지로 저장</button>
      </div>
      <p class="conv-note">이미지 방식은 쪽을 그림으로 넣습니다. 글자·표를 직접 편집할 수 없으며 해상도에 따라 품질이 달라집니다.</p>
      <div class="conv-actions">
        <label>텍스트 없는 쪽 <select id="pdf-hwpx-empty"><option value="error">중단하고 알림</option><option value="image">이미지로 저장</option><option value="skip">제외</option></select></label>
        <label><input type="checkbox" id="pdf-hwpx-tables"> 단순 표 추정</label>
        <button type="button" data-action="hwpx-text">HWPX 텍스트로 저장</button>
      </div>
      <p class="conv-note">텍스트 방식은 편집 가능한 문단과 단순 표를 재구성합니다. 그림·수식·원본 배치는 보존하지 않습니다. 다단·병합 표·회전 글자는 결과 확인이 필요하며 OCR은 지원하지 않습니다.</p>
      <h3>PDF → 이미지</h3>
      <p class="conv-note">현재 순서·회전을 반영합니다. 선택한 쪽이 있으면 선택 쪽만, 없으면 전체를 그립니다. 최대 200쪽·출력 64MB. 여러 장이면 ZIP 하나로 묶습니다.</p>
      <div class="conv-actions">
        <label>해상도 <select id="pdf-image-dpi"><option value="150">150 DPI</option><option value="200" selected>200 DPI</option><option value="300">300 DPI</option></select></label>
        <label>형식 <select id="pdf-image-format"><option value="png" selected>PNG (또렷함·큼)</option><option value="jpeg">JPEG (작음·사진용)</option></select></label>
        <button type="button" data-action="images">이미지로 저장</button>
      </div>
      <p class="conv-note">보이는 그대로 그리지만 <strong>글자가 그림이 되어</strong> 검색·복사·편집이 되지 않습니다. 편집이 필요하면 위의 HWPX 텍스트 방식을 쓰세요.</p>
    </fieldset>
    <button type="button" class="pdf-hwpx-cancel" hidden>변환 취소</button>
    <ul class="pdf-hwpx-warnings" aria-label="변환 확인 사항"></ul>
    <div class="pdf-outputs conv-actions" aria-label="저장 결과"></div>
    <p class="conv-note">쪽의 글·그림을 PDF로 복사합니다. 책갈피·양식·전자서명 보존은 지원하지 않습니다. 암호화된 PDF는 보안을 해제한 사본을 사용하세요.</p>
  `;
  const input = tool.querySelector<HTMLInputElement>('#conv-pdf-file')!;
  const drop = tool.querySelector<HTMLElement>('.conv-drop')!;
  const status = tool.querySelector<HTMLElement>('.conv-status')!;
  const controls = tool.querySelector<HTMLFieldSetElement>('.pdf-controls')!;
  const list = tool.querySelector<HTMLOListElement>('.pdf-pages')!;
  const summary = tool.querySelector<HTMLElement>('.pdf-summary')!;
  const ranges = tool.querySelector<HTMLInputElement>('#pdf-ranges')!;
  const outputs = tool.querySelector<HTMLElement>('.pdf-outputs')!;
  const cancel = tool.querySelector<HTMLButtonElement>('.pdf-hwpx-cancel')!;
  const warnings = tool.querySelector<HTMLElement>('.pdf-hwpx-warnings')!;
  let conversion: AbortController | undefined;
  cancel.addEventListener('click', () => conversion?.abort());
  let pages: PdfPageRef[] = [];
  const selected = new Set<PdfPageRef>();
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
    warnings.replaceChildren();
  };
  const render = (): void => {
    controls.disabled = busy || !pages.length;
    input.disabled = busy;
    summary.textContent = `${pages.length}쪽 · ${selected.size}쪽 선택`;
    list.replaceChildren();
    pages.forEach((page, index) => {
      const row = document.createElement('li');
      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = selected.has(page);
      check.addEventListener('change', () => {
        if (check.checked) selected.add(page); else selected.delete(page);
        summary.textContent = `${pages.length}쪽 · ${selected.size}쪽 선택`;
      });
      const angle = ((page.source.document.getPage(page.index).getRotation().angle + page.rotation) % 360 + 360) % 360;
      label.append(check, document.createTextNode(`${index + 1}. ${page.source.name} · 원본 ${page.index + 1}쪽 · ${angle}°`));
      row.append(label);
      for (const [title, delta] of [['위로', -1], ['아래로', 1]] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = title;
        button.setAttribute('aria-label', `${index + 1}쪽 ${title}`);
        button.disabled = index + delta < 0 || index + delta >= pages.length;
        button.addEventListener('click', () => {
          [pages[index], pages[index + delta]] = [pages[index + delta]!, page];
          clearOutputs();
          render();
          list.children[index + delta]?.querySelectorAll('button')[delta === -1 ? 0 : 1]?.focus();
        });
        row.append(button);
      }
      list.append(row);
    });
  };
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    controls.disabled = true;
    input.disabled = true;
    try { await work(); }
    catch (error) { message(reason(error), true); }
    finally { busy = false; render(); }
  };
  const add = (files: File[]): void => {
    if (!files.length) return;
    void run(async () => {
      message('PDF 읽는 중…');
      let total = [...new Set(pages.map(page => page.source))].reduce((sum, source) => sum + source.size, 0);
      const added: PdfPageRef[] = [];
      for (const file of files) {
        total += file.size;
        if (total > MAX_PDF_BYTES) throw new Error('PDF는 합계 64MB까지 추가할 수 있습니다.');
        const source = await readPdf(new Uint8Array(await file.arrayBuffer()), file.name);
        if (pages.length + added.length + source.document.getPageCount() > MAX_PDF_PAGES) throw new Error('PDF는 합계 1,000쪽까지 추가할 수 있습니다.');
        source.document.getPageIndices().forEach(index => added.push({ source, index, rotation: 0 }));
      }
      pages.push(...added);
      clearOutputs();
      message(`${files.length}개 파일에서 ${added.length}쪽을 추가했습니다.`);
    });
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
  const exportGroups = async (groups: PdfPageRef[][], prefix: string): Promise<void> => {
    message('PDF 만드는 중…');
    clearOutputs();
    try {
      for (let i = 0; i < groups.length; i++) {
        const bytes = await savePdf(groups[i]!);
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
        urls.push(url);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${prefix}${groups.length > 1 ? `-${i + 1}` : ''}.pdf`;
        link.textContent = `${link.download} 내려받기 (${groups[i]!.length}쪽)`;
        outputs.append(link);
      }
      message(`${groups.length}개 PDF를 만들었습니다. 아래 링크를 눌러 내려받으세요.`);
    } catch (error) { clearOutputs(); throw error; }
  };
  controls.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset['action'];
    if (!action || busy) return;
    if (action === 'hwpx-image' || action === 'hwpx-text') {
      void run(async () => {
        clearOutputs();
        conversion = new AbortController();
        cancel.hidden = false;
        try {
          const refs = selected.size ? pages.filter(page => selected.has(page)) : pages;
          if (refs.length > 100) throw new Error('HWPX는 한 번에 100쪽까지 변환할 수 있습니다.');
          message('PDF 쪽 준비 중…');
          const source = await savePdf(refs);
          conversion.signal.throwIfAborted();
          const { pdfToHwpx } = await import('./pdf-hwpx');
          const result = await pdfToHwpx(source, {
            mode: action === 'hwpx-image' ? 'image' : 'text', rotation: 0,
            dpi: Number(tool.querySelector<HTMLSelectElement>('#pdf-hwpx-dpi')!.value) as 150 | 200 | 300,
            emptyText: tool.querySelector<HTMLSelectElement>('#pdf-hwpx-empty')!.value as 'error' | 'image' | 'skip',
            tables: tool.querySelector<HTMLInputElement>('#pdf-hwpx-tables')!.checked,
            signal: conversion.signal, progress: text => message(text),
          });
          const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'application/hwp+zip' }));
          urls.push(url);
          const link = document.createElement('a'); link.href = url;
          link.download = `converted-${action === 'hwpx-image' ? 'image' : 'text'}.hwpx`;
          link.textContent = `${link.download} 내려받기 (${result.pages}쪽)`;
          outputs.append(link);
          for (const text of result.warnings) { const li = document.createElement('li'); li.textContent = text; warnings.append(li); }
          message(`${result.pages}쪽 HWPX 생성 완료. 아래 링크에서 내려받으세요.`);
        } catch (error) {
          if (conversion.signal.aborted) message('HWPX 변환을 취소했습니다.'); else throw error;
        } finally { conversion = undefined; cancel.hidden = true; }
      });
      return;
    }
    if (action === 'images') {
      void run(async () => {
        clearOutputs();
        conversion = new AbortController();
        cancel.hidden = false;
        try {
          const refs = selected.size ? pages.filter(page => selected.has(page)) : pages;
          message('PDF 쪽 준비 중…');
          // 편집기의 순서·회전을 먼저 PDF 로 굳힌 뒤 그린다 — HWPX 쪽과 같은 길이다.
          const source = await savePdf(refs);
          conversion.signal.throwIfAborted();
          const { packImages, pdfToImages } = await import('./pdf-images');
          const format = tool.querySelector<HTMLSelectElement>('#pdf-image-format')!.value as 'png' | 'jpeg';
          const images = await pdfToImages(source, {
            format, rotation: 0,
            dpi: Number(tool.querySelector<HTMLSelectElement>('#pdf-image-dpi')!.value) as 150 | 200 | 300,
            signal: conversion.signal, progress: text => message(text),
          });
          conversion.signal.throwIfAborted();
          const single = images.length === 1;
          if (!single) message('ZIP 으로 묶는 중…');
          const blob = single
            ? new Blob([new Uint8Array(images[0]!.bytes)], { type: `image/${format}` })
            : new Blob([new Uint8Array(packImages(images))], { type: 'application/zip' });
          const url = URL.createObjectURL(blob);
          urls.push(url);
          const link = document.createElement('a');
          link.href = url;
          link.download = single ? images[0]!.name : 'pages.zip';
          link.textContent = `${link.download} 내려받기 (${images.length}장)`;
          outputs.append(link);
          message(`${images.length}장을 만들었습니다. 아래 링크에서 내려받으세요.`);
        } catch (error) {
          if (conversion.signal.aborted) message('이미지 변환을 취소했습니다.'); else throw error;
        } finally { conversion = undefined; cancel.hidden = true; }
      });
      return;
    }
    if (action === 'save') { void run(() => exportGroups([pages], 'edited')); return; }
    if (action === 'extract') {
      if (!selected.size) { message('저장할 쪽을 선택하세요.', true); return; }
      void run(() => exportGroups([pages.filter(page => selected.has(page))], 'selected')); return;
    }
    if (action === 'split') {
      void run(async () => {
        const groups = splitRanges(ranges.value, pages.length).map(group => group.map(index => pages[index]!));
        await exportGroups(groups, 'split');
      }); return;
    }
    if (action === 'all') pages.forEach(page => selected.add(page));
    if (action === 'none') selected.clear();
    if (action === 'rotate' || action === 'remove') {
      if (!selected.size) { message('편집할 쪽을 선택하세요.', true); return; }
      clearOutputs();
      if (action === 'rotate') selected.forEach(page => { page.rotation = (page.rotation + 90) % 360; });
      else { pages = pages.filter(page => !selected.has(page)); selected.clear(); }
    }
    if (action === 'reset') { pages = []; selected.clear(); ranges.value = ''; clearOutputs(); }
    message('');
    render();
  });
  render();
  return tool;
}
