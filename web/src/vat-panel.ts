/**
 * 부가세 계산 화면.
 *
 * 위는 금액 하나에서 나머지 둘을 내고, 아래는 품목표에서 합계를 낸다. 둘 다 세율과
 * 끝자리 처리 방식을 함께 쓴다. 치는 대로 바로 바뀐다.
 *
 * 품목표의 세액은 합계 공급가액에 한 번 매긴다. 세금계산서를 품목마다 세액을
 * 끝맺어 적는 곳도 있어 몇 원 다를 수 있다 — 화면이 그렇게 적는다.
 */
import { copyText, need, outputs, resultList, statusLine, toolSection } from './kit';
import { commaBig, toHangul } from './money';
import {
  fromSupply, fromTax, fromTotal, itemTable, parseRate, parseWon, rateLabel, tableRows, toCsv, toTsv,
  ROUNDING_NAMES, type ItemInput, type Rounding, type VatAmounts,
} from './vat';

type Mode = 'supply' | 'total' | 'tax';

const MODE_NAMES: Record<Mode, string> = {
  supply: '공급가액',
  total: '합계 (부가세 포함)',
  tax: '세액',
};

export function vatTool(): HTMLElement {
  const tool = toolSection('conv-vat', `
    <h2>부가세 계산</h2>
    <p class="conv-note">공급가액·합계·세액 가운데 하나를 알면 나머지를 냅니다. 원 단위 정수로 계산해 끝자리가 흔들리지 않고,
      합계에서 거꾸로 구할 때는 <strong>공급가액 + 세액이 언제나 합계와 같게</strong> 세액을 뺄셈으로 냅니다.
      원 미만은 버림이 일반적이나 거래처 방식에 따르세요. 세율은 바꿀 수 있습니다(영세율은 0).
      <strong>세무 판단(과세·면세 구분, 신고)은 하지 않습니다.</strong></p>
    <div class="conv-form">
      <label for="vat-rate">세율 (%)</label>
      <input id="vat-rate" type="text" inputmode="decimal" value="10" autocomplete="off" />
      <label for="vat-rounding">원 미만</label>
      <select id="vat-rounding">
        ${(Object.keys(ROUNDING_NAMES) as Rounding[]).map(key => `<option value="${key}">${ROUNDING_NAMES[key]}</option>`).join('')}
      </select>
    </div>

    <h3>금액 하나로</h3>
    <div class="conv-form">
      <label for="vat-mode">아는 금액</label>
      <select id="vat-mode">
        ${(Object.keys(MODE_NAMES) as Mode[]).map(key => `<option value="${key}">${MODE_NAMES[key]}</option>`).join('')}
      </select>
      <label for="vat-amount">금액 (원)</label>
      <input id="vat-amount" type="text" inputmode="numeric" class="conv-wide" autocomplete="off" placeholder="1,000,000" />
    </div>
    <p class="conv-status" id="vat-status" role="status" aria-live="polite"></p>
    <div class="conv-result" id="vat-result"></div>

    <h3>품목표</h3>
    <p class="conv-note">품목마다 수량 × 단가로 공급가액을 내고, 세액은 <strong>합계 공급가액에 한 번</strong> 매깁니다.
      세금계산서를 품목마다 세액을 끝맺어 발행하면 몇 원 다를 수 있습니다. 수량은 정수만 받습니다.</p>
    <div class="conv-table-wrap">
      <table class="conv-table" id="vat-items">
        <thead><tr><th>품목</th><th class="num">수량</th><th class="num">단가</th><th class="num">공급가액</th><th aria-label="지우기"></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="conv-actions">
      <button type="button" id="vat-add">줄 더하기</button>
      <button type="button" id="vat-copy">표 복사 (엑셀에 붙여 넣기)</button>
    </div>
    <ul class="conv-notes" id="vat-errors"></ul>
    <p class="conv-status" id="vat-items-status" role="status" aria-live="polite"></p>
    <div class="conv-result" id="vat-items-result"></div>
    <div class="conv-outputs conv-actions" id="vat-outputs" aria-label="내려받기"></div>
  `);

  const rate = need<HTMLInputElement>(tool, '#vat-rate');
  const rounding = need<HTMLSelectElement>(tool, '#vat-rounding');
  const mode = need<HTMLSelectElement>(tool, '#vat-mode');
  const amount = need<HTMLInputElement>(tool, '#vat-amount');
  const result = need<HTMLElement>(tool, '#vat-result');
  const say = statusLine(need<HTMLElement>(tool, '#vat-status'));

  const body = need<HTMLTableSectionElement>(tool, '#vat-items tbody');
  const errorList = need<HTMLElement>(tool, '#vat-errors');
  const itemsResult = need<HTMLElement>(tool, '#vat-items-result');
  const sayItems = statusLine(need<HTMLElement>(tool, '#vat-items-status'));
  const files = outputs(need<HTMLElement>(tool, '#vat-outputs'));

  const settings = (): { rateBp: bigint; rounding: Rounding } | string => {
    const parsed = parseRate(rate.value);
    if (!parsed.ok) return parsed.error;
    return { rateBp: parsed.value, rounding: rounding.value as Rounding };
  };

  const amountRows = (values: VatAmounts, rateBp: bigint): Array<[string, string]> => [
    ['공급가액', `${commaBig(values.supply)}원`],
    [`세액 (${rateLabel(rateBp)})`, `${commaBig(values.tax)}원`],
    ['합계', `${commaBig(values.total)}원`],
    ['합계 한글', `일금 ${toHangul(values.total)}원정`],
  ];

  // --- 금액 하나로 ---
  const single = (): void => {
    const set = settings();
    if (typeof set === 'string') { result.replaceChildren(); say(set, 'error'); return; }
    if (!amount.value.trim()) { result.replaceChildren(); say(''); return; }
    const parsed = parseWon(amount.value);
    if (!parsed.ok) { result.replaceChildren(); say(parsed.error, 'error'); return; }
    const which = mode.value as Mode;
    let values: VatAmounts;
    if (which === 'supply') values = fromSupply(parsed.value, set.rateBp, set.rounding);
    else if (which === 'total') values = fromTotal(parsed.value, set.rateBp, set.rounding);
    else {
      const back = fromTax(parsed.value, set.rateBp, set.rounding);
      if (!back.ok) { result.replaceChildren(); say(back.error, 'error'); return; }
      values = back.value;
    }
    result.replaceChildren(resultList(amountRows(values, set.rateBp), say));
    if (values.mismatch !== undefined) {
      say(`이 공급가액으로 세액을 다시 내면 ${commaBig(values.mismatch)}원입니다. 세액이 나누어떨어지지 않아 공급가액을 끝맺었습니다 — 원래 공급가액을 확인하세요.`, 'error');
    } else if (which === 'total') {
      say('공급가액을 끝맺고 세액은 합계에서 뺐습니다. 둘을 더하면 합계와 같습니다.');
    } else {
      say('');
    }
  };

  // --- 품목표 ---
  const readItems = (): ItemInput[] => Array.from(body.rows, row => {
    const [name, qty, price] = Array.from(row.querySelectorAll('input'));
    return { name: name?.value ?? '', qty: qty?.value ?? '', price: price?.value ?? '' };
  });

  let lastTable: ReturnType<typeof itemTable> | null = null;
  let lastRate = 1000n;

  const items = (): void => {
    files.clear();
    errorList.replaceChildren();
    const set = settings();
    if (typeof set === 'string') { itemsResult.replaceChildren(); lastTable = null; sayItems(set, 'error'); return; }
    const table = itemTable(readItems(), set.rateBp, set.rounding);
    lastTable = table;
    lastRate = set.rateBp;

    // 줄마다 공급가액 칸을 채운다. 틀린 줄은 비운다.
    const amounts = new Map(table.rows.map(row => [row.index, row.amount]));
    Array.from(body.rows).forEach((row, index) => {
      const cell = row.cells[3];
      if (cell) cell.textContent = amounts.has(index) ? commaBig(amounts.get(index)!) : '';
    });
    for (const problem of table.errors) {
      const li = document.createElement('li');
      li.className = 'conv-bad';
      li.textContent = problem.index < 0 ? problem.error : `${problem.index + 1}번째 줄 — ${problem.error}`;
      errorList.append(li);
    }

    if (!table.rows.length) {
      itemsResult.replaceChildren();
      sayItems(table.errors.length ? '계산할 수 있는 줄이 없습니다.' : '품목·수량·단가를 적으면 합계를 냅니다.', table.errors.length ? 'error' : undefined);
      return;
    }
    itemsResult.replaceChildren(resultList(amountRows(table, set.rateBp), sayItems));
    sayItems(table.errors.length
      ? `${table.rows.length}줄을 계산했습니다. 틀린 ${table.errors.length}줄은 합계에서 뺐습니다.`
      : `${table.rows.length}줄을 계산했습니다.`, table.errors.length ? 'error' : undefined);
    const csv = toCsv(tableRows(table, rateLabel(set.rateBp)));
    files.add(csv, '부가세-품목표.csv', 'text/csv;charset=utf-8');
  };

  const addRow = (focus: boolean): void => {
    const row = body.insertRow();
    const fields: Array<[string, string, string]> = [
      ['품목', 'text', ''], ['수량', 'numeric', '1'], ['단가', 'numeric', ''],
    ];
    const inputs = fields.map(([label, mode, value], column) => {
      const cell = row.insertCell();
      if (column > 0) cell.className = 'num';
      const field = document.createElement('input');
      field.type = 'text';
      field.inputMode = mode;
      field.autocomplete = 'off';
      field.value = value;
      field.setAttribute('aria-label', label);
      if (column > 0) field.size = column === 1 ? 5 : 12;
      field.addEventListener('input', items);
      cell.append(field);
      return field;
    });
    row.insertCell().className = 'num';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '지우기';
    remove.setAttribute('aria-label', '이 줄 지우기');
    remove.addEventListener('click', () => {
      row.remove();
      if (!body.rows.length) addRow(false);
      items();
    });
    row.insertCell().append(remove);
    if (focus) inputs[0]?.focus();
  };

  need<HTMLButtonElement>(tool, '#vat-add').addEventListener('click', () => { addRow(true); items(); });
  need<HTMLButtonElement>(tool, '#vat-copy').addEventListener('click', () => {
    if (!lastTable || !lastTable.rows.length) { sayItems('복사할 줄이 없습니다.', 'error'); return; }
    void copyText(toTsv(tableRows(lastTable, rateLabel(lastRate))), '품목표 (엑셀에 붙여 넣으세요)', sayItems);
  });

  const all = (): void => { single(); items(); };
  rate.addEventListener('input', all);
  rounding.addEventListener('change', all);
  mode.addEventListener('change', single);
  amount.addEventListener('input', single);

  for (let i = 0; i < 3; i++) addRow(false);
  items();
  return tool;
}
