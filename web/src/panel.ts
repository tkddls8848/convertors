/**
 * 변환기 탭.
 *
 * 문서 형식 변환, PDF 편집·꾸미기, 이미지·텍스트 손질, 사무 계산, 파일 도구.
 * **전부 브라우저 안에서 끝난다** — 고른 파일은 이 컴퓨터를 벗어나지 않는다
 * (결정 0018).
 *
 * 스물다섯을 한 화면에 늘어놓지 않는다. 먼저 **무엇을 변환할지 고르게 하고**, 고른
 * 것 하나만 아래에 세운다. 이유는 둘이다.
 *
 *   - 쓰는 사람은 한 번에 한 가지를 한다. 나머지 도구의 한도·주의사항까지
 *     읽어 가며 제 자리를 찾을 이유가 없다
 *   - 도구마다 고정된 id(`#conv-pdf-file`, `#pdf-ranges` …)를 쓴다. 한 번에
 *     하나만 붙어 있으면 그 id 가 화면에서 언제나 하나다
 *
 * 고른 도구는 **처음 고를 때 한 번** 만들고 그대로 들고 있는다. 다른 것을
 * 보다 돌아와도 올려 둔 파일과 고쳐 둔 설정이 그대로다 — 떼었다 붙일 뿐
 * 다시 만들지 않기 때문이다.
 *
 * 화면에 "안 되는 것"까지 적는 이유는 이 도구의 신뢰가 거기서 갈리기 때문이다.
 * 한글 문서를 100% 그대로 옮겨 준다고 믿고 규격서를 맡겼다가 표 한 줄이 조용히
 * 빠지면, 그 뒤로는 아무것도 믿을 수 없게 된다.
 */
import './converters.css';

import { reason } from './errors';
import { encodingTool } from './encoding-panel';
import { hwpxToMarkdown, type HwpxResult } from './hwpx';
import { imagesPdfTool } from './images-pdf-panel';
import { pdfEditTool } from './pdf-edit-panel';
import { pdfTool } from './pdf-panel';
import { textHwpxTool } from './text-hwpx-panel';
import { zipTool } from './zip-panel';
import { documentTool, spreadsheetTool } from './format-panel';

const MAX_BYTES = 64 * 1024 * 1024;

/** 고를 수 있는 변환. `id` 는 화면에서 그 단추를 찾는 이름이라 바뀌면 안 된다. */
interface Choice {
  id: string;
  title: string;
  /** 한 줄로 "이걸 고르면 무엇을 하는가". 한도와 주의는 고른 뒤 도구가 적는다. */
  summary: string;
  /**
   * 도구를 짓는다. 뒤에 들인 도구는 **고를 때 가서** 코드를 받아 온다 — 열여섯을
   * 한꺼번에 받게 하면 PDF 병합만 하러 온 사람이 QR·스프레드시트 엔진까지 받는다.
   */
  build: () => HTMLElement | Promise<HTMLElement>;
}

interface Group { title: string; choices: Choice[] }

// 이름은 고른 뒤 열리는 도구의 제목과 **같은 글자**다. 고르고 나서 "내가 이걸
// 골랐나" 를 되짚게 만들지 않기 위함이다.
//
// 스물다섯을 한 판에 늘어놓으면 제 자리를 찾기 어렵다. 하려는 일의 갈래로 묶는다.
const GROUPS: Group[] = [
  {
    title: '문서 형식 변환',
    choices: [
      { id: 'document', title: '문서·전자책 변환', summary: 'DOCX·ODT·PDF·EPUB 등의 본문을 10가지 형식으로', build: documentTool },
      { id: 'spreadsheet', title: '스프레드시트 변환', summary: 'Excel·ODS·CSV·JSON 등, 여러 시트도 한 번에', build: spreadsheetTool },
      { id: 'text-hwpx', title: '텍스트·Markdown → HWPX', summary: '붙여 넣은 글과 표를 한글에서 열리는 문서로', build: textHwpxTool },
      { id: 'hwpx-markdown', title: 'HWPX → Markdown', summary: '한글 문서의 글 순서와 표 구조를 그대로 옮긴다', build: hwpxTool },
      { id: 'encoding', title: '인코딩 변환 (CSV·텍스트)', summary: 'CP949 ↔ UTF-8, BOM 과 줄바꿈까지 맞춘다', build: encodingTool },
    ],
  },
  {
    title: 'PDF',
    choices: [
      { id: 'pdf', title: 'PDF 편집기', summary: '병합·쪽 삭제·회전·분할, HWPX·이미지로 저장', build: pdfTool },
      { id: 'pdf-edit', title: 'PDF 글자 고치기', summary: '쪽 위의 글자를 눌러 원하는 글꼴·크기로 바꾼다', build: pdfEditTool },
      { id: 'pdf-stamp', title: 'PDF 워터마크·쪽번호', summary: '대외비·사본 같은 글자와 쪽번호를 모든 쪽에', build: () => import('./pdf-stamp-panel').then(m => m.pdfStampTool()) },
      { id: 'pdf-sign', title: 'PDF 서명·도장 넣기', summary: '서명·직인 그림을 쪽 위 원하는 자리에 찍는다', build: () => import('./pdf-sign-panel').then(m => m.pdfSignTool()) },
      { id: 'pdf-nup', title: 'PDF 모아찍기·빈 쪽 빼기', summary: '한 장에 2·4·6·9쪽씩, 빈 쪽은 골라 뺀다', build: () => import('./pdf-nup-panel').then(m => m.pdfNupTool()) },
      { id: 'pdf-meta', title: 'PDF 문서 정보 보기·지우기', summary: '작성자·제목·만든 프로그램을 보고 고치거나 지운다', build: () => import('./pdf-meta-panel').then(m => m.pdfMetaTool()) },
      { id: 'images-pdf', title: '이미지 → PDF', summary: '사진·스캔 여러 장을 고른 순서대로 한 PDF 로', build: imagesPdfTool },
    ],
  },
  {
    title: '이미지·텍스트',
    choices: [
      { id: 'image-convert', title: '이미지 형식·크기 바꾸기', summary: 'PNG·JPEG·WebP 로, 크기와 용량을 줄여서', build: () => import('./image-convert-panel').then(m => m.imageConvertTool()) },
      { id: 'text-diff', title: '텍스트 비교', summary: '두 글에서 바뀐 줄과 글자를 짚어 보인다', build: () => import('./text-diff-panel').then(m => m.textDiffTool()) },
      { id: 'text-count', title: '글자 수 세기', summary: '공백 포함·제외, 바이트, 원고지 매수까지', build: () => import('./text-count-panel').then(m => m.textCountTool()) },
      { id: 'redact', title: '개인정보 가리기', summary: '주민번호·전화·이메일·카드·계좌번호를 * 로', build: () => import('./redact-panel').then(m => m.redactTool()) },
    ],
  },
  {
    title: '사무 계산',
    choices: [
      { id: 'money', title: '금액 한글 표기', summary: '12,345,000 → 일금 일천이백삼십사만오천원정', build: () => import('./money-panel').then(m => m.moneyTool()) },
      { id: 'vat', title: '부가세 계산', summary: '공급가액·세액·합계를 어느 쪽에서든', build: () => import('./vat-panel').then(m => m.vatTool()) },
      { id: 'date', title: '날짜·영업일 계산', summary: 'D-day, N일 뒤, 두 날짜 사이의 평일 수', build: () => import('./date-panel').then(m => m.dateTool()) },
      { id: 'bizno', title: '사업자·법인등록번호 검증', summary: '검증 숫자로 잘못 적은 번호를 여러 개 한 번에', build: () => import('./bizno-panel').then(m => m.biznoTool()) },
    ],
  },
  {
    title: '파일',
    choices: [
      { id: 'zip', title: 'ZIP 묶기·풀기', summary: '윈도우가 만든 ZIP 의 한글 이름도 그대로 읽는다', build: zipTool },
      { id: 'sheet-merge', title: '표 합치기·나누기', summary: 'CSV·엑셀 여러 개를 하나로, 하나를 여럿으로', build: () => import('./sheet-tools-panel').then(m => m.sheetMergeTool()) },
      { id: 'rename', title: '파일 이름 일괄 바꾸기', summary: '번호·날짜·바꾸기 규칙으로 이름을 바꿔 ZIP 으로', build: () => import('./rename-panel').then(m => m.renameTool()) },
      { id: 'hash', title: '파일 해시 확인', summary: 'SHA-256·MD5 로 받은 파일이 원본과 같은지', build: () => import('./hash-panel').then(m => m.hashTool()) },
      { id: 'qr', title: 'QR 코드 만들기', summary: '주소·글·Wi-Fi·연락처를 PNG·SVG 로', build: () => import('./qr-panel').then(m => m.qrTool()) },
    ],
  },
];

export function mountConverters(root: HTMLElement): void {
  root.innerHTML = '';

  const stage = document.createElement('div');
  stage.className = 'conv-stage';
  stage.id = 'conv-stage';
  stage.setAttribute('role', 'region');
  stage.setAttribute('aria-label', '고른 도구');
  stage.append(placeholder());

  // 만든 도구는 버리지 않고 들고 있는다. 떼었다 붙여도 안에 든 것이 남는다.
  const built = new Map<string, HTMLElement>();
  const buttons = new Map<string, HTMLButtonElement>();
  // 코드를 받는 사이에 다른 것을 고르면 늦게 도착한 쪽이 화면을 덮지 않게 한다.
  let wanted = '';

  const chooser = document.createElement('nav');
  chooser.className = 'conv-choices';
  chooser.setAttribute('aria-label', '변환 고르기');
  // 갈래는 고르기의 하위 제목이다. 도구는 별도 영역이라 h2를 유지한다.
  const chooserTitle = document.createElement('h2');
  chooserTitle.className = 'conv-choices__title';
  chooserTitle.textContent = '변환 고르기';
  chooser.append(chooserTitle);

  const select = async (choice: Choice): Promise<void> => {
    wanted = choice.id;
    for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(id === choice.id));
    let tool = built.get(choice.id);
    if (!tool) {
      stage.removeAttribute('aria-labelledby');
      stage.setAttribute('aria-label', '고른 도구');
      stage.replaceChildren(notice(`${choice.title} 여는 중…`));
      try {
        tool = await choice.build();
      } catch (error) {
        if (wanted === choice.id) stage.replaceChildren(notice(`열지 못했습니다: ${reason(error)}`, true));
        return;
      }
      built.set(choice.id, tool);
    }
    if (wanted === choice.id) {
      stage.replaceChildren(tool);
      const title = tool.querySelector<HTMLElement>('h2');
      if (title) {
        title.id = `conv-title-${choice.id}`;
        title.tabIndex = -1;
        stage.removeAttribute('aria-label');
        stage.setAttribute('aria-labelledby', title.id);
        // 전체 도구를 낭독하는 live 영역 대신 제목 초점으로 열린 도구를 알린다.
        // 고르던 자리까지 함께 움직이면 키보드 사용자가 위치를 잃는다.
        title.focus({ preventScroll: true });
      }
    }
  };

  for (const group of GROUPS) {
    const section = document.createElement('div');
    section.className = 'conv-group';
    const heading = document.createElement('h3');
    heading.className = 'conv-group__title';
    heading.textContent = group.title;
    const grid = document.createElement('div');
    grid.className = 'conv-group__choices';
    section.append(heading, grid);

    for (const choice of group.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conv-choice';
      button.dataset['choice'] = choice.id;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-controls', stage.id);

      const title = document.createElement('span');
      title.className = 'conv-choice__title';
      title.textContent = choice.title;
      const summary = document.createElement('span');
      summary.className = 'conv-choice__summary';
      summary.textContent = choice.summary;
      button.append(title, summary);

      button.addEventListener('click', () => void select(choice));
      buttons.set(choice.id, button);
      grid.append(button);
    }
    chooser.append(section);
  }

  root.append(header(), chooser, stage, footer());
}

/** 고지 자료가 없는 배포에서 빈 링크를 약속하지 않는다. */
function footer(): HTMLElement {
  const foot = document.createElement('footer');
  foot.className = 'conv-footer';
  const promise = document.createElement('p');
  promise.textContent = '고른 파일은 이 컴퓨터를 벗어나지 않습니다';
  foot.append(promise);
  void (async () => {
    try {
      const index = new URL('licenses/index.json', new URL(import.meta.env.BASE_URL, location.href));
      const response = await fetch(index, { redirect: 'error' });
      if (!response.ok) return;
      const data: unknown = await response.json();
      // 생성기의 요약 정보가 붙은 목록과 단순 배열을 함께 읽는다.
      const entries: unknown = Array.isArray(data) ? data
        : data && typeof data === 'object' && 'components' in data ? data.components : null;
      if (!Array.isArray(entries) || !entries.length) return;
      const rows: Array<{ name: string; version: string; license: string; url: URL }> = [];
      for (const item of entries) {
        if (!item || typeof item !== 'object') return;
        const { name, version, license, file } = item as Record<string, unknown>;
        if (![name, license, file].every(value => typeof value === 'string' && value.trim()) || typeof version !== 'string') return;
        const url = new URL(file as string, index);
        if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
        rows.push({ name: name as string, version: version.trim() || '판본 미상', license: license as string, url });
      }
      const details = document.createElement('details');
      details.className = 'conv-licenses';
      const summary = document.createElement('summary');
      summary.textContent = '오픈소스 고지';
      const list = document.createElement('ul');
      for (const row of rows) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = row.url.href;
        link.textContent = `${row.name} · ${row.version} · ${row.license}`;
        li.append(link);
        list.append(li);
      }
      details.append(summary, list);
      foot.append(details);
    } catch {
      // 목록을 읽지 못해도 파일 변환은 계속 쓸 수 있다. 없는 고지만 감춘다.
    } finally {
      foot.dataset['licensesLoaded'] = 'true';
    }
  })();
  return foot;
}

function notice(text: string, error = false): HTMLElement {
  const line = document.createElement('p');
  line.className = error ? 'conv-status' : 'conv-empty';
  line.setAttribute('role', 'status');
  if (error) line.dataset['tone'] = 'error';
  line.textContent = text;
  return line;
}

/** 아직 아무것도 고르지 않았을 때. 빈 칸만 두면 고장으로 보인다. */
function placeholder(): HTMLElement {
  const empty = document.createElement('p');
  empty.className = 'conv-empty';
  empty.textContent = '위에서 하려는 변환을 고르세요. 고른 것만 여기에 열립니다.';
  return empty;
}

/**
 * 페이지 머리말.
 *
 * 예전에는 이 변환기가 여러 도구가 든 화면의 **한 탭**이었다. 제목도 틀도 셸이
 * 갖고 있었고, 여기 있던 `<h1>` 은 탭 안의 작은 제목일 뿐이었다. 이제 이
 * 저장소는 변환기만 한다 — 이 머리말이 곧 페이지의 머리말이라 제목을 페이지
 * 제목으로 세우고, 무엇을 하는 곳인지 한 줄로 먼저 적는다.
 *
 * 약속(파일이 나가지 않는다)을 맨 위에 눈에 띄게 두는 이유는, 그것이 이 도구를
 * 고르는 이유이기 때문이다. 규격서나 견적서를 올리려는 사람이 가장 먼저 묻는 것을
 * 찾아 읽게 만들지 않는다.
 */
function header(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'conv-intro';
  section.innerHTML = `
    <h1>변환기</h1>
    <p class="conv-intro__lede">
      문서·PDF·이미지·텍스트를 바꾸고, 사무에서 자주 쓰는 계산과 파일 손질까지 한자리에서 합니다.
    </p>
    <p class="conv-intro__promise">
      <strong>고른 파일은 이 컴퓨터를 벗어나지 않습니다.</strong>
      모든 변환이 브라우저 안에서 끝나며, 어디로도 올려 보내지 않습니다.
    </p>
    <p>
      <code>.hwp</code>(한글 5.0 바이너리)는 ZIP 이 아니라 OLE 복합 문서라 브라우저에서 열지 못합니다.
      한글이 설치된 PC 에서 <code>desktop/hwp-to-hwpx.ps1</code> 로 HWPX 로 바꾼 뒤 올려 주세요.
    </p>
  `;
  return section;
}

// --- HWPX → Markdown --------------------------------------------------------

function hwpxTool(): HTMLElement {
  const tool = document.createElement('section');
  tool.className = 'conv-tool';
  tool.innerHTML = `
    <h2>HWPX → Markdown</h2>
    <p class="conv-note">
      글의 순서와 표의 칸 구조(병합 포함)를 그대로 옮깁니다.
      글꼴·색·쪽 배치는 옮기지 않습니다 — 그것은 내용이 아니라 꾸밈입니다.
    </p>
    <label class="conv-drop" for="conv-hwpx-file">
      <input id="conv-hwpx-file" type="file" accept=".hwpx,application/hwp+zip" />
      <span>HWPX 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <div class="conv-result" hidden>
      <div class="conv-stats"></div>
      <div class="conv-actions">
        <button type="button" class="conv-download">Markdown 내려받기</button>
        <span class="conv-filename"></span>
      </div>
      <pre class="conv-preview"></pre>
    </div>
  `;

  const input = tool.querySelector<HTMLInputElement>('#conv-hwpx-file')!;
  const drop = tool.querySelector<HTMLLabelElement>('.conv-drop')!;
  const status = tool.querySelector<HTMLParagraphElement>('.conv-status')!;
  const result = tool.querySelector<HTMLDivElement>('.conv-result')!;
  const stats = tool.querySelector<HTMLDivElement>('.conv-stats')!;
  const preview = tool.querySelector<HTMLPreElement>('.conv-preview')!;
  const download = tool.querySelector<HTMLButtonElement>('.conv-download')!;
  const filename = tool.querySelector<HTMLSpanElement>('.conv-filename')!;

  let markdown = '';
  let name = 'document.md';

  const fail = (message: string): void => {
    status.textContent = message;
    status.dataset['tone'] = 'error';
    result.hidden = true;
  };

  const run = async (file: File): Promise<void> => {
    status.dataset['tone'] = '';
    // .hwp(5.0 바이너리)는 ZIP 이 아니라 OLE 복합 문서다. 브라우저에서 확실하게
    // 읽을 방법이 없어서 시도하지 않고, 무엇을 하면 되는지 알려 준다.
    if (/\.hwp$/i.test(file.name)) {
      fail('.hwp 는 브라우저에서 열 수 없습니다. 한글이 설치된 PC에서 desktop/hwp-to-hwpx.ps1 로 HWPX 로 바꾼 뒤 올려 주세요.');
      return;
    }
    if (file.size > MAX_BYTES) {
      fail(`파일이 너무 큽니다(${mb(file.size)}). ${mb(MAX_BYTES)}까지 읽습니다.`);
      return;
    }

    status.textContent = `${file.name} 읽는 중…`;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const converted: HwpxResult = await hwpxToMarkdown(bytes);
      markdown = converted.markdown;
      name = `${file.name.replace(/\.hwpx$/i, '')}.md`;

      stats.textContent = describe(converted);
      preview.textContent = markdown.slice(0, 4000) + (markdown.length > 4000 ? '\n…' : '');
      filename.textContent = name;
      result.hidden = false;
      status.textContent = `${file.name} 변환 완료`;
      status.dataset['tone'] = 'ok';
    } catch (error) {
      fail(`읽지 못했습니다: ${reason(error)}`);
    }
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void run(file);
  });

  for (const type of ['dragenter', 'dragover'] as const) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.dataset['over'] = 'yes';
    });
  }
  for (const type of ['dragleave', 'drop'] as const) {
    drop.addEventListener(type, () => delete drop.dataset['over']);
  }
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) void run(file);
  });

  download.addEventListener('click', () => {
    if (!markdown) return;
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    // 즉시 거두면 사파리에서 저장이 취소된다. 한 틱 뒤에 놓아 준다.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  return tool;
}

function describe({ stats }: HwpxResult): string {
  const parts = [`구역 ${stats.sections}개`, `표 ${stats.tables}개`];
  if (stats.tables) parts.push(`행 ${stats.rows}개`, `칸 ${stats.cells}개`);
  if (stats.bullets) parts.push(`글머리표 ${stats.bullets}개`);
  return parts.join(' · ');
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
