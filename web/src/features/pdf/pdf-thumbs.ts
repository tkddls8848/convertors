/**
 * PDF 편집기의 쪽 썸네일.
 *
 * 1,000쪽까지 받으므로 한꺼번에 그리지 않는다. **화면(목록 상자)에 들어온 칸만**
 * 차례로, 동시에 두 장까지 그린다. 한 번 그린 쪽은 (파일, 원본 쪽) 으로 기억해 두어
 * 회전·순서 바꾸기로 목록을 다시 세워도 다시 그리지 않는다. 편집기에서 더한 회전은
 * 그림을 돌려 보여 줄 뿐이라 여기서는 모른다.
 *
 * 그리기(`DrawPage`)는 밖에서 받는다. 대기열·기억·버리기는 브라우저 없이 시험하고,
 * 실제 PDF.js 그리기(`drawWithPdfJs`)는 브라우저 검사가 본다.
 */
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

import type { PdfSource } from './pdf';

export type DrawPage = (source: PdfSource, index: number) => Promise<Blob>;

export interface Thumbnailer {
  /** slot 이 root 안에서 보이면 (source, index) 를 그려 slot 안 <img> 에 넣는다. 그린 적 있으면 바로 넣는다. */
  show(slot: HTMLElement, source: PdfSource, index: number): void;
  /** 이 파일의 그림·대기를 버리고 Blob URL 을 거둔다. 진행 중이던 그림은 끝나면 버린다. */
  forget(source: PdfSource): void;
  dispose(): void;
}

interface Wanted { source: PdfSource; index: number }

export function createThumbnailer(options: { root: HTMLElement; draw: DrawPage; concurrency?: number }): Thumbnailer {
  const { root, draw, concurrency = 2 } = options;
  const drawn = new Map<PdfSource, Map<number, string>>();
  const wanted = new Map<HTMLElement, Wanted>();
  const queue: HTMLElement[] = [];
  const running = new Set<string>();
  const forgotten = new WeakSet<PdfSource>();
  const ids = new WeakMap<PdfSource, number>();
  let nextId = 0;
  const key = ({ source, index }: Wanted): string => {
    let id = ids.get(source);
    if (id === undefined) { id = nextId++; ids.set(source, id); }
    return `${id}:${index}`;
  };

  const picture = (slot: HTMLElement, url: string): void => {
    const img = document.createElement('img');
    img.className = 'pdf-thumb';
    img.alt = '';
    img.src = url;
    slot.replaceChildren(img);
    delete slot.dataset['state'];
  };
  const missing = (slot: HTMLElement): void => {
    const note = document.createElement('span');
    note.className = 'pdf-thumb-missing';
    note.textContent = '미리보기 없음';
    slot.replaceChildren(note);
    delete slot.dataset['state'];
  };
  /** 같은 쪽을 기다리는 칸 모두에 결과를 넣는다. */
  const deliver = (job: Wanted, fill: (slot: HTMLElement) => void): void => {
    for (const [slot, want] of wanted) {
      if (want.source !== job.source || want.index !== job.index) continue;
      fill(slot);
      wanted.delete(slot);
      observer.unobserve(slot);
    }
  };

  const pump = (): void => {
    while (running.size < concurrency && queue.length) {
      const slot = queue.shift()!;
      const job = wanted.get(slot);
      if (!job) continue;
      const id = key(job);
      if (running.has(id)) continue; // 같은 쪽을 이미 그리는 중 — 끝나면 이 칸에도 넣는다
      running.add(id);
      draw(job.source, job.index)
        .then(blob => {
          if (forgotten.has(job.source)) return;
          const url = URL.createObjectURL(blob);
          let pages = drawn.get(job.source);
          if (!pages) { pages = new Map(); drawn.set(job.source, pages); }
          pages.set(job.index, url);
          deliver(job, slot => picture(slot, url));
        })
        .catch(() => { if (!forgotten.has(job.source)) deliver(job, missing); })
        .finally(() => { running.delete(id); pump(); });
    }
  };

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const slot = entry.target as HTMLElement;
      if (!wanted.has(slot)) continue;
      const at = queue.indexOf(slot);
      if (entry.isIntersecting) { if (at < 0) queue.push(slot); }
      else if (at >= 0) queue.splice(at, 1);
    }
    pump();
  }, { root, rootMargin: '200px 0px' });

  return {
    show(slot, source, index) {
      const url = drawn.get(source)?.get(index);
      if (url) { picture(slot, url); return; }
      if (forgotten.has(source)) { missing(slot); return; }
      slot.replaceChildren();
      slot.dataset['state'] = 'waiting';
      wanted.set(slot, { source, index });
      observer.observe(slot);
    },
    forget(source) {
      forgotten.add(source);
      for (const url of drawn.get(source)?.values() ?? []) URL.revokeObjectURL(url);
      drawn.delete(source);
      for (const [slot, want] of wanted) {
        if (want.source !== source) continue;
        wanted.delete(slot);
        observer.unobserve(slot);
        const at = queue.indexOf(slot);
        if (at >= 0) queue.splice(at, 1);
      }
    },
    dispose() {
      observer.disconnect();
      for (const source of [...drawn.keys()]) this.forget(source);
      wanted.clear();
      queue.length = 0;
    },
  };
}

/**
 * PDF.js 로 쪽을 작게 그려 PNG 로 돌려준다. 파일마다 PDF.js 문서를 한 번만 열고,
 * `release` 에서 닫는다. 원래 회전(쪽에 적힌 /Rotate)은 PDF.js 기본 viewport 가 반영한다.
 */
export function drawWithPdfJs(longSide = 160): DrawPage & { release(source: PdfSource): void } {
  const documents = new Map<PdfSource, PDFDocumentLoadingTask>();
  const draw = async (source: PdfSource, index: number): Promise<Blob> => {
    const { openPdf, renderToCanvas } = await import('./pdf-render');
    let task = documents.get(source);
    if (!task) { task = openPdf(source.bytes); documents.set(source, task); }
    const page = await (await task.promise).getPage(index + 1);
    try {
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (longSide * ratio) / Math.max(base.width, base.height) });
      const canvas = document.createElement('canvas');
      try {
        await renderToCanvas(page, canvas, viewport);
        return await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('쪽 그림을 만들지 못했습니다.')), 'image/png'));
      } finally { canvas.width = 0; canvas.height = 0; }
    } finally { page.cleanup(); }
  };
  return Object.assign(draw, {
    release(source: PdfSource) {
      const task = documents.get(source);
      documents.delete(source);
      void task?.destroy().catch(() => {});
    },
  });
}
