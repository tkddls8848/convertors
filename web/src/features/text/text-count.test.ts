import { describe, expect, it } from 'vitest';

import { countText, graphemes } from './text-count';

describe('countText', () => {
  it('빈 글은 모두 0 이다', () => {
    expect(countText('')).toMatchObject({ all: 0, withSpaces: 0, noSpaces: 0, words: 0, lines: 0, paragraphs: 0, utf8Bytes: 0 });
    expect(countText('').manuscript.rows).toBe(0);
  });

  it('공백 포함·제외와 줄바꿈 포함·제외를 따로 센다', () => {
    const result = countText('안녕 하세요\nhello world');
    expect(result.all).toBe(18);
    expect(result.withSpaces).toBe(17);
    expect(result.noSpaces).toBe(15);
    expect(result.hangul).toBe(5);
    expect(result.words).toBe(4);
    expect(result.lines).toBe(2);
  });

  it('CRLF 도 줄바꿈 한 번이다', () => {
    const result = countText('가\r\n나');
    expect(result.all).toBe(3);
    expect(result.withSpaces).toBe(2);
    expect(result.lines).toBe(2);
  });

  it('이모지는 보이는 대로 한 글자다', () => {
    // 👍🏽 는 코드 포인트 둘, 👨‍👩‍👧 는 다섯이다.
    expect(graphemes('👍🏽👨‍👩‍👧')).toHaveLength(2);
    expect(countText('👍🏽a').withSpaces).toBe(2);
  });

  it('바이트: UTF-8 한글 3, CP949 셈 한글 2·ASCII 1', () => {
    const result = countText('한글 ab');
    expect(result.utf8Bytes).toBe(9);
    expect(result.cp949Bytes).toBe(7);
    expect(result.notInCp949).toEqual([]);
  });

  it('CP949 에 없는 글자는 따로 모은다', () => {
    const result = countText('가😀😀');
    expect(result.notInCp949).toEqual(['😀']);
  });

  it('문단은 빈 줄로 나눈다. 끝의 줄바꿈은 줄을 늘리지 않는다', () => {
    const result = countText('첫 문단\n이어짐\n\n\n둘째 문단\n');
    expect(result.paragraphs).toBe(2);
    expect(result.lines).toBe(5);
  });

  it('원고지: 문단마다 한 칸 들이고 새 줄에서 시작한다', () => {
    // 19글자 + 들여쓰기 = 20칸 → 1줄, 20글자 → 21칸 → 2줄
    const nineteen = '가'.repeat(19);
    const twenty = '가'.repeat(20);
    expect(countText(nineteen).manuscript.rows).toBe(1);
    expect(countText(twenty).manuscript.rows).toBe(2);
    expect(countText(`${nineteen}\n\n${nineteen}`).manuscript.rows).toBe(2);
    expect(countText('가'.repeat(199)).manuscript.pages).toBe(1);
  });
});
