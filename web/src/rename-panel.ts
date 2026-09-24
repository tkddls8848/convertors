/**
 * 파일 이름 일괄 바꾸기 화면.
 *
 * 브라우저는 디스크에 있는 파일의 이름을 바꿀 수 없다. 그래서 새 이름을 붙인
 * **사본**을 ZIP 하나로 묶어 준다 — 원본은 그대로 남는다는 것을 화면 첫머리에
 * 적는다. 그렇지 않으면 "바꿨는데 왜 그대로냐" 가 된다.
 *
 * 규칙을 고칠 때마다 미리보기를 다시 그린다. 내려받기 전에 모든 새 이름을 눈으로
 * 보게 하는 것이 이 화면의 요점이다.
 */
import { zipSync, type Zippable } from 'fflate';

import { reason } from './errors';
import { comma, filePicker, need, outputs, size, statusLine, toolSection, yieldToPaint } from './kit';
import { DEFAULT_RULES, PACKED, planRenames, sortFiles, type RenamePlan, type RenameRules, type SortKey } from './rename';

const MAX_FILES = 500;
const MAX_TOTAL = 64 * 1024 * 1024;
/** ZIP 의 시각 칸은 1980년부터다. 그 앞은 fflate 가 거절하므로 지금 시각을 쓴다. */
const ZIP_EPOCH = new Date(1980, 0, 2).getTime();

interface Item { file: File; name: string; lastModified: number; picked: number }

export function renameTool(): HTMLElement {
  const tool = toolSection('conv-rename', `
    <h2>파일 이름 일괄 바꾸기</h2>
    <p class="conv-note"><strong>브라우저는 컴퓨터에 있는 파일의 이름을 직접 바꿀 수 없습니다.</strong>
      새 이름을 붙인 사본을 ZIP 하나로 묶어 드리고, 원래 파일은 그대로 남습니다. 파일은 이 컴퓨터를 벗어나지 않습니다.
      ${comma(MAX_FILES)}개 · 합계 ${size(MAX_TOTAL)}까지. 폴더 구조는 만들지 않습니다(이름의 / 는 _ 가 됩니다).</p>
    <p class="conv-note">규칙은 적힌 순서대로 겁니다: 찾아 바꾸기 → 이름 틀 → 대소문자 → 공백. 윈도우에서 쓸 수 없는 글자·이름(CON, NUL …)은 고치고,
      겹치는 이름에는 " (2)" 를 붙여 표에 까닭을 적습니다.</p>

    <label class="conv-drop" for="rename-file">
      <input id="rename-file" type="file" multiple />
      <span>이름을 바꿀 파일을 고르거나 여기에 끌어다 놓으세요 (여러 개 가능)</span>
    </label>

    <fieldset>
      <legend>1. 찾아 바꾸기</legend>
      <div class="conv-form">
        <label for="rename-find">찾을 글자</label>
        <input id="rename-find" type="text" autocomplete="off" spellcheck="false" />
        <label for="rename-replace">바꿀 글자</label>
        <input id="rename-replace" type="text" autocomplete="off" spellcheck="false" placeholder="비우면 지웁니다" />
        <label for="rename-regex">정규식</label>
        <div><input id="rename-regex" type="checkbox" /> <label for="rename-flags">깃발</label>
          <input id="rename-flags" type="text" size="4" autocomplete="off" spellcheck="false" placeholder="i" /> <small>(i: 대소문자 무시 · $1 로 묶음 되쓰기)</small></div>
      </div>
    </fieldset>

    <fieldset>
      <legend>2. 이름 틀</legend>
      <div class="conv-form">
        <label for="rename-template">틀</label>
        <input id="rename-template" type="text" class="conv-wide" value="{name}" autocomplete="off" spellcheck="false" />
        <label for="rename-start">번호</label>
        <div><input id="rename-start" type="number" value="1" step="1" aria-label="시작 번호" />
          <label for="rename-step">씩 늘려</label> <input id="rename-step" type="number" value="1" step="1" />
          <label for="rename-pad">자리 수</label> <input id="rename-pad" type="number" value="1" min="1" max="12" step="1" /></div>
      </div>
      <p class="conv-note"><code>{name}</code> 지금 이름(1단계 뒤) · <code>{n}</code> 번호 · <code>{n:3}</code> 세 자리 번호(001) ·
        <code>{date}</code> 파일 수정한 날(YYYYMMDD) · <code>{today}</code> 오늘 · <code>{ext}</code> 확장자(점 없이)</p>
    </fieldset>

    <fieldset>
      <legend>3·4. 대소문자·공백·확장자</legend>
      <div class="conv-form">
        <label for="rename-case">대소문자</label>
        <div><select id="rename-case"><option value="keep">그대로</option><option value="lower">소문자</option><option value="upper">대문자</option></select>
          <input id="rename-case-ext" type="checkbox" /> <label for="rename-case-ext">확장자에도</label></div>
        <label for="rename-spaces">공백</label>
        <div><input id="rename-spaces" type="checkbox" /> <label for="rename-spaces">공백을 _ 로 (이어진 공백은 하나로)</label></div>
        <label for="rename-ext">확장자</label>
        <div><input id="rename-ext" type="checkbox" /> <label for="rename-ext">확장자도 바꾸기 — 켜면 틀이 이름 전체가 됩니다. 확장자를 남기려면 <code>.{ext}</code> 를 적으세요</label></div>
      </div>
    </fieldset>

    <fieldset>
      <legend>번호 매길 순서</legend>
      <div class="conv-actions">
        <label>정렬 <select class="rename-sort">
          <option value="picked">고른 순서</option><option value="name">이름</option><option value="modified">수정한 날짜</option>
        </select></label>
        <label><input type="checkbox" class="rename-desc" /> 거꾸로</label>
      </div>
    </fieldset>

    <p class="conv-status rename-status" role="status" aria-live="polite"></p>
    <div class="conv-table-wrap">
      <table class="conv-table rename-table" hidden>
        <thead><tr><th class="num">#</th><th>원래 이름</th><th>새 이름</th><th>비고</th><th>순서</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="conv-actions">
      <button type="button" class="conv-download rename-save" disabled>ZIP 으로 묶기</button>
      <button type="button" class="rename-reset">초기화</button>
    </div>
    <div class="conv-outputs conv-actions rename-outputs" aria-label="내려받기"></div>
  `);

  const input = need<HTMLInputElement>(tool, '#rename-file');
  const field = <T extends HTMLElement>(id: string): T => need<T>(tool, `#rename-${id}`);
  const find = field<HTMLInputElement>('find');
  const replace = field<HTMLInputElement>('replace');
  const regex = field<HTMLInputElement>('regex');
  const flags = field<HTMLInputElement>('flags');
  const template = field<HTMLInputElement>('template');
  const start = field<HTMLInputElement>('start');
  const step = field<HTMLInputElement>('step');
  const pad = field<HTMLInputElement>('pad');
  const caseMode = field<HTMLSelectElement>('case');
  const caseExt = field<HTMLInputElement>('case-ext');
  const spaces = field<HTMLInputElement>('spaces');
  const changeExt = field<HTMLInputElement>('ext');
  const sort = need<HTMLSelectElement>(tool, '.rename-sort');
  const descending = need<HTMLInputElement>(tool, '.rename-desc');
  const say = statusLine(need(tool, '.rename-status'));
  const table = need<HTMLTableElement>(tool, '.rename-table');
  const body = need<HTMLElement>(table, 'tbody');
  const save = need<HTMLButtonElement>(tool, '.rename-save');
  const reset = need<HTMLButtonElement>(tool, '.rename-reset');
  const links = outputs(need(tool, '.rename-outputs'));

  let items: Item[] = [];
  let picked = 0;
  let plans: RenamePlan[] = [];
  let busy = false;

  const rules = (): RenameRules => ({
    ...DEFAULT_RULES,
    find: find.value,
    replace: replace.value,
    regex: regex.checked,
    flags: flags.value.trim(),
    template: template.value,
    start: Number(start.value || 1),
    step: Number(step.value || 1),
    pad: Number(pad.value || 1),
    caseMode: caseMode.value as RenameRules['caseMode'],
    caseExt: caseExt.checked,
    spaces: spaces.checked,
    changeExt: changeExt.checked,
  });

  const render = (): void => {
    links.clear();
    table.hidden = !items.length;
    save.disabled = true;
    if (!items.length) { body.replaceChildren(); plans = []; return; }
    try {
      plans = planRenames(items, rules());
    } catch (error) {
      plans = [];
      body.replaceChildren();
      table.hidden = true;
      say(reason(error), 'error');
      return;
    }
    body.replaceChildren(...plans.map((plan, index) => row(plan, index)));
    const changed = plans.filter(plan => plan.changed).length;
    const fixed = plans.filter(plan => plan.notes.length).length;
    const total = items.reduce((sum, item) => sum + item.file.size, 0);
    say(`${comma(items.length)}개 · ${size(total)} · 이름이 바뀌는 것 ${comma(changed)}개${fixed ? ` · 스스로 고친 이름 ${comma(fixed)}개(비고 참고)` : ''}`);
    save.disabled = busy;
  };

  const row = (plan: RenamePlan, index: number): HTMLTableRowElement => {
    const tr = document.createElement('tr');
    const number = document.createElement('td');
    number.className = 'num';
    number.textContent = String(index + 1);
    const before = document.createElement('td');
    before.textContent = plan.original;
    const after = document.createElement('td');
    if (plan.changed) {
      const strong = document.createElement('strong');
      strong.textContent = plan.name;
      after.append(strong);
    } else {
      after.textContent = plan.name;
      after.style.color = 'var(--muted)';
    }
    const note = document.createElement('td');
    note.textContent = plan.notes.join(' · ');
    const order = document.createElement('td');
    order.style.whiteSpace = 'nowrap';
    const button = (text: string, label: string, disabled: boolean, act: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-label', `${plan.original} ${label}`);
      b.disabled = disabled;
      b.addEventListener('click', act);
      return b;
    };
    order.append(
      button('↑', '위로', index === 0, () => move(index, -1)),
      button('↓', '아래로', index === items.length - 1, () => move(index, 1)),
      button('빼기', '빼기', false, () => { items.splice(index, 1); render(); }),
    );
    tr.append(number, before, after, note, order);
    return tr;
  };

  const move = (index: number, by: number): void => {
    const target = index + by;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!];
    render();
  };

  const applySort = (): void => {
    items = sortFiles(items, sort.value as SortKey, descending.checked);
    render();
  };

  filePicker(input, added => {
    if (items.length + added.length > MAX_FILES) { say(`파일은 ${comma(MAX_FILES)}개까지 받습니다.`, 'error'); return; }
    const total = [...items.map(item => item.file), ...added].reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_TOTAL) { say(`파일은 합계 ${size(MAX_TOTAL)}까지 받습니다.`, 'error'); return; }
    items.push(...added.map(file => ({ file, name: file.name, lastModified: file.lastModified, picked: picked++ })));
    // 정렬을 골라 둔 채 더 넣으면 그 정렬을 따른다. 고른 순서면 뒤에 붙는다.
    applySort();
  }, () => busy);

  for (const element of [find, replace, flags, template, start, step, pad]) element.addEventListener('input', render);
  for (const element of [regex, caseMode, caseExt, spaces]) element.addEventListener('change', render);
  changeExt.addEventListener('change', () => {
    // 틀을 손대지 않았다면 확장자가 사라지지 않게 틀을 함께 바꿔 준다.
    if (changeExt.checked && template.value === '{name}') template.value = '{name}.{ext}';
    else if (!changeExt.checked && template.value === '{name}.{ext}') template.value = '{name}';
    render();
  });
  sort.addEventListener('change', applySort);
  descending.addEventListener('change', applySort);

  reset.addEventListener('click', () => {
    if (busy) return;
    items = [];
    picked = 0;
    say('');
    render();
  });

  save.addEventListener('click', () => {
    void (async () => {
      if (busy || !plans.length) return;
      busy = true;
      save.disabled = true;
      links.clear();
      try {
        say('파일 읽는 중…');
        const zippable: Zippable = {};
        // plans 는 items 와 같은 순서다. 묶는 동안 목록이 바뀌지 않게 지금 것을 붙든다.
        const pairs = items.map((item, index) => [item, plans[index]!] as const);
        for (const [item, plan] of pairs) {
          const bytes = new Uint8Array(await item.file.arrayBuffer());
          const options = item.lastModified >= ZIP_EPOCH
            ? { level: PACKED.test(plan.name) ? 0 as const : 6 as const, mtime: item.lastModified }
            : { level: PACKED.test(plan.name) ? 0 as const : 6 as const };
          zippable[plan.name] = [bytes, options];
        }
        say('묶는 중…');
        await yieldToPaint();
        const zip = zipSync(zippable);
        links.add(zip, '이름바꾼파일.zip', 'application/zip', `이름바꾼파일.zip 내려받기 (${comma(pairs.length)}개 · ${size(zip.length)})`);
        say('묶었습니다. ZIP 을 풀면 새 이름의 파일이 나옵니다 — 원래 파일은 그대로입니다.', 'ok');
      } catch (error) {
        links.clear();
        say(reason(error), 'error');
      } finally {
        busy = false;
        save.disabled = !plans.length;
      }
    })();
  });

  return tool;
}
