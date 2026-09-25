/**
 * QR 코드 만들기 화면.
 *
 * 무엇을 담을지 고르면 그 칸만 보인다. 적는 동안 미리보기와 내려받기(PNG·SVG)를
 * 새로 만든다. 라이브러리는 처음 그릴 때 한 번 받는다.
 *
 * 흔한 QR 사이트는 주소를 제 단축 URL 로 바꿔 담아 누가 찍었는지 센다. 여기서는
 * 적은 글 그대로를 담고, 만드는 일도 이 탭 안에서 끝난다 — 화면이 그렇게 적는다.
 */
import { reason } from './errors';
import { comma, need, outputs, size, statusLine, toolSection } from './kit';
import {
  QUIET_ZONE, buildMatrix, cellEdges, contrastWarning, mailtoPayload, matrixToSvg, smsPayload, telPayload, vcardPayload, wifiPayload,
  type Ecl, type QrFactory, type QrMatrix,
} from './qr';

type Kind = 'text' | 'wifi' | 'contact' | 'phone' | 'email';

let library: Promise<QrFactory> | undefined;
const loadLibrary = (): Promise<QrFactory> => {
  library ??= import('qrcode-generator').then(m => m.default as unknown as QrFactory);
  // 받다가 실패하면 다음에 다시 받도록 비운다.
  library.catch(() => { library = undefined; });
  return library;
};

export function qrTool(): HTMLElement {
  const tool = toolSection('conv-qr', `
    <h2>QR 코드 만들기</h2>
    <p class="conv-note">QR 코드는 <strong>이 브라우저에서 만듭니다.</strong> 적은 내용은 어디로도 보내지 않고, 단축 URL·추적 서버를 거치지 않아 적은 그대로 담깁니다.
      한글은 UTF-8 로 담습니다(대부분의 휴대전화 카메라가 읽지만 오래된 스캐너는 깨질 수 있습니다).</p>
    <p class="conv-note">인쇄할 때는 한 변 2cm 이상을 권합니다. 내용이 길수록 칸이 잘아집니다. <strong>쓰기 전에 휴대전화로 꼭 찍어 보세요.</strong></p>

    <div class="conv-form">
      <label for="qr-kind">담을 것</label>
      <select id="qr-kind">
        <option value="text">텍스트·주소</option>
        <option value="wifi">Wi-Fi</option>
        <option value="contact">연락처</option>
        <option value="phone">전화·문자</option>
        <option value="email">이메일</option>
      </select>
    </div>

    <fieldset data-kind="text">
      <legend>텍스트·주소</legend>
      <label for="qr-text" class="conv-label">QR 코드에 담을 글이나 주소</label>
      <textarea id="qr-text" class="conv-input conv-wide" rows="4" spellcheck="false" placeholder="https://… 또는 아무 글"></textarea>
    </fieldset>

    <fieldset data-kind="wifi" hidden>
      <legend>Wi-Fi</legend>
      <div class="conv-form">
        <label for="qr-ssid">네트워크 이름(SSID)</label><input id="qr-ssid" type="text" autocomplete="off" />
        <label for="qr-security">보안</label>
        <select id="qr-security"><option value="WPA">WPA/WPA2/WPA3</option><option value="WEP">WEP</option><option value="nopass">없음</option></select>
        <label for="qr-password">암호</label><input id="qr-password" type="text" autocomplete="off" spellcheck="false" />
        <label for="qr-hidden">숨긴 네트워크</label><div><input id="qr-hidden" type="checkbox" /></div>
      </div>
      <p class="conv-note">암호가 그림 안에 그대로 들어갑니다. 찍을 수 있는 사람은 누구나 암호를 알게 됩니다.</p>
    </fieldset>

    <fieldset data-kind="contact" hidden>
      <legend>연락처 (vCard 3.0)</legend>
      <div class="conv-form">
        <label for="qr-name">이름</label><input id="qr-name" type="text" autocomplete="off" />
        <label for="qr-org">회사</label><input id="qr-org" type="text" autocomplete="off" />
        <label for="qr-title">직함</label><input id="qr-title" type="text" autocomplete="off" />
        <label for="qr-tel">전화</label><input id="qr-tel" type="tel" autocomplete="off" />
        <label for="qr-email">이메일</label><input id="qr-email" type="email" autocomplete="off" />
        <label for="qr-address">주소</label><input id="qr-address" type="text" class="conv-wide" autocomplete="off" />
        <label for="qr-url">웹사이트</label><input id="qr-url" type="url" class="conv-wide" autocomplete="off" />
      </div>
    </fieldset>

    <fieldset data-kind="phone" hidden>
      <legend>전화·문자</legend>
      <div class="conv-form">
        <label for="qr-phone">전화번호</label><input id="qr-phone" type="tel" autocomplete="off" placeholder="010-1234-5678" />
        <label for="qr-sms">문자 내용</label><input id="qr-sms" type="text" class="conv-wide" autocomplete="off" placeholder="비우면 전화 걸기, 적으면 문자 보내기" />
      </div>
    </fieldset>

    <fieldset data-kind="email" hidden>
      <legend>이메일</legend>
      <div class="conv-form">
        <label for="qr-to">받는 사람</label><input id="qr-to" type="email" autocomplete="off" />
        <label for="qr-subject">제목</label><input id="qr-subject" type="text" class="conv-wide" autocomplete="off" />
        <label for="qr-body">본문</label><textarea id="qr-body" class="conv-wide" rows="3"></textarea>
      </div>
    </fieldset>

    <fieldset>
      <legend>모양</legend>
      <div class="conv-form">
        <label for="qr-ecl">오류 정정</label>
        <select id="qr-ecl">
          <option value="L">L (7% — 가장 작다)</option>
          <option value="M" selected>M (15% — 보통)</option>
          <option value="Q">Q (25%)</option>
          <option value="H">H (30% — 가운데 로고를 얹을 때)</option>
        </select>
        <label for="qr-fg">색</label>
        <div><input id="qr-fg" type="color" value="#000000" aria-label="점 색" /> 점 · <input id="qr-bg" type="color" value="#ffffff" aria-label="바탕 색" /> 바탕</div>
        <label for="qr-pixels">PNG 크기</label>
        <select id="qr-pixels"><option value="256">256px</option><option value="512">512px</option><option value="1024" selected>1024px</option><option value="2048">2048px</option></select>
      </div>
    </fieldset>

    <p class="conv-status qr-status" role="status" aria-live="polite"></p>
    <div class="qr-preview" hidden></div>
    <ul class="conv-notes qr-notes"></ul>
    <div class="conv-outputs conv-actions qr-outputs" aria-label="내려받기"></div>
  `);

  const value = (id: string): string => need<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(tool, `#qr-${id}`).value;
  const kind = need<HTMLSelectElement>(tool, '#qr-kind');
  const say = statusLine(need(tool, '.qr-status'));
  const preview = need<HTMLElement>(tool, '.qr-preview');
  const notes = need<HTMLElement>(tool, '.qr-notes');
  const links = outputs(need(tool, '.qr-outputs'));
  let previewUrl = '';
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 같은 내용으로 다시 그리지 않는다 — 링크를 누르며 칸을 벗어날 때 change 가 한 번 더 온다.
  let drawn = '';

  const payload = (): string => {
    switch (kind.value as Kind) {
      case 'wifi': return wifiPayload({
        ssid: value('ssid'), password: value('password'),
        security: value('security') as 'WPA' | 'WEP' | 'nopass', hidden: need<HTMLInputElement>(tool, '#qr-hidden').checked,
      });
      case 'contact': return vcardPayload({
        name: value('name'), org: value('org'), title: value('title'), tel: value('tel'),
        email: value('email'), address: value('address'), url: value('url'),
      });
      case 'phone': {
        if (!value('phone').trim()) throw new Error('전화번호를 적어 주세요.');
        const message = value('sms');
        return message ? smsPayload(value('phone'), message) : telPayload(value('phone'));
      }
      case 'email': return mailtoPayload(value('to'), value('subject'), value('body'));
      default: return value('text').trim();
    }
  };

  const clear = (): void => {
    links.clear();
    notes.replaceChildren();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    preview.replaceChildren();
    preview.hidden = true;
  };

  const draw = async (): Promise<void> => {
    const mine = ++generation;
    let text: string;
    try {
      text = payload();
    } catch (error) {
      clear();
      drawn = '';
      say(reason(error));
      return;
    }
    if (!text) { clear(); drawn = ''; say('내용을 적으면 바로 그립니다.'); return; }
    const key = [text, value('ecl'), value('fg'), value('bg'), value('pixels')].join('\u0000');
    if (key === drawn) return;
    try {
      const qrcode = await loadLibrary();
      if (mine !== generation) return;
      const fg = value('fg');
      const bg = value('bg');
      const matrix = buildMatrix(qrcode, text, value('ecl') as Ecl);
      const svg = matrixToSvg(matrix.modules, { fg, bg });
      const png = await toPng(matrix, Number(value('pixels')), fg, bg);
      if (mine !== generation) return;

      clear();
      drawn = key;
      // 미리보기도 innerHTML 이 아니라 그림 파일로 붙인다.
      previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const img = document.createElement('img');
      img.src = previewUrl;
      img.alt = 'QR 코드 미리보기';
      preview.append(img);
      preview.hidden = false;

      const count = matrix.modules.length;
      const pixels = Number(value('pixels'));
      const cell = pixels / (count + QUIET_ZONE * 2);
      const facts = [
        `버전 ${matrix.version} · ${count}×${count}칸 · ${comma(matrix.bytes)}바이트(UTF-8) · 오류 정정 ${value('ecl')}`,
        `PNG 는 한 칸이 약 ${cell.toFixed(1)}px 입니다${cell < 4 ? ' — 칸이 잘아 인쇄하면 흐려질 수 있으니 더 큰 크기를 고르세요' : ''}.`,
      ];
      const warning = contrastWarning(fg, bg);
      if (warning) facts.push(warning);
      if (matrix.version > 10) facts.push('내용이 길어 칸이 촘촘합니다. 주소라면 짧은 주소를 쓰는 편이 잘 읽힙니다.');
      notes.replaceChildren(...facts.map(fact => {
        const li = document.createElement('li');
        li.textContent = fact;
        return li;
      }));
      links.add(png, 'qr.png', 'image/png', `PNG 내려받기 (${pixels}px · ${size(png.length)})`);
      links.add(svg, 'qr.svg', 'image/svg+xml', `SVG 내려받기 (${size(svg.length)} · 인쇄용, 크기 자유)`);
      say('만들었습니다. 쓰기 전에 휴대전화로 찍어 확인하세요.', warning ? 'error' : 'ok');
    } catch (error) {
      if (mine !== generation) return;
      clear();
      drawn = '';
      say(reason(error), 'error');
    }
  };

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => { void draw(); }, 200);
  };

  kind.addEventListener('change', () => {
    for (const fieldset of tool.querySelectorAll<HTMLElement>('fieldset[data-kind]')) fieldset.hidden = fieldset.dataset['kind'] !== kind.value;
    schedule();
  });
  tool.addEventListener('input', schedule);
  tool.addEventListener('change', event => { if (event.target !== kind) schedule(); });

  say('내용을 적으면 바로 그립니다.');
  return tool;
}

/** 캔버스에 칸 경계를 반올림해 채운다 — 고른 크기 그대로, 번짐 없이. */
async function toPng(matrix: QrMatrix, pixels: number, fg: string, bg: string): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이 브라우저에서 캔버스를 쓸 수 없어 PNG 를 만들지 못했습니다. SVG 를 쓰세요.');
  context.fillStyle = bg;
  context.fillRect(0, 0, pixels, pixels);
  context.fillStyle = fg;
  const edges = cellEdges(matrix.modules.length + QUIET_ZONE * 2, pixels);
  matrix.modules.forEach((row, y) => {
    const top = edges[y + QUIET_ZONE]!;
    const height = edges[y + QUIET_ZONE + 1]! - top;
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (x + run < row.length && row[x + run]) run++;
      const left = edges[x + QUIET_ZONE]!;
      context.fillRect(left, top, edges[x + QUIET_ZONE + run]! - left, height);
      x += run - 1;
    }
  });
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 를 만들지 못했습니다. 더 작은 크기를 골라 보세요.');
  return new Uint8Array(await blob.arrayBuffer());
}
