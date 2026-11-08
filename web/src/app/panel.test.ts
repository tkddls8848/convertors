// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { mountConverters } from './panel';

const builders = vi.hoisted(() => ({ first: vi.fn(), second: vi.fn() }));
vi.mock('./tool-registry', () => ({
  GROUPS: [{ title: 'Tools', choices: [
    { id: 'first', title: 'First', summary: 'S1', build: builders.first },
    { id: 'second', title: 'Second', summary: 'S2', build: builders.second },
  ] }],
}));

function tool(title: string) {
  const node = document.createElement('section');
  node.innerHTML = `<h2>${title}</h2><input />`;
  return node;
}
function choose(id: string) {
  document.querySelector<HTMLButtonElement>(`[data-choice="${id}"]`)!.click();
}
beforeEach(() => {
  vi.resetAllMocks();
  document.body.replaceChildren();
  mountConverters(document.body);
});

it('shares an in-flight build and preserves the tool state on return', async () => {
  let resolve!: (value: HTMLElement) => void;
  builders.first.mockReturnValue(new Promise<HTMLElement>(done => { resolve = done; }));
  builders.second.mockImplementation(() => tool('Second'));
  choose('first'); choose('first');
  await vi.waitFor(() => expect(builders.first).toHaveBeenCalledTimes(1));
  const first = tool('First');
  first.querySelector('input')!.value = 'retained';
  resolve(first);
  await vi.waitFor(() => expect(document.querySelector('.conv-stage')!.firstChild).toBe(first));
  choose('second');
  await vi.waitFor(() => expect(document.querySelector('.conv-stage h2')!.textContent).toBe('Second'));
  choose('first');
  expect(document.querySelector('.conv-stage input')).toHaveProperty('value', 'retained');
  expect(builders.first).toHaveBeenCalledTimes(1);
});

it('does not let a late build replace the current selection', async () => {
  let resolve!: (value: HTMLElement) => void;
  builders.first.mockReturnValue(new Promise<HTMLElement>(done => { resolve = done; }));
  builders.second.mockImplementation(() => tool('Second'));
  choose('first'); choose('second');
  await vi.waitFor(() => expect(document.querySelector('.conv-stage h2')!.textContent).toBe('Second'));
  resolve(tool('First'));
  await new Promise(done => setTimeout(done, 0));
  expect(document.querySelector('.conv-stage h2')!.textContent).toBe('Second');
});

it('allows retry after a failed build', async () => {
  builders.first.mockRejectedValueOnce(new Error('load failed')).mockImplementationOnce(() => tool('First'));
  choose('first');
  await vi.waitFor(() => expect(document.querySelector('.conv-stage')!.textContent).toContain('load failed'));
  choose('first');
  await vi.waitFor(() => expect(document.querySelector('.conv-stage h2')!.textContent).toBe('First'));
  expect(builders.first).toHaveBeenCalledTimes(2);
});

it('처음에는 목록이 펼쳐져 있고, 고르면 접히며 토글에 고른 이름이 보인다', async () => {
  const toggle = document.querySelector<HTMLButtonElement>('.conv-choices__toggle')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.getAttribute('aria-controls')).toBe('conv-choice-groups');
  expect(document.getElementById('conv-choice-groups')!.querySelector('[data-choice="first"]')).not.toBeNull();
  expect(toggle.textContent).toBe('도구 고르기');
  builders.first.mockImplementation(() => tool('First'));
  choose('first');
  await vi.waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
  expect(document.querySelector('.conv-choices')!.hasAttribute('data-collapsed')).toBe(true);
  expect(toggle.textContent).toBe('First · 다른 도구 고르기');
  toggle.click();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('.conv-choices')!.hasAttribute('data-collapsed')).toBe(false);
});

it('도구 버튼 이름에 한 줄 설명이 남고 title 로도 보인다', () => {
  const button = document.querySelector('[data-choice="first"]')!;
  expect(button.textContent).toContain('S1');
  expect(button.getAttribute('title')).toBe('S1');
});

it('목록과 고른 도구가 한 틀 안에 나란히 있다', () => {
  const layout = document.querySelector('.conv-layout')!;
  expect([...layout.children].map(child => child.className)).toEqual(['conv-choices', 'conv-stage']);
});

it('넓은 화면에서 아래로 내려 둔 채 다른 도구를 고르면 그 도구의 맨 위로 옮긴다', async () => {
  const stage = document.querySelector<HTMLElement>('.conv-stage')!;
  const scroll = vi.fn();
  stage.scrollIntoView = scroll;
  builders.first.mockImplementation(() => tool('First'));
  builders.second.mockImplementation(() => tool('Second'));
  stage.getBoundingClientRect = () => ({ top: 120 } as DOMRect);
  choose('first');
  await vi.waitFor(() => expect(document.querySelector('.conv-stage h2')!.textContent).toBe('First'));
  expect(scroll).not.toHaveBeenCalled();            // 이미 보이면 그대로 둔다
  stage.getBoundingClientRect = () => ({ top: -480 } as DOMRect);
  choose('second');
  await vi.waitFor(() => expect(document.querySelector('.conv-stage h2')!.textContent).toBe('Second'));
  expect(scroll).toHaveBeenCalledTimes(1);
});

it('갈래는 처음에 접혀 있고, 제목을 눌러 펼친다', () => {
  const toggle = document.querySelector<HTMLButtonElement>('.conv-group__toggle')!;
  const list = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  expect(toggle.textContent).toContain('Tools');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(list.hidden).toBe(true);
  toggle.click();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(list.hidden).toBe(false);
  toggle.click();
  expect(list.hidden).toBe(true);
});

it('고른 도구가 든 갈래는 펼쳐 둔다 — 지금 어디에 있는지 보이게', async () => {
  builders.first.mockImplementation(() => tool('First'));
  choose('first');
  await vi.waitFor(() => expect(document.querySelector('.conv-stage h2')!.textContent).toBe('First'));
  expect(document.querySelector('.conv-group__toggle')!.getAttribute('aria-expanded')).toBe('true');
});
