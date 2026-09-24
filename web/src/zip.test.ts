import { describe, expect, it } from 'vitest';

import { isSafePath, readZip } from './zip';
import { makeZip } from './zip-fixture';

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('readZip', () => {
  it('암호화 ZIP과 실제 해제 크기를 속인 ZIP은 거절한다', async () => {
    const encrypted = await makeZip([{ name: 'a', content: 'secret', flags: 1 }]);
    await expect(readZip(encrypted)).rejects.toThrow('암호화');
    const bomb = await makeZip([{ name: 'a', content: 'x'.repeat(100000), deflate: true }]);
    const view = new DataView(bomb.buffer as ArrayBuffer);
    const central = view.getUint32(bomb.length - 22 + 16, true);
    view.setUint32(central + 24, 1, true);
    await expect(readZip(bomb)).rejects.toThrow('실제 압축 해제 크기');
  });
  it('압축하지 않은 항목과 deflate 항목을 모두 되읽는다', async () => {
    // 한글이 내보내는 HWPX 는 deflate 다. method 0 도 규격에 있어 둘 다 받는다.
    const zip = await makeZip([
      { name: 'mimetype', content: 'application/hwp+zip' },
      { name: 'Contents/section0.xml', content: '<hp:sec>한글</hp:sec>', deflate: true },
    ]);
    const entries = await readZip(zip);
    expect([...entries.keys()]).toEqual(['mimetype', 'Contents/section0.xml']);
    expect(text(entries.get('mimetype')!)).toBe('application/hwp+zip');
    expect(text(entries.get('Contents/section0.xml')!)).toBe('<hp:sec>한글</hp:sec>');
  });

  it('윈도우가 만든 ZIP 의 CP949 이름을 바로 읽는다', async () => {
    // 탐색기는 한글 이름을 CP949 로 적으면서 UTF-8 표식(bit 11)을 달지 않는다.
    // UTF-8 로 읽으면 이름만 깨진 채 내용은 멀쩡해서, 조용히 틀리는 쪽이 된다.
    const zip = await makeZip([
      { name: new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x2e, 0x74, 0x78, 0x74]), content: 'x' },
      { name: '\uc0ac\uc6a9\uc790.txt', content: 'y', flags: 0x800 },
      { name: 'ascii.txt', content: 'z' },
    ]);
    expect([...(await readZip(zip)).keys()]).toEqual(['\ud55c\uae00.txt', '\uc0ac\uc6a9\uc790.txt', 'ascii.txt']);
  });

  it('경로가 바깥으로 나가는 항목은 읽지 않는다', async () => {
    // zip-slip. 브라우저에서는 디스크에 쓰지 않지만, 같은 함수를 데스크톱 경로에
    // 쓰는 순간 구멍이 된다. 읽는 단계에서 떨군다.
    const zip = await makeZip([
      { name: '../.env', content: 'SECRET=1' },
      { name: '/etc/passwd', content: 'root' },
      { name: 'a\\b.xml', content: 'x' },
      { name: 'Contents/section0.xml', content: '<hp:sec/>' },
    ]);
    expect([...(await readZip(zip)).keys()]).toEqual(['Contents/section0.xml']);
    expect(isSafePath('Contents/section0.xml')).toBe(true);
    expect(isSafePath('../x')).toBe(false);
  });

  it('한도를 넘는 ZIP 은 풀지 않는다', async () => {
    const zip = await makeZip([
      { name: 'a.xml', content: '1' },
      { name: 'b.xml', content: '2' },
      { name: 'c.xml', content: '3' },
    ]);
    await expect(readZip(zip, { maxEntries: 2 })).rejects.toThrow(/항목 수/);
    await expect(readZip(zip, { maxSize: 2 })).rejects.toThrow(/한도/);
  });

  it('ZIP 이 아니면 그렇다고 말한다', async () => {
    // PDF 를 잘못 올리는 일이 실제로 잦다. "undefined 읽기 실패" 대신 이유를 준다.
    await expect(readZip(new TextEncoder().encode('%PDF-1.7 ...'))).rejects.toThrow(/ZIP 이 아닙니다/);
  });
});
