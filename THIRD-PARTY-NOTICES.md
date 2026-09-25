# 제3자 구성요소 고지 (Third-Party Notices)

> **이 목록은 `node web/scripts/gen_licenses.mjs` 가 만든다. 손으로 고치지 마라.**
> 손으로 적으면 의존성을 올릴 때 조용히 어긋나고, 어긋난 고지는 없느니만 못하다 —
> 지키고 있다고 믿게 만들기 때문이다. 고칠 것이 있으면 그 스크립트를 고치고 다시 돌려라.

이 저장소 자체는 상용 비공개다 ([`LICENSE`](LICENSE)). **아래 구성요소에는 그
라이선스가 적용되지 않고 각자의 라이선스가 그대로 적용된다.** 원문은 전부
[`web/public/licenses/`](web/public/licenses/) 에 함께 배포한다.

구성요소 **29건**. 라이선스별로는 (MIT AND Zlib) 1건, 0BSD 1건, Apache-2.0 4건, Apache-2.0 + BSD 계열 1건, BSD 계열 4건, CC0-1.0 1건, MIT 6건, MIT 계열 2건, OFL-1.1 9건.

## 상류가 전문을 배포하지 않는 것

아래는 상류가 라이선스 전문 파일을 담지 않아, 배포본에서 확인한 **저작권 고지
원문**만 실은 것이다. 전문을 이쪽에서 대신 적어 넣지 않는다 — 기억이나 템플릿에서
옮겨 적은 전문은 상류가 실제로 건 조건과 다를 수 있고, 그런 고지는 법적으로
쓸모가 없다. 각 파일 안에 그 사실과 확인한 자리를 적어 두었다.

| 구성요소 | 선언된 라이선스 | 확인한 자리 |
| --- | --- | --- |
| @pdf-lib/fontkit | MIT | `node_modules/@pdf-lib/fontkit/README.md 의 라이선스 절` |
| qrcode-generator | MIT | `node_modules/qrcode-generator/dist/qrcode.mjs 의 머리말 주석` |

## 직접 의존하는 npm 패키지 (6)

`web/package.json` 의 `dependencies`. 번들에 실려 사용자에게 배포된다.

| 이름 | 판본 | 라이선스 | 원문 |
| --- | --- | --- | --- |
| fflate | 0.8.3 | MIT | [`fflate.LICENSE`](web/public/licenses/fflate.LICENSE) |
| pdf-lib | 1.17.1 | MIT | [`pdf-lib.LICENSE`](web/public/licenses/pdf-lib.LICENSE) |
| @pdf-lib/fontkit | 1.1.1 | MIT · 전문 없음 | [`pdf-lib-fontkit.LICENSE`](web/public/licenses/pdf-lib-fontkit.LICENSE) |
| pdfjs-dist | 6.3.289 | Apache-2.0 | [`pdfjs-dist.LICENSE`](web/public/licenses/pdfjs-dist.LICENSE) |
| qrcode-generator | 2.0.4 | MIT · 전문 없음 | [`qrcode-generator.LICENSE`](web/public/licenses/qrcode-generator.LICENSE) |
| xlsx | 0.20.3 | Apache-2.0 | [`xlsx.LICENSE`](web/public/licenses/xlsx.LICENSE) |

## 딸려 오는 런타임 npm 패키지 (4)

위 패키지가 끌고 오는 것. 직접 적지 않았을 뿐 **번들에는 똑같이 실린다** — 이를테면 pako 는 pdf-lib 를 타고 들어온다.

| 이름 | 판본 | 라이선스 | 원문 |
| --- | --- | --- | --- |
| pako | 1.0.11 | (MIT AND Zlib) | [`pako.LICENSE`](web/public/licenses/pako.LICENSE) |
| @pdf-lib/standard-fonts | 1.0.0 | MIT | [`pdf-lib-standard-fonts.LICENSE`](web/public/licenses/pdf-lib-standard-fonts.LICENSE) |
| @pdf-lib/upng | 1.0.1 | MIT | [`pdf-lib-upng.LICENSE`](web/public/licenses/pdf-lib-upng.LICENSE) |
| tslib | 1.14.1 | 0BSD | [`tslib.LICENSE`](web/public/licenses/tslib.LICENSE) |

## 패키지가 함께 싣는 제3자 자료 (9)

pdfjs-dist 가 대표적이다. cmap·기본 글꼴·wasm·ICC 는 코드가 아니라 런타임이 이름으로 찾아 읽는 자료라 번들러가 손대지 않고 `/pdf-assets/…` 로 그대로 실려 나간다. 각자 제 라이선스가 있다.

| 이름 | 판본 | 라이선스 | 원문 |
| --- | --- | --- | --- |
| pdfjs-dist 에 함께 실린 것: cmaps/LICENSE | 6.3.289 | BSD 계열 (원문에서 짐작) | [`pdfjs-dist-cmaps.LICENSE`](web/public/licenses/pdfjs-dist-cmaps.LICENSE) |
| pdfjs-dist 에 함께 실린 것: iccs/LICENSE | 6.3.289 | CC0-1.0 (원문에서 짐작) | [`pdfjs-dist-iccs.LICENSE`](web/public/licenses/pdfjs-dist-iccs.LICENSE) |
| pdfjs-dist 에 함께 실린 것: standard_fonts/LICENSE_FOXIT | 6.3.289 | BSD 계열 (원문에서 짐작) | [`pdfjs-dist-standard_fonts-FOXIT.LICENSE`](web/public/licenses/pdfjs-dist-standard_fonts-FOXIT.LICENSE) |
| pdfjs-dist 에 함께 실린 것: wasm/LICENSE_JBIG2 | 6.3.289 | Apache-2.0 + BSD 계열 (원문에서 짐작) | [`pdfjs-dist-wasm-JBIG2.LICENSE`](web/public/licenses/pdfjs-dist-wasm-JBIG2.LICENSE) |
| pdfjs-dist 에 함께 실린 것: wasm/LICENSE_OPENJPEG | 6.3.289 | BSD 계열 (원문에서 짐작) | [`pdfjs-dist-wasm-OPENJPEG.LICENSE`](web/public/licenses/pdfjs-dist-wasm-OPENJPEG.LICENSE) |
| pdfjs-dist 에 함께 실린 것: wasm/LICENSE_PDFJS_JBIG2 | 6.3.289 | Apache-2.0 (원문에서 짐작) | [`pdfjs-dist-wasm-PDFJS_JBIG2.LICENSE`](web/public/licenses/pdfjs-dist-wasm-PDFJS_JBIG2.LICENSE) |
| pdfjs-dist 에 함께 실린 것: wasm/LICENSE_PDFJS_OPENJPEG | 6.3.289 | BSD 계열 (원문에서 짐작) | [`pdfjs-dist-wasm-PDFJS_OPENJPEG.LICENSE`](web/public/licenses/pdfjs-dist-wasm-PDFJS_OPENJPEG.LICENSE) |
| pdfjs-dist 에 함께 실린 것: wasm/LICENSE_PDFJS_QCMS | 6.3.289 | MIT 계열 (원문에서 짐작) | [`pdfjs-dist-wasm-PDFJS_QCMS.LICENSE`](web/public/licenses/pdfjs-dist-wasm-PDFJS_QCMS.LICENSE) |
| pdfjs-dist 에 함께 실린 것: wasm/LICENSE_QCMS | 6.3.289 | MIT 계열 (원문에서 짐작) | [`pdfjs-dist-wasm-QCMS.LICENSE`](web/public/licenses/pdfjs-dist-wasm-QCMS.LICENSE) |

## 심는 한글 글꼴 (9)

`web/scripts/fetch_fonts.py` 가 배포할 때 npm 에서 받아 `/fonts/` 로 넣는다. 고지는 글꼴 자신이 제 안에 적어 둔 것에서 뽑았다 — 래퍼 패키지의 LICENSE 는 래퍼의 것이라 글꼴의 고지로 쓸 수 없다.

| 이름 | 판본 | 라이선스 | 원문 |
| --- | --- | --- | --- |
| SIL Open Font License 1.1 (한글 글꼴 8종이 따르는 전문) | 1.1 | OFL-1.1 (원문에서 짐작) | [`font-SIL-OFL-1.1.LICENSE`](web/public/licenses/font-SIL-OFL-1.1.LICENSE) |
| D2Coding — D2Coding | — | OFL-1.1 | [`font-d2coding.LICENSE`](web/public/licenses/font-d2coding.LICENSE) |
| 나눔고딕 — NanumGothic | — | OFL-1.1 | [`font-nanum-gothic.LICENSE`](web/public/licenses/font-nanum-gothic.LICENSE) |
| 나눔고딕 굵게 — NanumGothicBold | — | OFL-1.1 | [`font-nanum-gothic-bold.LICENSE`](web/public/licenses/font-nanum-gothic-bold.LICENSE) |
| 나눔명조 — NanumMyeongjo | — | OFL-1.1 | [`font-nanum-myeongjo.LICENSE`](web/public/licenses/font-nanum-myeongjo.LICENSE) |
| 본고딕 (Noto Sans KR) — Noto Sans KR Regular | — | OFL-1.1 | [`font-noto-sans-kr.LICENSE`](web/public/licenses/font-noto-sans-kr.LICENSE) |
| 본고딕 굵게 — Noto Sans KR Bold | — | OFL-1.1 | [`font-noto-sans-kr-bold.LICENSE`](web/public/licenses/font-noto-sans-kr-bold.LICENSE) |
| 본명조 (Noto Serif KR) — Noto Serif KR Regular | — | OFL-1.1 | [`font-noto-serif-kr.LICENSE`](web/public/licenses/font-noto-serif-kr.LICENSE) |
| 프리텐다드 — Pretendard Regular | — | OFL-1.1 | [`font-pretendard.LICENSE`](web/public/licenses/font-pretendard.LICENSE) |

## 저장소가 직접 담은 제3자 자료 (1)

npm 을 거치지 않고 저장소가 들고 있는 것.

| 이름 | 판본 | 라이선스 | 원문 |
| --- | --- | --- | --- |
| python-hwpx (HWPX 빈 문서 뼈대와 배치 값) | bf40152e5202a55af76f97fe8c2d60eed43f0b00 | Apache-2.0 | [`python-hwpx.LICENSE`](web/public/licenses/python-hwpx.LICENSE) · [`python-hwpx.NOTICE`](web/public/licenses/python-hwpx.NOTICE) |

## 다시 만드는 법

```sh
node web/scripts/gen_licenses.mjs
```

같은 설치본이면 같은 결과가 나온다 (시각을 찍지 않는다). 두 번 돌린 뒤
`git status --short web/public/licenses THIRD-PARTY-NOTICES.md` 가 비어 있어야 한다.

원문을 못 찾으면 이 스크립트는 0 이 아닌 값으로 죽고, `web/scripts/cf_build.sh` 가
거기서 빌드를 세운다. 고지가 빠진 채로 나가는 배포를 막는 것이 그 규칙의 목적이다.
