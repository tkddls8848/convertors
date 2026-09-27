import { describe, expect, it } from 'vitest';

import { inline, parseMarkdown } from './markdown';

const texts = (source: string): string[] =>
  parseMarkdown(source).blocks.filter(block => block.kind === 'paragraph').map(block => block.text);

describe('inline', () => {
  it('꾸밈은 벗기고 글자는 남긴다', () => {
    expect(inline('**굵게** 와 *기울임* 과 `코드`')).toBe('굵게 와 기울임 과 코드');
    expect(inline('~~취소~~선')).toBe('취소선');
  });

  it('링크는 주소를 괄호로 남긴다 — HWPX 에 링크가 없다', () => {
    expect(inline('[나라장터](https://g2b.go.kr)')).toBe('나라장터 (https://g2b.go.kr)');
    expect(inline('![표지](cover.png) 다음')).toBe(' 다음');
  });
});

describe('parseMarkdown', () => {
  it('빈 줄로 나뉜 문단을 지키고 이어진 줄은 한 문단으로 합친다', () => {
    expect(texts('첫째 줄\n이어지는 줄\n\n다음 문단')).toEqual(['첫째 줄 이어지는 줄', '다음 문단']);
  });

  it('표는 행과 열을 그대로 옮긴다', () => {
    const { blocks } = parseMarkdown('| 품목 | 수량 |\n| --- | ---: |\n| 볼펜 | 3 |\n| 종이 | 10 |');
    expect(blocks).toEqual([{ kind: 'table', rows: [['품목', '수량'], ['볼펜', '3'], ['종이', '10']] }]);
  });

  it('구분선이 없으면 표가 아니다', () => {
    // 본문에 세로줄이 있다고 표로 만들면 글이 표 안에 갇힌다.
    expect(texts('가격은 1,000|2,000 사이입니다.')).toEqual(['가격은 1,000|2,000 사이입니다.']);
  });

  it('칸 수가 다른 줄은 빈 칸으로 맞추고 그 사실을 적는다', () => {
    // 직사각형이 아니면 hwpx-writer 가 거절한다. 조용히 줄을 버리지 않는다.
    const { blocks, notes } = parseMarkdown('| a | b | c |\n| - | - | - |\n| 1 |');
    expect(blocks).toEqual([{ kind: 'table', rows: [['a', 'b', 'c'], ['1', '', '']] }]);
    expect(notes).toContain('칸 수가 다른 표의 줄은 빈 칸을 채워 맞췄습니다.');
  });

  it('칸 안의 이스케이프된 세로줄은 칸을 나누지 않는다', () => {
    const { blocks } = parseMarkdown('| 식 |\n| - |\n| a \\| b |');
    expect(blocks).toEqual([{ kind: 'table', rows: [['식'], ['a | b']] }]);
  });

  it('제목·목록·인용은 문단이 되고 무엇을 잃는지 알린다', () => {
    const { blocks, notes } = parseMarkdown('# 과업 내용\n\n- 첫째\n  - 안쪽\n1. 하나\n\n> 인용');
    expect(blocks.map(block => block.kind === 'paragraph' ? block.text : '')).toEqual([
      '과업 내용', '• 첫째', '  • 안쪽', '1. 하나', '인용',
    ]);
    expect(notes).toEqual([
      '제목은 문단으로 들어갑니다 — 제목 스타일·크기는 옮기지 않습니다.',
      '목록은 글머리표 모양의 문단입니다 — 한글의 자동 번호 매김이 아닙니다.',
    ]);
  });

  it('코드 블록은 줄을 그대로 둔다', () => {
    const { blocks, notes } = parseMarkdown('```bash\nnpm  run   test\n```');
    expect(blocks).toEqual([{ kind: 'paragraph', text: 'npm  run   test' }]);
    expect(notes).toContain('코드 블록은 글꼴 없이 문단으로 옮깁니다.');
  });

  it('XML 에 넣을 수 없는 제어 문자는 떨군다', () => {
    expect(texts('앞' + '\u0000' + '뒤')).toEqual(['앞뒤']);
  });

  it('텍스트 모드는 줄 하나가 문단 하나다', () => {
    // 로그·주소록처럼 줄이 곧 뜻인 글은 합치면 안 된다.
    const { blocks, notes } = parseMarkdown('# 제목이 아니다\n| 표 | 아니다 |', { markdown: false });
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '# 제목이 아니다' },
      { kind: 'paragraph', text: '| 표 | 아니다 |' },
    ]);
    expect(notes).toEqual([]);
  });

  it('윈도우 줄바꿈을 그대로 받는다', () => {
    expect(texts('첫째\r\n\r\n둘째')).toEqual(['첫째', '둘째']);
  });
});
