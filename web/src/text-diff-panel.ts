/**
 * 텍스트 비교 화면.
 *
 * 양쪽 칸에 붙여 넣거나 파일을 연다. 파일의 인코딩은 `decodeText` 가 가린다 —
 * 한쪽이 CP949, 다른 쪽이 UTF-8 이어도 글자로 비교한다. 판별이 추정이면 그렇게
 * 적는다. 깨진 글자끼리 비교한 결과는 믿을 수 없기 때문이다.
 */
import { decodeText, ENCODING_LIMITS, ENCODING_NAMES } from './encoding';
import { reason } from './errors';
import { comma, filePicker, need, outputs, statusLine, stem, toolSection, yieldToPaint } from './kit';
import { diffText, unifiedDiff, viewRows, type Part, type Row } from './text-diff';

/** 한 번에 그리는 줄 수. 넘으면 앞부분만 그리고 차이 파일로 보게 한다. */
const MAX_ROWS = 5_000;

const SIDES = [
  { key: 'a', title: '원본', fallback: '원본.txt' },
  { key: 'b', title: '고친 글', fallback: '고친글.txt' },
] as const;

export function textDiffTool(): HTMLElement {
  const sideHtml = SIDES.map(side => `
    <label class="conv-label" for="text-diff-${side.key}">${side.title}</label>
    <label class="conv-drop" for="text-diff-${side.key}-file">
      <input id="text-diff-${side.key}-file" type="file" accept=".txt,.md,.csv,.tsv,.json,.xml,.html,.log,.srt,.ini,.yml,.yaml,text/*" />
      <span>${side.title} 파일을 고르거나 끌어다 놓으세요 (선택)</span>
    </label>
    <p class="conv-filename text-diff-${side.key}-info"></p>
    <textarea id="text-diff-${side.key}" class="conv-input" rows="10" spellcheck="false" placeholder="${side.title}을 붙여 넣으세요"></textarea>
  `).join('');

  const tool = toolSection('conv-text-diff', `
    <h2>텍스트 비교</h2>
    <p class="conv-note">두 글을 줄 단위로 비교하고, 바뀐 줄 안에서는 바뀐 글자를 짚어 보입니다. 한쪽 2만 줄까지, 바뀐 줄이 3천 줄을 넘으면 멈춥니다.
      <strong>줄바꿈 방식(CRLF·LF)과 마지막 줄바꿈의 유무는 비교하지 않습니다.</strong>
      줄이 옮겨 간 것은 "삭제 + 추가" 로 보이고, 워드·HWP·PDF 같은 문서 파일은 비교하지 않습니다(텍스트로 저장해 넣으세요).</p>
    ${sideHtml}
    <fieldset>
      <legend>무시할 차이</legend>
      <label><input type="checkbox" id="text-diff-space" /> 공백 개수·앞뒤 공백</label>
      <label><input type="checkbox" id="text-diff-case" /> 영문 대소문자</label>
      <label><input type="checkbox" id="text-diff-blank" /> 빈 줄</label>
    </fieldset>
    <div class="conv-actions">
      <button type="button" class="conv-download" data-action="compare">비교하기</button>
      <button type="button" data-action="swap">양쪽 바꾸기</button>
    </div>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <div class="diff-view" hidden><table><tbody></tbody></table></div>
    <div class="conv-outputs conv-actions" aria-label="저장 결과"></div>
  `);

  const say = statusLine(need(tool, '.conv-status'));
  const areas = {
    a: need<HTMLTextAreaElement>(tool, '#text-diff-a'),
    b: need<HTMLTextAreaElement>(tool, '#text-diff-b'),
  };
  const infos = { a: need<HTMLElement>(tool, '.text-diff-a-info'), b: need<HTMLElement>(tool, '.text-diff-b-info') };
  const names: Record<'a' | 'b', string | null> = { a: null, b: null };
  const space = need<HTMLInputElement>(tool, '#text-diff-space');
  const caseBox = need<HTMLInputElement>(tool, '#text-diff-case');
  const blank = need<HTMLInputElement>(tool, '#text-diff-blank');
  const view = need<HTMLElement>(tool, '.diff-view');
  const tbody = need<HTMLElement>(tool, '.diff-view tbody');
  const out = outputs(need(tool, '.conv-outputs'));

  const clear = (): void => { out.clear(); tbody.replaceChildren(); view.hidden = true; };

  for (const side of SIDES) {
    const key = side.key;
    areas[key].addEventListener('input', clear);
    filePicker(need<HTMLInputElement>(tool, `#text-diff-${key}-file`), files => {
      const file = files[0];
      if (!file) return;
      void (async () => {
        if (file.size > ENCODING_LIMITS.bytes) { say('파일이 64MB를 넘습니다.', 'error'); return; }
        try {
          const result = decodeText(new Uint8Array(await file.arrayBuffer()));
          areas[key].value = result.text;
          names[key] = file.name;
          infos[key].textContent = `${file.name} · ${ENCODING_NAMES[result.encoding]}${result.certain ? '' : ' (추정 — 글자가 깨져 보이면 비교도 틀립니다)'}`;
          clear();
          say(`${side.title}: ${file.name} 를 읽었습니다.`);
        } catch (error) { say(reason(error), 'error'); }
      })();
    });
  }

  const partsInto = (target: HTMLElement, parts: Part[] | undefined, text: string, tag: 'del' | 'ins'): void => {
    if (!parts) { target.textContent = text; return; }
    for (const part of parts) {
      if (part.changed) {
        const mark = document.createElement(tag);
        mark.textContent = part.text;
        target.append(mark);
      } else target.append(document.createTextNode(part.text));
    }
  };

  const rowElement = (row: Row): HTMLTableRowElement => {
    const tr = document.createElement('tr');
    const number = (value: number | null): HTMLTableCellElement => {
      const td = document.createElement('td');
      td.className = 'diff-no';
      td.textContent = value === null ? '' : String(value);
      return td;
    };
    const body = document.createElement('td');
    if (row.kind === 'skip') {
      tr.className = 'diff-skip';
      body.colSpan = 3;
      body.textContent = `… ${comma(row.count)}줄 같음 …`;
      tr.append(body);
      return tr;
    }
    if (row.kind === 'del') {
      tr.className = 'diff-del';
      body.append('- ');
      partsInto(body, row.parts, row.text, 'del');
      tr.append(number(row.a), number(null), body);
    } else if (row.kind === 'add') {
      tr.className = 'diff-add';
      body.append('+ ');
      partsInto(body, row.parts, row.text, 'ins');
      tr.append(number(null), number(row.b), body);
    } else {
      body.textContent = `  ${row.text}`;
      tr.append(number(row.a), number(row.b), body);
    }
    return tr;
  };

  tool.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset['action'];
    if (action === 'swap') {
      [areas.a.value, areas.b.value] = [areas.b.value, areas.a.value];
      [names.a, names.b] = [names.b, names.a];
      [infos.a.textContent, infos.b.textContent] = [infos.b.textContent, infos.a.textContent];
      clear();
      say('양쪽을 바꿨습니다.');
      return;
    }
    if (action !== 'compare') return;
    void (async () => {
      clear();
      say('비교하는 중…');
      await yieldToPaint();
      try {
        const result = diffText(areas.a.value, areas.b.value, {
          ignoreWhitespace: space.checked, ignoreCase: caseBox.checked, ignoreBlankLines: blank.checked,
        });
        const newlineNote = result.finalNewline.a !== result.finalNewline.b ? ' 마지막 줄바꿈은 한쪽에만 있습니다(비교에서 뺐습니다).' : '';
        if (!result.added && !result.deleted && !result.changed) {
          say(`두 글이 같습니다.${newlineNote}`, 'ok');
          return;
        }
        const rows = viewRows(result);
        tbody.replaceChildren(...rows.slice(0, MAX_ROWS).map(rowElement));
        view.hidden = false;
        const nameA = names.a ?? SIDES[0].fallback;
        const nameB = names.b ?? SIDES[1].fallback;
        const file = `${stem(names.b ?? '비교')}.diff`;
        out.add(unifiedDiff(result, nameA, nameB), file, 'text/x-diff', `${file} 내려받기 (통합 diff 형식)`);
        const cut = rows.length > MAX_ROWS ? ` 화면에는 앞 ${comma(MAX_ROWS)}줄만 그렸습니다 — 나머지는 차이 파일에서 보세요.` : '';
        say(`추가 ${comma(result.added)}줄 · 삭제 ${comma(result.deleted)}줄 · 바뀐 줄 ${comma(result.changed)}줄.${newlineNote}${cut}`);
      } catch (error) { say(reason(error), 'error'); }
    })();
  });

  return tool;
}
