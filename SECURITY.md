# 취약점 신고

**연락처: tkddls8848@gmail.com** — 제목 앞에 `[보안]` 을 붙여 주면 먼저 본다.

공개 이슈나 PR 에는 적지 말아 달라. 고치기 전에 읽히면 쓰는 사람이 위험해진다.
암호화가 필요하면 먼저 메일로 알려 주면 공개키를 보낸다.

## 언제 답이 오는가

| 단계 | 기간 |
|---|---|
| 받았다는 답 | 영업일 3일 안 |
| 재현했는지 / 취약점으로 볼지에 대한 판단 | 영업일 10일 안 |
| 고침 배포 | 심각도에 따라. 정해지면 날짜를 알린다 |

**혼자 관리하는 저장소다.** 회사도 보안팀도 당직도 없다. 위 기간은 지키려는 목표이지
계약이 아니고, 늦어질 것 같으면 늦어진다고 알린다 — 조용히 넘기지 않는다. 포상금은
없다. 원하면 고침과 함께 공개하는 글에 이름을 적는다.

## 이 도구의 위협 모형은 보통의 웹 서비스와 다르다

**서버가 없다.** `wrangler.jsonc` 에 Worker 스크립트가 없고 올라가는 것은 정적
자산뿐이다. 계정도, 세션도, 데이터베이스도, 업로드 받는 자리도 없다. **고른 파일은
이 컴퓨터를 벗어나지 않는다** — 모든 변환이 브라우저 안에서 끝나고,
`web/public/_headers` 의 CSP(`connect-src 'self'`)가 그것을 브라우저에게 지키게 한다.

그래서 서버 쪽 취약점 목록(SQL 삽입, 인증 우회, SSRF, 권한 상승)은 이 저장소에
적용할 자리가 없다. 대신 **신뢰할 수 없는 파일을 브라우저 안에서 파싱한다**는 점이
위험의 거의 전부다.

### 진짜 관심사

- **CSP 우회** — `connect-src 'self'` 를 넘어 바깥으로 요청을 내보낼 수 있는 길.
  이것이 깨지면 이 도구의 약속 자체가 깨진다. 가장 심각하게 본다
- **zip-slip** — ZIP·HWPX 안의 `../` 경로나 절대 경로로 의도한 자리 밖을 가리키는 것
  (`web/src/zip.ts`)
- **압축폭탄** — 압축을 풀면 폭발적으로 커지는 입력으로 탭을 죽이거나 메모리를
  고갈시키는 것. 항목 수·해제 후 크기 한도를 두고 있는데 그것을 우회하는 길
- **파서를 이용한 코드 실행·XSS** — PDF·HWPX·DOCX·스프레드시트·이미지를 읽는
  경로에서 문서 내용이 스크립트가 되거나 DOM 에 그대로 들어가는 것.
  CSV 수식 삽입(`=`, `+`, `-`, `@` 로 시작하는 값)도 여기에 든다
- **개인정보가 조용히 남는 것** — 가린 줄 알았는데 파일에 남아 있는 경우.
  특히 PDF 글자 고치기는 **덮어 쓸 뿐 원래 글자가 파일에 남는다**. 이것은 화면에
  적어 둔 알려진 한계이므로 취약점이 아니지만, **적혀 있지 않은 곳에서** 남는다면
  취약점이다
- **의존성의 알려진 취약점** — 특히 pdfjs-dist, pdf-lib, fflate, SheetJS 처럼
  신뢰할 수 없는 입력을 직접 읽는 것들

### 취약점으로 보지 않는 것

- **화면에 이미 적어 둔 한계.** 이 도구는 보장하지 못하는 것을 화면과
  [README](README.md) 에 적는다 — 개인정보 가리기가 모양으로만 찾는다는 것,
  PDF 서명·도장이 전자서명이 아니라는 것, 빈 쪽 판별과 표 재구성이 추정이라는 것,
  MD5·SHA-1 이 변조 방지용이 아니라는 것. 적힌 대로 동작하면 결함이 아니다
- **자기 컴퓨터에서 자기 파일에 하는 일.** 서버가 없으므로 사용자가 제 브라우저의
  콘솔에서 무엇을 하든 넘을 경계가 없다
- **스캐너 출력만 붙인 신고.** 이 저장소에서 어떻게 닿는지(어느 화면, 어떤 입력)를
  적어 주어야 판단할 수 있다
- **보안 헤더 점수·버전 노출 같은 정보성 지적** — 실제로 무엇을 할 수 있는지가
  함께 있어야 다룬다
- **서비스 거부.** 서버가 없어 남에게 번지지 않는다. 다만 **평범한 크기의 파일
  하나로 탭이 죽는다면** 그것은 한도 처리의 결함이므로 신고해 달라

## 무엇을 적어 주면 좋은가

브라우저와 판번호, 어느 화면(도구 이름)인지, 재현에 쓴 입력 파일(가능하면 가장 작게
줄인 것), 일어난 일과 기대한 일. 재현 코드가 있으면 가장 빠르다.

## 공개 시점

고침이 배포된 뒤에 공개하는 데 합의해 주면 좋겠다. **90일**을 기본으로 보고, 그
전에 고쳐지면 그때 함께 공개한다. 90일이 지나도 고치지 못했다면 신고자가 공개해도
좋다 — 무기한 침묵을 요구하지 않는다. 이미 악용되고 있다면 그 사실을 알려 주면
기간과 상관없이 먼저 알린다.

---

## English

**Report security issues to tkddls8848@gmail.com** with `[security]` in the subject.
Please do not open a public issue or PR. Ask first if you want to send it encrypted.

Expect an acknowledgement within 3 business days and a triage decision within 10.
This is a **single-maintainer project** — there is no security team and no on-call
rotation, so these are targets rather than guarantees; if a deadline slips you will
be told, not ignored. There is no bug bounty. Credit in the fix announcement is
offered if you want it.

The threat model differs from a normal web service. **There is no server**: the
deployment ships static assets only (no Worker script), and every conversion runs
inside the browser. **Files you choose never leave your computer**, and the CSP in
`web/public/_headers` (`connect-src 'self'`) is what enforces that in the browser
rather than merely promising it. Server-side vulnerability classes therefore have
nothing to apply to here. What matters instead is **parsing untrusted files in the
browser**: CSP bypasses (the most serious — they break the core promise), zip-slip
in ZIP/HWPX entries, decompression bombs that escape the entry-count and
expanded-size limits, script execution or XSS through the PDF/HWPX/DOCX/spreadsheet
/image parsers (including CSV formula injection), data that silently survives a
redaction step, and known vulnerabilities in the dependencies that read untrusted
input (pdfjs-dist, pdf-lib, fflate, SheetJS).

Out of scope: limitations already documented in the UI and [README](README.md)
(pattern-only PII masking, image stamps that are not digital signatures, blank-page
and table reconstruction being heuristics, MD5/SHA-1 not being tamper-proof);
anything a user does to their own files in their own browser, since there is no
trust boundary to cross; scanner output with no described path to impact; and
denial of service, which cannot spread without a server — though **a single
ordinary-sized file that kills the tab is a limit-handling bug and is in scope.**

Please include browser and version, which tool screen, the smallest input that
reproduces it, and what you expected instead. Coordinated disclosure is requested:
**90 days** by default, sooner once a fix ships. If it is not fixed within 90 days
you are free to publish. Tell us if it is already being exploited and we will
disclose regardless of the clock.
