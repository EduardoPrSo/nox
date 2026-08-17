#!/usr/bin/env bash
set -Eeuo pipefail

: "${NOX_IMAGE:?NOX_IMAGE must contain the immutable API image tag to deploy}"
: "${NOX_WEB_IMAGE:?NOX_WEB_IMAGE must contain the immutable web image tag to deploy}"

readonly APP_DIR="${APP_DIR:-/opt/nox}"
readonly API_HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
readonly WEB_HEALTH_URL="${WEB_HEALTH_URL:-http://127.0.0.1:3001/web-health}"
readonly EXPECTED_VERSION="${EXPECTED_VERSION:-}"
readonly COMPOSE=(docker compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.env" -f "$APP_DIR/docker-compose.yml")

cd "$APP_DIR"
previous_api_image="$(docker inspect --format '{{.Config.Image}}' nox 2>/dev/null || true)"
previous_web_image="$(docker inspect --format '{{.Config.Image}}' nox-web 2>/dev/null || true)"

wait_for_health() {
  local url="$1"
  local expected_version="${2:-}"
  local response

  for _ in $(seq 1 45); do
    if response="$(curl --fail --silent --show-error "$url" 2>/dev/null)"; then
      if [[ -z "$expected_version" ]] || grep -Fq "\"version\":\"$expected_version\"" <<<"$response"; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

rollback() {
  trap - ERR
  echo "Deploy failed; restoring the previous deployment." >&2

  if [[ -n "$previous_api_image" ]]; then
    NOX_IMAGE="$previous_api_image" NOX_WEB_IMAGE="${previous_web_image:-$NOX_WEB_IMAGE}" \
      "${COMPOSE[@]}" up -d --no-build nox
  fi

  if [[ -n "$previous_web_image" ]]; then
    NOX_IMAGE="${previous_api_image:-$NOX_IMAGE}" NOX_WEB_IMAGE="$previous_web_image" \
      "${COMPOSE[@]}" up -d --no-build web
  else
    "${COMPOSE[@]}" rm -sf web >/dev/null 2>&1 || true
  fi

  if [[ -n "$previous_api_image" ]] && ! wait_for_health "$API_HEALTH_URL"; then
    echo "Rollback started, but the previous API did not become healthy." >&2
    return 1
  fi
  if [[ -n "$previous_web_image" ]] && ! wait_for_health "$WEB_HEALTH_URL"; then
    echo "Rollback started, but the previous web app did not become healthy." >&2
    return 1
  fi

  echo "Rollback restored API=${previous_api_image:-none} web=${previous_web_image:-none}" >&2
}

pull_succeeded=false
for attempt in 1 2 3; do
  if NOX_IMAGE="$NOX_IMAGE" NOX_WEB_IMAGE="$NOX_WEB_IMAGE" "${COMPOSE[@]}" pull nox web; then
    pull_succeeded=true
    break
  fi
  echo "Image pull attempt $attempt failed; retrying..." >&2
  sleep $((attempt * 5))
done
if [[ "$pull_succeeded" != true ]]; then
  echo "Could not pull both deployment images after 3 attempts." >&2
  exit 1
fi

trap rollback ERR
NOX_IMAGE="$NOX_IMAGE" NOX_WEB_IMAGE="$NOX_WEB_IMAGE" \
  "${COMPOSE[@]}" up -d --no-build --remove-orphans nox web

if ! wait_for_health "$API_HEALTH_URL" "$EXPECTED_VERSION"; then
  docker logs --tail 100 nox >&2 || true
  false
fi
if ! wait_for_health "$WEB_HEALTH_URL" "$EXPECTED_VERSION"; then
  docker logs --tail 100 nox-web >&2 || true
  false
fi

trap - ERR
printf '%s\n' "$previous_api_image" >.previous-image
printf '%s\n' "$previous_web_image" >.previous-web-image
printf '%s\n' "$NOX_IMAGE" >.current-image
printf '%s\n' "$NOX_WEB_IMAGE" >.current-web-image
echo "Deployed API=$NOX_IMAGE web=$NOX_WEB_IMAGE"
