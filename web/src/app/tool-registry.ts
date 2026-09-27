/** 고를 수 있는 변환. `id` 는 화면에서 그 단추를 찾는 이름이라 바뀌면 안 된다. */
export interface Choice {
  id: string;
  title: string;
  /** 한 줄로 "이걸 고르면 무엇을 하는가". 한도와 주의는 고른 뒤 도구가 적는다. */
  summary: string;
  /** 선택할 때 코드를 받아 도구를 만든다. 초기 화면에서 기능 엔진을 읽지 않는다. */
  build: () => HTMLElement | Promise<HTMLElement>;
}

interface Group { title: string; choices: Choice[] }

// 이름은 고른 뒤 열리는 도구의 제목과 **같은 글자**다. 고르고 나서 "내가 이걸
// 골랐나" 를 되짚게 만들지 않기 위함이다.
//
// 스물다섯을 한 판에 늘어놓으면 제 자리를 찾기 어렵다. 하려는 일의 갈래로 묶는다.
export const GROUPS: Group[] = [
  {
    title: '문서 형식 변환',
    choices: [
      { id: 'document', title: '문서·전자책 변환', summary: 'DOCX·ODT·PDF·EPUB 등의 본문을 10가지 형식으로', build: () => import('../features/documents/format-panel').then(m => m.documentTool()) },
      { id: 'spreadsheet', title: '스프레드시트 변환', summary: 'Excel·ODS·CSV·JSON 등, 여러 시트도 한 번에', build: () => import('../features/documents/format-panel').then(m => m.spreadsheetTool()) },
      { id: 'text-hwpx', title: '텍스트·Markdown → HWPX', summary: '붙여 넣은 글과 표를 한글에서 열리는 문서로', build: () => import('../features/documents/text-hwpx-panel').then(m => m.textHwpxTool()) },
      { id: 'hwpx-markdown', title: 'HWPX → Markdown', summary: '한글 문서의 글 순서와 표 구조를 그대로 옮긴다', build: () => import('../features/documents/hwpx-panel').then(m => m.hwpxTool()) },
      { id: 'encoding', title: '인코딩 변환 (CSV·텍스트)', summary: 'CP949 ↔ UTF-8, BOM 과 줄바꿈까지 맞춘다', build: () => import('../features/text/encoding-panel').then(m => m.encodingTool()) },
    ],
  },
  {
    title: 'PDF',
    choices: [
      { id: 'pdf', title: 'PDF 편집기', summary: '병합·쪽 삭제·회전·분할, HWPX·이미지로 저장', build: () => import('../features/pdf/pdf-panel').then(m => m.pdfTool()) },
      { id: 'pdf-edit', title: 'PDF 글자 고치기', summary: '쪽 위의 글자를 눌러 원하는 글꼴·크기로 바꾼다', build: () => import('../features/pdf/pdf-edit-panel').then(m => m.pdfEditTool()) },
      { id: 'pdf-stamp', title: 'PDF 워터마크·쪽번호', summary: '대외비·사본 같은 글자와 쪽번호를 모든 쪽에', build: () => import('../features/pdf/pdf-stamp-panel').then(m => m.pdfStampTool()) },
      { id: 'pdf-sign', title: 'PDF 서명·도장 넣기', summary: '서명·직인 그림을 쪽 위 원하는 자리에 찍는다', build: () => import('../features/pdf/pdf-sign-panel').then(m => m.pdfSignTool()) },
      { id: 'pdf-nup', title: 'PDF 모아찍기·빈 쪽 빼기', summary: '한 장에 2·4·6·9쪽씩, 빈 쪽은 골라 뺀다', build: () => import('../features/pdf/pdf-nup-panel').then(m => m.pdfNupTool()) },
      { id: 'pdf-meta', title: 'PDF 문서 정보 보기·지우기', summary: '작성자·제목·만든 프로그램을 보고 고치거나 지운다', build: () => import('../features/pdf/pdf-meta-panel').then(m => m.pdfMetaTool()) },
      { id: 'images-pdf', title: '이미지 → PDF', summary: '사진·스캔 여러 장을 고른 순서대로 한 PDF 로', build: () => import('../features/images/images-pdf-panel').then(m => m.imagesPdfTool()) },
    ],
  },
  {
    title: '이미지·텍스트',
    choices: [
      { id: 'image-convert', title: '이미지 형식·크기 바꾸기', summary: 'PNG·JPEG·WebP 로, 크기와 용량을 줄여서', build: () => import('../features/images/image-convert-panel').then(m => m.imageConvertTool()) },
      { id: 'text-diff', title: '텍스트 비교', summary: '두 글에서 바뀐 줄과 글자를 짚어 보인다', build: () => import('../features/text/text-diff-panel').then(m => m.textDiffTool()) },
      { id: 'text-count', title: '글자 수 세기', summary: '공백 포함·제외, 바이트, 원고지 매수까지', build: () => import('../features/text/text-count-panel').then(m => m.textCountTool()) },
      { id: 'redact', title: '개인정보 가리기', summary: '주민번호·전화·이메일·카드·계좌번호를 * 로', build: () => import('../features/text/redact-panel').then(m => m.redactTool()) },
    ],
  },
  {
    title: '사무 계산',
    choices: [
      { id: 'money', title: '금액 한글 표기', summary: '12,345,000 → 일금 일천이백삼십사만오천원정', build: () => import('../features/office/money-panel').then(m => m.moneyTool()) },
      { id: 'vat', title: '부가세 계산', summary: '공급가액·세액·합계를 어느 쪽에서든', build: () => import('../features/office/vat-panel').then(m => m.vatTool()) },
      { id: 'date', title: '날짜·영업일 계산', summary: 'D-day, N일 뒤, 두 날짜 사이의 평일 수', build: () => import('../features/office/date-panel').then(m => m.dateTool()) },
      { id: 'bizno', title: '사업자·법인등록번호 검증', summary: '검증 숫자로 잘못 적은 번호를 여러 개 한 번에', build: () => import('../features/office/bizno-panel').then(m => m.biznoTool()) },
    ],
  },
  {
    title: '파일',
    choices: [
      { id: 'zip', title: 'ZIP 묶기·풀기', summary: '윈도우가 만든 ZIP 의 한글 이름도 그대로 읽는다', build: () => import('../features/files/zip-panel').then(m => m.zipTool()) },
      { id: 'sheet-merge', title: '표 합치기·나누기', summary: 'CSV·엑셀 여러 개를 하나로, 하나를 여럿으로', build: () => import('../features/spreadsheets/sheet-tools-panel').then(m => m.sheetMergeTool()) },
      { id: 'rename', title: '파일 이름 일괄 바꾸기', summary: '번호·날짜·바꾸기 규칙으로 이름을 바꿔 ZIP 으로', build: () => import('../features/files/rename-panel').then(m => m.renameTool()) },
      { id: 'hash', title: '파일 해시 확인', summary: 'SHA-256·MD5 로 받은 파일이 원본과 같은지', build: () => import('../features/files/hash-panel').then(m => m.hashTool()) },
      { id: 'qr', title: 'QR 코드 만들기', summary: '주소·글·Wi-Fi·연락처를 PNG·SVG 로', build: () => import('../features/files/qr-panel').then(m => m.qrTool()) },
    ],
  },
];

