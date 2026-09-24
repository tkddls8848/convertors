#!/usr/bin/env bash
# Cloudflare Workers Builds 의 빌드 단계.
#
# 대시보드에는 아래 두 줄만 넣는다. 실제 순서는 저장소가 갖고 있어야 대시보드
# 설정과 코드가 어긋나지 않는다.
#
#   Build command  : bash "$(git rev-parse --show-toplevel)"/web/scripts/cf_build.sh
#   Deploy command : bash "$(git rev-parse --show-toplevel)"/web/scripts/cf_deploy.sh deploy
#
# 이 스크립트는 자기 위치를 보고 web/ 으로 이동한다. 대시보드의 Root directory
# 가 저장소 루트든 web 이든 똑같이 동작한다 — 어긋나면 wrangler 가 설정을 못
# 찾아 "Missing entry-point" 로 죽는다.
#
# 올라가는 것은 정적 자산뿐이다. 변환은 전부 브라우저가 하므로 서버 코드가 없다.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "=== 작업 폴더: $(pwd)"
test -f wrangler.jsonc || { echo "wrangler.jsonc 를 찾지 못했습니다"; exit 1; }

echo "=== 1/3 의존성 설치"
npm ci

echo "=== 2/3 심을 한글 글꼴 가져오기"
# 글꼴은 저장소에 담지 않는다 (여덟 종 39MB). 배포할 때 npm 에서 받아
# public/fonts/ 로 넣는다.
#
# **못 받아도 빌드를 세우지 않는다.** 그때 PDF 글자 고치기는 라틴 기본 글꼴과
# "내 글꼴 불러오기" 로 물러나고, 화면이 그 사실을 적는다. 글꼴 하나 때문에
# 나머지 스물넷을 못 올리는 편이 더 나쁘다.
# Cloudflare 빌드 이미지는 python3 다. 개발 기계가 윈도우면 python 뿐일 수 있다.
(python3 scripts/fetch_fonts.py || python scripts/fetch_fonts.py)   || echo "    글꼴 없이 계속합니다 (라틴 기본 글꼴로 물러납니다)."

echo "=== 3/3 정적 자산 빌드"
# tsc --noEmit 이 먼저 돈다. 타입이 깨진 채로 올라가지 않는다.
npm run build

echo "=== 빌드 완료: $(pwd)/dist"
