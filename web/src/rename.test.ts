import { describe, expect, it } from 'vitest';

import { DEFAULT_RULES, MAX_NAME, dedupe, planRenames, replacer, sanitizeName, sortFiles, splitName, ymd, type RenameInput, type RenameRules } from './rename';

const at = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12).getTime();
const file = (name: string, lastModified = at(2026, 3, 5)) => ({ name, lastModified });
const rules = (patch: Partial<RenameRules>): RenameRules => ({ ...DEFAULT_RULES, ...patch });
const names = (list: RenameInput[], patch: Partial<RenameRules>, today?: Date): string[] =>
  planRenames(list, rules(patch), today).map(p => p.name);

describe('splitName', () => {
  it('keeps dotfiles and trailing dots as stems', () => {
    expect(splitName('견적서.최종.pdf')).toEqual({ stem: '견적서.최종', ext: 'pdf' });
    expect(splitName('.env')).toEqual({ stem: '.env', ext: '' });
    expect(splitName('README')).toEqual({ stem: 'README', ext: '' });
  });
});

describe('find and replace', () => {
  it('replaces every plain occurrence in the stem only', () => {
    expect(names([file('사진 사진.jpg')], { find: '사진', replace: '그림' })).toEqual(['그림 그림.jpg']);
    // 확장자는 지킨다.
    expect(names([file('a.jpg')], { find: 'jpg', replace: 'png' })).toEqual(['a.jpg']);
    expect(names([file('a.jpg')], { find: 'jpg', replace: 'png', changeExt: true, template: '{name}.{ext}' })).toEqual(['a.png']);
  });

  it('supports regex with groups and flags', () => {
    expect(names([file('IMG_0012.JPG')], { find: '^img_(\\d+)$', replace: '사진-$1', regex: true, flags: 'i' })).toEqual(['사진-0012.JPG']);
    // 정규식 문자가 글자 그대로 모드에서는 글자다.
    expect(names([file('a.b(1).txt')], { find: '(1)', replace: '' })).toEqual(['a.b.txt']);
  });

  it('reports invalid regex and flags in Korean', () => {
    expect(() => replacer({ find: '(', replace: '', regex: true, flags: '' })).toThrow('정규식이 올바르지 않습니다');
    expect(() => replacer({ find: 'a', replace: '', regex: true, flags: 'x' })).toThrow('깃발');
    expect(() => replacer({ find: 'a', replace: '', regex: true, flags: 'gi' })).not.toThrow();
  });
});

describe('template', () => {
  it('numbers with start, step and zero padding', () => {
    const list = [file('a.txt'), file('b.txt'), file('c.txt')];
    expect(names(list, { template: '{n:3}_{name}' })).toEqual(['001_a.txt', '002_b.txt', '003_c.txt']);
    expect(names(list, { template: '{n}', start: 10, step: 5, pad: 2 })).toEqual(['10.txt', '15.txt', '20.txt']);
    expect(names(list, { template: '견적-{n}', pad: 4 })).toEqual(['견적-0001.txt', '견적-0002.txt', '견적-0003.txt']);
  });

  it('fills dates as YYYYMMDD in local time', () => {
    expect(ymd(new Date(2026, 0, 9))).toBe('20260109');
    expect(names([file('a.pdf', at(2025, 12, 31))], { template: '{date}_{name}' })).toEqual(['20251231_a.pdf']);
    expect(names([file('a.pdf')], { template: '{today}-{name}' }, new Date(2026, 8, 24))).toEqual(['20260924-a.pdf']);
  });

  it('treats the template as the whole name when changing extensions', () => {
    expect(names([file('a.jpeg')], { template: '{name}.{ext}', changeExt: true })).toEqual(['a.jpeg']);
    expect(names([file('a.jpeg')], { template: '{name}.jpg', changeExt: true })).toEqual(['a.jpg']);
    // 확장자를 지킬 때 {ext} 는 이름 안에 한 번 더 쓰일 뿐이다.
    expect(names([file('a.jpeg')], { template: '{name}_{ext}' })).toEqual(['a_jpeg.jpeg']);
  });

  it('rejects unknown tokens', () => {
    expect(() => names([file('a.txt')], { template: '{parent}' })).toThrow('모르는 토큰');
    expect(() => names([file('a.txt')], { template: '{date:3}' })).toThrow('번호에만');
  });
});

describe('case and spaces', () => {
  it('changes case of the name, and the extension only when asked', () => {
    expect(names([file('Hello World.JPG')], { caseMode: 'lower' })).toEqual(['hello world.JPG']);
    expect(names([file('Hello World.JPG')], { caseMode: 'lower', caseExt: true })).toEqual(['hello world.jpg']);
    expect(names([file('abc.txt')], { caseMode: 'upper' })).toEqual(['ABC.txt']);
    expect(names([file('한글 abc.txt')], { caseMode: 'upper' })).toEqual(['한글 ABC.txt']);
  });

  it('turns runs of whitespace into one underscore', () => {
    expect(names([file('회의  자료 최종.hwp')], { spaces: true })).toEqual(['회의_자료_최종.hwp']);
  });
});

describe('sanitize', () => {
  it('replaces Windows-invalid characters and trims trailing dots', () => {
    const notes: string[] = [];
    expect(sanitizeName('a<b>:"c|?*.txt', notes)).toBe('a_b___c___.txt');
    expect(notes.length).toBe(1);
    expect(sanitizeName('끝에 점...  ')).toBe('끝에 점');
    expect(sanitizeName('탭\t이름')).toBe('탭_이름');
    expect(sanitizeName('...')).toBe('이름없음');
  });

  it('guards reserved device names even with an extension', () => {
    expect(sanitizeName('CON')).toBe('CON_');
    expect(sanitizeName('nul.txt')).toBe('nul_.txt');
    expect(sanitizeName('com1.tar.gz')).toBe('com1_.tar.gz');
    expect(sanitizeName('CONSOLE.txt')).toBe('CONSOLE.txt');
    expect(names([file('a.txt')], { template: 'LPT9' })).toEqual(['LPT9_.txt']);
  });

  it('limits length but keeps the extension', () => {
    const long = sanitizeName(`${'가'.repeat(300)}.pdf`);
    expect(Array.from(long).length).toBe(MAX_NAME);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('slashes from a template cannot create folders', () => {
    expect(names([file('a.txt')], { template: '../{name}' })).toEqual(['.._a.txt']);
  });
});

describe('duplicates', () => {
  it('appends (2), (3) case-insensitively and reports it', () => {
    const plans = planRenames([file('a.txt'), file('b.txt'), file('C.txt')], rules({ template: '같은이름' }));
    expect(plans.map(p => p.name)).toEqual(['같은이름.txt', '같은이름 (2).txt', '같은이름 (3).txt']);
    expect(plans[1]!.notes.join()).toContain('겹쳐');
    const mixed = [{ original: 'x', name: 'A.txt', changed: true, notes: [] }, { original: 'y', name: 'a.TXT', changed: true, notes: [] }];
    expect(dedupe(mixed)).toBe(1);
    expect(mixed[1]!.name).toBe('a (2).TXT');
  });

  it('does not collide with an existing "(2)" name', () => {
    const plans = planRenames([file('a (2).txt'), file('a.txt'), file('a.txt')], rules({}));
    expect(plans.map(p => p.name)).toEqual(['a (2).txt', 'a.txt', 'a (3).txt']);
  });

  it('marks unchanged names', () => {
    const plans = planRenames([file('보고서.hwp'), file('보고서 초안.hwp')], rules({ find: ' 초안', replace: '' }));
    expect(plans.map(p => [p.name, p.changed])).toEqual([['보고서.hwp', false], ['보고서 (2).hwp', true]]);
  });
});

describe('sortFiles', () => {
  const list = [
    { name: '파일10.txt', lastModified: 3, picked: 0 },
    { name: '파일2.txt', lastModified: 1, picked: 1 },
    { name: '가나.txt', lastModified: 2, picked: 2 },
  ];
  it('sorts by natural name, modified time or pick order', () => {
    expect(sortFiles(list, 'name').map(f => f.name)).toEqual(['가나.txt', '파일2.txt', '파일10.txt']);
    expect(sortFiles(list, 'modified').map(f => f.picked)).toEqual([1, 2, 0]);
    expect(sortFiles(list, 'picked', true).map(f => f.picked)).toEqual([2, 1, 0]);
  });
});
