// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { mountConverters } from './panel';

const builders = vi.hoisted(() => ({ first: vi.fn(), second: vi.fn() }));
vi.mock('./tool-registry', () => ({
  GROUPS: [{ title: 'Tools', choices: [
    { id: 'first', title: 'First', summary: '', build: builders.first },
    { id: 'second', title: 'Second', summary: '', build: builders.second },
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
