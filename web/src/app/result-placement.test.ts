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

const PLACED = [
  'document', 'spreadsheet', 'hwpx-markdown', 'text-hwpx', 'encoding', 'redact', 'text-diff', 'bizno', 'vat',
  'hash', 'qr', 'rename', 'zip', 'image-convert', 'images-pdf', 'sheet-merge',
  'pdf-meta', 'pdf-nup', 'pdf-sign', 'pdf-stamp', 'pdf-edit', 'pdf',
];

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

  it('PDF 글자 고치기: 편집 양식의 입력 확인은 결과 칸이 아니라 양식 안 알림 줄에 나온다', async () => {
    const tool = await build('pdf-edit');
    const note = tool.querySelector('.edit-form-note[role="status"]');
    expect(note).not.toBeNull();
    expect(note!.closest('.conv-results')).toBeNull();
  });

  it('PDF 편집기: 결과 칸은 오른쪽 칸 맨 위, 쪽 목록은 왼쪽 칸', async () => {
    const tool = await build('pdf');
    expect(tool.querySelector('.pdf-right')!.firstElementChild!.matches('.conv-results')).toBe(true);
    expect(tool.querySelector('.pdf-left .pdf-pages')).not.toBeNull();
    expect(tool.querySelector('.pdf-left #conv-pdf-file')).not.toBeNull();
    expect(tool.querySelector('.pdf-right .pdf-outputs')).not.toBeNull();
  });
});
