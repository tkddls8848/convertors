# 변환기 (문서·PDF·이미지·텍스트)

**문서·PDF·이미지·표를 브라우저 안에서 바꾸는 도구 25개.** 규격서·제안서·견적 자료를
다루다 보면 HWPX·CP949·부가세·영업일 같은 것이 매번 걸리는데, 그런 파일일수록 낯선
변환 사이트에 올리기 어렵다. 이 도구는 **고른 파일을 이 컴퓨터 밖으로 내보내지 않는다.**

설치할 것도, 가입할 것도, 올릴 곳도 없다. 그 약속은 선의가 아니라
`web/public/_headers` 의 CSP(`connect-src 'self'`)가 **브라우저에게** 지키게 한다 —
받을 서버가 아예 없고(`wrangler.jsonc` 에 Worker 스크립트가 없다), 바깥으로 나가는
연결은 브라우저가 막는다. 예전에 HWP(5.0) → PDF 에만 변환 서버가 있었지만 공개할 수
없어 내렸다. 그 하나 때문에 도구 전체의 약속이 약해졌다.

도구는 다섯 갈래다 — **문서 형식 변환** 5(문서·전자책, 스프레드시트, 텍스트·Markdown
→ HWPX, HWPX → Markdown, 인코딩), **PDF** 7(편집기, 글자 고치기, 워터마크·쪽번호,
서명·도장, 모아찍기, 문서 정보, 이미지 → PDF), **이미지·텍스트** 4, **사무 계산**
4(금액 한글 표기, 부가세, 날짜·영업일, 사업자번호), **파일** 5(ZIP, 표 합치기,
이름 바꾸기, 해시, QR). 무엇을 어디까지 하는지는 아래 [지금 되는 것](#지금-되는-것)
표에 **못 하는 것과 함께** 적었다.

**쓰는 브라우저**: Chrome · Firefox · Safari 의 최신판. 세 엔진(Chromium 153 ·
Firefox 155 · WebKit 26.6)에서 화면 검사 12회가 전부 통과했다. 다만 그 Safari 는
**Playwright 의 WebKit 이지 실제 Safari 기기가 아니다** — macOS·iOS 실기에서의 동작을
보장하는 결과가 아니라는 뜻이다. 기록은 `.cache/cross-browser-report.md` 에 있다.
Internet Explorer 는 받지 않는다.

[지원 형식·한도·검증](FORMAT_SUPPORT.md) · [바뀐 것](CHANGELOG.md) ·
[취약점 신고](SECURITY.md) · [구현 계획](IMPLEMENTATION_PLAN.md) ·
[검증 기록·재현 방법](VALIDATION.md)

```text
convertors/
  web/index.html      셸 — 빈 칸 하나와 <script src="/src/main.ts"> 뿐이다
  web/src/
    main.ts           셸이 하는 일의 전부 — #converters-root 에 mountConverters 를 부른다
    styles.css        색 변수·바탕 글꼴·바깥 여백. 어느 도구에도 딸리지 않는 것만 둔다
    panel.ts          머리말과 변환 고르기. 고른 하나만 아래에 세운다
    pdf-panel.ts      PDF 파일 추가·쪽 선택·순서·회전·분할·다운로드, HWPX 저장
    pdf-edit-panel.ts PDF 글자 고치기 화면 — 쪽 위 글자 상자를 눌러 고친다
    pdf-edit.ts       덮고 다시 쓰기. 글꼴 심기·덮을 자리·자리에 맞게 줄이기
    pdf-edit.test.ts  덮는 자리·줄이기·경고·한도를 고정
    pdf-source-font.ts   원본이 이미 심어 둔 글꼴을 심지 않고 가리켜 쓴다
    pdf-source-font.test.ts  /W 두 꼴·bfrange·못 읽는 글꼴에서 물러나기를 고정
    sfnt.ts           글꼴 손질 — 배치 테이블 떼기(fontkit 이 거기서 죽는다)와
                      글리프 짝수 맞추기(서브셋 loca 가 홀수 자리를 못 담는다)
    sfnt.test.ts      떼기·자리 맞추기·내용 보존·검사합 재계산·못 쓰는 글꼴 거절
    fonts.ts          심을 수 있는 글꼴 목록. 고른 하나만 받아서 붙든다
    fonts.test.ts     받아 온 글꼴 전부를 실제로 심어 한글을 되읽는다
    pdf.ts            pdf-lib 기반 PDF 읽기·쪽 복사·저장·범위 검증
    pdf.test.ts       저장한 PDF 를 다시 열어 병합·분할·순서·회전 확인
    pdf-render.ts     PDF.js 로 쪽을 여닫고 그린다 — 아래 둘이 함께 쓴다
    pdf-hwpx.ts       쪽을 그리거나 글자를 뽑아 HWPX 로. 한도·진행·취소
    pdf-images.ts     쪽을 PNG·JPEG 로. 여러 장이면 ZIP 하나로 묶는다
    pdf-text.ts       글자 좌표 → 읽는 순서·문단·단순 표 (추정이다)
    pdf-text.test.ts  정렬·표 오인·빈 입력을 고정
    hwpx-writer.ts    쪽마다 구역 하나인 HWPX 패키지를 짓는다
    images-pdf.ts     그림 여러 장 → PDF 한 벌. 다시 압축하지 않는다
    images-pdf.test.ts  형식 판별·비율 맞춤·그림 아닌 파일 거절
    images-pdf-panel.ts 이미지 → PDF 화면. PNG·JPEG 밖은 캔버스로 바꾼다
    markdown.ts       Markdown·텍스트 → 문단과 표 (DOM 을 쓰지 않는다)
    markdown.test.ts  표 오인·칸 수 어긋남·제어 문자·텍스트 모드를 고정
    text-hwpx-panel.ts  텍스트·Markdown → HWPX 화면
    encoding.ts       CP949 ↔ UTF-8, BOM, 줄바꿈. 쓰기 표는 디코더를 뒤집어 만든다
    encoding.test.ts  판별·왕복·담을 수 없는 글자에서 멈추는지
    encoding-panel.ts 인코딩 변환 화면 — 판별이 추정이면 그렇게 적는다
    zip-panel.ts      ZIP 묶기·풀기 화면
    converters.css    이 기능 전용 스타일
    hwpx.ts           HWPX(OWPML) → 문단·표 → Markdown
    hwpx.test.ts      실제 규격서에서 겪은 것들(ID 잘림·병합 칸 밀림)을 고정
    zip.ts            ZIP 읽기 — HWPX 가 ZIP 이다. zip-slip·압축폭탄 방어 포함
    zip.test.ts
    errors.ts         오류를 화면에 보일 말로. 낡은 화면의 조각 오류를 알아본다
    errors.test.ts    브라우저 셋의 말투를 고정
    zip-fixture.ts    테스트용 ZIP 조립기(화면은 부르지 않는다)
    kit.ts            뒤에 들인 도구들이 함께 쓰는 화면 조각 — 상태 줄·내려받기·복사
    pdf-stamp.ts      워터마크·쪽번호. 돌아간 쪽·CropBox 에서 보이는 자리를 셈한다
    pdf-sign.ts       서명·도장 그림을 고른 자리에 얹는다 (전자서명 아님)
    pdf-nup.ts        한 장에 2·4·6·9쪽 모아찍기, 잉크 비율로 빈 쪽 후보 찾기
    pdf-meta.ts       문서 정보(Info·XMP) 보기·고치기·지우기. 남은 옛 객체까지 걷는다
    image-convert.ts  이미지 형식·크기. 캔버스를 거치므로 EXIF 가 빠진다
    text-diff.ts      Myers 줄 비교 + 글자 단위 강조, unified diff 내보내기
    text-count.ts     글자·바이트·원고지 매수(추정)
    redact.ts         주민번호·전화·이메일·카드·계좌·여권번호를 모양으로 찾아 가린다
    money.ts          금액 ↔ 한글·갖은자 표기 (BigInt, 9999경까지)
    vat.ts            부가세 — 공급가액·세액·합계, 원 미만 버림·반올림·올림
    dates.ts          D-day·N일 뒤·영업일. 시간대 없이 날 번호로만 센다
    bizno.ts          사업자·법인등록번호 검증 숫자
    sheet-tools.ts    표 합치기·나누기 (sheet-tools.worker.ts 안에서만 SheetJS 를 부른다)
    rename.ts         이름 틀·찾아 바꾸기·번호, 윈도우가 못 쓰는 이름 걸러 내기
    hash.ts           MD5(조각 단위) · SHA 는 crypto.subtle
    qr.ts             QR 내용(Wi-Fi·vCard …)과 SVG. 부호화는 qrcode-generator
    *-panel.ts        위 도구마다 화면 하나. 고를 때 가서 받아 온다
    *.test.ts         도구마다 계산을 고정한다
    assets/           HWPX 뼈대 파일과 그 출처·라이선스
    hwpx-probe.ts     한 쪽짜리 최소 HWPX 생성기 (probe.html, 개발 검증용)
  web/wrangler.jsonc  Cloudflare 배포 정의. `main` 이 없다 — 올라가는 것은 자산뿐이다
  web/scripts/
    검사 — 앞의 넷은 CHECK_BROWSER 로 chromium·firefox·webkit 을 고를 수 있다
    check-converters.mjs    실제 브라우저로 공개 화면을 조작해 산출물을 검사
    check-formats.mjs       문서·스프레드시트 변환을 형식마다 열어 내용을 확인
    check-hwpx.mjs          한 쪽 HWPX 의 패키지 구조·쪽 크기·PNG 픽셀 검사
    check-office-tools.mjs  뒤에 들인 도구 16개를 실제로 열고 산출물을 검사
    check-a11y.mjs          이름 없는 조작 요소·건너뛴 제목 단계·모자란 대비를 찾는다
    check-bundle.mjs        첫 화면이 받는 JS 를 재고 예산을 넘으면 죽는다
    check-deploy.mjs        배포 모양 그대로(CSP·헤더·자산·404) 검사한다
    cf_build.sh             Cloudflare 빌드 단계 — npm ci → 글꼴 → dist
    cf_deploy.sh            Cloudflare 배포 단계 — wrangler 에 인자를 넘긴다
    fetch_fonts.py          심을 한글 글꼴을 npm 에서 받아 web/public/fonts/ 로
    gen_licenses.mjs        node_modules 에서 제3자 고지를 뽑는다 (손으로 적지 않는다)
    gen-icons.mjs           파비콘·공유 미리보기 그림을 굽는다
  web/public/
    _headers          CSP — 파일이 나가지 않는다는 약속을 브라우저가 지키게 한다
    robots.txt        검색에는 열려 있고 AI 학습·요약용 수집에는 닫혀 있다
    licenses/         제3자 라이선스 원문. 화면 아래 고지가 이것을 가리킨다
    favicon.svg · og.png   탭 아이콘과 공유 미리보기
  desktop/
    hwp-to-hwpx.ps1   한글 COM 으로 .hwp → .hwpx (Windows + 한글 설치 필요)
    verify-hwpx.ps1   만든 HWPX 를 한글에서 열어 본다
  LICENSE · THIRD-PARTY-NOTICES.md · SECURITY.md · CHANGELOG.md
```

## 원본 글꼴을 그대로 쓴다

고친 글자를 원본과 다른 글꼴로 내면 그 자리만 튄다. 그래서 글꼴을 새로 심지 않고
**원본이 이미 갖고 있는 글꼴 자원을 가리킨다**(`pdf-source-font.ts`) — 파일도 커지지
않고 모양도 원본 그대로다.

대신 **원본 문서에 한 번도 나오지 않은 글자는 쓸 수 없다.** PDF 는 글꼴을 서브셋으로
담아서 그 글자의 모양이 파일에 없기 때문이고, 이것은 원리상 피할 방법이 없다. 그런
글자는 치는 동안 화면이 짚어 주고, 저장 전에 막은 뒤 닮은 글꼴(세리프·굵기를 보고
고른다)로 물러난다.

다음은 읽지 않고 목록의 글꼴로 물러난다 — 읽는 척하느니 그러는 편이 낫다.
ToUnicode 가 없는 글꼴, Identity-H 가 아닌 CID 인코딩, 세로쓰기, Type3, 너비 표가
없는 단순 글꼴.

## 글꼴은 저장소에 없다

원본 글꼴을 쓸 수 없을 때 심는 한글 글꼴은 여덟 종 39MB 라 담지 않는다. 배포할 때
`web/scripts/fetch_fonts.py` 가 npm 에서 받아 `web/public/fonts/` 로 넣는다.

개발 중에 한글 글꼴이 필요하면 한 번 돌려 두면 된다.

```bash
python3 web/scripts/fetch_fonts.py
```

받아 두지 않아도 화면은 선다 — PDF 기본 라틴 글꼴과 "내 글꼴 불러오기" 로
물러나고, `fonts.test.ts` 는 건너뛴다.

## 어디서 왔나

`hwpx.ts` 와 `zip.ts` 는 **gong-go 저장소의 `converter/`** 에서 옮겨 왔다. 그쪽은
나라장터 공고 첨부(제안요청서·과업내용서)에서 규격표를 뽑으려고 만든 코드이고,
실제 문서 수천 건을 통과했다. 그 저장소는 Cloudflare Worker + R2 로 도는 조회
서비스라 한글 COM 도 HWPX 파서도 쓸 수 없었다 — **쓰는 쪽이 구현을 갖는다**는
같은 규칙에 따라 이쪽으로 옮기고 저쪽에서는 지웠다.

옮기며 바꾼 것은 둘뿐이다.

- Node 의 `zlib.inflateRawSync` → 브라우저의 `DecompressionStream('deflate-raw')`.
  그래서 `readZip` 과 `hwpxToMarkdown` 이 **비동기**다.
- CommonJS → TypeScript. 규칙·한도·안전 검사는 한 줄도 바꾸지 않았다.

HWPX 를 **쓰는** 쪽(`hwpx-writer.ts`)의 그림 배치 값은 python-hwpx(Apache-2.0)의
말뭉치에서 얻은 OWPML 모양을 따랐다. 출처와 라이선스는 `web/src/assets/` 에 있다.

## 지금 되는 것

아래 표의 "브라우저" 는 전부 **이 컴퓨터 안**이라는 뜻이다. 파일이 나가는 기능은 없다.

| 기능 | 어디서 | 보장하는 것 / 못 하는 것 |
|---|---|---|
| PDF 병합·분할·회전·쪽 순서 | 브라우저 | 합계 64MB·1,000쪽. 암호화 PDF 와 책갈피·양식·전자서명 보존은 지원하지 않는다 |
| PDF 글자 고치기 | 브라우저 | 그 자리를 덮고 위에 새로 쓴다 — **원래 글자는 파일에 남는다(가림 용도 아님).** 글꼴은 **원본 것을 그대로** 쓰고, 원본에 없는 글자는 쓸 수 없어 화면이 짚어 준 뒤 닮은 글꼴로 물러난다. 무늬·그림 위에서는 덮은 자국이 보인다 |
| PDF → HWPX (이미지) | 브라우저 | 쪽을 그림으로 심는다. 보이는 대로 나오지만 **글자·표를 고칠 수 없다.** 최대 100쪽·출력 64MB |
| PDF → HWPX (텍스트) | 브라우저 | 문단과 단순 표를 다시 짠다. **배치는 추정이다.** 그림·수식·원본 배치는 옮기지 않는다. 표 추정은 켜야 돈다 |
| PDF → 이미지 | 브라우저 | 보이는 대로 그린다. **글자가 그림이 되어** 검색·복사가 안 된다. 최대 200쪽·출력 64MB. 여러 장이면 ZIP |
| 이미지 → PDF | 브라우저 | PNG·JPEG 를 **다시 압축하지 않아** 화질이 그대로다. 그 밖의 형식은 캔버스를 거치므로 한 번 다시 그려진다. OCR 은 하지 않는다. 합계 64MB·200장 |
| 텍스트·Markdown → HWPX | 브라우저 | 글의 순서, 표의 행·열, 목록의 항목 수를 지킨다. **글꼴·크기·색·굵기는 옮기지 않는다.** 그림도 담지 못한다 — 무엇을 버렸는지 화면에 적는다 |
| HWPX → Markdown | 브라우저 | 글의 순서, 표의 칸 구조(colSpan·rowSpan 포함), 글머리표 수를 지킨다. 글꼴·색·쪽 배치는 옮기지 않는다 |
| 인코딩 변환 (CSV·텍스트) | 브라우저 | CP949 ↔ UTF-8, BOM, 줄바꿈. **BOM 이 없으면 판별은 추정이고 화면이 그렇게 적는다.** CP949 에 없는 글자가 있으면 멈춘다 |
| ZIP 묶기·풀기 | 브라우저 | 윈도우가 만든 ZIP 의 CP949 한글 이름도 읽는다. 합계 64MB·500개. 암호 ZIP 과 분할 압축은 열지 않는다 |
| PDF 워터마크·쪽번호 | 브라우저 | 돌아간 쪽·잘린 쪽에서도 보이는 자리에 바로 선다. 라틴 글자는 받지 않고, **한글은 글꼴(수 MB)을 받아 심는다.** 가운데 맞춤은 글꼴 높이를 어림한 값이다 |
| PDF 서명·도장 넣기 | 브라우저 | 쪽을 눌러 자리를 정한다. **그림을 얹을 뿐 전자서명이 아니다** — 누구나 떼어 쓸 수 있다 |
| PDF 모아찍기·빈 쪽 빼기 | 브라우저 | 2·4·6·9쪽을 한 장에. 링크·양식·주석·책갈피는 옮기지 않는다. **빈 쪽 판별은 추정이라** 후보를 보이고 사람이 고른다. 글자가 있는 쪽은 후보가 되지 않는다 |
| PDF 문서 정보 보기·지우기 | 브라우저 | Info·XMP 를 고치거나 지운다. 쪽 안의 글자·첨부 파일 이름은 건드리지 않는다 |
| 이미지 형식·크기 바꾸기 | 브라우저 | PNG·JPEG·WebP. 다시 그리므로 **EXIF(위치·기기)가 빠지고** 색 프로필이 바뀔 수 있다. 움직이는 GIF 는 첫 장만 |
| 텍스트 비교 | 브라우저 | 줄 단위 + 바뀐 줄의 글자 단위. 한쪽 2만 줄·바뀐 줄 3천까지 |
| 글자 수 세기 | 브라우저 | 공백 포함·제외, UTF-8·CP949 바이트. **원고지 매수는 추정**이다 |
| 개인정보 가리기 | 브라우저 | **모양으로 찾는다** — 이름·주소·자유 형식 번호는 놓친다. 보내기 전에 사람이 봐야 한다 |
| 금액 한글 표기 | 브라우저 | 한글·일금 …원정·갖은자(金 壹阡…원整)·숫자 혼용, 한글 → 숫자 되읽기. 9999경까지 |
| 부가세 계산 | 브라우저 | 세 방향 모두 원 단위로 합이 맞는다. 원 미만 처리는 거래처 방식을 고른다 |
| 날짜·영업일 계산 | 브라우저 | **음력 공휴일·대체공휴일·임시공휴일은 모른다** — 양력 고정 공휴일만 넣을 수 있고 나머지는 적는다 |
| 사업자·법인등록번호 검증 | 브라우저 | **검증 숫자만 본다.** 휴·폐업은 홈택스에서 확인한다. 번호를 어디로도 보내지 않는다 |
| 표 합치기·나누기 | 브라우저 (워커) | 머리글 이름으로 열을 맞춘다. 값만 옮기고 수식·서식은 버린다. 파일당 16MB·50개·50만 셀 |
| 파일 이름 일괄 바꾸기 | 브라우저 | 브라우저는 디스크의 이름을 바꿀 수 없어 **ZIP 으로 내준다** |
| 파일 해시 확인 | 브라우저 | SHA 는 파일당 512MB, MD5 는 조각으로 읽어 한도가 없다. MD5·SHA-1 은 변조 방지용이 아니다 |
| QR 코드 만들기 | 브라우저 | 한글은 UTF-8 로 담는다. 단축 URL·추적 서버를 거치지 않는다 |
| HWP(5.0) → HWPX | 데스크톱 (한글) | `desktop/hwp-to-hwpx.ps1`. 한글이 제 형식을 직접 저장하므로 충실도가 가장 높다 |

두 HWPX 방식을 왜 둘 다 두는지는 [구현 계획](IMPLEMENTATION_PLAN.md)에 적었다.
무엇을 어디까지 재 봤는지는 [검증 기록](VALIDATION.md)에 있다 — **한글에서 열어 본
검증은 아직 남아 있다.**

`.hwp` 는 ZIP 이 아니라 OLE 복합 문서라 브라우저에서 열지 않는다. 머리말과
HWPX → Markdown 화면이 그 사실과 함께 데스크톱 스크립트를 안내한다 — 조용히
실패하지 않는 것이 이 도구의 규칙이다.

## 아직 없는 것

| 기능 | 브라우저만으로 되는가 | 근거 |
|---|---|---|
| HWP(5.0) → PDF | 안 된다 | 공개된 HWP 파서는 포맷의 일부만 읽거나 렌더러가 없다. 서버를 들였다가 공개하지 못해 내렸다 |
| DOCX·PPTX → PDF | 근사로만 | 레이아웃 엔진이 필요하다. HTML 을 거치면 배치가 어긋난다 — 충실도를 보장할 수 없는 변환은 내놓지 않는다 |
| DOCX·XLSX 읽기 (→ Markdown·CSV) | 구현됨 | 문서·전자책 변환 / 스프레드시트 변환에서 제공한다. [지원 형식](FORMAT_SUPPORT.md) |
| PDF 주석 추가 | 된다 | 아직 구현하지 않았다. 서명·도장 **그림**은 넣을 수 있다 |
| PDF 전자서명 | 안 된다 | 인증서와 서명 사전이 필요하다. 서명·도장 넣기는 그림일 뿐이다 |
| 음력 공휴일 자동 반영 | 되지만 자료가 든다 | 해마다 바뀌는 음력·대체·임시 공휴일 표를 들여와 고쳐 가야 한다. 지금은 직접 적는다 |
| 스캔 PDF 의 OCR | 안 된다 | 텍스트 방식은 글자가 있는 PDF 만 받는다. 글자가 없으면 중단·이미지·제외를 고르게 한다 |
| 병합 표·다단의 정확한 재구성 | 되지만 근사 | 좌표에서 되짚는 추정이라 어긋날 수 있다. 확인이 필요한 쪽을 화면에 적는다 |
| UTF-8 → CP949 의 완전 변환 | 안 된다 | CP949 에 없는 글자는 적을 수 없다. 조용히 `?` 로 바꾸지 않고 멈춘 뒤 어떤 글자인지 보여 준다 |

## 규칙

여기 무엇을 만들든 다음을 지킨다.

- 셸(`index.html` · `main.ts`)은 빈 칸을 내주고 진입점 하나(`panel.ts` 의
  `mountConverters`)만 부른다. 화면 뼈대·스타일·논리는 전부 `src/` 가 갖는다.
  그 경계가 있어야 이 변환기를 탭이 여럿인 다른 셸에 그대로 옮겨 붙일 수 있다.
- **`src/` 바깥에 공유 코드를 두지 않는다.** 여러 도구가 함께 쓰는 것은 `kit.ts`
  처럼 이 폴더 안에 둔다 — 밖에 둔 공유부는 거기 생긴 문제 하나를 여러 도구의
  장애로 번지게 한다.
- 고른 도구만 받아 온다. 도구가 스물다섯이고 PDF 라이브러리가 무거워서, QR 하나
  만들려는 사람이 그것을 다 내려받을 이유가 없다 (`panel.ts` 의 `import()`).
  이 약속은 말로만 두지 않고 `check-bundle.mjs` 가 번번이 잰다.
- **무엇을 보장하고 무엇을 보장하지 못하는지 화면에 적는다.** 변환 품질은
  입력에 따라 달라지므로, 그것을 숨기면 신뢰를 잃는다.
- **파일을 브라우저 밖으로 내보내지 않는다.** 한 번 예외(HWP→PDF 변환 서버)를
  두었다가 도구 전체의 약속이 약해졌고, 결국 내렸다. 서버가 있어야 하는 기능은
  넣지 않는다.

## 고칠 때

표 한 줄이 조용히 빠지는 것이 이 도구에서 가장 나쁜 실패다. 파서나 변환을 고쳤으면
반드시 돌린다.

```bash
npm --prefix web install       # 처음 한 번
npm --prefix web test          # web/src/*.test.ts — 파일 30개, 413건
npm --prefix web run typecheck
```

화면과 산출물까지 보려면 개발 서버를 띄우고 실제 브라우저로 돌린다.

```bash
npm --prefix web run dev -- --host 127.0.0.1 --port 18574
node web/scripts/check-converters.mjs
node web/scripts/check-formats.mjs
node web/scripts/check-office-tools.mjs
node web/scripts/check-hwpx.mjs
A11Y_TEST_URL=http://127.0.0.1:18574 node web/scripts/check-a11y.mjs
```

엔진을 바꾸려면 `CHECK_BROWSER=firefox`(또는 `webkit`)를 앞에 붙인다. 없으면
Chromium 으로 돈다.

번들 예산 검사는 개발 서버가 아니라 **빌드한 결과**를 봐야 해서 따로 돈다. 제가
`.cache/bundle-check/dist` 로 굽고 제가 내주므로 `web/dist` 를 건드리지 않는다.

```bash
node web/scripts/check-bundle.mjs
```

첫 화면이 받는 JS 가 예산을 넘거나, fontkit·PDF.js·SheetJS 워커 같은 무거운 것이
첫 화면에 딸려오면 **0 이 아닌 값으로 죽는다.** "고른 도구만 받아 온다"는 설계가
조용히 무너지면 화면에는 아무 자국도 남지 않고 처음 온 사람만 느려지기 때문에,
사람 눈이 아니라 검사가 봐야 한다.

## 배포 (Cloudflare)

올라가는 것은 **정적 자산뿐이다.** `wrangler.jsonc` 에 `main` 이 없다 — Worker
스크립트가 없다는 뜻이고, 그것이 이 도구의 약속과 맞는다. 받을 서버가 아예
없으면 파일을 밖으로 보낼 방법도 없다. 덤으로 요청당 CPU 한도에 걸릴 일이 없고,
정적 자산 요청은 무료·무제한이라 하루 요청 한도도 쓰지 않는다.

보안 헤더는 `web/public/_headers` 가 갖는다. 그 안의
`Content-Security-Policy: … connect-src 'self'` 가 **파일이 나가지 않는다는 약속을
브라우저에게 지키게 하는 자리다** — 코드의 선의가 아니라 규칙이 된다.

### 배포 주소는 `VITE_SITE_URL` 로 받는다

`canonical`·`og:url`·`sitemap.xml` 은 절대 주소여야 뜻이 산다. 그런데 저장소는 제가
어디에 올라갈지 모르므로 그 주소를 빌드 때 환경 변수로 받는다 —
`VITE_SITE_URL=https://convertors.example.com npm --prefix web run build`, Workers
Builds 에 맡길 때는 대시보드의 빌드 환경 변수에 같은 값을 넣는다. **값이 없으면 그
셋을 아예 내지 않는다**: canonical 도 og:url 도 붙지 않고, `sitemap.xml` 이 나오지
않으며, `robots.txt` 의 `Sitemap:` 줄도 붙지 않는다. 그럴듯한 주소를 지어내면 검색
엔진이 남의 주소를 정본으로 알고 공유 미리보기가 엉뚱한 곳을 긁는다 — 틀린 주소를
내는 것이 빈 것보다 나쁘고, 조용히 실패하지 않는 것이 이 도구의 규칙이다. 값이 있는데
주소로 읽히지 않으면 빌드를 세운다. 이 판단은 전부 `web/vite.config.ts` 의
`converter-site-url` 플러그인 한 군데에 있다.

### 손으로 올릴 때

```bash
npx wrangler login                     # 처음 한 번
bash web/scripts/cf_build.sh           # npm ci → 글꼴 → 고지 → dist
npm --prefix web run check             # 올리지 않고 설정·자산만 맞춰 본다
npm --prefix web run deploy            # 프로덕션
```

**스테이징은 색인을 막고 굽는다.** 프로덕션과 **같은 dist** 를 올리기 때문에, 그냥
올리면 같은 내용이 두 주소에 뜨고 검색 엔진이 그중 하나를 고른다 — 하필 스테이징이
뽑히면 쓰는 사람이 낡은 판을 본다.

```bash
VITE_NOINDEX=1 bash web/scripts/cf_build.sh
bash web/scripts/cf_deploy.sh deploy --env staging
```

`VITE_NOINDEX=1` 은 셋을 함께 켠다 — `robots.txt` 를 `Disallow: /` 로 바꾸고,
`X-Robots-Tag: noindex` 를 붙이고, `<meta name="robots">` 를 심는다. 하나만으로는
새는 길이 남기 때문이다(robots.txt 를 안 읽고 링크를 타고 온 수집기에는 헤더가
유일한 신호이고, 헤더를 못 보는 쪽에는 meta 가 남는다). `sitemap.xml` 은 내지
않는다 — 색인하지 말라면서 지도를 내미는 것은 앞뒤가 맞지 않는다. **canonical 은
프로덕션을 가리킨 채로 둔다** — 혹시 긁히더라도 여기가 사본임을 말해 준다.

검사도 같은 변수를 읽어 **두 모드에서 서로 반대를 단언한다.** 안 그러면 실수로
프로덕션에 noindex 를 올려도 검사가 통과한다.

```bash
VITE_NOINDEX=1 DEPLOY_TEST_URL=https://<스테이징 주소> node web/scripts/check-deploy.mjs
```

### Cloudflare Workers Builds 에 맡길 때

대시보드에 넣을 값은 셋이다. 나머지 순서는 저장소가 갖고 있어야 대시보드 설정과
코드가 어긋나지 않는다.

| 항목 | 값 |
|---|---|
| Worker 이름 | `convertors` (`wrangler.jsonc` 의 `name` 과 같아야 한다) |
| Build command | `bash "$(git rev-parse --show-toplevel)"/web/scripts/cf_build.sh` |
| Deploy command | `bash "$(git rev-parse --show-toplevel)"/web/scripts/cf_deploy.sh deploy` |

두 스크립트 모두 제 위치를 보고 `web/` 으로 옮겨 가므로 Root directory 가
저장소 루트든 `web` 이든 똑같이 돈다.

빌드는 `npm ci` → 글꼴 → `npm run build` 순이다. **글꼴을 못 받아도 빌드를 세우지
않는다** — 그때 PDF 글자 고치기는 라틴 기본 글꼴과 "내 글꼴 불러오기" 로 물러나고
화면이 그 사실을 적는다. 글꼴 하나 때문에 나머지를 못 올리는 편이 더 나쁘다.

### 올리기 전에 배포 모양 그대로 본다

개발 서버에는 CSP 가 없고 자산도 번들되기 전이라, **배포에서만 깨지는 것**을
잡지 못한다 — 헤더가 안 붙거나, `/pdf-assets` 가 `dist` 에 안 실렸거나, CSP 가 제
코드를 막거나, 없는 주소가 멀쩡한 화면을 내주거나. 그래서 검사 하나를 따로 둔다.

```bash
npm --prefix web run build
npm --prefix web run preview:cf -- --port 18700  # wrangler 가 dist 를 내준다
node web/scripts/check-deploy.mjs
```

보안 헤더, `/pdf-assets`·`robots.txt` 가 실렸는지, 없는 주소가 404 인지, 그리고
**CSP 를 켠 채로** 문서 → HWPX 가 끝까지 도는지와 바깥으로 나간 요청이 없는지를
본다.

## 데스크톱 스크립트

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop/hwp-to-hwpx.ps1 입력.hwp 출력.hwpx
```

한글이 설치된 Windows 에서만 돈다. 한글 COM(`HWPFrame.HwpObject`)을 띄워 열고
HWPX 로 저장한 뒤 반드시 종료한다 — 종료를 빼먹으면 한글 프로세스가 남아 다음
실행이 조용히 멈춘다. 자동화로 여러 건을 돌릴 때는 건마다 시간 제한을 두고,
실패한 건은 건너뛰되 프로세스를 먼저 정리한다.

`verify-hwpx.ps1` 은 만든 HWPX 를 한글에서 열어 보는 검증용이다. HWPX 를 지원하지
않는 한글(8 이하)에서는 재시도하지 않고 검증 환경이 부족하다고 알린다.

## 라이선스

**상용 비공개다.** 저작권은 tkddls8848 에게 있고 모든 권리를 보유한다 —
소스를 볼 수 있다는 것이 마음대로 써도 된다는 뜻이 아니다. 조건은 [`LICENSE`](LICENSE)
에 있고, 거기 적히지 않은 사용은 허락된 것이 아니다. 쓰고 싶은 자리가 있으면
tkddls8848@gmail.com 으로 물어라.

**함께 배포되는 제3자 구성요소에는 이 라이선스가 적용되지 않는다.** 각자의 라이선스가
그대로 적용되고, 목록과 원문 위치는 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)
에 있다(원문은 `web/public/licenses/`, 화면 아래 고지도 같은 것을 가리킨다). 그 목록은
손으로 적지 않고 `web/scripts/gen_licenses.mjs` 가 `node_modules` 에서 뽑는다 — 손으로
적은 고지는 의존성을 올릴 때 조용히 어긋나고, 어긋난 고지는 없느니만 못하다.

**카피레프트는 배포물에 싣지 않는다.** PDF.js 가 함께 싣는 Liberation 글꼴이
GPLv2 + 글꼴 예외라, 상용 비공개로 내놓는 이상 빼는 편이 깔끔하다고 보고 뺐다
(영향을 먼저 쟀다 — [CHANGELOG](CHANGELOG.md) 에 수치가 있다). 무엇이 실려 나가는지는
`web/pdf-assets.json` 하나가 정하고 **빌드와 고지 생성이 둘 다 그 파일을 읽는다.**
고지 생성기는 카피레프트가 걸린 것을 만나면 그 사실을 세어 알린다 — 지금은 0건이다.

## 취약점을 찾았다면

[`SECURITY.md`](SECURITY.md) 를 보라. 공개 이슈 말고 tkddls8848@gmail.com 으로
보내 달라. 서버가 없는 도구라 위협 모형이 보통의 웹 서비스와 달라서, 무엇을
취약점으로 보고 무엇을 보지 않는지도 거기 적어 두었다.
