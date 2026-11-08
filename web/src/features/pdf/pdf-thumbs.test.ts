// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

import type { PdfSource } from './pdf';
import { createThumbnailer, type DrawPage } from './pdf-thumbs';

/** 손으로 부르는 IntersectionObserver. `intersect(slot)` 로 칸이 보였다고 알린다. */
let fire: (slot: Element, visible?: boolean) => void;
beforeEach(() => {
  let callback: IntersectionObserverCallback = () => {};
  const observed = new Set<Element>();
  class FakeObserver {
    constructor(cb: IntersectionObserverCallback) { callback = cb; }
    observe(target: Element) { observed.add(target); }
    unobserve(target: Element) { observed.delete(target); }
    disconnect() { observed.clear(); }
    takeRecords() { return []; }
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  fire = (slot, visible = true) => {
    if (!observed.has(slot)) return;
    callback([{ target: slot, isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);
  };
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:${++n}`);
  URL.revokeObjectURL = vi.fn();
  document.body.replaceChildren();
});

const source = (name: string): PdfSource => ({ name, size: 1, bytes: new Uint8Array(), document: {} as PdfSource['document'] });
const slot = (): HTMLElement => {
  const element = document.createElement('span');
  document.body.append(element);
  return element;
};
/** 끝내는 때를 테스트가 정하는 그리기. */
function deferredDraw() {
  const calls: Array<{ source: PdfSource; index: number; resolve: (blob: Blob) => void; reject: (error: Error) => void }> = [];
  const draw: DrawPage = (s, index) => new Promise<Blob>((resolve, reject) => { calls.push({ source: s, index, resolve, reject }); });
  return { calls, draw };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('보이는 칸만 그린다', () => {
  const { calls, draw } = deferredDraw();
  const thumbs = createThumbnailer({ root: document.body, draw });
  const a = source('a.pdf');
  const [first, second] = [slot(), slot()];
  thumbs.show(first, a, 0);
  thumbs.show(second, a, 1);
  fire(first);
  expect(calls.map(call => call.index)).toEqual([0]);
});

it('동시에 최대 2장만 그린다', async () => {
  const { calls, draw } = deferredDraw();
  const thumbs = createThumbnailer({ root: document.body, draw });
  const a = source('a.pdf');
  const slots = [0, 1, 2, 3, 4].map(index => { const s = slot(); thumbs.show(s, a, index); return s; });
  slots.forEach(s => fire(s));
  expect(calls).toHaveLength(2);
  calls[0]!.resolve(new Blob(['x']));
  await settle();
  expect(calls).toHaveLength(3);
});

it('같은 쪽은 한 번만 그린다', async () => {
  const { calls, draw } = deferredDraw();
  const thumbs = createThumbnailer({ root: document.body, draw });
  const a = source('a.pdf');
  const first = slot();
  thumbs.show(first, a, 0);
  fire(first);
  calls[0]!.resolve(new Blob(['x']));
  await settle();
  expect(first.querySelector('img.pdf-thumb')?.getAttribute('src')).toBe('blob:1');
  // 회전·순서 바꾸기로 목록을 다시 그리면 새 칸이 생긴다 — 그림은 다시 그리지 않는다.
  const again = slot();
  thumbs.show(again, a, 0);
  expect(again.querySelector('img.pdf-thumb')?.getAttribute('src')).toBe('blob:1');
  expect(calls).toHaveLength(1);
});

it('그리기 실패는 "미리보기 없음"', async () => {
  const { calls, draw } = deferredDraw();
  const thumbs = createThumbnailer({ root: document.body, draw });
  const s = slot();
  thumbs.show(s, source('a.pdf'), 0);
  fire(s);
  calls[0]!.reject(new Error('broken page'));
  await settle();
  expect(s.textContent).toBe('미리보기 없음');
  expect(s.querySelector('img')).toBeNull();
});

it('잊은 파일의 늦은 그림은 버리고 URL 을 거둔다', async () => {
  const { calls, draw } = deferredDraw();
  const thumbs = createThumbnailer({ root: document.body, draw });
  const a = source('a.pdf');
  const [drawn, late] = [slot(), slot()];
  thumbs.show(drawn, a, 0);
  thumbs.show(late, a, 1);
  fire(drawn); fire(late);
  calls[0]!.resolve(new Blob(['x']));
  await settle();
  thumbs.forget(a);
  calls[1]!.resolve(new Blob(['y']));
  await settle();
  expect(late.querySelector('img')).toBeNull();
  const created = vi.mocked(URL.createObjectURL).mock.results.map(result => result.value);
  expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(call => call[0]).sort()).toEqual([...created].sort());
});

it('보이기 전에 화면 밖으로 나간 칸은 그리지 않는다', () => {
  const { calls, draw } = deferredDraw();
  const thumbs = createThumbnailer({ root: document.body, draw });
  const a = source('a.pdf');
  const slots = [0, 1, 2].map(index => { const s = slot(); thumbs.show(s, a, index); return s; });
  slots.forEach(s => fire(s));         // 0, 1 은 그리기 시작, 2 는 기다림
  fire(slots[2]!, false);               // 빠르게 지나쳐 갔다
  calls[0]!.resolve(new Blob(['x']));
  return settle().then(() => expect(calls.map(call => call.index)).toEqual([0, 1]));
});

it('목록을 다시 세우기 전에 옛 칸을 놓아 준다 — 떼어 낸 칸이 쌓이지 않게', async () => {
  const { calls, draw } = deferredDraw();
  const thumbs = createThumbnailer({ root: document.body, draw });
  const a = source('a.pdf');
  const old = [0, 1, 2].map(index => { const s = slot(); thumbs.show(s, a, index); return s; });
  fire(old[0]!);                       // 0쪽은 그리는 중
  thumbs.clearSlots();
  old.forEach(s => s.remove());
  old.slice(1).forEach(s => fire(s));  // 떼어 낸 칸이 보였다는 알림은 무시한다
  expect(calls.map(call => call.index)).toEqual([0]);
  const fresh = slot();
  thumbs.show(fresh, a, 0);            // 새 목록의 같은 쪽 — 그리던 그림이 여기로 온다
  calls[0]!.resolve(new Blob(['x']));
  await settle();
  expect(fresh.querySelector('img.pdf-thumb')).not.toBeNull();
  expect(old[0]!.querySelector('img')).toBeNull();
});
