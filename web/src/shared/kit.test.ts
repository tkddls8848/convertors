// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { outputs, revealResult, statusLine } from './kit';

let results: HTMLElement;
let status: HTMLElement;
let links: HTMLElement;
let scroll: ReturnType<typeof vi.fn>;

/** 결과 칸이 화면의 어디에 있는지 jsdom 에 알려 준다. 창 높이는 768. */
function placeAt(top: number, bottom: number): void {
  results.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
}
function reducedMotion(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  document.body.innerHTML = '<div class="conv-results"><p class="conv-status" role="status"></p><div class="conv-outputs"></div></div>';
  results = document.querySelector('.conv-results')!;
  status = document.querySelector('.conv-status')!;
  links = document.querySelector('.conv-outputs')!;
  scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll as unknown as Element['scrollIntoView'];
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  reducedMotion(false);
});
afterEach(() => { vi.restoreAllMocks(); });

it('화면 밖 결과 칸으로 링크가 생기면 그 칸이 보이게 스크롤한다', () => {
  placeAt(1200, 1300);
  outputs(links).add(new Uint8Array([1]), 'a.pdf', 'application/pdf');
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll.mock.contexts[0]).toBe(results);
  expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
});

it('위로 밀려 올라간 결과 칸도 드러낸다', () => {
  placeAt(-400, -300);
  revealResult(links);
  expect(scroll).toHaveBeenCalledTimes(1);
});

it('이미 보이는 결과 칸이면 스크롤하지 않는다', () => {
  placeAt(100, 200);
  outputs(links).add(new Uint8Array([1]), 'a.pdf', 'application/pdf');
  expect(scroll).not.toHaveBeenCalled();
});

it('statusLine 의 error 는 결과 칸을 드러낸다', () => {
  placeAt(1200, 1300);
  statusLine(status)('저장하지 못했습니다.', 'error');
  expect(scroll).toHaveBeenCalledTimes(1);
});

it('statusLine 의 ok·보통 알림은 스크롤하지 않는다', () => {
  placeAt(1200, 1300);
  const say = statusLine(status);
  say('복사했습니다: 금액', 'ok');
  say('PDF 읽는 중…');
  expect(scroll).not.toHaveBeenCalled();
});

it('움직임 줄이기 설정이면 애니메이션 없이 옮긴다', () => {
  reducedMotion(true);
  placeAt(1200, 1300);
  revealResult(links);
  expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
});

it('결과 칸 밖의 요소는 그 요소 자체를 드러낸다', () => {
  const lone = document.createElement('p');
  document.body.append(lone);
  lone.getBoundingClientRect = () => ({ top: 900, bottom: 950, left: 0, right: 1, width: 1, height: 50, x: 0, y: 900, toJSON: () => ({}) });
  revealResult(lone);
  expect(scroll.mock.contexts[0]).toBe(lone);
});

it('긴 결과 칸은 윗부분이 보이면 스크롤하지 않는다 — 입력할 때마다 화면이 튀지 않게', () => {
  placeAt(300, 2400);
  revealResult(links);
  expect(scroll).not.toHaveBeenCalled();
});

it('윗부분이 화면 맨 아래에 겨우 걸치면 드러낸다', () => {
  placeAt(740, 900);
  revealResult(links);
  expect(scroll).toHaveBeenCalledTimes(1);
});
