import { describe, expect, it } from 'vitest';

import { applyNewline, cp949Table, decodeText, encodeText } from './encoding';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
/** CP949 바이트를 표에서 직접 얻는다 — 테스트가 구현과 같은 표를 쓰지 않도록 값을 따로 적는다. */
const 한글 = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]);

describe('decodeText', () => {
  it('BOM 이 있으면 그것을 따르고 BOM 은 글에 남기지 않는다', () => {
    const result = decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('금액')]));
    expect(result).toMatchObject({ text: '금액', encoding: 'utf-8', hadBom: true, certain: true });
  });

  it('UTF-16 BOM 도 읽는다 — 윈도우 메모장이 내보내는 갈래다', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0xac, 0x00, 0xd5]);
    expect(decodeText(bytes)).toMatchObject({ text: '가각'.slice(0, 0) + '가픀', encoding: 'utf-16le' });
  });

  it('UTF-8 로 읽히면 UTF-8 이다', () => {
    expect(decodeText(utf8('견적서'))).toMatchObject({ text: '견적서', encoding: 'utf-8', certain: true });
  });

  it('UTF-8 이 아니면 CP949 로 읽되 확실하지 않다고 말한다', () => {
    // 여기서 certain 이 true 가 되면 화면이 추정을 사실처럼 적게 된다.
    expect(decodeText(한글)).toMatchObject({ text: '한글', encoding: 'euc-kr', certain: false });
  });

  it('ASCII 뿐이면 UTF-8 이라고 답한다 — 어느 쪽으로 읽어도 같다', () => {
    expect(decodeText(utf8('id,name\n1,kim\n'))).toMatchObject({ encoding: 'utf-8', certain: true });
  });
});

describe('encodeText', () => {
  it('UTF-8 BOM 을 붙인다 — 엑셀이 UTF-8 CSV 를 알아보려면 필요하다', () => {
    const { bytes } = encodeText('금액', { encoding: 'utf-8', bom: true, newline: 'keep', replaceMissing: false });
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(decodeText(bytes).text).toBe('금액');
  });

  it('CP949 로 적고 다시 읽으면 같은 글이다', () => {
    const { bytes, missing } = encodeText('한글', { encoding: 'euc-kr', bom: false, newline: 'keep', replaceMissing: false });
    expect([...bytes]).toEqual([...한글]);
    expect(missing).toEqual([]);
  });

  it('CP949 에 없는 글자는 조용히 버리지 않고 멈춘다', () => {
    // '?' 로 바꿔 놓고 성공이라 말하면, 이름이 깨진 명부를 그대로 넘기게 된다.
    expect(() => encodeText('가격 😀', { encoding: 'euc-kr', bom: false, newline: 'keep', replaceMissing: false }))
      .toThrow('CP949로 적을 수 없는 글자가 1종 있습니다: 😀');
  });

  it('사람이 고르면 그때 물음표로 바꾸고 무엇이 바뀌었는지 돌려준다', () => {
    const { bytes, missing } = encodeText('값😀', { encoding: 'euc-kr', bom: false, newline: 'keep', replaceMissing: true });
    expect(missing).toEqual(['😀']);
    expect(bytes[bytes.length - 1]).toBe(0x3f);
  });

  it('이모지처럼 두 칸을 쓰는 글자를 반쪽으로 자르지 않는다', () => {
    const { missing } = encodeText('😀😀', { encoding: 'euc-kr', bom: false, newline: 'keep', replaceMissing: true });
    expect(missing).toEqual(['😀']);
  });
});

describe('applyNewline', () => {
  it('섞인 줄바꿈을 한쪽으로 모은다', () => {
    expect(applyNewline('a\r\nb\nc\rd', 'crlf')).toBe('a\r\nb\r\nc\r\nd');
    expect(applyNewline('a\r\nb\nc\rd', 'lf')).toBe('a\nb\nc\nd');
    expect(applyNewline('a\r\nb', 'keep')).toBe('a\r\nb');
  });
});

describe('cp949Table', () => {
  it('완성형 한글과 한자를 담고 두 번째 호출은 같은 표다', () => {
    const table = cp949Table();
    expect(table.get('한')).toBe(0xc7d1);
    expect(table.get('金')).toBe(0xd1d1);
    expect(table.size).toBeGreaterThan(8000);
    expect(cp949Table()).toBe(table);
  });
});
