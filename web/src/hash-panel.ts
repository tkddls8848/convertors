/**
 * 파일 해시 확인 화면.
 *
 * 받은 파일이 원본과 같은지 보는 도구다. 사이트가 적어 둔 값을 "기대값" 에 붙여
 * 넣으면 자리 수로 알고리즘을 가려 그것까지 세고 견준다 — 무엇을 골라야 하는지
 * 몰라도 되게.
 *
 * 파일은 읽기만 하고 어디로도 보내지 않는다. 계산은 모두 이 탭 안에서 한다.
 */
import { reason } from './errors';
import {
  ALGORITHMS, CancelledError, SHA_LIMIT, duplicateGroups, hashBlob, parseExpected, sumsFileName, sumsText, type Algorithm,
} from './hash';
import { comma, filePicker, need, outputs, size, statusLine, toolSection, yieldToPaint } from './kit';

const MAX_FILES = 1000;

export function hashTool(): HTMLElement {
  const tool = toolSection('conv-hash', `
    <h2>파일 해시 확인</h2>
    <p class="conv-note">파일의 해시(지문)를 세어 원본과 같은지 확인합니다. <strong>파일은 이 컴퓨터를 벗어나지 않습니다</strong> — 계산은 브라우저 안에서 끝납니다.
      SHA 계열은 파일을 통째로 메모리에 올려야 해서 파일당 ${size(SHA_LIMIT)}까지 셉니다. MD5 는 조각씩 읽어 크기 제한이 없지만 큰 파일은 시간이 걸립니다.</p>
    <p class="conv-note"><strong>MD5·SHA-1 은 내려받다 깨진 파일을 가려내는 데는 충분하지만, 누가 일부러 바꾼 파일은 가려내지 못합니다.</strong>
      위·변조 확인에는 SHA-256 이상을 쓰고, 기대값은 파일과 다른 경로(공식 사이트 등)에서 받은 것이어야 뜻이 있습니다.</p>

    <div class="conv-form">
      <label for="hash-algorithm">알고리즘</label>
      <select id="hash-algorithm">${ALGORITHMS.map(a => `<option value="${a}">${a}</option>`).join('')}</select>
      <label for="hash-expected">기대값</label>
      <input id="hash-expected" type="text" class="conv-wide" autocomplete="off" spellcheck="false"
        placeholder="사이트에 적힌 해시를 붙여 넣으세요 (선택) — 자리 수로 알고리즘을 알아봅니다" />
    </div>

    <label class="conv-drop" for="hash-file">
      <input id="hash-file" type="file" multiple />
      <span>해시를 셀 파일을 고르거나 여기에 끌어다 놓으세요 (여러 개 가능)</span>
    </label>
    <p class="conv-status hash-status" role="status" aria-live="polite"></p>
    <div class="conv-result hash-verdict" aria-live="polite"></div>
    <div class="conv-table-wrap">
      <table class="conv-table hash-table" hidden>
        <thead><tr><th>이름</th><th class="num">크기</th><th class="hash-col">해시</th><th>복사</th><th>비고</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="conv-actions">
      <button type="button" class="hash-stop" disabled>멈추기</button>
      <button type="button" class="hash-reset">초기화</button>
    </div>
    <div class="conv-outputs conv-actions hash-outputs" aria-label="해시 목록 내려받기"></div>
  `);

  const algorithmSelect = need<HTMLSelectElement>(tool, '#hash-algorithm');
  const expectedInput = need<HTMLInputElement>(tool, '#hash-expected');
  const input = need<HTMLInputElement>(tool, '#hash-file');
  const say = statusLine(need(tool, '.hash-status'));
  const verdict = need<HTMLElement>(tool, '.hash-verdict');
  const table = need<HTMLTableElement>(tool, '.hash-table');
  const body = need<HTMLElement>(table, 'tbody');
  const hashHeading = need<HTMLElement>(table, '.hash-col');
  const stop = need<HTMLButtonElement>(tool, '.hash-stop');
  const reset = need<HTMLButtonElement>(tool, '.hash-reset');
  const links = outputs(need(tool, '.hash-outputs'));

  let files: File[] = [];
  // 파일마다 센 값을 알고리즘별로 들고 있는다. 알고리즘을 바꿔도 센 것은 다시 세지 않는다.
  let hashes = new Map<File, Partial<Record<Algorithm, string>>>();
  let failures = new Map<File, Partial<Record<Algorithm, string>>>();
  // 새로 셈을 시작하면 앞선 셈은 다음 조각에서 스스로 멈춘다.
  let generation = 0;
  let running = false;

  const selected = (): Algorithm => algorithmSelect.value as Algorithm;

  const wanted = (): Algorithm[] => {
    const list: Algorithm[] = [selected()];
    const expected = parseExpected(expectedInput.value);
    if (expected.kind === 'ok' && !list.includes(expected.algorithm)) list.push(expected.algorithm);
    return list;
  };

  const render = (): void => {
    const algorithm = selected();
    const expected = parseExpected(expectedInput.value);
    table.hidden = !files.length;
    hashHeading.textContent = algorithm;
    const shown = files.map(file => hashes.get(file)?.[algorithm] ?? '');
    const same = new Map<number, number>();
    duplicateGroups(shown).forEach((group, index) => group.forEach(row => same.set(row, index + 1)));

    body.replaceChildren(...files.map((file, row) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = file.name;
      const bytes = document.createElement('td');
      bytes.className = 'num';
      bytes.textContent = size(file.size);
      bytes.title = `${comma(file.size)}바이트`;
      const hashCell = document.createElement('td');
      const code = document.createElement('code');
      const failure = failures.get(file)?.[algorithm];
      code.textContent = shown[row] || (failure ? '' : '세는 중…');
      hashCell.append(code);
      if (failure) {
        const bad = document.createElement('span');
        bad.className = 'conv-bad';
        bad.textContent = failure;
        hashCell.append(bad);
      }
      const copyCell = document.createElement('td');
      if (shown[row]) copyCell.append(copyButton(shown[row]!, file.name));
      const note = document.createElement('td');
      const notes: HTMLElement[] = [];
      if (expected.kind === 'ok') {
        const actual = hashes.get(file)?.[expected.algorithm];
        if (actual) notes.push(mark(actual === expected.hex, actual === expected.hex ? '✓ 기대값 일치' : '✗ 기대값 불일치'));
      }
      const group = same.get(row);
      if (group) {
        const span = document.createElement('span');
        span.textContent = `같은 파일 (${group}번 묶음)`;
        notes.push(span);
      }
      notes.forEach((element, i) => { if (i) note.append(document.createTextNode(' · ')); note.append(element); });
      tr.append(name, bytes, hashCell, copyCell, note);
      return tr;
    }));

    renderVerdict(expected);
    renderSums(algorithm, shown);
  };

  const renderVerdict = (expected: ReturnType<typeof parseExpected>): void => {
    verdict.replaceChildren();
    if (expected.kind === 'empty') return;
    const line = document.createElement('p');
    line.style.margin = '0';
    if (expected.kind === 'invalid') {
      line.className = 'conv-bad';
      line.textContent = expected.message;
      verdict.append(line);
      return;
    }
    if (!files.length) {
      line.textContent = `기대값은 ${expected.algorithm} 로 보입니다. 파일을 고르면 견줍니다.`;
      verdict.append(line);
      return;
    }
    const counted = files.filter(file => hashes.get(file)?.[expected.algorithm]);
    const failed = files.filter(file => failures.get(file)?.[expected.algorithm]);
    const matched = counted.filter(file => hashes.get(file)?.[expected.algorithm] === expected.hex);
    if (!matched.length && counted.length + failed.length < files.length) {
      line.textContent = running ? `${expected.algorithm} 로 세는 중…` : `${expected.algorithm} 로 다 세지 못했습니다.`;
    } else if (!counted.length) {
      line.className = 'conv-bad';
      line.textContent = `${expected.algorithm} 로 세지 못해 견줄 수 없습니다. 표의 까닭을 보세요.`;
    } else if (matched.length) {
      line.className = 'conv-ok';
      line.textContent = files.length === 1
        ? `✓ 일치 — ${expected.algorithm} 값이 기대값과 같습니다.`
        : `✓ 일치 — ${matched.map(file => file.name).join(', ')} (${expected.algorithm})`;
    } else {
      line.className = 'conv-bad';
      line.textContent = files.length === 1
        ? `✗ 불일치 — ${expected.algorithm} 값이 기대값과 다릅니다. 파일이 깨졌거나 다른 판일 수 있습니다.`
        : `✗ 불일치 — 기대값과 같은 ${expected.algorithm} 값을 가진 파일이 없습니다.`;
    }
    verdict.append(line);
  };

  const renderSums = (algorithm: Algorithm, shown: string[]): void => {
    links.clear();
    const rows = files.map((file, i) => ({ name: file.name, hash: shown[i] ?? '' })).filter(row => row.hash);
    if (!rows.length || running) return;
    links.add(sumsText(rows), sumsFileName(algorithm), 'text/plain;charset=utf-8',
      `${sumsFileName(algorithm)} 내려받기 (${rows.length}개)`);
  };

  const copyButton = (hash: string, name: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '복사';
    button.setAttribute('aria-label', `${name} 해시 복사`);
    button.addEventListener('click', () => {
      navigator.clipboard.writeText(hash).then(
        () => say(`${name} 의 해시를 복사했습니다.`, 'ok'),
        () => say('복사하지 못했습니다. 해시를 끌어 선택해 복사해 주세요.', 'error'),
      );
    });
    return button;
  };

  /** 빠진 해시만 센다. 알고리즘을 바꾸거나 기대값을 넣을 때마다 부른다. */
  const compute = async (): Promise<void> => {
    const mine = ++generation;
    const todo = files.flatMap(file => wanted().filter(a => !hashes.get(file)?.[a] && !failures.get(file)?.[a]).map(a => [file, a] as const));
    if (!todo.length) { render(); return; }
    running = true;
    stop.disabled = false;
    render();
    let done = 0;
    try {
      for (const [file, algorithm] of todo) {
        if (mine !== generation) return;
        const label = `${algorithm} 세는 중… ${done + 1}/${todo.length} · ${file.name}`;
        say(label);
        await yieldToPaint();
        try {
          const hex = await hashBlob(file, algorithm, {
            cancelled: () => mine !== generation,
            progress: fraction => { if (file.size > 16 * 1024 * 1024) say(`${label} ${Math.floor(fraction * 100)}%`); },
          });
          if (mine !== generation) return;
          hashes.set(file, { ...hashes.get(file), [algorithm]: hex });
        } catch (error) {
          if (error instanceof CancelledError) return;
          failures.set(file, { ...failures.get(file), [algorithm]: reason(error) });
        }
        done++;
        render();
      }
      running = false;
      const failed = files.filter(file => failures.has(file)).length;
      say(failed
        ? `${comma(files.length - failed)}개를 셌고 ${comma(failed)}개는 세지 못했습니다.`
        : `${comma(files.length)}개 파일의 해시를 셌습니다.`, failed ? 'error' : 'ok');
    } finally {
      if (mine === generation) { running = false; stop.disabled = true; render(); }
    }
  };

  const start = (): void => { void compute(); };

  filePicker(input, added => {
    if (files.length + added.length > MAX_FILES) { say(`파일은 ${comma(MAX_FILES)}개까지 셉니다.`, 'error'); return; }
    // 같은 파일을 두 번 고른 것은 한 번만 센다.
    files.push(...added.filter(file => !files.includes(file)));
    start();
  });
  algorithmSelect.addEventListener('change', start);
  let typing: ReturnType<typeof setTimeout> | undefined;
  expectedInput.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(start, 250);
  });
  stop.addEventListener('click', () => {
    generation++;
    running = false;
    stop.disabled = true;
    say('멈췄습니다. 다 센 파일의 값만 보입니다. 알고리즘을 다시 고르면 이어서 셉니다.');
    render();
  });
  reset.addEventListener('click', () => {
    generation++;
    running = false;
    stop.disabled = true;
    files = [];
    hashes = new Map();
    failures = new Map();
    expectedInput.value = '';
    say('');
    render();
  });

  render();
  return tool;
}

function mark(ok: boolean, text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = ok ? 'conv-ok' : 'conv-bad';
  span.textContent = text;
  return span;
}
