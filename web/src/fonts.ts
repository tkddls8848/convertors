/**
 * 심을 수 있는 글꼴 목록.
 *
 * 글꼴 파일은 저장소에 담지 않는다. 한글 글꼴은 한 벌이 2~14MB 이고, 바이너리는
 * 델타 압축이 먹지 않아 한 번 커밋하면 이력에서 되돌릴 방법이 없다 — 데스크톱
 * EXE 를 다루는 규칙과 같다(`web/scripts/fetch_desktop_app.sh`). 그래서 **배포할
 * 때 npm 에서 받아** `web/public/fonts/` 에 담는다.
 *
 * 그래서 목록도 코드가 아니라 **받아 온 자리**(`/fonts/fonts.json`)가 갖는다.
 * 못 받았으면 목록이 없고, 그때 화면은 있는 척하지 않는다 — PDF 가 이미 아는
 * 라틴 기본 글꼴과 "내 글꼴 불러오기" 로 물러난다.
 *
 * 고른 글꼴 하나만 받는다. 목록에 용량을 적어 두는 것은 누르기 전에 알라는 뜻이다.
 */
import { EDIT_LIMITS, type FontSource } from './pdf-edit';

export interface CatalogFont {
  id: string;
  label: string;
  group: string;
  /** `/fonts/` 아래의 파일 이름. */
  file: string;
  bytes: number;
  license: string;
}

/**
 * PDF 규격이 정한 글꼴. 파일을 받지 않고 쓰며 **한글은 담지 못한다**.
 * 숫자·영문만 고치는 흔한 경우에 5MB 를 받게 할 이유가 없다.
 */
export const STANDARD_FONTS: FontSource[] = [
  { id: 'std-helvetica', label: 'Helvetica (라틴 전용 · 내려받기 없음)', standard: 'Helvetica' },
  { id: 'std-helvetica-bold', label: 'Helvetica 굵게 (라틴 전용)', standard: 'HelveticaBold' },
  { id: 'std-times', label: 'Times Roman (라틴 전용 · 내려받기 없음)', standard: 'TimesRoman' },
  { id: 'std-times-bold', label: 'Times Roman 굵게 (라틴 전용)', standard: 'TimesRomanBold' },
  { id: 'std-courier', label: 'Courier (라틴 전용 · 고정폭)', standard: 'Courier' },
];

/** 한 번 받은 글꼴은 다시 받지 않는다. 탭을 닫을 때까지 들고 있는다. */
const cache = new Map<string, Uint8Array>();

/** 받아 온 목록을 읽는다. 없으면 빈 목록 — 화면이 라틴 글꼴로 물러난다. */
export async function loadCatalog(): Promise<CatalogFont[]> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}fonts/fonts.json`, { cache: 'force-cache' });
    if (!response.ok) return [];
    const parsed: unknown = await response.json();
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCatalogFont);
  } catch {
    // 목록을 못 읽는 것은 고장이 아니다. 글꼴 없이도 라틴 글자는 고칠 수 있다.
    return [];
  }
}

/** 고른 글꼴 하나를 받는다. `progress` 로 몇 MB 를 받는 중인지 알린다. */
export async function loadFont(font: CatalogFont, progress?: (message: string) => void): Promise<Uint8Array> {
  const held = cache.get(font.id);
  if (held) return held;
  progress?.(`${font.label} 글꼴 ${mb(font.bytes)} 받는 중…`);
  const response = await fetch(`${import.meta.env.BASE_URL}fonts/${font.file}`, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`${font.label} 글꼴을 받지 못했습니다 (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > EDIT_LIMITS.fontBytes) throw new Error(`${font.label} 글꼴 파일이 올바르지 않습니다.`);
  cache.set(font.id, bytes);
  return bytes;
}

/** 쓰는 사람이 제 컴퓨터에서 올린 글꼴. 맑은 고딕·함초롬돋움처럼 우리가 담아 줄 수 없는 것들이다. */
export function holdUploaded(id: string, bytes: Uint8Array): void {
  cache.set(id, bytes);
}

export function heldBytes(id: string): Uint8Array | undefined {
  return cache.get(id);
}

export function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function isCatalogFont(value: unknown): value is CatalogFont {
  if (typeof value !== 'object' || value === null) return false;
  const font = value as Record<string, unknown>;
  return typeof font['id'] === 'string' && typeof font['label'] === 'string'
    && typeof font['group'] === 'string' && typeof font['license'] === 'string'
    && typeof font['bytes'] === 'number'
    // 파일 이름이 경로가 되면 /fonts/ 밖을 가리킬 수 있다. 목록은 우리가 만들지만 검사는 한다.
    && typeof font['file'] === 'string' && /^[\w.-]+$/.test(font['file']);
}
