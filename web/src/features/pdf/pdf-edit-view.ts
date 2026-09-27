import { EDIT_LIMITS } from './pdf-edit';
const ZOOMS = [1, 1.5, 2, 3];

export function pdfEditMarkup(): string {
  return `
    <h2>PDF 글자 고치기</h2>
    <p class="conv-note">쪽 위의 글자를 눌러 다른 글자로 바꿉니다. <strong>원본과 같은 글꼴</strong>로 쓰는 것이 기본이고, 다른 글꼴과 크기도 고를 수 있습니다. 최대 64MB.</p>
    <ul class="conv-note edit-caveats">
      <li><strong>원래 글자는 지워지지 않습니다.</strong> 그 자리를 덮고 위에 새로 쓰는 방식이라, 덮인 글자는 파일 안에 남아 글자를 뽑아 보면 나옵니다 — <strong>가려야 할 내용을 감추는 용도로 쓰면 안 됩니다.</strong></li>
      <li><strong>원본 글꼴을 그대로 쓸 수 있습니다</strong> — 다만 <strong>원본 문서에 이미 나온 글자</strong>만 됩니다. PDF 는 쓰인 글자의 모양만 담고 있어서, 한 번도 나오지 않은 글자는 그 글꼴로 그릴 수 없습니다. 그런 글자가 있으면 화면이 짚어 주고 닮은 글꼴로 물러납니다.</li>
      <li>덮을 자리의 배경이 단색이 아니면(무늬·그림·표선 위) <strong>덮은 자국이 보입니다.</strong></li>
    </ul>
    <label class="conv-drop" for="conv-edit-file">
      <input id="conv-edit-file" type="file" accept=".pdf,application/pdf" />
      <span>PDF 파일을 고르거나 여기에 끌어다 놓으세요</span>
    </label>
    <p class="conv-status" role="status" aria-live="polite"></p>

    <fieldset class="edit-controls" disabled>
      <legend>쪽 보기</legend>
      <div class="conv-actions">
        <button type="button" data-action="prev">◀ 이전 쪽</button>
        <span class="edit-page"></span>
        <button type="button" data-action="next">다음 쪽 ▶</button>
        <label>확대 <select class="edit-zoom">${ZOOMS.map(z => `<option value="${z}"${z === 1.5 ? ' selected' : ''}>${z * 100}%</option>`).join('')}</select></label>
      </div>
      <div class="edit-stage">
        <canvas class="edit-canvas"></canvas>
        <div class="edit-spans"></div>
      </div>
      <p class="conv-note edit-hint">쪽 위의 글자 상자를 누르면 그 자리를 고칩니다.</p>

      <div class="edit-form" hidden>
        <h3>이 자리 고치기</h3>
        <p class="edit-original conv-note"></p>
        <label class="conv-label" for="conv-edit-text">새 글자</label>
        <textarea id="conv-edit-text" class="conv-input" rows="2" spellcheck="false"></textarea>
        <div class="conv-actions">
          <label>글꼴 <select class="edit-font"></select></label>
          <label>크기 <input class="edit-size" type="number" min="${EDIT_LIMITS.minSize}" max="${EDIT_LIMITS.maxSize}" step="0.5" /></label>
          <label>글자색 <input class="edit-color" type="color" value="#000000" /></label>
        </div>
        <div class="conv-actions">
          <label>덮을 색 <input class="edit-cover" type="color" value="#ffffff" /></label>
          <label><input type="checkbox" class="edit-auto-cover" checked /> 배경색 자동</label>
          <label><input type="checkbox" class="edit-shrink" checked /> 넘치면 크기 자동 줄임</label>
        </div>
        <div class="conv-actions">
          <label>가로 옮김 <input class="edit-dx" type="number" step="0.5" value="0" /></label>
          <label>세로 옮김 <input class="edit-dy" type="number" step="0.5" value="0" /></label>
        </div>
        <p class="edit-fit conv-note"></p>
        <div class="conv-actions">
          <button type="button" class="conv-download" data-action="apply">이 자리 고치기</button>
          <button type="button" data-action="dismiss">그만두기</button>
        </div>
      </div>

      <h3>고친 자리</h3>
      <ol class="edit-list" aria-label="고친 자리"></ol>
      <div class="conv-actions">
        <button type="button" class="conv-download" data-action="save">고친 PDF 저장</button>
        <button type="button" data-action="reset">모두 되돌리기</button>
      </div>
    </fieldset>

    <div class="conv-actions edit-font-add">
      <label>내 글꼴 불러오기 <input class="edit-font-file" type="file" accept=".ttf,.otf,font/ttf,font/otf" /></label>
    </div>
    <p class="conv-note">맑은 고딕·함초롬돋움처럼 저희가 담아 드릴 수 없는 글꼴은 그 글꼴 파일(<code>.ttf</code>·<code>.otf</code>)을 직접 올려 쓰세요. 올린 글꼴도 이 컴퓨터를 벗어나지 않습니다.</p>
    <ul class="edit-warnings conv-note" aria-label="저장 확인 사항"></ul>
    <div class="edit-outputs conv-actions" aria-label="저장 결과"></div>
  `;
}
