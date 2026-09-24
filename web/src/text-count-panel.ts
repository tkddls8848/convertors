/**
 * 글자 수 세기 화면.
 *
 * 치는 대로 다시 센다. 한 번 세는 데 글 전체를 훑으므로 멈출 때까지 잠깐 기다렸다
 * 센다 — 긴 글을 붙여 넣고 칠 때마다 화면이 굳지 않게.
 */
import { decodeText, ENCODING_LIMITS, ENCODING_NAMES } from './encoding';
import { reason } from './errors';
import { comma, filePicker, need, statusLine, toolSection } from './kit';
import { countText, MANUSCRIPT } from './text-count';

const WAIT_MS = 150;

export function textCountTool(): HTMLElement {
  const tool = toolSection('conv-text-count', `
    <h2>글자 수 세기</h2>
    <p class="conv-note">붙여 넣거나 파일을 열면 치는 대로 셉니다. 글자는 눈에 보이는 한 글자 단위로 셉니다(이모지 👍🏽 도 한 글자).
      <strong>제출처마다 세는 규칙이 다릅니다</strong> — 줄바꿈을 넣는지, 바이트를 어떻게 세는지 요강을 확인하세요.
      원고지 매수는 문단마다 한 칸 들여 쓰고 한 글자에 한 칸으로 셈한 <strong>추정</strong>입니다.</p>
    <label class="conv-drop" for="text-count-file">
      <input id="text-count-file" type="file" accept=".txt,.md,.csv,.tsv,.json,.log,.srt,.html,text/*" />
      <span>텍스트 파일을 고르거나 여기에 끌어다 놓으세요 (선택)</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <label class="conv-label" for="text-count-input">셀 글</label>
    <textarea id="text-count-input" class="conv-input" rows="12" spellcheck="false" placeholder="여기에 글을 붙여 넣으세요"></textarea>
    <div class="conv-table-wrap"><table class="conv-table text-count-table">
      <thead><tr><th>항목</th><th class="num">수</th><th>설명</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <ul class="conv-notes text-count-notes"></ul>
  `);

  const input = need<HTMLInputElement>(tool, '#text-count-file');
  const say = statusLine(need(tool, '.conv-status'));
  const area = need<HTMLTextAreaElement>(tool, '#text-count-input');
  const tbody = need<HTMLElement>(tool, '.text-count-table tbody');
  const notes = need<HTMLElement>(tool, '.text-count-notes');

  const update = (): void => {
    const result = countText(area.value);
    const pages = result.manuscript.pages;
    const rows: Array<[string, string, string]> = [
      ['공백 포함', comma(result.withSpaces), '띄어쓰기는 넣고 줄바꿈은 뺀 수'],
      ['공백 포함 (줄바꿈까지)', comma(result.all), '줄바꿈 하나를 한 글자로'],
      ['공백 제외', comma(result.noSpaces), '띄어쓰기·탭·줄바꿈을 모두 뺀 수'],
      ['한글 음절', comma(result.hangul), '가–힣 (자모만 있는 ㄱ·ㅏ 는 넣지 않음)'],
      ['단어', comma(result.words), '띄어쓰기로 나눈 덩이'],
      ['줄', comma(result.lines), '끝의 줄바꿈 하나는 줄로 세지 않음'],
      ['문단', comma(result.paragraphs), '빈 줄로 나눈 덩이'],
      ['바이트 (UTF-8)', comma(result.utf8Bytes), '한글 3바이트 · 영문 1바이트'],
      ['바이트 (한글 2·영문 1)', comma(result.cp949Bytes), 'CP949(EUC-KR) 셈법'],
      ['200자 원고지 (추정)', pages ? `${Math.ceil(pages)}장` : '0장',
        `${comma(result.manuscript.rows)}줄 ÷ ${MANUSCRIPT.rows}줄 = ${pages.toFixed(1)}장 · 줄바꿈마다 새 문단으로 봄`],
    ];
    tbody.replaceChildren(...rows.map(([label, value, note]) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = label;
      const number = document.createElement('td');
      number.className = 'num';
      number.textContent = value;
      const explain = document.createElement('td');
      explain.textContent = note;
      tr.append(th, number, explain);
      return tr;
    }));

    const lines: string[] = [];
    if (result.notInCp949.length) {
      const sample = result.notInCp949.slice(0, 20).join(' ');
      lines.push(`CP949 로 적을 수 없는 글자 ${result.notInCp949.length}종: ${sample}${result.notInCp949.length > 20 ? ' …' : ''} — 바이트 셈에는 2바이트로 넣었지만, CP949 만 받는 곳에서는 깨지거나 ? 가 됩니다.`);
    }
    if (!result.graphemeAware) lines.push('이 브라우저는 글자 단위 나누기를 못 해 코드 포인트로 셌습니다. 이모지·결합 문자는 실제보다 많게 셀 수 있습니다.');
    notes.replaceChildren(...lines.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  area.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, WAIT_MS);
  });

  filePicker(input, files => {
    const file = files[0];
    if (!file) return;
    void (async () => {
      if (file.size > ENCODING_LIMITS.bytes) { say('파일이 64MB를 넘습니다.', 'error'); return; }
      try {
        say(`${file.name} 읽는 중…`);
        const result = decodeText(new Uint8Array(await file.arrayBuffer()));
        area.value = result.text;
        update();
        say(`${file.name} — ${ENCODING_NAMES[result.encoding]}${result.certain ? '' : ' 로 추정해'} 읽었습니다.${result.certain ? '' : ' 글자가 깨져 보이면 셈도 틀립니다.'}`,
          result.certain ? 'ok' : 'error');
      } catch (error) { say(reason(error), 'error'); }
    })();
  });

  update();
  return tool;
}
