import { describe, it, expect } from 'vitest';
import { reconstructText, type TextSpan } from './pdf-text';
const span = (text: string, x: number, y: number): TextSpan => ({ text, x, y, width: text.length * 6, height: 10 });
describe('PDF 텍스트 재구성', () => {
  it('입력 순서에 관계없이 위에서 아래, 왼쪽에서 오른쪽으로 정렬한다', () => {
    expect(reconstructText([span('third', 10, 50), span('second', 50, 20), span('first', 10, 20)], false))
      .toEqual([{ kind: 'paragraph', text: 'first second' }, { kind: 'paragraph', text: 'third' }]);
  });
  it('정렬된 연속 행만 사용자 선택에 따라 표로 만든다', () => {
    const input = [span('A', 10, 10), span('B', 150, 10), span('C', 10, 30), span('D', 150, 30)];
    expect(reconstructText(input, true)).toEqual([{ kind: 'table', rows: [['A', 'B'], ['C', 'D']] }]);
    expect(reconstructText(input, false).every(block => block.kind === 'paragraph')).toBe(true);
  });
  it('열 위치나 행 간격이 다르면 표로 오인하지 않는다', () => {
    expect(reconstructText([span('A', 10, 10), span('B', 150, 10), span('C', 30, 80), span('D', 170, 80)], true).every(block => block.kind === 'paragraph')).toBe(true);
    expect(reconstructText([], true)).toEqual([]);
  });
});
