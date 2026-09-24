/**
 * 개인정보 가리기 화면.
 *
 * 찾은 것을 보여 줄 때도 **원문은 보이지 않는다** — 가린 모양과 줄 번호만 보인다.
 * 화면을 공유하거나 캡처하는 자리에서 쓰는 도구라서다.
 *
 * 파일은 읽은 인코딩 그대로 돌려준다. CP949 CSV 를 UTF-8 로 바꿔 주면 엑셀에서
 * 깨지고, 그러면 사람은 원본을 다시 쓰게 된다. 가린 모양(*, [주민번호])은 CP949 에
 * 모두 있으므로 원본이 CP949 로 읽혔다면 CP949 로 다시 적을 수 있다. UTF-16 은 적을
 * 수 없어 BOM 붙인 UTF-8 로 낸다.
 */
import { zipSync, type Zippable } from 'fflate';

import { decodeText, encodeText, ENCODING_LIMITS, ENCODING_NAMES, type DecodeResult } from './encoding';
import { reason } from './errors';
import { comma, filePicker, need, outputs, size, statusLine, stem, toolSection, yieldToPaint } from './kit';
import { redact, REDACT_KINDS, type MaskStyle, type RedactKind, type RedactResult } from './redact';

const MAX_FILES = 200;
const PREVIEW_CHARS = 20_000;
const TABLE_ROWS = 500;

interface Loaded { name: string; decoded: DecodeResult }

/** 원래 인코딩으로 다시 적는다. 못 하면 BOM 붙인 UTF-8 로 물러나고 그 까닭을 돌려준다. */
function reencode(text: string, decoded: DecodeResult): { bytes: Uint8Array; note: string } {
  if (decoded.encoding === 'euc-kr') {
    try { return { bytes: encodeText(text, { encoding: 'euc-kr', bom: false, newline: 'keep', replaceMissing: false }).bytes, note: 'CP949' }; }
    catch { /* 아래로 물러난다 */ }
    return { bytes: encodeText(text, { encoding: 'utf-8', bom: true, newline: 'keep', replaceMissing: false }).bytes, note: 'UTF-8(BOM) — CP949 로 적을 수 없는 글자가 있어서' };
  }
  if (decoded.encoding !== 'utf-8') {
    return { bytes: encodeText(text, { encoding: 'utf-8', bom: true, newline: 'keep', replaceMissing: false }).bytes, note: 'UTF-8(BOM) — UTF-16 으로는 다시 적지 않습니다' };
  }
  return { bytes: encodeText(text, { encoding: 'utf-8', bom: decoded.hadBom, newline: 'keep', replaceMissing: false }).bytes, note: decoded.hadBom ? 'UTF-8(BOM)' : 'UTF-8' };
}

function redactedName(name: string): string {
  const extension = /(?<=.)\.[^./\\]*$/.exec(name)?.[0] ?? '.txt';
  return `${stem(name)}-가림${extension}`;
}

export function redactTool(): HTMLElement {
  const kindBoxes = REDACT_KINDS.map(item => `
    <label><input type="checkbox" data-kind="${item.kind}"${item.defaultOn ? ' checked' : ''} /> ${item.label}${item.defaultOn ? '' : ' (잘못 잡기 쉬워 기본 꺼짐)'}</label>`).join('');

  const tool = toolSection('conv-redact', `
    <h2>개인정보 가리기</h2>
    <p class="conv-note">글이나 텍스트 파일(TXT·CSV·TSV·MD·JSON·LOG)에서 주민번호·전화번호·이메일·카드번호 등을 찾아 * 로 가립니다.
      <strong>숫자와 글자의 모양으로만 찾습니다.</strong> 이름·주소·띄어 쓰거나 한글로 적은 번호는 찾지 못하고,
      모양이 같은 다른 번호를 가릴 수도 있습니다 — <strong>보내기 전에 결과를 꼭 읽어 보세요.</strong>
      그림·PDF·HWP·HWPX·엑셀(XLSX) 파일 안은 보지 못합니다. 원본 파일은 바뀌지 않습니다.</p>
    <fieldset>
      <legend>찾을 것</legend>
      ${kindBoxes}
    </fieldset>
    <div class="conv-form">
      <label for="redact-style">가리는 방법</label>
      <select id="redact-style">
        <option value="partial" selected>일부만 (900101-1******, 010-****-5678)</option>
        <option value="full">전부 * 로 (******-*******)</option>
        <option value="tag">표시로 바꾸기 ([주민번호], [전화번호])</option>
      </select>
    </div>
    <label class="conv-label" for="redact-input">붙여 넣은 글</label>
    <textarea id="redact-input" class="conv-input" rows="10" spellcheck="false" placeholder="가릴 글을 붙여 넣으세요"></textarea>
    <div class="conv-actions">
      <button type="button" class="conv-download" data-action="text">붙여 넣은 글 가리기</button>
    </div>
    <label class="conv-drop" for="redact-file">
      <input id="redact-file" type="file" multiple accept=".txt,.csv,.tsv,.md,.json,.log,.xml,.srt,.ini,.yml,.yaml,text/*" />
      <span>또는 텍스트 파일을 고르거나 끌어다 놓으세요 (여러 개 가능, 합계 64MB)</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <ul class="conv-notes redact-counts"></ul>
    <pre class="conv-preview redact-preview" hidden></pre>
    <div class="conv-table-wrap" hidden><table class="conv-table redact-table">
      <thead><tr><th>파일</th><th class="num">줄</th><th>종류</th><th>가린 모양</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <div class="conv-outputs conv-actions" aria-label="저장 결과"></div>
  `);

  const say = statusLine(need(tool, '.conv-status'));
  const style = need<HTMLSelectElement>(tool, '#redact-style');
  const area = need<HTMLTextAreaElement>(tool, '#redact-input');
  const counts = need<HTMLElement>(tool, '.redact-counts');
  const preview = need<HTMLElement>(tool, '.redact-preview');
  const tableWrap = need<HTMLElement>(tool, '.conv-table-wrap');
  const tbody = need<HTMLElement>(tool, '.redact-table tbody');
  const out = outputs(need(tool, '.conv-outputs'));

  /** 마지막으로 가린 대상. 옵션을 바꾸면 같은 대상을 다시 가린다. */
  let source: { kind: 'text' } | { kind: 'files'; items: Loaded[] } | null = null;

  const clear = (): void => {
    out.clear();
    counts.replaceChildren();
    preview.hidden = true;
    preview.textContent = '';
    tbody.replaceChildren();
    tableWrap.hidden = true;
  };

  const options = (): { kinds: RedactKind[]; style: MaskStyle } => ({
    kinds: Array.from(tool.querySelectorAll<HTMLInputElement>('input[data-kind]'))
      .filter(box => box.checked).map(box => box.dataset['kind'] as RedactKind),
    style: style.value as MaskStyle,
  });

  const labelOf = (kind: RedactKind): string => REDACT_KINDS.find(item => item.kind === kind)!.label;

  const show = (results: Array<{ name: string; result: RedactResult }>): number => {
    const totals = new Map<RedactKind, number>();
    let rows = 0;
    let total = 0;
    for (const { name, result } of results) {
      for (const finding of result.findings) {
        total++;
        totals.set(finding.kind, (totals.get(finding.kind) ?? 0) + 1);
        if (rows >= TABLE_ROWS) continue;
        rows++;
        const tr = document.createElement('tr');
        for (const [text, className] of [[name, ''], [comma(finding.line), 'num'], [labelOf(finding.kind), ''], [finding.masked, '']] as const) {
          const td = document.createElement('td');
          td.textContent = text;
          if (className) td.className = className;
          tr.append(td);
        }
        tbody.append(tr);
      }
    }
    tableWrap.hidden = total === 0;
    const lines = REDACT_KINDS.filter(item => totals.has(item.kind)).map(item => `${item.label}: ${comma(totals.get(item.kind)!)}개`);
    if (total > TABLE_ROWS) lines.push(`표에는 앞 ${comma(TABLE_ROWS)}개만 보입니다.`);
    counts.replaceChildren(...lines.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    const first = results[0];
    if (first) {
      preview.hidden = false;
      preview.textContent = first.result.text.slice(0, PREVIEW_CHARS) + (first.result.text.length > PREVIEW_CHARS ? '\n…' : '');
    }
    return total;
  };

  const runText = (): void => {
    clear();
    source = { kind: 'text' };
    const chosen = options();
    if (!chosen.kinds.length) { say('찾을 것을 하나 이상 고르세요.', 'error'); return; }
    if (!area.value) { say('가릴 글을 붙여 넣으세요.', 'error'); return; }
    const result = redact(area.value, chosen);
    const total = show([{ name: '붙여 넣은 글', result }]);
    out.add(result.text, '가린글.txt', 'text/plain;charset=utf-8');
    say(total ? `${comma(total)}곳을 가렸습니다. 아래 미리보기를 읽어 빠진 것이 없는지 확인하세요.` : '찾은 것이 없습니다. 이 도구가 모르는 모양일 수 있으니 직접 확인하세요.', total ? 'ok' : undefined);
  };

  const runFiles = async (items: Loaded[]): Promise<void> => {
    clear();
    source = { kind: 'files', items };
    const chosen = options();
    if (!chosen.kinds.length) { say('찾을 것을 하나 이상 고르세요.', 'error'); return; }
    say('찾는 중…');
    await yieldToPaint();
    const results = items.map(item => ({ name: item.name, result: redact(item.decoded.text, chosen) }));
    const total = show(results);
    const written = results.map((entry, index) => {
      const { bytes, note } = reencode(entry.result.text, items[index]!.decoded);
      return { name: redactedName(entry.name), bytes, note };
    });
    // 이름이 겹치면 ZIP 안에서 서로 덮어쓴다.
    const used = new Set<string>();
    for (const item of written) {
      const base = item.name;
      for (let n = 2; used.has(item.name); n++) item.name = base.replace(/(\.[^.]*)?$/, match => ` (${n})${match}`);
      used.add(item.name);
    }
    if (written.length > 1) {
      const zippable: Zippable = {};
      for (const item of written) zippable[item.name] = item.bytes;
      out.add(zipSync(zippable), '가린파일.zip', 'application/zip', `가린파일.zip 로 한꺼번에 내려받기 (${written.length}개)`);
    }
    for (const item of written) out.add(item.bytes, item.name, 'text/plain', `${item.name} 내려받기 (${size(item.bytes.length)} · ${item.note})`);
    const guessed = items.filter(item => !item.decoded.certain).map(item => item.name);
    const guessNote = guessed.length ? ` ${guessed.slice(0, 3).join(', ')}${guessed.length > 3 ? ' 등' : ''} 은 인코딩을 ${ENCODING_NAMES['euc-kr']} 로 추정해 읽었습니다.` : '';
    const summary = total ? `${items.length}개 파일에서 ${comma(total)}곳을 가렸습니다. 미리보기(첫 파일)를 읽어 확인하세요.` : `${items.length}개 파일에서 찾은 것이 없습니다.`;
    say(`${summary}${guessNote}`, guessed.length ? 'error' : total ? 'ok' : undefined);
  };

  filePicker(need<HTMLInputElement>(tool, '#redact-file'), files => {
    void (async () => {
      if (files.length > MAX_FILES) { say(`파일은 ${MAX_FILES}개까지 넣을 수 있습니다.`, 'error'); return; }
      const total = files.reduce((sum, file) => sum + file.size, 0);
      if (total > ENCODING_LIMITS.bytes) { say('파일은 합계 64MB까지 넣을 수 있습니다.', 'error'); return; }
      try {
        say('파일 읽는 중…');
        const items: Loaded[] = [];
        for (const file of files) items.push({ name: file.name, decoded: decodeText(new Uint8Array(await file.arrayBuffer())) });
        await runFiles(items);
      } catch (error) { clear(); say(reason(error), 'error'); }
    })();
  });

  need<HTMLButtonElement>(tool, '[data-action="text"]').addEventListener('click', runText);
  area.addEventListener('input', () => { if (source?.kind === 'text') { clear(); source = null; } });
  const rerun = (): void => {
    if (!source) return;
    if (source.kind === 'text') runText();
    else void runFiles(source.items).catch(error => { clear(); say(reason(error), 'error'); });
  };
  style.addEventListener('change', rerun);
  tool.querySelectorAll<HTMLInputElement>('input[data-kind]').forEach(box => box.addEventListener('change', rerun));

  return tool;
}
