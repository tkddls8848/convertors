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

import { reason } from '../shared/errors';
import { GROUPS, type Choice } from './tool-registry';


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
  const pending = new Map<string, Promise<HTMLElement>>();
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
        let building = pending.get(choice.id);
        if (!building) {
          building = Promise.resolve().then(() => choice.build());
          pending.set(choice.id, building);
        }
        tool = await building;
      } catch (error) {
        if (wanted === choice.id) stage.replaceChildren(notice(`열지 못했습니다: ${reason(error)}`, true));
        return;
      } finally {
        pending.delete(choice.id);
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

  // 상용 비공개 도구다. 소스를 볼 수 있다는 것이 마음대로 써도 된다는 뜻이 아니라는
  // 것을 쓰는 사람이 화면에서 한 번은 보게 한다 — 조건은 저장소의 LICENSE 에 있다.
  // 함께 배포되는 제3자 구성요소는 각자의 라이선스를 따르고, 그 목록이 아래 고지다.
  const rights = document.createElement('p');
  rights.className = 'conv-footer__rights';
  rights.textContent = '© 2026 미르누리. 모든 권리를 보유합니다.';

  foot.append(promise, rights);
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
