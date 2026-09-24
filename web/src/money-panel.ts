/**
 * 금액 한글 표기 화면.
 *
 * 치는 대로 바로 바뀐다. 한글로 적힌 금액을 넣으면 거꾸로 숫자로 읽어 보여 준다 —
 * 계약서에 적힌 "일금 …원정" 이 숫자 칸과 맞는지 확인하는 데 쓴다.
 */
import { need, resultList, statusLine, toolSection } from './kit';
import { commaBig, formalHangul, formalHanja, parseAny, toHangul, toMixed } from './money';

export function moneyTool(): HTMLElement {
  const tool = toolSection('conv-money', `
    <h2>금액 한글 표기</h2>
    <p class="conv-note">숫자 금액을 한글·갖은자(壹貳參)·숫자 혼용으로 적습니다. 원 단위 정수, 9999경까지.
      <strong>계약서·영수증에는 "일" 을 빼지 않는 표기(일천, 일백)를 쓰세요</strong> — 앞에 글자를 덧붙여 금액을 고치는 일을 막는 관행입니다.
      "일억이천만", "3억 5천만" 처럼 한글로 적으면 거꾸로 숫자로 읽어 확인해 줍니다.
      소수점(원 미만)은 받지 않습니다. 기관마다 정한 서식(띄어쓰기·"원整" 과 "圓整" 등)이 있으면 그것을 따르세요.</p>
    <div class="conv-form">
      <label for="money-input">금액</label>
      <input id="money-input" type="text" class="conv-wide" inputmode="text" autocomplete="off" spellcheck="false"
        placeholder="12,345,000 또는 일억이천만" />
      <span></span>
      <label><input id="money-omit" type="checkbox" /> "일" 생략 (천이백…, 만) — 계약서에는 권하지 않음</label>
    </div>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <div class="conv-result" id="money-result"></div>
  `);

  const input = need<HTMLInputElement>(tool, '#money-input');
  const omit = need<HTMLInputElement>(tool, '#money-omit');
  const result = need<HTMLElement>(tool, '#money-result');
  const say = statusLine(need<HTMLElement>(tool, '.conv-status'));

  const update = (): void => {
    const text = input.value;
    if (!text.trim()) { result.replaceChildren(); say(''); return; }
    const parsed = parseAny(text);
    if (!parsed.ok) { result.replaceChildren(); say(parsed.error, 'error'); return; }
    const value = parsed.value;
    const options = { omitOne: omit.checked };
    const rows: Array<[string, string]> = [
      [parsed.korean ? '읽은 숫자' : '숫자', commaBig(value)],
      ['한글', toHangul(value, options)],
      ['격식', formalHangul(value, options)],
      ['갖은자', formalHanja(value)],
      ['숫자+한글', toMixed(value)],
    ];
    result.replaceChildren(resultList(rows, say));
    say(parsed.korean ? '한글 금액을 숫자로 읽었습니다. 적어 둔 숫자와 맞는지 보세요.' : '');
  };

  input.addEventListener('input', update);
  omit.addEventListener('change', update);
  return tool;
}
