# 무료 문서·스프레드시트 변환

2026-09-22. Cloudflare Workers Static Assets 구성을 유지한다. 파일은 서버로
전송하지 않고 브라우저에서 읽고 저장한다. 유료 API, LibreOffice 서버, R2,
데이터베이스, 별도 변환 서버가 필요하지 않다. 서버 실행 코드는 추가하지 않는다.

## 지원 형식

| 도구 | 입력 | 출력 |
|---|---|---|
| 문서·전자책 | DOCX, DOCM, DOTX, ODT, OTT, FODT, TXT, MD, MARKDOWN, HTML, HTM, EPUB, FB2, PPTX, PPSX, POTX, ODP, HWPX, PDF | DOCX, ODT, FODT, TXT, MD, HTML, RTF, EPUB, FB2, HWPX |
| 스프레드시트 | XLSX, XLS, XLSB, XLSM, XLTX, XLTM, ODS, FODS, CSV, TSV, DIF, SYLK, SLK, SpreadsheetML XML, DBF, WK1, WK3, WKS, NUMBERS, JSON | XLSX, XLS, XLSB, ODS, FODS, CSV, TSV, JSON, HTML, MD, DIF, SYLK |

문서는 본문의 글·기본 표를 새 문서로 만든다. 원본 레이아웃 변환이 아니다.
프레젠테이션 입력은 슬라이드 순서대로 본문을 추출한다. 프레젠테이션 출력은 없다.
PDF는 텍스트 레이어만 추출하고 빈 쪽을 경고한다. OCR은 하지 않는다.
RTF·FB2·TXT 출력에서는 표를 탭으로 구분한 텍스트로 옮긴다.
제목·목록 스타일, 병합 셀, 그림, 수식, 각주, 머리말, 글꼴, 페이지 배치,
매크로는 보존하지 않는다. ODF 반복 셀·중첩 표는 원본 대조가 필요하다.

스프레드시트는 값과 기본 셀·시트를 옮긴다. 수식은 재계산하지 않는다.
값 전용 출력은 저장된 계산값을 사용하며 계산값이 없는 수식을 경고한다.
XLSX·XLS·XLSB·ODS·FODS는 전체 통합문서로 저장한다. 나머지는 시트별 파일과
전체 ZIP을 제공한다. 숨긴 시트도 포함한다. 차트·그림·매크로·고급 서식은
보존하지 않는다. 오래된 형식·Numbers는 SheetJS CE 지원 범위에 따른다.

CSV·TSV 입력은 UTF-8이며 앞자리 0과 긴 식별자를 지키기 위해 문자열로 읽는다.
출력은 UTF-8 BOM을 붙인다. `=`, `+`, `-`, `@` 등으로 시작하는 값에는 수식으로
실행되지 않도록 작은따옴표를 붙인다. JSON 입력은 원시값의 행 배열 또는 객체
배열이며 출력은 행 배열이다. DIF·SYLK 출력은 ASCII만 허용한다. 한글이 있으면
대체 형식을 안내하며 깨진 파일을 만들지 않는다.

## 자원 제한

- 새 입력: 파일당 16 MiB. 결과: 32 MiB.
- ZIP 내부: 3,000항목·해제 후 32 MiB. 실제 스트림 해제 크기도 검사한다.
- 문서: 본문 200만 자·30,000 문단/표. PDF: 200쪽.
- 스프레드시트: 100시트·전체 시트 영역 50만 셀. 별도 Web Worker에서 처리한다.
  60초 제한·취소 시 worker를 종료한다. 압축 검사도 worker 안에서 수행한다.
- 문서 엔진은 변환할 때 지연 로딩한다. SheetJS와 코드페이지 엔진은
  스프레드시트 worker에만 들어가며 같은 사이트에서 받는다.
- HTML은 비활성 template에서 읽고 텍스트만 추출한다. 출력은 escape하여 새로
  만들며 스크립트·이벤트·외부 자원 링크를 복사하지 않는다.

모든 기기에서 같은 속도와 메모리 사용을 보장하지는 않는다.
기존 PDF 편집·이미지 변환 도구의 한도는 별개다.

## 제외 범위와 근거

DOC 바이너리, HWP 바이너리, PAGES/KEY, DRM EPUB, 암호화 Office, XPS,
Office 원본 배치를 보존하는 PDF·이미지 변환은 추가하지 않았다.
현재 무료 정적 호스팅에서 네이티브 오피스 엔진을 실행할 수 없기 때문이다.
기존 PDF ↔ 이미지 도구는 계속 제공한다.

- [CloudConvert DOC 변환 목록](https://cloudconvert.com/doc-converter)
- [Cloudflare Workers 한도](https://developers.cloudflare.com/workers/platform/limits/)
- [SheetJS 공식 설치](https://docs.sheetjs.com/docs/getting-started/installation/standalone/)
- [SheetJS 출력 형식·옵션](https://docs.sheetjs.com/docs/api/write-options/)

SheetJS CE 0.20.3은 공식 CDN 고정 버전 tarball과 lockfile integrity를 사용한다.
Apache-2.0이며 유료 Pro 기능은 사용하지 않는다. 라이선스 사본은
`web/public/licenses/xlsx.LICENSE`에 있다. 기존 fflate(MIT),
pdfjs-dist(Apache-2.0), HWPX 작성기를 재사용한다. jsdom은 테스트 전용이다.
QR 코드 도구의 qrcode-generator(MIT) 사본은 `web/public/licenses/qrcode-generator.LICENSE`에 있다.

## 검증 방법

```powershell
npm --prefix web test
npm --prefix web run build
node web/node_modules/vite/bin/vite.js web --host 127.0.0.1 --port 18574
node web/scripts/check-formats.mjs
```

단위 테스트: DOCX/ODT/FODT/EPUB 재읽기, 한글·표, HTML 실행 요소 제거,
RTF 유니코드, PPTX 관계 파일 순서, 스프레드시트 다중 시트와 주요 형식 왕복,
수식·인코딩·한도, ZIP 실제 팽창 크기.

Chromium 테스트: 10가지 문서 출력의 실제 다운로드, PDF 텍스트와 빈 쪽 경고,
스프레드시트 worker, 시트별 ZIP, 실패 시 이전 결과 제거, 외부 요청 부재.

Word·한글·LibreOffice의 모든 형식 실사용 검증이나 희귀 입력 포맷의 전체
실문서 검증을 의미하지는 않는다. 운영 배포는 별도다.

2026-09-22 실행 결과: 전체 단위 테스트 171개 통과, 글꼴 자산이 없어 1개
건너뜀. 이후 글꼴 자산을 준비해 글꼴 테스트 18개도 통과했다.
TypeScript/Vite 빌드, 배포 번들을 대상으로 한 `check-formats.mjs`, 기존
`check-converters.mjs`(PDF·HWPX·인코딩·ZIP·모바일 화면), Wrangler dry-run이
모두 통과했다. 실제 배포는 실행하지 않았다.
