/**
 * 날짜·영업일 계산 화면.
 *
 * 오늘 날짜는 이 컴퓨터의 시계에서 **날짜만** 가져온다. 그 뒤로는 dates.ts 가 시간대
 * 없이 계산한다. 공휴일은 적은 것과 양력 고정 공휴일뿐이다 — 음력 명절과 대체·임시
 * 공휴일은 해마다 정해져서 이 도구가 알 수 없고, 그것을 화면에 분명히 적는다.
 */
import {
  between, ddayLabel, elapsed, formatDate, formatWithWeekday, formatYmd, fromDay, holidaySet,
  nthDay, parseDate, parseHolidays, shift, toDay, UNIT_NAMES, type Holidays, type Unit,
} from './dates';
import { comma, need, resultList, statusLine, toolSection } from './kit';

/** 사이에 걸린 공휴일을 이 수까지만 늘어놓는다. */
const LIST_LIMIT = 60;

export function dateTool(): HTMLElement {
  const now = new Date();
  const todayDate = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  const today = toDay(todayDate);
  const todayText = formatDate(todayDate);

  const tool = toolSection('conv-date', `
    <h2>날짜·영업일 계산</h2>
    <p class="conv-note">D-day, N일·N개월 뒤, 두 날짜 사이의 평일·영업일 수를 셉니다. 오늘은 이 컴퓨터 시계 기준 <strong>${todayText}</strong> 입니다.
      <strong>설날·추석·부처님오신날(음력), 대체공휴일, 선거일·임시공휴일은 자동으로 넣지 않으니 아래 공휴일 칸에 직접 적으세요.</strong>
      "양력 고정 공휴일" 은 1/1·3/1·5/5·6/6·8/15·10/3·10/9·12/25 만 넣습니다. 회사 휴무일도 같은 칸에 적으면 됩니다.
      개월을 더할 때 그 달에 같은 날이 없으면 말일로 당깁니다(1월 31일 + 1개월 = 2월 28·29일).</p>

    <h3>공휴일</h3>
    <div class="conv-form">
      <label for="date-holidays">직접 적기</label>
      <textarea id="date-holidays" class="conv-input conv-wide" rows="4" spellcheck="false"
        placeholder="한 줄에 하나, YYYY-MM-DD. # 뒤는 메모&#10;2026-09-25 추석&#10;2026-09-24 # 추석 연휴"></textarea>
      <span></span>
      <label><input id="date-fixed" type="checkbox" checked /> 양력 고정 공휴일 포함</label>
    </div>
    <ul class="conv-notes" id="date-holiday-errors"></ul>

    <h3>D-day</h3>
    <div class="conv-form">
      <label for="date-target">날짜</label>
      <input id="date-target" type="date" />
      <label for="date-nth">N일째</label>
      <input id="date-nth" type="number" min="1" step="1" value="100" />
      <span></span>
      <label><input id="date-count-first" type="checkbox" checked /> 그날을 1일로 셈 (기념일 방식)</label>
    </div>
    <p class="conv-status" id="date-dday-status" role="status" aria-live="polite"></p>
    <div class="conv-result" id="date-dday-result"></div>

    <h3>날짜 더하기·빼기</h3>
    <div class="conv-form">
      <label for="date-from">시작일</label>
      <input id="date-from" type="date" value="${todayText}" />
      <label for="date-amount">더할 값</label>
      <div>
        <input id="date-amount" type="number" step="1" value="30" aria-label="더할 값 (빼려면 음수)" />
        <select id="date-unit" aria-label="단위">
          ${(Object.keys(UNIT_NAMES) as Unit[]).map(unit => `<option value="${unit}">${UNIT_NAMES[unit]}</option>`).join('')}
        </select>
      </div>
    </div>
    <p class="conv-status" id="date-shift-status" role="status" aria-live="polite"></p>
    <div class="conv-result" id="date-shift-result"></div>

    <h3>두 날짜 사이</h3>
    <div class="conv-form">
      <label for="date-a">시작일</label>
      <input id="date-a" type="date" value="${todayText}" />
      <label for="date-b">끝나는 날</label>
      <input id="date-b" type="date" />
      <span></span>
      <div>
        <label><input id="date-include-start" type="checkbox" checked /> 시작일 포함</label>
        <label><input id="date-include-end" type="checkbox" /> 끝나는 날 포함</label>
      </div>
    </div>
    <p class="conv-status" id="date-span-status" role="status" aria-live="polite"></p>
    <div class="conv-result" id="date-span-result"></div>
    <ul class="conv-notes" id="date-span-holidays" aria-label="사이에 든 공휴일"></ul>
  `);

  const holidayText = need<HTMLTextAreaElement>(tool, '#date-holidays');
  const fixed = need<HTMLInputElement>(tool, '#date-fixed');
  const holidayErrors = need<HTMLElement>(tool, '#date-holiday-errors');

  const target = need<HTMLInputElement>(tool, '#date-target');
  const nth = need<HTMLInputElement>(tool, '#date-nth');
  const countFirst = need<HTMLInputElement>(tool, '#date-count-first');
  const ddayResult = need<HTMLElement>(tool, '#date-dday-result');
  const sayDday = statusLine(need<HTMLElement>(tool, '#date-dday-status'));

  const from = need<HTMLInputElement>(tool, '#date-from');
  const amount = need<HTMLInputElement>(tool, '#date-amount');
  const unit = need<HTMLSelectElement>(tool, '#date-unit');
  const shiftResult = need<HTMLElement>(tool, '#date-shift-result');
  const sayShift = statusLine(need<HTMLElement>(tool, '#date-shift-status'));

  const a = need<HTMLInputElement>(tool, '#date-a');
  const b = need<HTMLInputElement>(tool, '#date-b');
  const includeStart = need<HTMLInputElement>(tool, '#date-include-start');
  const includeEnd = need<HTMLInputElement>(tool, '#date-include-end');
  const spanResult = need<HTMLElement>(tool, '#date-span-result');
  const spanHolidays = need<HTMLElement>(tool, '#date-span-holidays');
  const saySpan = statusLine(need<HTMLElement>(tool, '#date-span-status'));

  let holidays: Holidays = holidaySet(new Map(), true);

  const readHolidays = (): void => {
    const list = parseHolidays(holidayText.value);
    holidays = holidaySet(list.days, fixed.checked);
    holidayErrors.replaceChildren(...list.errors.map(error => {
      const li = document.createElement('li');
      li.className = 'conv-bad';
      li.textContent = `${error} — 이 줄은 공휴일로 넣지 않았습니다`;
      return li;
    }));
  };

  /** 빈 칸이면 null, 틀리면 오류 글, 맞으면 날 번호. */
  const dayOf = (input: HTMLInputElement): number | null | string => {
    if (!input.value.trim()) return null;
    const parsed = parseDate(input.value);
    return parsed.ok ? toDay(parsed.value) : parsed.error;
  };

  const dday = (): void => {
    const day = dayOf(target);
    if (day === null) { ddayResult.replaceChildren(); sayDday('날짜를 고르면 오늘과 비교합니다.'); return; }
    if (typeof day === 'string') { ddayResult.replaceChildren(); sayDday(day, 'error'); return; }
    const rows: Array<[string, string]> = [
      ['D-day', ddayLabel(today, day)],
      ['날짜', formatWithWeekday(day)],
    ];
    const first = countFirst.checked;
    if (day <= today) {
      const count = elapsed(day, today, first);
      rows.push(['오늘은', first ? `${comma(count)}일째` : `${comma(count)}일 지남`]);
    } else {
      rows.push(['남은 날', `${comma(day - today)}일`]);
    }
    const n = Number(nth.value);
    if (Number.isInteger(n) && n >= 1 && n <= 3_650_000) {
      const at = first ? nthDay(day, n) : day + n;
      const year = fromDay(at).y;
      if (year >= 1 && year <= 9999) rows.push([first ? `${comma(n)}일째 되는 날` : `${comma(n)}일 뒤`, formatWithWeekday(at)]);
    }
    ddayResult.replaceChildren(resultList(rows, sayDday));
    sayDday(first ? '그날을 1일로 셌습니다 (기념일 100일 방식).' : '그날 다음 날을 1일로 셌습니다.');
  };

  const shifted = (): void => {
    const day = dayOf(from);
    if (day === null) { shiftResult.replaceChildren(); sayShift('시작일을 고르세요.'); return; }
    if (typeof day === 'string') { shiftResult.replaceChildren(); sayShift(day, 'error'); return; }
    const n = Number(amount.value);
    if (!amount.value.trim() || !Number.isInteger(n)) { shiftResult.replaceChildren(); sayShift('더할 값은 정수로 적어 주세요 (빼려면 음수).', 'error'); return; }
    const which = unit.value as Unit;
    const result = shift(fromDay(day), n, which, holidays);
    if (!result.ok) { shiftResult.replaceChildren(); sayShift(result.error, 'error'); return; }
    const rows: Array<[string, string]> = [
      [`${n >= 0 ? '+' : ''}${comma(n)}${UNIT_NAMES[which]}`, formatWithWeekday(result.value.day)],
      ['시작일', formatWithWeekday(day)],
      ['달력일 차이', `${comma(result.value.day - day)}일`],
    ];
    shiftResult.replaceChildren(resultList(rows, sayShift));
    if (result.value.clamped) sayShift('그 달에 같은 날이 없어 말일로 당겼습니다.', 'error');
    else if (which === 'business') sayShift('시작일은 세지 않고 다음 영업일부터 셉니다. 주말과 공휴일을 건너뛰었습니다.');
    else sayShift('');
  };

  const span = (): void => {
    spanHolidays.replaceChildren();
    const first = dayOf(a);
    const second = dayOf(b);
    if (first === null || second === null) { spanResult.replaceChildren(); saySpan('두 날짜를 고르세요.'); return; }
    if (typeof first === 'string') { spanResult.replaceChildren(); saySpan(first, 'error'); return; }
    if (typeof second === 'string') { spanResult.replaceChildren(); saySpan(second, 'error'); return; }
    const s = between(first, second, { includeStart: includeStart.checked, includeEnd: includeEnd.checked }, holidays);
    const rows: Array<[string, string]> = [
      ['달력일', `${comma(s.calendar)}일`],
      ['기간', `${formatYmd(s.ymd)} (${comma(s.weeks[0])}주 ${s.weeks[1]}일)`],
      ['평일 (월–금)', `${comma(s.weekdays)}일`],
      ['주말', `${comma(s.weekends)}일`],
      ['평일 공휴일', `${comma(s.holidays)}일`],
      ['영업일', `${comma(s.business)}일`],
    ];
    spanResult.replaceChildren(resultList(rows, saySpan));

    const listed: string[] = [];
    let more = 0;
    for (let day = s.first; day <= s.last; day++) {
      const name = holidays.name(day);
      if (name === undefined) continue;
      if (listed.length < LIST_LIMIT) listed.push(`${formatWithWeekday(day)} ${name}`);
      else more++;
    }
    spanHolidays.replaceChildren(...listed.map(text => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }));
    if (more) {
      const li = document.createElement('li');
      li.textContent = `… 외 ${comma(more)}일`;
      spanHolidays.append(li);
    }
    const counted = s.calendar > 0
      ? `${formatWithWeekday(s.first)}부터 ${formatWithWeekday(s.last)}까지 셌습니다.`
      : '센 날이 없습니다.';
    saySpan(`${s.reversed ? '끝나는 날이 앞이라 뒤집어 셌습니다. ' : ''}${counted} 주말과 겹친 공휴일은 주말로만 셉니다.`);
  };

  const all = (): void => { readHolidays(); dday(); shifted(); span(); };
  holidayText.addEventListener('input', all);
  fixed.addEventListener('change', all);
  for (const input of [target, nth]) input.addEventListener('input', dday);
  countFirst.addEventListener('change', dday);
  for (const input of [from, amount]) input.addEventListener('input', shifted);
  unit.addEventListener('change', shifted);
  for (const input of [a, b]) input.addEventListener('input', span);
  for (const input of [includeStart, includeEnd]) input.addEventListener('change', span);

  all();
  return tool;
}
