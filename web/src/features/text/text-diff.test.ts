import { describe, expect, it } from 'vitest';

import { diffChars, diffText, editScript, TEXT_DIFF_LIMITS, unifiedDiff, viewRows } from './text-diff';

/** 편집 스크립트를 적용해 a 가 b 가 되는지 — 가장 짧은지와 별개로 먼저 맞아야 한다. */
function apply(a: number[], b: number[], script: number[]): number[] {
  const out: number[] = [];
  let i = 0; let j = 0;
  for (const step of script) {
    if (step === 0) { expect(a[i]).toBe(b[j]); out.push(a[i++]!); j++; }
    else if (step === 1) i++;
    else out.push(b[j++]!);
  }
  expect(i).toBe(a.length);
  return out;
}

describe('editScript', () => {
  it('어떤 두 줄이든 a 를 b 로 바꾸고, 걸음 수가 가장 짧다', () => {
    const a = [1, 2, 3, 1, 2, 2, 1];
    const b = [3, 2, 1, 2, 1, 3];
    const script = editScript(a, b, 100)!;
    expect(apply(a, b, script)).toEqual(b);
    // Myers 논문의 예(ABCABBA → CBABAC)는 D = 5 다.
    expect(script.filter(step => step !== 0)).toHaveLength(5);
  });

  it('무작위로도 맞는다', () => {
    let seed = 7;
    const random = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % 4; };
    for (let round = 0; round < 50; round++) {
      const a = Array.from({ length: 30 }, random);
      const b = Array.from({ length: 25 }, random);
      expect(apply(a, b, editScript(a, b, 1000)!)).toEqual(b);
    }
  });

  it('한도를 넘으면 null', () => {
    expect(editScript([1, 2, 3], [4, 5, 6], 2)).toBeNull();
  });
});

describe('diffText', () => {
  it('같으면 바뀐 것이 없고 차이 파일도 비어 있다', () => {
    const result = diffText('가\n나\n', '가\n나');
    expect(result).toMatchObject({ added: 0, deleted: 0, changed: 0 });
    expect(result.finalNewline).toEqual({ a: true, b: false });
    expect(unifiedDiff(result, 'a', 'b')).toBe('');
  });

  it('더하기만·빼기만', () => {
    expect(diffText('a\nc', 'a\nb\nc')).toMatchObject({ added: 1, deleted: 0, changed: 0 });
    expect(diffText('a\nb\nc', 'a\nc')).toMatchObject({ added: 0, deleted: 1, changed: 0 });
    expect(diffText('', 'a\nb')).toMatchObject({ added: 2 });
  });

  it('붙은 삭제·추가는 바뀐 줄로 짝짓고 글자 단위로 칠한다', () => {
    const result = diffText('단가 1000원\n합계', '단가 1200원\n합계');
    expect(result).toMatchObject({ added: 0, deleted: 0, changed: 1 });
    const del = result.ops.find(op => op.kind === 'del')!;
    expect(del.kind === 'del' && del.parts).toEqual([
      { text: '단가 1', changed: false }, { text: '0', changed: true }, { text: '00원', changed: false },
    ]);
  });

  it('공백 무시·대소문자 무시·빈 줄 무시', () => {
    expect(diffText('a  b\n', ' a b').changed).toBe(1);
    expect(diffText('a  b\n', ' a b', { ignoreWhitespace: true }).changed).toBe(0);
    expect(diffText('Hello', 'hello', { ignoreCase: true }).changed).toBe(0);
    const blanks = diffText('a\n\nb', 'a\nb\n\n', { ignoreBlankLines: true });
    expect(blanks).toMatchObject({ added: 0, deleted: 0, changed: 0 });
    expect(unifiedDiff(blanks, 'a', 'b')).toBe('');
    expect(diffText('a\n\nb', 'a\nb').deleted).toBe(1);
  });

  it('한도를 넘으면 한국어로 멈춘다', () => {
    const many = Array.from({ length: TEXT_DIFF_LIMITS.lines + 1 }, (_, i) => `${i}`).join('\n');
    expect(() => diffText(many, '')).toThrow(/줄을 넘어/);
  });

  it('한글 글에서도 짝을 맞춘다', () => {
    const result = diffText('계약 기간은 1년으로 한다.\n위약금은 없다.', '계약 기간은 2년으로 한다.\n위약금은 10%로 한다.\n특약 없음');
    expect(result.changed).toBe(2);
    expect(result.added).toBe(1);
  });
});

describe('diffChars', () => {
  it('이모지·결합 문자를 반으로 가르지 않는다', () => {
    const parts = diffChars('좋아요👍🏽', '좋아요👍🏿')!;
    expect(parts.a).toEqual([{ text: '좋아요', changed: false }, { text: '👍🏽', changed: true }]);
  });
  it('거의 다 다르면 칠하지 않는다', () => {
    expect(diffChars('abcdef', 'uvwxyz')).toBeNull();
  });
});

describe('unifiedDiff', () => {
  it('문맥 3줄과 @@ 머리를 규칙대로 적는다', () => {
    const a = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n');
    const b = ['1', '2', '3', '4', '5', '여섯', '7', '8', '9', '10'].join('\n');
    expect(unifiedDiff(diffText(a, b), 'a.txt', 'b.txt')).toBe([
      '--- a.txt', '+++ b.txt', '@@ -3,7 +3,7 @@', ' 3', ' 4', ' 5', '-6', '+여섯', ' 7', ' 8', ' 9', '',
    ].join('\n'));
  });

  it('빈 파일에 더하면 -0,0 이다', () => {
    expect(unifiedDiff(diffText('', 'a'), 'a', 'b')).toBe('--- a\n+++ b\n@@ -0,0 +1 @@\n+a\n');
  });

  it('멀리 떨어진 변경은 덩이를 나눈다', () => {
    const a = Array.from({ length: 20 }, (_, i) => `${i}`);
    const b = [...a]; b[1] = 'x'; b[18] = 'y';
    const text = unifiedDiff(diffText(a.join('\n'), b.join('\n')), 'a', 'b');
    expect(text.match(/^@@/gm)).toHaveLength(2);
    expect(text).toContain('@@ -1,5 +1,5 @@');
    expect(text).toContain('@@ -16,5 +16,5 @@');
  });
});

describe('viewRows', () => {
  it('긴 같은 줄은 접는다', () => {
    const a = Array.from({ length: 30 }, (_, i) => `${i}`);
    const b = [...a]; b[15] = 'x';
    const rows = viewRows(diffText(a.join('\n'), b.join('\n')));
    expect(rows[0]).toEqual({ kind: 'skip', count: 12 });
    expect(rows.filter(row => row.kind === 'skip')).toEqual([{ kind: 'skip', count: 12 }, { kind: 'skip', count: 11 }]);
    expect(rows.find(row => row.kind === 'del')).toMatchObject({ a: 16, text: '15' });
  });
});
