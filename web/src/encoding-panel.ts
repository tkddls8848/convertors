/**
 * 인코딩 변환 화면.
 *
 * 읽은 인코딩이 **추정**일 때 그렇게 적는 것이 이 화면의 일이다. CSV 한 줄이
 * 깨진 채로 성공이라 말하면 그 파일은 어디선가 다시 깨진다.
 */
import {
  decodeText, encodeText, ENCODING_LIMITS, ENCODING_NAMES,
  type Newline, type WriteEncoding,
} from './encoding';
import { reason } from './errors';

export function encodingTool(): HTMLElement {
  const tool = document.createElement('section');
  tool.className = 'conv-tool conv-encoding';
  tool.innerHTML = `
    <h2>인코딩 변환 (CSV·텍스트)</h2>
    <p class="conv-note">엑셀이 만든 CP949 CSV 와 UTF-8 을 서로 바꿉니다. 줄바꿈(CRLF·LF)과 BOM 도 함께 맞춥니다.
      최대 64MB. <strong>파일의 인코딩은 파일 안에 적혀 있지 않아</strong> BOM 이 없으면 추정입니다 — 미리보기로 확인하세요.</p>
    <label class="conv-drop" for="conv-enc-file">
      <input id="conv-enc-file" type="file" accept=".csv,.txt,.tsv,.md,.json,.xml,.srt,text/*" />
      <span>CSV·텍스트 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>
    <fieldset class="enc-controls" disabled>
      <legend>내보내기</legend>
      <p class="enc-detected"></p>
      <div class="conv-actions">
        <label>인코딩
          <select class="enc-target">
            <option value="utf-8">UTF-8</option>
            <option value="euc-kr">CP949 (EUC-KR)</option>
          </select>
        </label>
        <label>BOM <select class="enc-bom">
          <option value="yes" selected>붙이기 (엑셀용)</option>
          <option value="no">붙이지 않기</option>
        </select></label>
        <label>줄바꿈 <select class="enc-newline">
          <option value="keep" selected>그대로</option>
          <option value="crlf">CRLF (윈도우)</option>
          <option value="lf">LF (macOS·리눅스)</option>
        </select></label>
      </div>
      <label class="enc-replace"><input type="checkbox"> CP949 에 없는 글자를 <code>?</code> 로 바꿔 저장</label>
      <div class="conv-actions">
        <button type="button" class="conv-download" data-action="save">변환해 내려받기</button>
      </div>
      <pre class="conv-preview enc-preview"></pre>
    </fieldset>
    <div class="enc-outputs conv-actions" aria-label="저장 결과"></div>
  `;

  const input = tool.querySelector<HTMLInputElement>('#conv-enc-file')!;
  const drop = tool.querySelector<HTMLElement>('.conv-drop')!;
  const status = tool.querySelector<HTMLElement>('.conv-status')!;
  const controls = tool.querySelector<HTMLFieldSetElement>('.enc-controls')!;
  const detected = tool.querySelector<HTMLElement>('.enc-detected')!;
  const target = tool.querySelector<HTMLSelectElement>('.enc-target')!;
  const bom = tool.querySelector<HTMLSelectElement>('.enc-bom')!;
  const newline = tool.querySelector<HTMLSelectElement>('.enc-newline')!;
  const replace = tool.querySelector<HTMLInputElement>('.enc-replace input')!;
  const preview = tool.querySelector<HTMLElement>('.enc-preview')!;
  const outputs = tool.querySelector<HTMLElement>('.enc-outputs')!;

  let text = '';
  let name = 'converted.txt';
  let urls: string[] = [];

  const message = (value: string, error = false): void => {
    status.textContent = value;
    status.dataset['tone'] = error ? 'error' : '';
  };
  const clearOutputs = (): void => {
    urls.forEach(url => URL.revokeObjectURL(url));
    urls = [];
    outputs.replaceChildren();
  };
  const sync = (): void => {
    // BOM 은 UTF-8 에만 있다. CP949 파일에 붙이면 그 세 바이트가 글자로 읽힌다.
    bom.disabled = target.value !== 'utf-8';
    tool.querySelector<HTMLElement>('.enc-replace')!.hidden = target.value !== 'euc-kr';
  };

  const load = (file: File): void => {
    void (async () => {
      clearOutputs();
      if (file.size > ENCODING_LIMITS.bytes) { message('파일이 64MB를 넘습니다.', true); controls.disabled = true; return; }
      try {
        message(`${file.name} 읽는 중…`);
        const result = decodeText(new Uint8Array(await file.arrayBuffer()));
        text = result.text;
        name = file.name;
        const crlf = /\r\n/.test(text);
        detected.textContent = [
          `읽은 인코딩: ${ENCODING_NAMES[result.encoding]}`,
          result.certain ? (result.hadBom ? 'BOM 이 있어 확실합니다' : '확실합니다') : '추정입니다 — 아래 미리보기를 확인하세요',
          `줄바꿈: ${crlf ? 'CRLF' : 'LF'}`,
        ].join(' · ');
        // 추정일 때는 반대쪽으로 골라 두는 것이 사람이 바라는 바다.
        target.value = result.encoding === 'euc-kr' ? 'utf-8' : 'euc-kr';
        sync();
        preview.textContent = text.slice(0, 4000) + (text.length > 4000 ? '\n…' : '');
        controls.disabled = false;
        message(`${file.name} 를 읽었습니다.`);
      } catch (error) {
        controls.disabled = true;
        message(reason(error), true);
      }
    })();
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) load(file);
    input.value = '';
  });
  for (const type of ['dragenter', 'dragover'] as const) drop.addEventListener(type, event => {
    event.preventDefault();
    drop.dataset['over'] = 'yes';
  });
  drop.addEventListener('dragleave', () => delete drop.dataset['over']);
  drop.addEventListener('drop', event => {
    event.preventDefault();
    delete drop.dataset['over'];
    const file = event.dataTransfer?.files?.[0];
    if (file) load(file);
  });
  for (const control of [target, bom, newline, replace]) control.addEventListener('change', () => { sync(); clearOutputs(); });

  controls.addEventListener('click', event => {
    if (!(event.target as HTMLElement).closest('[data-action="save"]')) return;
    clearOutputs();
    try {
      const encoding = target.value as WriteEncoding;
      const result = encodeText(text, {
        encoding,
        bom: encoding === 'utf-8' && bom.value === 'yes',
        newline: newline.value as Newline,
        replaceMissing: replace.checked,
      });
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'text/plain' }));
      urls.push(url);
      const link = document.createElement('a');
      link.href = url;
      const suffix = encoding === 'utf-8' ? 'utf8' : 'cp949';
      link.download = name.replace(/(\.[^.]+)?$/, match => `-${suffix}${match || '.txt'}`);
      link.textContent = `${link.download} 내려받기`;
      outputs.append(link);
      message(result.missing.length
        ? `변환했습니다. CP949 에 없는 글자 ${result.missing.length}종을 ? 로 바꿨습니다: ${result.missing.slice(0, 10).join(' ')}`
        : '변환했습니다. 아래 링크를 눌러 내려받으세요.', result.missing.length > 0);
    } catch (error) {
      clearOutputs();
      message(reason(error), true);
    }
  });

  sync();
  return tool;
}
