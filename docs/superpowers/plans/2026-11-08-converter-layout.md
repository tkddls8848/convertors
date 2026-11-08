# 변환기 화면 배치 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도구를 고르면 첫 화면에 열리고, 실행 결과(상태·내려받기·미리보기)가 작업 칸 맨 위 한 곳에 나오며, PDF 편집기는 쪽 썸네일로 수정 상황이 보이게 한다.

**Architecture:** 페이지 틀(`app/panel.ts`)을 "왼쪽 목록 + 오른쪽 도구" 두 칸으로 바꾸고 좁은 화면에선 목록을 접는다. 결과 칸은 마크업 래퍼 `.conv-results` + `shared/kit.ts` 의 `revealResult()` 로 25개 도구가 같은 규칙을 쓴다. PDF 편집기 썸네일은 새 모듈 `features/pdf/pdf-thumbs.ts` 가 PDF.js(`pdf-render.ts`)로 화면에 든 쪽만 그린다.

**Tech Stack:** TypeScript, 바닐라 DOM, Vite, Vitest(jsdom), Playwright 검사 스크립트, pdf-lib, pdfjs-dist.

**Spec:** `docs/superpowers/specs/2026-11-08-converter-layout-design.md`

## Global Constraints

- 기존 도구 ID, 접근성 이름, 변환 한도(PDF 합계 64MB · 1,000쪽 등)는 바꾸지 않는다 (`AGENTS.md`).
- 파일은 브라우저 안에서만 처리한다. 새 라이브러리는 들이지 않는다.
- 브라우저 검사가 기대는 선택자 유지: `.conv-choice[data-choice="…"]`, `aria-pressed`, `.conv-stage`, `.conv-empty`, `.pdf-pages li`, `.pdf-pages input`, `.pdf-outputs a`, `.conv-pdf .conv-status`, `.conv-outputs a`, `.qr-outputs`, 모든 단추 이름과 "N쪽 위로/아래로" `aria-label`.
- 도구 버튼의 접근성 이름은 "제목 + 한 줄 설명" 그대로다(설명은 시각적으로만 숨김).
- `prefers-reduced-motion: reduce` 이면 스크롤 애니메이션을 쓰지 않는다.
- 입력 즉시 값이 나오는 계산기(`money`, `date`, `vat` 위쪽 계산기, `text-count`)의 상태 줄·`.conv-result` 는 옮기지 않는다. `vat` 은 품목 표 내려받기(`#vat-outputs` 와 그 상태 줄)만 결과 칸으로.
- 입력칸에 딸린 짧은 알림(복사 완료, PDF 글자 고치기 편집 양식의 입력 확인)은 그 자리에 둔다.
- 기능 변경 후 관련 테스트, import·에셋 경로 변경 시 전체 테스트·타입 검사·빌드·브라우저 검사 (`AGENTS.md`).

## Review Focus

- 아무것도 실행하지 않은 도구에서 결과 칸이 빈 테두리 상자로 보이면 안 된다 → Task 1 CSS + Task 8 브라우저 검사(실행 전 `.conv-results` 높이 0).
- "복사했습니다"(ok 알림)나 진행 중 상태로 화면이 튀면 안 된다 → Task 1 테스트 `statusLine 의 ok·보통 알림은 스크롤하지 않는다`.
- 쪽 회전·이동으로 목록을 다시 그릴 때 썸네일을 다시 렌더링하면 안 된다 → Task 6 테스트 `같은 쪽은 한 번만 그린다`.
- 그리는 도중 "초기화"하면 늦게 끝난 그림이 새 목록에 끼거나 URL 이 새면 안 된다 → Task 6 테스트 `잊은 파일의 늦은 그림은 버리고 URL 을 거둔다`.
- 깨진 쪽을 그리지 못해도 편집·저장은 되어야 한다 → Task 6 테스트 `그리기 실패는 "미리보기 없음"`.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `web/src/shared/kit.ts` (수정) | `revealResult()` 추가, `outputs().add` 와 `statusLine` 의 error 가 결과 칸을 드러냄 |
| `web/src/shared/kit.test.ts` (새) | 위 동작 테스트 (jsdom) |
| `web/src/app/panel.ts`, `converters.css`, `panel.test.ts` (수정) | 두 칸 틀, 좁은 화면 접힘 단추, `.conv-results` 공통 스타일 |
| `web/src/app/result-placement.test.ts` (새) | 등록된 도구를 jsdom 에서 만들어 결과 칸 규칙을 검사(도구 ID 목록을 Task 3–7 이 채움) |
| 각 `features/*/*-panel.ts`, `pdf-edit-view.ts` (수정) | 상태·내려받기·미리보기를 `.conv-results` 로 묶어 파일 칸 바로 아래로 |
| `web/src/features/pdf/pdf.ts` (수정) | `PdfSource.bytes` |
| `web/src/features/pdf/pdf-thumbs.ts` + `.test.ts` (새) | 썸네일 대기열·캐시·그리기 |
| `web/src/features/pdf/pdf-panel.ts` (수정) | 두 칸, 썸네일 격자, `<details>` |
| `web/scripts/check-converters.mjs` (수정) | 뷰포트·모바일 검사 |

---

### Task 1: 결과 칸 공통 부품

**Files:**
- Modify: `web/src/shared/kit.ts`
- Modify: `web/src/app/converters.css`
- Create: `web/src/shared/kit.test.ts`

**Interfaces:**
- Produces: `revealResult(element: HTMLElement): void` — `element.closest('.conv-results') ?? element` 이 뷰포트 밖(위나 아래로 잘림)이면 `scrollIntoView({ block: 'nearest', behavior })`. `behavior` 는 `matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'` (matchMedia 가 없으면 'auto'). 초점은 옮기지 않는다.
- Produces: `outputs(container).add(...)` 는 링크를 붙인 뒤 `revealResult(container)` 를 부른다. `statusLine(el)` 이 돌려준 `say(text, 'error')` 는 `revealResult(el)` 를 부른다. `'ok'`·보통 알림은 부르지 않는다.
- Produces: CSS 클래스 `.conv-results` — 안의 `.conv-status:empty`, 빈 링크 묶음, `[hidden]` 은 자리를 차지하지 않고, 보이는 자식이 하나도 없으면 상자 자체(테두리·여백)도 없다(`:has()` 사용). 보이는 자식이 있으면 테두리 있는 상자.

- [ ] **Step 1: 실패하는 테스트 작성** — `kit.test.ts` 첫 줄 `// @vitest-environment jsdom`. jsdom 에는 `scrollIntoView` 가 없으므로 `Element.prototype.scrollIntoView = vi.fn()` 로 두고, 대상의 `getBoundingClientRect` 를 덮어 화면 안/밖을 만든다(`window.innerHeight` 는 768).

```ts
it('화면 밖 결과 칸으로 링크가 생기면 그 칸이 보이게 스크롤한다', () => {
  // .conv-results > .conv-outputs, results.getBoundingClientRect → { top: 1200, bottom: 1300 }
  outputs(container).add(new Uint8Array([1]), 'a.pdf', 'application/pdf');
  expect(results.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
});
it('이미 보이는 결과 칸이면 스크롤하지 않는다', () => { /* top: 100, bottom: 200 → not called */ });
it('statusLine 의 error 는 결과 칸을 드러낸다', () => { /* say('x', 'error') → called */ });
it('statusLine 의 ok·보통 알림은 스크롤하지 않는다', () => { /* say('복사했습니다', 'ok'); say('읽는 중…') → not called */ });
it('움직임 줄이기 설정이면 애니메이션 없이 옮긴다', () => { /* matchMedia → matches: true → behavior: 'auto' */ });
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/shared/kit.test.ts` → FAIL (`revealResult` 없음 / 호출 안 됨).
- [ ] **Step 3: `revealResult` 구현, `outputs().add`·`statusLine` 에 연결, `.conv-results` CSS 추가** (`converters.css` 의 kit 구역).
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, 이어서 `npm test` 전체 PASS.
- [ ] **Step 5: 커밋** — `git add web/src/shared web/src/app/converters.css && git commit -m "결과 칸이 화면 밖이면 실행 결과가 나올 때 보이게 한다"`

### Task 2: 페이지 틀 — 왼쪽 목록 + 오른쪽 도구

**Files:**
- Modify: `web/src/app/panel.ts` (`mountConverters`, `placeholder`)
- Modify: `web/src/app/converters.css` (`.converters`, `.conv-choices*`, 새 `.conv-layout`)
- Test: `web/src/app/panel.test.ts`

**Interfaces:**
- Produces DOM: `root > header(.conv-intro), div.conv-layout > [nav.conv-choices, div.conv-stage#conv-stage], footer`. `nav.conv-choices` 안에 `button.conv-choices__toggle`(`aria-expanded`, `aria-controls="conv-choice-groups"`) 와 `div#conv-choice-groups.conv-choices__groups`(기존 갈래들). 접힘 상태는 `nav[data-collapsed]`.
- 토글 글자: 아무것도 안 골랐으면 `도구 고르기`, 골랐으면 `${choice.title} · 다른 도구 고르기`.
- 각 `.conv-choice` 에 `title = choice.summary`. 요약 `span` 은 DOM 에 남긴다.

- [ ] **Step 1: 실패하는 테스트 추가** (`panel.test.ts`, 기존 세 테스트는 그대로 통과해야 한다)

```ts
it('처음에는 목록이 펼쳐져 있고, 고르면 접히며 토글에 고른 이름이 보인다', async () => {
  const toggle = document.querySelector<HTMLButtonElement>('.conv-choices__toggle')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.getAttribute('aria-controls')).toBe('conv-choice-groups');
  builders.first.mockImplementation(() => tool('First'));
  choose('first');
  await vi.waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
  expect(document.querySelector('.conv-choices')!.hasAttribute('data-collapsed')).toBe(true);
  expect(toggle.textContent).toBe('First · 다른 도구 고르기');
  toggle.click();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
});
it('도구 버튼 이름에 한 줄 설명이 남고 title 로도 보인다', () => {
  // mock GROUPS 의 summary 를 'S1' 로 바꿔 두고:
  const button = document.querySelector('[data-choice="first"]')!;
  expect(button.textContent).toContain('S1');
  expect(button.getAttribute('title')).toBe('S1');
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/app/panel.test.ts` → 새 두 테스트 FAIL.
- [ ] **Step 3: 구현** — 고르면 접고, 좁은 화면(`matchMedia('(max-width: 56rem)')` 일치)일 때만 `stage.scrollIntoView({ block: 'start' })`(움직임 줄이기 존중). 넓은 화면에서는 `data-collapsed` 와 상관없이 목록이 보이고 토글은 숨는다(CSS). CSS: `.converters` 최대 폭 76rem, `.conv-intro` 는 읽기 폭(54rem) 유지; `@media (min-width: 56.01rem)` 에서 `.conv-layout { display: grid; grid-template-columns: minmax(12rem, 15rem) minmax(0, 1fr); gap }`, 목록은 `position: sticky; top: 0; max-height: 100vh; overflow: auto`, `.conv-choice` 는 한 줄 제목만 보이는 세로 목록, `.conv-choice__summary` 는 시각적으로만 숨김(clip 패턴). 좁은 화면에선 기존 격자 그대로 + `nav[data-collapsed] .conv-choices__groups { display: none }`. `placeholder()` 문구: `하려는 변환을 고르세요. 고른 것만 여기에 열립니다.`
- [ ] **Step 4: 통과 확인** — `npx vitest run src/app/panel.test.ts` PASS, `npm run typecheck` PASS.
- [ ] **Step 5: 커밋** — `git commit -m "도구 목록을 왼쪽에 세우고, 좁은 화면에선 고르면 접는다"`

### Task 3: 결과 칸 옮기기 — 문서·텍스트·사무

**Files:**
- Create: `web/src/app/result-placement.test.ts`
- Modify: `features/documents/{format,hwpx,text-hwpx}-panel.ts`, `features/text/{encoding,redact,text-diff}-panel.ts`, `features/office/{bizno,vat}-panel.ts`

**Interfaces:**
- Consumes: Task 1 의 `.conv-results`, `revealResult`.
- Produces: `result-placement.test.ts` 의 `PLACED` 배열(도구 ID). 뒤 Task 가 ID 를 더한다.

**결과 칸 규칙(이 Task 와 Task 4–5, 7 공통):** 실행 흐름 하나마다 `div.conv-results` 하나. 그 안에 순서대로 상태 줄(`role="status"`), (있으면) 취소 단추·경고 목록, 화면에 보이는 결과(미리보기 `pre.conv-preview`, `.conv-table-wrap`, `.qr-preview`, `.hash-verdict` 등), 내려받기 링크 묶음. 위치는 그 흐름의 파일 칸(`.conv-drop`) 또는 주 입력칸 바로 뒤, 옵션·실행 단추보다 앞. 기존 클래스·id 는 그대로 둔다. kit 을 안 쓰는 화면은 링크를 붙인 뒤와 실행 오류 때 `revealResult` 를 직접 부른다.

- [ ] **Step 1: 실패하는 테스트 작성** — jsdom 에서 `GROUPS` 의 도구를 `build()` 로 만든다(만들기에 필요한 브라우저 기능이 없으면 그 import 만 `vi.mock`).

```ts
const PLACED = ['document', 'spreadsheet', 'hwpx-markdown', 'text-hwpx', 'encoding', 'redact', 'text-diff', 'bizno', 'vat'];
it.each(PLACED)('%s: 내려받기 묶음은 상태 줄과 같은 결과 칸에 있고, 결과 칸이 첫 실행 단추보다 앞이다', async id => {
  const tool = await build(id);
  const lists = tool.querySelectorAll('[class*="outputs"]');
  expect(lists.length).toBeGreaterThan(0);
  for (const list of lists) {
    const box = list.closest('.conv-results');
    expect(box, list.className).not.toBeNull();
    expect(box!.querySelector('[role="status"]')).not.toBeNull();
  }
  const firstBox = tool.querySelector('.conv-results')!;
  const firstRun = tool.querySelector('button.conv-download');
  if (firstRun) expect(firstBox.compareDocumentPosition(firstRun) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```
(`vat` 은 품목 표 흐름의 결과 칸만 검사 대상이 되도록, 위쪽 계산기의 `.conv-result` 는 `[class*="outputs"]` 에 걸리지 않는다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run src/app/result-placement.test.ts` → 9개 FAIL.
- [ ] **Step 3: 8개 화면의 마크업을 규칙대로 옮긴다** (`document`·`spreadsheet` 는 같은 `format-panel.ts`). `redact` 는 텍스트 입력 흐름과 파일 흐름이 결과 칸 하나를 같이 쓴다(지금도 상태 줄 하나). `text-diff` 는 파일 칸 바로 뒤.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm test` 전체 PASS.
- [ ] **Step 5: 커밋** — `git commit -m "문서·텍스트·사무 도구의 결과를 파일 칸 바로 아래 한 곳에 모은다"`

### Task 4: 결과 칸 옮기기 — 파일·이미지·표

**Files:**
- Modify: `features/files/{hash,qr,rename,zip}-panel.ts`, `features/images/{image-convert,images-pdf}-panel.ts`, `features/spreadsheets/sheet-tools-panel.ts`
- Test: `web/src/app/result-placement.test.ts` (`PLACED` 에 ID 추가)

- [ ] **Step 1: `PLACED` 에 `hash`, `qr`, `rename`, `zip`, `image-convert`, `images-pdf`, `sheet-merge` 추가.**
- [ ] **Step 2: 실패 확인** — 새 7개 FAIL.
- [ ] **Step 3: 규칙대로 옮긴다.** `zip`(묶기/풀기)과 `sheet-tools`(합치기/나누기)는 흐름마다 자기 결과 칸을 그 흐름의 파일 칸 바로 뒤에. `image-convert` 는 결과 표(`.conv-table-wrap`)와 링크를 한 칸에. `qr` 은 미리보기와 링크를 한 칸에, 입력칸(`#qr-text`/`#qr-body`) 영역 바로 뒤.
- [ ] **Step 4: 통과 확인** — `npx vitest run src/app/result-placement.test.ts` PASS, `npm test` PASS.
- [ ] **Step 5: 커밋** — `git commit -m "파일·이미지·표 도구의 결과를 파일 칸 바로 아래 한 곳에 모은다"`

### Task 5: 결과 칸 옮기기 — 작은 PDF 도구와 PDF 글자 고치기

**Files:**
- Modify: `features/pdf/{pdf-meta,pdf-nup,pdf-sign,pdf-stamp}-panel.ts`, `features/pdf/pdf-edit-view.ts`, `features/pdf/pdf-edit-panel.ts`
- Test: `web/src/app/result-placement.test.ts`

- [ ] **Step 1: `PLACED` 에 `pdf-meta`, `pdf-nup`, `pdf-sign`, `pdf-stamp`, `pdf-edit` 추가. 그리고 테스트 하나 더:**

```ts
it('PDF 글자 고치기: 편집 양식의 입력 확인은 결과 칸이 아니라 양식 안 알림 줄에 나온다', async () => {
  const tool = await build('pdf-edit');
  const note = tool.querySelector('.edit-form-note[role="status"]');
  expect(note).not.toBeNull();
  expect(note!.closest('.conv-results')).toBeNull();
});
```
- [ ] **Step 2: 실패 확인** — 새 테스트 FAIL.
- [ ] **Step 3: 옮긴다.** `pdf-meta` 는 문서 정보 표(`.meta-facts`)가 입력 표라 옮기지 않고 상태 줄 + 링크만. `pdf-edit-view` 는 상태 줄·경고(`.edit-warnings`)·링크(`.edit-outputs`)를 결과 칸으로, 편집 양식(`#conv-edit-text` 주변)에 `p.conv-note.edit-form-note[role=status][aria-live=polite]` 를 새로 두고 `pdf-edit-panel.ts` 에서 양식 입력 확인 알림(예: `새 글자를 입력하세요.`)을 그 줄로 보낸다.
- [ ] **Step 4: 통과 확인** — `npm test` PASS.
- [ ] **Step 5: 커밋** — `git commit -m "PDF 도구들의 결과를 파일 칸 바로 아래 한 곳에 모은다"`

### Task 6: PDF 썸네일 대기열

**Files:**
- Modify: `web/src/features/pdf/pdf.ts` — `PdfSource` 에 `bytes: Uint8Array` 추가, `readPdf` 가 채운다.
- Create: `web/src/features/pdf/pdf-thumbs.ts`, `web/src/features/pdf/pdf-thumbs.test.ts`

**Interfaces:**
- Produces:
```ts
export type DrawPage = (source: PdfSource, index: number) => Promise<Blob>;
export interface Thumbnailer {
  /** slot 이 root 안에서 보이면 (source, index) 를 그려 slot 안 <img> 에 넣는다. 그린 적 있으면 바로 넣는다. */
  show(slot: HTMLElement, source: PdfSource, index: number): void;
  /** 이 파일의 그림·대기를 버리고 Blob URL 을 거둔다. 진행 중이던 그림은 끝나면 버린다. */
  forget(source: PdfSource): void;
  dispose(): void;
}
export function createThumbnailer(options: { root: HTMLElement; draw: DrawPage; concurrency?: number }): Thumbnailer; // concurrency 기본 2
export function drawWithPdfJs(longSide?: number): DrawPage & { release(source: PdfSource): void }; // 기본 160
```
- `slot` 안 결과: 성공 `img.pdf-thumb`(alt 빈 문자열, 장식), 실패 `span.pdf-thumb-missing` 글자 `미리보기 없음`, 기다리는 동안 빈 회색 칸.
- `drawWithPdfJs` 는 파일마다 `openPdf(source.bytes)` 를 한 번만 열고(`release` 에서 `destroy()`), 긴 변 `longSide` px(× `devicePixelRatio`, 최대 2)로 `renderToCanvas` 해 PNG Blob. 원래 회전은 PDF.js 기본 viewport 가 반영한다.

- [ ] **Step 1: 실패하는 테스트 작성** (`// @vitest-environment jsdom`; `IntersectionObserver` 는 콜백을 손으로 부르는 가짜로, `URL.createObjectURL/revokeObjectURL` 은 `vi.fn` 으로)

```ts
it('보이는 칸만 그린다', ...);                       // show 2개, 하나만 교차 → draw 1회
it('동시에 최대 2장만 그린다', ...);                  // 5칸 교차, draw 가 풀리지 않는 promise → 호출 2회
it('같은 쪽은 한 번만 그린다', ...);                  // 그린 뒤 새 slot 으로 show → draw 추가 호출 없음, img 즉시 있음
it('그리기 실패는 "미리보기 없음"', ...);             // draw reject → slot.textContent === '미리보기 없음'
it('잊은 파일의 늦은 그림은 버리고 URL 을 거둔다', ...); // draw 진행 중 forget → 풀린 뒤 slot 에 img 없음, revokeObjectURL 호출
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/features/pdf/pdf-thumbs.test.ts` → FAIL (모듈 없음).
- [ ] **Step 3: 구현** — 캐시는 `Map<PdfSource, Map<number, string>>`(URL). `drawWithPdfJs` 는 단위 테스트하지 않고 Task 8 브라우저 검사로 확인.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm test`, `npm run typecheck` PASS.
- [ ] **Step 5: 커밋** — `git commit -m "PDF 쪽 썸네일을 화면에 든 것만 두 장씩 그린다"`

### Task 7: PDF 편집기 두 칸

**Files:**
- Modify: `web/src/features/pdf/pdf-panel.ts`, `web/src/app/converters.css` (`.conv-pdf` 구역)
- Test: `web/src/app/result-placement.test.ts`

**Interfaces:**
- Consumes: Task 6 `createThumbnailer`, `drawWithPdfJs`; Task 1 `revealResult`, `.conv-results`.
- DOM: `section.conv-pdf > h2, p.conv-note, div.pdf-layout > [div.pdf-left, div.pdf-right]`.
  - `pdf-left`: `label.conv-drop`(`#conv-pdf-file`), 선택·회전·삭제·초기화 단추 줄, `.pdf-summary`, `ol.pdf-pages`(자기 상자 안 스크롤, `max-height: calc(100vh - 12rem)` 정도, 최소 20rem).
  - `pdf-right`: `div.conv-results`(`p.conv-status`, `.pdf-hwpx-cancel`, `ul.pdf-hwpx-warnings`, `div.pdf-outputs`) → 저장 단추 두 개 → 분할 → `h3 다른 형식으로` → HWPX → 이미지.
  - 지금 `fieldset.pdf-controls` 가 단추를 묶어 비활성화한다. 두 칸에 걸치므로 fieldset 을 칸마다 하나씩(`pdf-controls` 클래스 둘 다) 두고 `render()` 가 둘 다 끈다.
- 쪽 칸 `li`: `label` 안에 `input[type=checkbox]` + `span.pdf-thumb-slot` + `span.pdf-page-no`(`${index + 1}`) + `span.pdf-page-from`(`${source.name} · 원본 ${index+1}쪽`, 작게); 그 뒤 "N쪽 위로/아래로" 단추. 체크된 칸 `li[data-selected]`. 편집기에서 더한 회전은 `.pdf-thumb-slot` 에 `style.transform = rotate(${page.rotation}deg)`.
- 긴 설명(`HWPX` 이미지·텍스트 방식 설명 두 문단, 분할 문법 예시, 이미지 방식 경고)은 `<details><summary>자세히</summary>…</details>`. 한도 문구("최대 100쪽·출력 64MB", "최대 200쪽…")는 접지 않는다.
- 썸네일러는 `ol.pdf-pages` 를 root 로 하나 만들고, "초기화" 때 `forget` + `release`.

- [ ] **Step 1: `PLACED` 에 `pdf` 추가하고 테스트 하나 더:**

```ts
it('PDF 편집기: 결과 칸은 오른쪽 칸 맨 위, 쪽 목록은 왼쪽 칸', async () => {
  const tool = await build('pdf');
  expect(tool.querySelector('.pdf-right')!.firstElementChild!.matches('.conv-results')).toBe(true);
  expect(tool.querySelector('.pdf-left .pdf-pages')).not.toBeNull();
  expect(tool.querySelector('.pdf-right .pdf-outputs')).not.toBeNull();
});
```
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현.** CSS: 넓은 도구 칸에서 `.pdf-layout { display: grid; grid-template-columns: minmax(0, 3fr) minmax(16rem, 2fr) }`, 좁으면 한 칸; `ol.pdf-pages` 는 `grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr))`; 선택 칸은 강조 테두리. 기존 `@media (max-width: 480px) .pdf-pages li` 규칙은 새 칸 모양에 맞게 고친다. `exportGroups`·HWPX·이미지 성공 후와 `run()` 의 오류에서 `revealResult(status)`.
- [ ] **Step 4: 통과 확인** — `npm test`, `npm run typecheck`, `npm run build` PASS.
- [ ] **Step 5: 커밋** — `git commit -m "PDF 편집기를 쪽 썸네일과 결과 칸 두 칸으로 나눈다"`

### Task 8: 브라우저 검사와 마무리

**Files:**
- Modify: `web/scripts/check-converters.mjs`, `web/scripts/check-office-tools.mjs`(선택자 바뀐 곳만)
- Modify: `web/src/README.md` (`pdf-thumbs.ts` 한 줄), `VALIDATION.md` (검사 항목 한 줄)

- [ ] **Step 1: 검사 추가** (`check-converters.mjs`, 기존 흐름 앞뒤로)
  - 1366×768: `choose('pdf')` 직후 `#conv-pdf-file` 를 감싼 `.conv-drop` 의 `boundingBox().y + height <= 768`.
  - 1366×768: 실행 전 `.conv-pdf .conv-results` 높이 0. 3쪽 PDF 를 넣으면 `.pdf-pages img.pdf-thumb` 3개가 뜬다. "선택 쪽 ↻ 90°" 뒤 그 칸 `.pdf-thumb-slot` 의 `transform` 이 `rotate(90deg)` 를 포함. "전체 병합·저장" 뒤 `.pdf-outputs a` 의 상자가 뷰포트 안.
  - 1,000쪽: pdf-lib 로 빈 쪽 1,000장 PDF 를 만들어 넣으면 10초 안에 첫 `img.pdf-thumb` 가 뜨고, 그 시점 `img.pdf-thumb` 수가 100 미만(보이는 것만 그림), 목록 상자를 끝까지 스크롤해도 페이지 오류가 없다.
  - 375×812: 처음에 `.conv-choices__toggle` 의 `aria-expanded="true"`; 도구를 고르면 `false` 이고 `.conv-stage h2` 가 뷰포트 안; `document.documentElement.scrollWidth <= innerWidth`.
  - PASS 문구에 `layout (sidebar, results in view, thumbnails)` 추가.
- [ ] **Step 2: 개발 서버를 띄우고 실행** — `npm --prefix web run dev -- --host 127.0.0.1 --port 18574 --strictPort` 후 `node web/scripts/check-converters.mjs`, `node web/scripts/check-office-tools.mjs`, `A11Y_TEST_URL=http://127.0.0.1:18574 node web/scripts/check-a11y.mjs`. 기대: 세 스크립트 모두 PASS, 접근성 `위반 0건`. 1366×768 에서 파일 칸이 화면 밖이면 원인은 머리말 높이일 가능성이 크다 — 넓은 화면에서 머리말 여백·`.hwp` 안내 문단을 줄여 맞추고 다시 실행.
- [ ] **Step 3: 전체 확인** — `npm --prefix web test`, `npm --prefix web run typecheck`, `npm --prefix web run build` 모두 PASS.
- [ ] **Step 4: 문서 한 줄씩 갱신 후 커밋** — `git commit -m "화면 배치 바뀐 것을 브라우저 검사로 묶는다"`
