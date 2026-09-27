# 코드 탐색

진입점은 `main.ts` → `app/panel.ts`이다. 도구 이름·ID·지연 로딩 경로는
`app/tool-registry.ts` 한 곳에서 찾는다. 기능 수정은 해당 폴더부터 읽는다.

| 위치 | 책임과 검색어 |
|---|---|
| `app/` | 도구 선택·캐시, 공통 스타일과 페이지 틀 |
| `features/documents/` | 문서·전자책, HWPX, Markdown, 형식 선택 UI·카탈로그 |
| `features/spreadsheets/` | 시트 변환·합치기·나누기, SheetJS 워커 |
| `features/pdf/` | PDF 편집·출력·렌더링·글꼴 |
| `features/images/` | 이미지 변환, 이미지 → PDF |
| `features/text/` | 인코딩·비교·글자 수·개인정보 가리기 |
| `features/office/` | 금액·부가세·날짜·사업자번호 |
| `features/files/` | ZIP UI·파일명·해시·QR |
| `shared/` | 여러 기능에서 실제로 쓰는 UI(`kit`), 오류, ZIP 파서 |
| `testing/` | 테스트용 ZIP 생성기 |
| `assets/` | HWPX 템플릿과 출처·라이선스 |

`*-panel.ts`는 UI, 나머지 `.ts`는 처리 로직이며 `*.test.ts`는 대상 옆에 둔다.
문서/이미지 기능이 PDF 출력을 위해 PDF 모듈을 사용하는 등 명시적 기능 간 의존은 있다.
폴더별 `index.ts` 재수출은 두지 않는다. 실제 구현을 직접 import해 탐색 단계를 줄인다.

PDF 글자 편집의 진입점은 `features/pdf/pdf-edit-panel.ts`다.
마크업은 `pdf-edit-view.ts`, 글자 좌표·원본 글꼴 매칭은 `pdf-edit-spans.ts`,
폭 측정·캐시는 `pdf-edit-measure.ts`, PDF 저장 로직은 `pdf-edit.ts`가 맡는다.

저장소 루트에서:

```sh
rg --files web/src/features/pdf
rg -n 'export |function ' web/src/features/pdf/pdf-edit*.ts
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run build
```

브라우저 검사는 `web/scripts/check-*.mjs`, 실행 조건은 루트 `VALIDATION.md`를 참고한다.
생성물(`dist`, `.cache`, `node_modules`), 잠금 파일, 라이선스 원문은 관련 작업일 때만 읽는다.
과거 변경·검증 기록의 평면 경로는 파일명을 이 표의 기능 폴더에서 검색하면 된다.
