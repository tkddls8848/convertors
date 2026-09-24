#!/usr/bin/env bash
# Cloudflare Workers Builds 의 배포 단계.
#
#   프로덕션 배포 : bash "$(git rev-parse --show-toplevel)"/web/scripts/cf_deploy.sh deploy
#   프리뷰 업로드 : bash "$(git rev-parse --show-toplevel)"/web/scripts/cf_deploy.sh versions upload
#   스테이징이면  : ... cf_deploy.sh deploy --env staging
#
# Workers Builds 는 프로덕션 브랜치와 그 외 브랜치의 배포 명령을 따로 둔다
# (기본값이 각각 `wrangler deploy`, `wrangler versions upload`). 둘 다 이
# 스크립트를 쓰도록 인자를 그대로 받는다. 인자가 없으면 deploy 로 본다.
#
# cf_build.sh 와 마찬가지로 자기 위치를 보고 web/ 으로 이동하므로 대시보드의
# Root directory 값에 영향을 받지 않는다.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "=== 작업 폴더: $(pwd)"
test -f wrangler.jsonc || { echo "wrangler.jsonc 를 찾지 못했습니다"; exit 1; }
test -d dist || { echo "dist 가 없습니다. 먼저 scripts/cf_build.sh 를 돌리세요"; exit 1; }

if [ "$#" -eq 0 ]; then
  set -- deploy
fi

# 대상 환경을 알아 둔다. wrangler 는 환경을 지정하지 않으면 경고를 낸다.
has_env=false
for arg in "$@"; do
  case "$arg" in
    --env|--env=*|-e) has_env=true ;;
  esac
done

# 환경을 안 준 경우 최상위 환경임을 분명히 한다.
if [ "$has_env" = false ]; then
  set -- "$@" --env=""
fi
echo "=== 배포: npx wrangler $*"
exec npx wrangler "$@"
