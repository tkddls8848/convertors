/**
 * 파일 이름 일괄 바꾸기 — 규칙.
 *
 * 브라우저는 디스크의 파일 이름을 바꿀 수 없다. 그래서 새 이름을 붙인 사본을
 * ZIP 하나로 묶어 내려받게 한다(화면이 그렇게 적는다). 여기에는 이름을 짓는
 * 규칙만 둔다 — DOM 을 쓰지 않아 node 에서 그대로 시험한다.
 *
 * 규칙은 늘 같은 순서로 건다. 순서가 바뀌면 같은 설정이 다른 이름을 낸다.
 *   1. 찾아 바꾸기 (글자 그대로 또는 정규식, 모두 바꾼다)
 *   2. 이름 틀 — {name} {ext} {n} {n:3} {date} {today}
 *   3. 대소문자
 *   4. 공백 → _
 * 그 뒤 윈도우에서 못 쓰는 이름을 고치고, 겹치는 이름에 " (2)" 를 붙인다.
 *
 * 확장자는 기본으로 지킨다. "확장자도 바꾸기" 를 켜야 1·2단계가 이름 전체를
 * 다루고, 그때 틀이 곧 새 이름 전체가 된다(`{name}.{ext}` 처럼 적어야 확장자가 남는다).
 */

export interface RenameRules {
  find: string;
  replace: string;
  regex: boolean;
  /** 정규식 깃발. g 는 늘 붙인다(모두 바꾸기). */
  flags: string;
  template: string;
  start: number;
  step: number;
  /** `{n}` 의 기본 자리 수. `{n:3}` 처럼 적으면 그것이 이긴다. */
  pad: number;
  caseMode: 'keep' | 'lower' | 'upper';
  /** 대소문자 규칙을 확장자에도 건다. */
  caseExt: boolean;
  spaces: boolean;
  changeExt: boolean;
}

export const DEFAULT_RULES: RenameRules = {
  find: '', replace: '', regex: false, flags: '', template: '{name}',
  start: 1, step: 1, pad: 1, caseMode: 'keep', caseExt: false, spaces: false, changeExt: false,
};

export interface RenameInput { name: string; lastModified: number }

export interface RenamePlan {
  original: string;
  name: string;
  changed: boolean;
  /** 이름을 스스로 고친 까닭 — 조용히 고치지 않는다. */
  notes: string[];
}

export const MAX_NAME = 200;
const INVALID = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 이름을 줄기와 확장자로. `.env` 처럼 점으로 시작하는 이름은 확장자가 없다. */
export function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

const join = (stem: string, ext: string): string => ext ? `${stem}.${ext}` : stem;

export function ymd(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

/** 찾아 바꾸기를 함수로 만든다. 정규식이 틀렸으면 여기서 한국어로 멈춘다. */
export function replacer(rules: Pick<RenameRules, 'find' | 'replace' | 'regex' | 'flags'>): (text: string) => string {
  if (!rules.find) return text => text;
  if (!rules.regex) return text => text.split(rules.find).join(rules.replace);
  const flags = rules.flags.replace(/g/g, '');
  if (/[^imsu]/.test(flags) || new Set(flags).size !== flags.length) {
    throw new Error(`정규식 깃발은 i·m·s·u 만 한 번씩 쓸 수 있습니다: "${rules.flags}"`);
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(rules.find, `${flags}g`);
  } catch (error) {
    throw new Error(`정규식이 올바르지 않습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
  return text => text.replace(pattern, rules.replace);
}

const TOKEN = /\{([a-z]+)(?::(\d{1,2}))?\}/gi;

/** 틀에 모르는 토큰이 있으면 미리 알린다 — 그대로 이름에 박히면 알아채기 어렵다. */
export function checkTemplate(template: string): void {
  for (const match of template.matchAll(TOKEN)) {
    const [whole, key, width] = match;
    const name = key!.toLowerCase();
    if (!['name', 'ext', 'n', 'date', 'today'].includes(name)) {
      throw new Error(`이름 틀의 ${whole} 는 모르는 토큰입니다. {name} {ext} {n} {n:3} {date} {today} 를 쓸 수 있습니다.`);
    }
    if (width !== undefined && name !== 'n') throw new Error(`자리 수는 {n:3} 처럼 번호에만 붙입니다: ${whole}`);
  }
}

function fillTemplate(template: string, values: { name: string; ext: string; n: number; pad: number; date: string; today: string }): string {
  return template.replace(TOKEN, (_, key: string, width: string | undefined) => {
    switch (key.toLowerCase()) {
      case 'name': return values.name;
      case 'ext': return values.ext;
      case 'n': {
        const digits = width === undefined ? values.pad : Number(width);
        const sign = values.n < 0 ? '-' : '';
        return sign + String(Math.abs(values.n)).padStart(digits, '0');
      }
      case 'date': return values.date;
      default: return values.today;
    }
  });
}

/** 윈도우·ZIP 에서 쓸 수 있는 이름으로. 고친 것은 notes 에 남긴다. */
export function sanitizeName(raw: string, notes: string[] = []): string {
  let name = raw.replace(INVALID, '_');
  if (name !== raw) notes.push('쓸 수 없는 글자(< > : " / \\ | ? * 제어 문자)를 _ 로 바꿈');
  const trimmed = name.replace(/[. ]+$/, '');
  if (trimmed !== name) { notes.push('끝의 점·공백을 뗌'); name = trimmed; }
  const lead = name.replace(/^ +/, '');
  if (lead !== name) { notes.push('앞의 공백을 뗌'); name = lead; }
  if (!name || /^\.+$/.test(name)) { notes.push('이름이 비어 "이름없음" 으로 함'); name = '이름없음'; }
  // 윈도우는 확장자가 붙어도(`CON.txt`) 장치 이름으로 본다. 첫 점 앞을 본다.
  const first = name.split('.')[0]!;
  if (RESERVED.test(first.trim())) {
    notes.push(`${first} 는 윈도우가 쓰는 이름이라 _ 를 붙임`);
    name = `${first}_${name.slice(first.length)}`;
  }
  const chars = Array.from(name);
  if (chars.length > MAX_NAME) {
    const { stem, ext } = splitName(name);
    const extChars = ext ? Array.from(ext).length + 1 : 0;
    // 확장자가 비정상으로 길면 통째로 자른다. 보통은 줄기만 줄여 확장자를 지킨다.
    name = extChars < MAX_NAME / 2
      ? join(Array.from(stem).slice(0, MAX_NAME - extChars).join('').replace(/[. ]+$/, ''), ext)
      : chars.slice(0, MAX_NAME).join('');
    notes.push(`${MAX_NAME}자가 넘어 잘라 냄`);
  }
  return name;
}

/**
 * 모든 파일의 새 이름을 짓는다. 입력 순서가 곧 번호 순서다.
 * `today` 는 시험에서 날짜를 고정하려고 받는다.
 */
export function planRenames(files: RenameInput[], rules: RenameRules, today: Date = new Date()): RenamePlan[] {
  const replace = replacer(rules);
  checkTemplate(rules.template);
  if (!Number.isFinite(rules.start) || !Number.isFinite(rules.step)) throw new Error('시작 번호와 증가 폭은 숫자여야 합니다.');
  const pad = Math.min(Math.max(Math.trunc(rules.pad) || 1, 1), 12);
  const todayText = ymd(today);

  const plans = files.map((file, index): RenamePlan => {
    const notes: string[] = [];
    const original = splitName(file.name);
    // 1. 찾아 바꾸기 — 확장자를 지킬 때는 줄기에만 건다.
    let stem: string;
    let ext: string;
    if (rules.changeExt) ({ stem, ext } = splitName(replace(file.name)));
    else { stem = replace(original.stem); ext = original.ext; }

    // 2. 이름 틀
    const filled = fillTemplate(rules.template || '{name}', {
      name: stem, ext, n: rules.start + index * rules.step, pad,
      date: ymd(new Date(file.lastModified)), today: todayText,
    });
    let name = rules.changeExt ? filled : join(filled, ext);

    // 3. 대소문자 — 이름과 확장자를 나눠 건다.
    if (rules.caseMode !== 'keep') {
      const parts = rules.changeExt ? splitName(name) : { stem: filled, ext };
      const apply = (text: string): string => rules.caseMode === 'lower' ? text.toLowerCase() : text.toUpperCase();
      name = join(apply(parts.stem), rules.caseExt ? apply(parts.ext) : parts.ext);
    }
    // 4. 공백 → _ (연속된 공백은 하나로)
    if (rules.spaces) name = name.replace(/\s+/g, '_');

    name = sanitizeName(name, notes);
    return { original: file.name, name, changed: false, notes };
  });

  dedupe(plans);
  for (const plan of plans) plan.changed = plan.name !== plan.original;
  return plans;
}

/**
 * 같은 이름에 " (2)" 를 붙인다. 윈도우는 대소문자를 가리지 않으므로 견줄 때도
 * 가리지 않는다. 붙인 이름이 다시 다른 이름과 겹치지 않게 전부 모아 두고 센다.
 */
export function dedupe(plans: RenamePlan[]): number {
  const taken = new Set<string>();
  let renamed = 0;
  for (const plan of plans) {
    let candidate = plan.name;
    if (taken.has(candidate.toLowerCase())) {
      const { stem, ext } = splitName(plan.name);
      for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = join(`${stem} (${n})`, ext);
      plan.notes.push(`이름이 겹쳐 "${candidate}" 로 함`);
      plan.name = candidate;
      renamed++;
    }
    taken.add(candidate.toLowerCase());
  }
  return renamed;
}

export type SortKey = 'picked' | 'name' | 'modified';

/** 번호를 매길 순서. 이름은 사람이 읽는 순서(파일2 < 파일10)로 줄 세운다. */
export function sortFiles<T extends RenameInput & { picked: number }>(files: T[], key: SortKey, descending = false): T[] {
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  const compare = (a: T, b: T): number => {
    if (key === 'name') return collator.compare(a.name, b.name) || a.picked - b.picked;
    if (key === 'modified') return a.lastModified - b.lastModified || a.picked - b.picked;
    return a.picked - b.picked;
  };
  const sorted = [...files].sort(compare);
  return descending ? sorted.reverse() : sorted;
}

/** 다시 압축해 봐야 줄지 않는 것들 — zip-panel 과 같은 목록. */
export const PACKED = /\.(zip|gz|bz2|xz|7z|rar|png|jpe?g|gif|webp|avif|heic|mp3|mp4|mov|avi|woff2?|pdf|hwpx?|docx|xlsx|pptx)$/i;
