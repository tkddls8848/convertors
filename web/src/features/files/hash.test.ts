import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  CHUNK, Md5, detectAlgorithm, duplicateGroups, hashBlob, md5Hex, normalizeExpected, parseExpected, shaHex, sumsFileName, sumsText,
} from './hash';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const node = (algorithm: string, bytes: Uint8Array): string => createHash(algorithm).update(bytes).digest('hex');

describe('MD5', () => {
  it('matches RFC 1321 vectors', () => {
    expect(md5Hex(new Uint8Array())).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex(utf8('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex(utf8('The quick brown fox jumps over the lazy dog'))).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });

  it('matches node:crypto for 1MB of "a" and padding edge lengths', () => {
    const big = new Uint8Array(1024 * 1024).fill(0x61);
    expect(md5Hex(big)).toBe(node('md5', big));
    // 55·56·63·64·65 바이트는 덧붙이기가 한 블록/두 블록으로 갈리는 경계다.
    for (const length of [55, 56, 57, 63, 64, 65, 119, 120, 128]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 31) & 0xff);
      expect(md5Hex(bytes), `length ${length}`).toBe(node('md5', bytes));
    }
  });

  it('gives the same result when fed in odd-sized chunks', () => {
    const bytes = new Uint8Array(10_000).map((_, i) => (i * 7 + 3) & 0xff);
    const whole = md5Hex(bytes);
    for (const step of [1, 3, 63, 64, 65, 1000, 4097]) {
      const md5 = new Md5();
      for (let at = 0; at < bytes.length; at += step) md5.update(bytes.subarray(at, at + step));
      expect(md5.hex(), `step ${step}`).toBe(whole);
    }
  });

  it('hashes Korean UTF-8 text like node:crypto', () => {
    const text = utf8('견적서_최종본(수정).hwpx — 한글 파일 이름');
    expect(md5Hex(text)).toBe(node('md5', text));
  });

  it('digest is repeatable and update after digest fails', () => {
    const md5 = new Md5().update(utf8('abc'));
    expect(md5.hex()).toBe(md5.hex());
    expect(() => md5.update(utf8('d'))).toThrow();
  });
});

describe('SHA via crypto.subtle', () => {
  it('matches node:crypto', async () => {
    const bytes = utf8('파일 해시 확인 — SHA 테스트');
    expect(await shaHex('SHA-1', bytes)).toBe(node('sha1', bytes));
    expect(await shaHex('SHA-256', bytes)).toBe(node('sha256', bytes));
    expect(await shaHex('SHA-384', bytes)).toBe(node('sha384', bytes));
    expect(await shaHex('SHA-512', bytes)).toBe(node('sha512', bytes));
    expect(await shaHex('SHA-256', new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashBlob streams MD5 across chunks and reports progress', async () => {
    const bytes = new Uint8Array(CHUNK * 2 + 123).map((_, i) => i & 0xff);
    const seen: number[] = [];
    const hex = await hashBlob(new Blob([bytes]), 'MD5', { progress: f => seen.push(f) });
    expect(hex).toBe(node('md5', bytes));
    expect(seen.at(-1)).toBe(1);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(await hashBlob(new Blob([bytes]), 'SHA-256')).toBe(node('sha256', bytes));
  });

  it('stops when cancelled', async () => {
    await expect(hashBlob(new Blob([new Uint8Array(10)]), 'MD5', { cancelled: () => true })).rejects.toThrow('멈췄');
  });
});

describe('expected value', () => {
  it('normalizes case, spaces and colons', () => {
    expect(normalizeExpected('  D4:1D:8C:D9 8F00B204 E9800998 ECF8427E \n')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(normalizeExpected('d4 1d 8c d9 8f 00 b2 04 e9 80 09 98 ec f8 42 7e')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('takes the hash from a SUMS line', () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(normalizeExpected(`${hash}  ubuntu.iso`)).toBe(hash);
    expect(normalizeExpected(`${hash.toUpperCase()} *setup.exe`)).toBe(hash);
  });

  it('detects the algorithm by length', () => {
    expect(detectAlgorithm('a'.repeat(32))).toBe('MD5');
    expect(detectAlgorithm('a'.repeat(40))).toBe('SHA-1');
    expect(detectAlgorithm('a'.repeat(64))).toBe('SHA-256');
    expect(detectAlgorithm('a'.repeat(96))).toBe('SHA-384');
    expect(detectAlgorithm('a'.repeat(128))).toBe('SHA-512');
    expect(detectAlgorithm('a'.repeat(50))).toBeUndefined();
    expect(detectAlgorithm('g'.repeat(32))).toBeUndefined();
  });

  it('explains what is wrong in Korean', () => {
    expect(parseExpected('   ')).toEqual({ kind: 'empty' });
    const bad = parseExpected('xyz');
    expect(bad.kind === 'invalid' && bad.message).toContain('16진수');
    const short = parseExpected('abcd');
    expect(short.kind === 'invalid' && short.message).toContain('4자');
    expect(parseExpected('D41D8CD98F00B204E9800998ECF8427E')).toEqual({ kind: 'ok', hex: 'd41d8cd98f00b204e9800998ecf8427e', algorithm: 'MD5' });
  });
});

describe('results', () => {
  it('writes a SHA256SUMS-style list and escapes odd names', () => {
    expect(sumsText([{ name: '견적서.pdf', hash: 'ab' }, { name: 'a b.txt', hash: 'cd' }])).toBe('ab  견적서.pdf\ncd  a b.txt\n');
    expect(sumsText([{ name: 'a\\b', hash: 'ef' }])).toBe('\\ef  a\\\\b\n');
    expect(sumsFileName('SHA-256')).toBe('SHA256SUMS');
    expect(sumsFileName('MD5')).toBe('MD5SUMS');
  });

  it('groups identical hashes', () => {
    expect(duplicateGroups(['a', 'b', 'a', 'c', 'b', ''])).toEqual([[0, 2], [1, 4]]);
    expect(duplicateGroups(['a', 'b'])).toEqual([]);
  });
});
