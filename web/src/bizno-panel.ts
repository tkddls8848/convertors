/**
 * 사업자·법인등록번호 검증 화면.
 *
 * 붙여 넣는 대로 바로 표를 다시 짠다. 여러 번호를 한 번에 받는 까닭은 거래처 목록을
 * 엑셀에서 통째로 붙여 넣어 오타를 찾는 일이 가장 흔해서다.
 *
 * 번호는 어디로도 보내지 않는다. 그래서 휴·폐업 여부는 알 수 없고, 화면이 그렇게 적는다.
 */
import { batchCsv, checkMany, KIND_NAMES } from './bizno';
import { comma, copyText, need, outputs, statusLine, toolSection } from './kit';

/** 표에 그리는 줄 수 상한. 넘으면 CSV 로 전부 받게 한다 — 화면이 멈추지 않게. */
const TABLE_LIMIT = 2000;
/** 받는 번호 수 상한. */
const MAX_NUMBERS = 20000;

export function biznoTool(): HTMLElement {
  const tool = toolSection('conv-bizno', `
    <h2>사업자·법인등록번호 검증</h2>
    <p class="conv-note">사업자등록번호(10자리)와 법인등록번호(13자리)의 <strong>검증 숫자만</strong> 봅니다 — 잘못 적은 번호(오타)를 찾는 용도입니다.
      맞다고 나와도 실제로 발급된 번호인지, <strong>지금 영업 중인지(휴·폐업)는 알 수 없습니다.</strong> 그것은 국세청 홈택스에서 확인하세요.
      번호는 이 컴퓨터를 벗어나지 않습니다. 가운데 자리로 짐작한 구분은 국세청·등기소 분류라 바뀔 수 있어 "참고" 로만 적습니다.
      13자리는 법인등록번호로만 봅니다 — 주민등록번호는 넣지 마세요.</p>
    <div class="conv-form">
      <label for="bizno-input">번호</label>
      <textarea id="bizno-input" class="conv-input conv-wide" rows="6" spellcheck="false"
        placeholder="한 줄에 하나, 또는 쉼표·공백으로 나누어&#10;124-81-00998&#10;130111-0006246"></textarea>
    </div>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <div class="conv-actions">
      <button type="button" id="bizno-copy" disabled>맞는 번호만 복사</button>
    </div>
    <div class="conv-table-wrap">
      <table class="conv-table" id="bizno-table" hidden>
        <thead><tr><th>입력</th><th>정규화</th><th>종류</th><th>결과</th><th>이유</th><th>참고</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="conv-outputs conv-actions" id="bizno-outputs" aria-label="내려받기"></div>
  `);

  const input = need<HTMLTextAreaElement>(tool, '#bizno-input');
  const table = need<HTMLTableElement>(tool, '#bizno-table');
  const body = need<HTMLTableSectionElement>(tool, '#bizno-table tbody');
  const copy = need<HTMLButtonElement>(tool, '#bizno-copy');
  const say = statusLine(need<HTMLElement>(tool, '.conv-status'));
  const files = outputs(need<HTMLElement>(tool, '#bizno-outputs'));

  let validNumbers: string[] = [];

  const update = (): void => {
    files.clear();
    body.replaceChildren();
    const batch = checkMany(input.value);
    validNumbers = batch.checks.filter(c => c.valid).map(c => c.normalized);
    copy.disabled = !validNumbers.length;
    table.hidden = !batch.checks.length;
    if (!batch.checks.length) { say('번호를 붙여 넣으면 바로 확인합니다.'); return; }
    if (batch.checks.length > MAX_NUMBERS) {
      table.hidden = true;
      copy.disabled = true;
      say(`번호가 ${comma(batch.checks.length)}개입니다. 한 번에 ${comma(MAX_NUMBERS)}개까지만 봅니다.`, 'error');
      return;
    }

    for (const check of batch.checks.slice(0, TABLE_LIMIT)) {
      const row = body.insertRow();
      const mark = check.valid ? '✓ 맞음' : '✗ 틀림';
      [check.input, check.normalized, check.kind ? KIND_NAMES[check.kind] : '—', mark, check.reason, check.note]
        .forEach((text, column) => {
          const cell = row.insertCell();
          cell.textContent = text;
          if (column === 3) cell.className = check.valid ? 'conv-ok' : 'conv-bad';
        });
    }
    files.add(batchCsv(batch.checks), '번호-검증.csv', 'text/csv;charset=utf-8', `결과 CSV 내려받기 (${comma(batch.checks.length)}건)`);

    const shown = batch.checks.length > TABLE_LIMIT ? ` 표에는 앞 ${comma(TABLE_LIMIT)}건만 보입니다 — 전부는 CSV 로 받으세요.` : '';
    say(`${comma(batch.checks.length)}건 중 맞음 ${comma(batch.valid)} · 틀림 ${comma(batch.invalid)}.${shown}`, batch.invalid ? 'error' : 'ok');
  };

  input.addEventListener('input', update);
  copy.addEventListener('click', () => {
    void copyText(validNumbers.join('\n'), `맞는 번호 ${comma(validNumbers.length)}개`, say);
  });
  update();
  return tool;
}
