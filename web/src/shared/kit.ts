/**
 * 새 도구들이 함께 쓰는 화면 조각.
 *
 * 앞서 만든 화면들(zip-panel·images-pdf-panel …)은 같은 몇 줄을 저마다 들고
 * 있다. 새로 들이는 도구가 열 개가 넘어 그대로 베끼면 한 군데만 고쳐지는 일이
 * 생긴다. 그래서 여기 한 벌만 둔다 — 공유는 이 폴더 안에서만 한다(결정 0012).
 *
 * 규칙은 기존 화면과 같다.
 *   - 상태 줄은 `role="status"` 이고, 오류는 `data-tone="error"` 로 눈에 띄게 한다
 *   - 내려받기는 링크로 준다. 누르기 전에 이름과 크기를 보여 준다
 *   - 만든 Blob URL 은 다음 결과를 낼 때 반드시 거둔다
 */

/** 도구 칸 하나. `className` 은 `conv-tool conv-kit` 뒤에 붙는다. */
export function toolSection(className: string, html: string): HTMLElement {
  const tool = document.createElement('section');
  tool.className = `conv-tool conv-kit ${className}`;
  tool.innerHTML = html;
  return tool;
}

export function need<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`화면 조각을 찾지 못했습니다: ${selector}`);
  return found;
}

/** 상태 줄에 쓰는 함수. `tone` 이 없으면 보통 알림이다. */
export type Say = (text: string, tone?: 'error' | 'ok') => void;

export function statusLine(element: HTMLElement): Say {
  return (text, tone) => {
    element.textContent = text;
    element.dataset['tone'] = tone ?? '';
    // 실패는 결과다 — 화면 밖이면 보이게 한다. 진행 중 글·"복사했습니다" 로는 움직이지 않는다.
    if (tone === 'error') revealResult(element);
  };
}

/**
 * 초점이 입력칸(글 칸·고르기·체크)에 있으면 사람이 그 칸을 만지는 중이다. 부가세·QR·
 * 이름 바꾸기처럼 입력할 때마다 결과가 바뀌는 도구에서 그때 화면을 옮기면 치던 칸이
 * 화면 밖으로 사라진다. 단추·파일 고르기로 시작한 실행만 결과로 데려간다.
 */
function typing(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return true;
  if (active instanceof HTMLInputElement) return !['file', 'button', 'submit', 'reset'].includes(active.type);
  return active instanceof HTMLElement && active.isContentEditable;
}

/** 결과 칸 윗부분이 화면 아래 끝에서 이만큼(px)은 올라와 있어야 "보인다"고 본다. */
const REVEAL_MARGIN = 64;

/**
 * 실행 결과가 나왔을 때 결과 칸(`.conv-results`)의 윗부분이 화면 밖이면 그 칸을 화면
 * 위로 끌어온다. 윗부분만 본다 — 긴 표·미리보기 전체를 담으라 하면 QR 처럼 입력하는
 * 대로 링크가 바뀌는 도구에서 글자마다 화면이 튄다. 초점은 옮기지 않는다 — 상태 줄의
 * `aria-live` 가 이미 알린다.
 */
export function revealResult(element: HTMLElement): void {
  if (typing()) return;
  const target = element.closest<HTMLElement>('.conv-results') ?? element;
  const { top } = target.getBoundingClientRect();
  if (top >= 0 && top <= window.innerHeight - REVEAL_MARGIN) return;
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
}

/** 내려받기 링크 묶음. `clear` 가 앞서 만든 URL 을 모두 거둔다. */
export interface Outputs {
  add(bytes: Uint8Array | string, name: string, mime: string, label?: string): HTMLAnchorElement;
  clear(): void;
}

export function outputs(container: HTMLElement): Outputs {
  let urls: string[] = [];
  return {
    add(bytes, name, mime, label) {
      const blob = typeof bytes === 'string'
        ? new Blob([bytes], { type: mime })
        : new Blob([new Uint8Array(bytes)], { type: mime });
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.textContent = label ?? `${name} 내려받기 (${size(blob.size)})`;
      container.append(link);
      revealResult(container);
      return link;
    },
    clear() {
      urls.forEach(url => URL.revokeObjectURL(url));
      urls = [];
      container.replaceChildren();
    },
  };
}

/** 칸 전체가 파일 받는 자리가 되게 한다. 끌어다 놓기도 같은 자리에서 받는다. */
export function dropTarget(drop: HTMLElement, receive: (files: File[]) => void, busy: () => boolean = () => false): void {
  for (const type of ['dragenter', 'dragover'] as const) drop.addEventListener(type, event => {
    event.preventDefault();
    if (!busy()) drop.dataset['over'] = 'yes';
  });
  drop.addEventListener('dragleave', () => delete drop.dataset['over']);
  drop.addEventListener('drop', event => {
    event.preventDefault();
    delete drop.dataset['over'];
    if (!busy()) receive(Array.from(event.dataTransfer?.files ?? []));
  });
}

/** 파일 고르기 칸과 끌어다 놓기를 한 번에 잇는다. 같은 파일을 다시 골라도 받도록 값을 비운다. */
export function filePicker(input: HTMLInputElement, receive: (files: File[]) => void, busy?: () => boolean): void {
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) receive(files);
  });
  const drop = input.closest<HTMLElement>('.conv-drop');
  if (drop) dropTarget(drop, receive, busy);
}

export function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** 확장자를 뗀 이름. 점으로 시작하는 이름(`.env`)은 그대로 둔다. */
export function stem(name: string): string {
  return name.replace(/(?<=.)\.[^./\\]*$/, '');
}

/** 무거운 일 앞에서 한 틱 놓아 준다 — 상태 줄이 먼저 그려지게. */
export function yieldToPaint(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** 천 단위 쉼표. 원 단위 금액과 개수에 쓴다. */
export function comma(value: number | bigint): string {
  return value.toLocaleString('ko-KR');
}

/** 이름·값·복사 단추가 한 줄씩인 목록(`.conv-result dl`). 값은 textContent 로만 넣는다. */
export function resultList(rows: Array<[string, string]>, say: Say): HTMLDListElement {
  const list = document.createElement('dl');
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.append(dt, dd, copyButton(value, label, say));
  }
  return list;
}

export function copyButton(text: string, label: string, say: Say): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '복사';
  button.setAttribute('aria-label', `${label} 복사`);
  button.addEventListener('click', () => { void copyText(text, label, say); });
  return button;
}

/** 클립보드는 https·권한에 따라 막힐 수 있다. 막히면 직접 골라 복사하라고 알린다. */
export async function copyText(text: string, label: string, say: Say): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    say(`복사했습니다: ${label}`, 'ok');
  } catch {
    say('클립보드에 넣지 못했습니다. 글자를 직접 골라 복사해 주세요.', 'error');
  }
}
