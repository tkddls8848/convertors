// @vitest-environment jsdom
/**
 * 결과 칸 규칙 — 실행 결과(상태 줄·미리보기·내려받기)는 한 상자(`.conv-results`)에 모이고,
 * 그 상자는 실행 단추보다 앞, 파일 칸 바로 아래에 온다. 도구를 하나씩 옮기며 목록을 늘린다.
 */
import { describe, expect, it } from 'vitest';

import { GROUPS } from './tool-registry';

async function build(id: string): Promise<HTMLElement> {
  const choice = GROUPS.flatMap(group => group.choices).find(item => item.id === id);
  if (!choice) throw new Error(`등록부에 없는 도구: ${id}`);
  const tool = await choice.build();
  document.body.replaceChildren(tool);
  return tool;
}

const PLACED = ['document', 'spreadsheet', 'hwpx-markdown', 'text-hwpx', 'encoding', 'redact', 'text-diff', 'bizno', 'vat'];

/** 내려받기 링크 묶음 대신 결과 상자 안의 단추로 내려받는 도구. */
const RESULT_SELECTOR: Record<string, string> = { 'hwpx-markdown': '.conv-result' };

describe('결과 칸', () => {
  it.each(PLACED)('%s: 내려받기 묶음은 상태 줄과 같은 결과 칸에 있고, 결과 칸이 첫 실행 단추보다 앞이다', async id => {
    const tool = await build(id);
    const lists = tool.querySelectorAll(RESULT_SELECTOR[id] ?? '[class*="outputs"]');
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      const box = list.closest('.conv-results');
      expect(box, list.className).not.toBeNull();
      expect(box!.querySelector('[role="status"]'), list.className).not.toBeNull();
    }
    const firstBox = tool.querySelector('.conv-results')!;
    const firstRun = tool.querySelector('button.conv-download');
    if (firstRun) expect(firstBox.compareDocumentPosition(firstRun) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
