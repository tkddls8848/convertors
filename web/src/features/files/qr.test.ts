import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';

import {
  MAX_BYTES, buildMatrix, cellEdges, checkColor, contrastWarning, mailtoPayload, matrixToSvg, smsPayload, telPayload, vcardEscape,
  vcardPayload, wifiPayload, type QrFactory,
} from './qr';

const factory = qrcode as unknown as QrFactory;

describe('payloads', () => {
  it('builds Wi-Fi strings and escapes reserved characters', () => {
    expect(wifiPayload({ ssid: '우리집', password: 'pass', security: 'WPA', hidden: false })).toBe('WIFI:T:WPA;S:우리집;P:pass;;');
    expect(wifiPayload({ ssid: 'a;b,c', password: 'x:y"z\\', security: 'WPA', hidden: true }))
      .toBe('WIFI:T:WPA;S:a\\;b\\,c;P:x\\:y\\"z\\\\;H:true;;');
    expect(wifiPayload({ ssid: 'open', password: 'ignored', security: 'nopass', hidden: false })).toBe('WIFI:T:nopass;S:open;;');
    expect(() => wifiPayload({ ssid: '', password: '', security: 'WPA', hidden: false })).toThrow('SSID');
    expect(() => wifiPayload({ ssid: 'a', password: '', security: 'WPA', hidden: false })).toThrow('암호');
  });

  it('builds vCard 3.0 with CRLF and escaped text', () => {
    const card = vcardPayload({
      name: '홍길동', org: '(주)견적, 영업부', title: '과장', tel: '010-1234-5678',
      email: 'hong@example.com', address: '서울시 중구; 세종대로 110\n3층', url: 'https://example.com/a,b',
    });
    expect(card.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true);
    expect(card.endsWith('END:VCARD\r\n')).toBe(true);
    expect(card).not.toMatch(/[^\r]\n/);
    expect(card).toContain('FN:홍길동\r\n');
    expect(card).toContain('ORG:(주)견적\\, 영업부\r\n');
    expect(card).toContain('ADR;TYPE=WORK:;;서울시 중구\\; 세종대로 110\\n3층;;;;\r\n');
    expect(card).toContain('TEL;TYPE=CELL:010-1234-5678\r\n');
    // URL 은 text 가 아니어서 쉼표를 막지 않는다.
    expect(card).toContain('URL:https://example.com/a,b\r\n');
    expect(card).not.toContain('TITLE:\r\n');
    expect(vcardEscape('a\\b')).toBe('a\\\\b');
    expect(() => vcardPayload({ name: ' ', org: '', title: '', tel: '', email: '', address: '', url: '' })).toThrow('이름');
  });

  it('builds tel, SMS and mailto', () => {
    expect(telPayload('010-1234 5678')).toBe('tel:01012345678');
    expect(telPayload('+82 10-1234-5678')).toBe('tel:+821012345678');
    expect(smsPayload('010-1234-5678', '도착했어요: 3층')).toBe('SMSTO:01012345678:도착했어요: 3층');
    expect(() => telPayload('abc')).toThrow('숫자');
    expect(mailtoPayload('a@b.kr', '견적 문의', '안녕하세요 & 감사')).toBe(
      `mailto:a@b.kr?subject=${encodeURIComponent('견적 문의')}&body=${encodeURIComponent('안녕하세요 & 감사')}`);
    expect(mailtoPayload('a@b.kr', '', '')).toBe('mailto:a@b.kr');
    expect(() => mailtoPayload('nope', '', '')).toThrow('이메일');
  });
});

describe('matrix via qrcode-generator', () => {
  it('encodes Korean as UTF-8, not truncated Latin-1', () => {
    // 10글자 = 30바이트. Latin-1 로 잘렸다면 10바이트라 버전 1(M:14바이트)에 들어갔을 것이다.
    const matrix = buildMatrix(factory, '가나다라마바사아자차', 'M');
    expect(matrix.bytes).toBe(30);
    expect(matrix.version).toBe(3);
    expect(matrix.modules.length).toBe(29);
    expect(matrix.modules.every(row => row.length === 29)).toBe(true);
    // 바꿔 끼운 것은 되돌려 놓는다.
    expect(factory.stringToBytes('가')).toEqual([0x00]);
  });

  it('keeps finder patterns in the corners', () => {
    const { modules } = buildMatrix(factory, 'https://example.com', 'M');
    const n = modules.length;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      expect(modules[r]![c]).toBe(true);
      expect(modules[r + 1]![c + 1]).toBe(false);
      expect(modules[r + 3]![c + 3]).toBe(true);
    }
  });

  it('refuses content that does not fit, in Korean', () => {
    expect(() => buildMatrix(factory, '가'.repeat(500), 'H')).toThrow('너무 깁니다');
    expect(() => buildMatrix(factory, 'a'.repeat(MAX_BYTES.L), 'L')).not.toThrow();
    expect(() => buildMatrix(factory, 'a'.repeat(MAX_BYTES.L + 1), 'L')).toThrow('너무 깁니다');
    expect(() => buildMatrix(factory, '', 'M')).toThrow('내용');
  });

  it('higher error correction needs a larger version', () => {
    const text = '견적서 확인 부탁드립니다';
    expect(buildMatrix(factory, text, 'H').version).toBeGreaterThan(buildMatrix(factory, text, 'L').version);
  });
});

describe('svg', () => {
  it('merges horizontal runs and adds a quiet zone', () => {
    const svg = matrixToSvg([[true, true, false], [false, true, false], [false, false, false]], { fg: '#112233', bg: '#FFFFFF' });
    expect(svg).toContain('viewBox="0 0 11 11"');
    expect(svg).toContain('d="M4 4h2v1h-2zM5 5h1v1h-1z"');
    expect(svg).toContain('fill="#112233"');
    expect(svg).toContain('fill="#ffffff"');
  });

  it('rejects non-hex colors so nothing can be injected', () => {
    expect(() => matrixToSvg([[true]], { fg: 'red"/><script>' })).toThrow('#rrggbb');
    expect(checkColor('#ABCDEF')).toBe('#abcdef');
  });

  it('warns about inverted or low-contrast colors', () => {
    expect(contrastWarning('#000000', '#ffffff')).toBeUndefined();
    expect(contrastWarning('#ffffff', '#000000')).toContain('밝습니다');
    expect(contrastWarning('#999999', '#bbbbbb')).toContain('명암');
  });

  it('cell edges cover the canvas exactly', () => {
    const edges = cellEdges(29, 512);
    expect(edges[0]).toBe(0);
    expect(edges.at(-1)).toBe(512);
    for (let i = 1; i < edges.length; i++) expect(edges[i]! - edges[i - 1]!).toBeGreaterThanOrEqual(17);
  });
});
