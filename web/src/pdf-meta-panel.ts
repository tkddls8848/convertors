/**
 * PDF 문서 정보 보기·지우기 화면.
 *
 * 남에게 보내기 전에 "작성자: 홍길동(인사팀)", "만든 프로그램: 한글 2014" 같은
 * 것이 따라가는지 보고 고치거나 지운다. 무엇을 지우고 무엇을 **못** 지우는지
 * 화면에 적는다 — 다 지웠다고 믿고 보냈는데 쪽 안의 글자나 첨부 파일 이름에
 * 남아 있으면 이 도구가 해를 끼친 것이다.
 */
import { reason } from './errors';
import { filePicker, need, outputs, size, statusLine, stem, toolSection, yieldToPaint } from './kit';
import { MAX_PDF_BYTES } from './pdf';
import { clearMeta, FIELD_LABELS, readMeta, TEXT_FIELDS, writeMeta, type PdfMeta, type TextValues } from './pdf-meta';

export function pdfMetaTool(): HTMLElement {
  const tool = toolSection('conv-pdf-meta', `
    <h2>PDF 문서 정보 보기·지우기</h2>
    <p class="conv-note">PDF 에 적힌 제목·작성자·만든 프로그램·날짜를 보고, 고치거나 한 번에 지웁니다. 최대 64MB · 1,000쪽.
      파일은 이 컴퓨터를 벗어나지 않습니다.</p>
    <ul class="conv-notes">
      <li>지우는 것: 문서 정보(Info) 항목 전부와 XMP 메타데이터. 저장할 때 파일을 통째로 다시 쓰므로 <strong>앞서 덧붙여 고친 판(이전 수정본)과 가리키는 곳 없는 옛 정보도 함께 사라집니다.</strong></li>
      <li><strong>지우지 않는 것:</strong> 쪽 안의 글자(머리말·꼬리말에 적힌 이름 등), 첨부 파일의 이름과 내용, 그림 파일 안의 EXIF, 양식 칸에 적힌 값, 주석 작성자.</li>
      <li>원본에 전자서명이 있었다면 저장하면서 그 서명은 무효가 됩니다. 암호가 걸린 PDF 는 열지 않습니다.</li>
    </ul>
    <label class="conv-drop" for="meta-file">
      <input id="meta-file" type="file" accept=".pdf,application/pdf" />
      <span>PDF 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <div class="conv-table-wrap meta-facts" hidden>
      <table class="conv-table">
        <caption class="conv-note">파일에서 읽은 것</caption>
        <tbody class="meta-rows"></tbody>
      </table>
    </div>
    <fieldset class="meta-controls" disabled>
      <legend>문서 정보 고치기</legend>
      <div class="conv-form">
        ${TEXT_FIELDS.map(key => `
          <label for="meta-${key}">${FIELD_LABELS[key]}</label>
          <input id="meta-${key}" type="text" class="conv-wide" data-field="${key}" />`).join('')}
      </div>
      <p class="conv-note">칸을 비우면 그 항목을 지웁니다. 고쳐 저장할 때도 XMP 는 떼어 냅니다 — 남겨 두면 뷰어가 XMP 의 옛 값을 먼저 보여 줍니다. 날짜는 그대로 둡니다.</p>
      <div class="conv-actions">
        <button type="button" class="conv-download" data-action="save">고친 대로 저장</button>
        <button type="button" class="conv-download" data-action="clear">모두 지우고 저장</button>
      </div>
    </fieldset>
    <div class="conv-outputs conv-actions" aria-label="저장 결과"></div>
  `);

  const input = need<HTMLInputElement>(tool, '#meta-file');
  const say = statusLine(need(tool, '.conv-status'));
  const out = outputs(need(tool, '.conv-outputs'));
  const controls = need<HTMLFieldSetElement>(tool, '.meta-controls');
  const facts = need<HTMLElement>(tool, '.meta-facts');
  const rows = need<HTMLElement>(tool, '.meta-rows');
  const fields = [...tool.querySelectorAll<HTMLInputElement>('input[data-field]')];

  let source: { name: string; bytes: Uint8Array } | null = null;
  let busy = false;

  const render = (): void => {
    controls.disabled = busy || !source;
    input.disabled = busy;
  };

  filePicker(input, files => void open(files[0]!), () => busy);

  async function open(file: File): Promise<void> {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { say('PDF 파일만 열 수 있습니다.', 'error'); return; }
    if (file.size > MAX_PDF_BYTES) { say(`파일이 너무 큽니다(${size(file.size)}). 64MB까지 읽습니다.`, 'error'); return; }
    busy = true; render(); out.clear();
    try {
      say(`${file.name} 읽는 중…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const meta = await readMeta(bytes);
      source = { name: file.name, bytes };
      show(meta);
      const filled = Object.values(meta.text).filter(Boolean).length;
      say(`${file.name} · ${meta.pages}쪽 · 문서 정보 ${filled}개 항목${meta.hasXmp ? ' · XMP 있음' : ''}.`, 'ok');
    } catch (error) {
      source = null;
      facts.hidden = true;
      say(reason(error), 'error');
    } finally { busy = false; render(); }
  }

  function show(meta: PdfMeta): void {
    for (const field of fields) field.value = meta.text[field.dataset['field'] as keyof TextValues] ?? '';
    const lines: [string, string][] = [
      ...TEXT_FIELDS.map(key => [FIELD_LABELS[key], meta.text[key] || '—'] as [string, string]),
      ['만든 날짜', when(meta.creationDate)],
      ['고친 날짜', when(meta.modificationDate)],
      ['그 밖의 정보 항목', meta.otherKeys.length ? meta.otherKeys.join(', ') : '—'],
      ['쪽 수', String(meta.pages)],
      ['PDF 판', meta.version],
      ['XMP 메타데이터', meta.hasXmp ? '있음 — 지우기가 함께 지웁니다' : '없음'],
      ['자바스크립트', meta.javaScript ? '있음 (이 도구는 건드리지 않습니다)' : '없음'],
      ['첨부 파일', meta.attachments ? `${meta.attachments}개 (이름·내용은 지우지 않습니다)` : '없음'],
      ['양식 칸', meta.formFields ? `${meta.formFields}개 (적힌 값은 지우지 않습니다)` : '없음'],
    ];
    rows.replaceChildren(...lines.map(([label, text]) => {
      const row = document.createElement('tr');
      const head = document.createElement('th');
      head.scope = 'row';
      head.textContent = label;
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(head, cell);
      return row;
    }));
    facts.hidden = false;
  }

  controls.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset['action'];
    if (!action || busy || !source) return;
    void run(action === 'clear');
  });

  async function run(clear: boolean): Promise<void> {
    if (!source) return;
    const picked = source;
    busy = true; render(); out.clear();
    try {
      say(clear ? '문서 정보를 지우는 중…' : '문서 정보를 고쳐 쓰는 중…');
      await yieldToPaint();
      const values = Object.fromEntries(fields.map(field => [field.dataset['field']!, field.value])) as Partial<TextValues>;
      const bytes = clear ? await clearMeta(picked.bytes) : await writeMeta(picked.bytes, values);
      out.add(bytes, `${stem(picked.name)}-${clear ? 'clean' : 'meta'}.pdf`, 'application/pdf');
      // 이어서 고치면 방금 저장한 파일에서 시작한다 — 표에 보이는 것과 같은 파일이다.
      source = { name: picked.name, bytes };
      // 저장한 것을 다시 읽어 보여 준다. 무엇이 남았는지는 결과 파일에서 확인해야 믿을 수 있다.
      show(await readMeta(bytes));
      say(`${clear ? '문서 정보와 XMP 를 모두 지웠습니다' : '고친 대로 저장했습니다'}. 위 표는 저장한 파일을 다시 읽은 것입니다. 아래 링크를 눌러 내려받으세요.`, 'ok');
    } catch (error) {
      out.clear();
      say(reason(error), 'error');
    } finally { busy = false; render(); }
  }

  render();
  return tool;
}

function when(date: Date | undefined): string {
  if (!date) return '—';
  return date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}
