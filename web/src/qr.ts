/**
 * QR 코드 — 담을 글 짓기와 그림 그리기.
 *
 * 부호화는 qrcode-generator 가 한다. 라이브러리는 화면이 **만들 때** 받아 와서
 * 여기로 넘긴다(`buildMatrix` 의 첫 인자) — 이 파일이 라이브러리를 직접 부르면
 * 도구를 열기만 해도 받게 된다.
 *
 * 한 가지를 바로잡는다. 라이브러리의 기본 `stringToBytes` 는 글자마다 아래 8비트만
 * 남긴다(Latin-1). 한글은 그대로 깨진다. 부호화하는 동안만 UTF-8 로 바꿔 끼운다.
 *
 * SVG 는 라이브러리 것을 쓰지 않고 칸 배열에서 직접 짓는다. 한 줄의 이어진 검은 칸을
 * 사각형 하나로 합쳐 파일이 작고, 조용한 여백(4칸)과 색을 우리가 정한다.
 */

export type Ecl = 'L' | 'M' | 'Q' | 'H';

/** 쓰는 만큼만 적은 라이브러리 모양. 실제 타입보다 좁아서 시험에서 흉내 내기 쉽다. */
export interface QrCode {
  addData(data: string, mode?: 'Byte'): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}
export interface QrFactory {
  (typeNumber: 0, errorCorrectionLevel: Ecl): QrCode;
  stringToBytes(s: string): number[];
}

export interface QrMatrix {
  modules: boolean[][];
  /** 1~40 */
  version: number;
  /** 담은 UTF-8 바이트 수 */
  bytes: number;
}

export const QUIET_ZONE = 4;

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 버전 40 에서 담을 수 있는 바이트(바이트 방식). 넘으면 부호화 전에 알린다. */
export const MAX_BYTES: Record<Ecl, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 };

export function buildMatrix(qrcode: QrFactory, text: string, ecl: Ecl = 'M'): QrMatrix {
  if (!text) throw new Error('담을 내용을 적어 주세요.');
  const bytes = utf8Length(text);
  if (bytes > MAX_BYTES[ecl]) throw tooLong(bytes, ecl);
  const latin1 = qrcode.stringToBytes;
  // 부호화하는 동안만 바꿔 끼운다. 같은 라이브러리를 쓰는 다른 도구에 번지지 않게.
  qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));
  let code: QrCode;
  try {
    code = qrcode(0, ecl);
    code.addData(text, 'Byte');
    code.make();
  } catch (error) {
    // 라이브러리는 Error 가 아니라 글자를 던진다 ("code length overflow …").
    if (String(error).includes('overflow')) throw tooLong(bytes, ecl);
    throw error;
  } finally {
    qrcode.stringToBytes = latin1;
  }
  const count = code.getModuleCount();
  const modules = Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, col) => code.isDark(row, col)));
  return { modules, version: (count - 17) / 4, bytes };
}

function tooLong(bytes: number, ecl: Ecl): Error {
  return new Error(`내용이 너무 깁니다 (${bytes}바이트). 오류 정정 ${ecl} 에서는 ${MAX_BYTES[ecl]}바이트까지 담을 수 있습니다 — 한글은 한 글자가 3바이트입니다. 글을 줄이거나 오류 정정을 낮춰 주세요.`);
}

// --- 색 -----------------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;

export function checkColor(color: string): string {
  if (!HEX.test(color)) throw new Error(`색은 #rrggbb 꼴이어야 합니다: ${color}`);
  return color.toLowerCase();
}

/** WCAG 상대 휘도. */
export function luminance(color: string): number {
  const hex = checkColor(color);
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 읽기 어려운 색 짝이면 까닭을 돌려준다. 많은 스캐너가 "밝은 바탕에 어두운 점" 만
 * 읽으므로 뒤집힌 짝은 명암 차가 커도 경고한다.
 */
export function contrastWarning(fg: string, bg: string): string | undefined {
  const f = luminance(fg);
  const b = luminance(bg);
  if (f >= b) return '점 색이 바탕보다 밝습니다. 많은 스캐너가 뒤집힌 QR 을 읽지 못합니다 — 어두운 점, 밝은 바탕을 쓰세요.';
  const ratio = (b + 0.05) / (f + 0.05);
  if (ratio < 4) return `명암 차가 작습니다(${ratio.toFixed(1)}:1). 인쇄나 화면 밝기에 따라 읽히지 않을 수 있습니다.`;
  return undefined;
}

// --- SVG ----------------------------------------------------------------------

/**
 * 칸 배열 → SVG. 줄마다 이어진 검은 칸을 `M x y h n v1 h-n z` 하나로 합친다.
 * 사용자 글자는 들어가지 않는다 — 색만 검사해 넣는다.
 */
export function matrixToSvg(modules: boolean[][], options: { fg?: string; bg?: string; margin?: number } = {}): string {
  const fg = checkColor(options.fg ?? '#000000');
  const bg = checkColor(options.bg ?? '#ffffff');
  const margin = options.margin ?? QUIET_ZONE;
  const count = modules.length;
  const total = count + margin * 2;
  let path = '';
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (x + run < row.length && row[x + run]) run++;
      path += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
      x += run - 1;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * 8}" height="${total * 8}" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${total}" fill="${bg}"/>`
    + (path ? `<path fill="${fg}" d="${path}"/>` : '')
    + '</svg>\n';
}

/**
 * 한 변 `pixels` 로 그릴 때 칸 i 가 차지하는 [시작, 끝) 픽셀. 칸 너비가 정수가 아니어도
 * 경계를 반올림해 번짐 없이 채운다(칸마다 1픽셀쯤 차이 날 뿐이다).
 */
export function cellEdges(total: number, pixels: number): number[] {
  return Array.from({ length: total + 1 }, (_, i) => Math.round((i * pixels) / total));
}

// --- 담을 글 ------------------------------------------------------------------

/** Wi-Fi 설정 문법(ZXing)이 예약한 글자. 역슬래시로 막는다. */
const wifiEscape = (text: string): string => text.replace(/([\\;,:"])/g, '\\$1');

export interface Wifi { ssid: string; password: string; security: 'WPA' | 'WEP' | 'nopass'; hidden: boolean }

export function wifiPayload(wifi: Wifi): string {
  if (!wifi.ssid) throw new Error('네트워크 이름(SSID)을 적어 주세요.');
  if (wifi.security !== 'nopass' && !wifi.password) throw new Error('암호를 적거나 보안을 "없음" 으로 고르세요.');
  let text = `WIFI:T:${wifi.security};S:${wifiEscape(wifi.ssid)};`;
  if (wifi.security !== 'nopass') text += `P:${wifiEscape(wifi.password)};`;
  if (wifi.hidden) text += 'H:true;';
  return `${text};`;
}

export interface Contact { name: string; org: string; title: string; tel: string; email: string; address: string; url: string }

/** vCard 3.0 의 text 값 이스케이프(RFC 2426 §4, RFC 6350 §3.4). */
export const vcardEscape = (text: string): string =>
  text.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r\n|\r|\n/g, '\\n');

/** 줄바꿈이 섞이면 줄이 새로 시작된 것으로 읽힌다. text 가 아닌 값은 한 줄로 만든다. */
const oneLine = (text: string): string => text.replace(/[\r\n]+/g, ' ').trim();

export function vcardPayload(contact: Contact): string {
  const name = contact.name.trim();
  if (!name) throw new Error('이름을 적어 주세요.');
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  // 한국 이름은 성·이름을 나눠 적지 않는 일이 많다. N 에는 통째로 성 자리에 두고 FN 이 보이는 이름이다.
  lines.push(`N:${vcardEscape(name)};;;;`, `FN:${vcardEscape(name)}`);
  if (contact.org.trim()) lines.push(`ORG:${vcardEscape(contact.org.trim())}`);
  if (contact.title.trim()) lines.push(`TITLE:${vcardEscape(contact.title.trim())}`);
  if (contact.tel.trim()) lines.push(`TEL;TYPE=CELL:${oneLine(contact.tel)}`);
  if (contact.email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${oneLine(contact.email)}`);
  // 주소는 한 칸(도로명 자리)에 통째로 넣는다. 나눠 받지 않으므로 나누는 척하지 않는다.
  if (contact.address.trim()) lines.push(`ADR;TYPE=WORK:;;${vcardEscape(contact.address.trim())};;;;`);
  if (contact.url.trim()) lines.push(`URL:${oneLine(contact.url)}`);
  lines.push('END:VCARD');
  return `${lines.join('\r\n')}\r\n`;
}

/** 전화번호는 숫자·+ 만 남긴다. 010-1234-5678 도 그대로 받는다. */
export function phoneDigits(phone: string): string {
  const cleaned = phone.replace(/[\s\-().]/g, '');
  if (!/^\+?[0-9]+$/.test(cleaned)) throw new Error('전화번호에는 숫자·+·-·공백만 쓸 수 있습니다.');
  return cleaned;
}

export function telPayload(phone: string): string {
  return `tel:${phoneDigits(phone)}`;
}

export function smsPayload(phone: string, message: string): string {
  return `SMSTO:${phoneDigits(phone)}:${message}`;
}

export function mailtoPayload(to: string, subject: string, body: string): string {
  const address = oneLine(to);
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) throw new Error('이메일 주소를 확인해 주세요.');
  const query = [
    subject ? `subject=${encodeURIComponent(subject)}` : '',
    body ? `body=${encodeURIComponent(body)}` : '',
  ].filter(Boolean).join('&');
  return `mailto:${address}${query ? `?${query}` : ''}`;
}
