#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="${APP_DIR:-/opt/nox}"
readonly PREVIOUS_API_FILE="$APP_DIR/.previous-image"
readonly PREVIOUS_WEB_FILE="$APP_DIR/.previous-web-image"
readonly API_HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
readonly WEB_HEALTH_URL="${WEB_HEALTH_URL:-http://127.0.0.1:3001/web-health}"
readonly COMPOSE=(docker compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.env" -f "$APP_DIR/docker-compose.yml")

if [[ ! -s "$PREVIOUS_API_FILE" ]]; then
  echo "No previous API image is recorded." >&2
  exit 1
fi
if [[ ! -e "$PREVIOUS_WEB_FILE" ]]; then
  echo "No previous web deployment is recorded." >&2
  exit 1
fi

previous_api_image="$(<"$PREVIOUS_API_FILE")"
previous_web_image="$(<"$PREVIOUS_WEB_FILE")"
cd "$APP_DIR"
current_api_image="$(docker inspect --format '{{.Config.Image}}' nox 2>/dev/null || true)"
current_web_image="$(docker inspect --format '{{.Config.Image}}' nox-web 2>/dev/null || true)"

wait_for_health() {
  local url="$1"
  for _ in $(seq 1 45); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

NOX_IMAGE="$previous_api_image" NOX_WEB_IMAGE="${previous_web_image:-$current_web_image}" \
  "${COMPOSE[@]}" up -d --no-build nox

if [[ -n "$previous_web_image" ]]; then
  NOX_IMAGE="$previous_api_image" NOX_WEB_IMAGE="$previous_web_image" \
    "${COMPOSE[@]}" up -d --no-build web
else
  "${COMPOSE[@]}" rm -sf web >/dev/null 2>&1 || true
fi

if ! wait_for_health "$API_HEALTH_URL"; then
  docker logs --tail 100 nox >&2 || true
  echo "Rollback API did not become healthy." >&2
  exit 1
fi
if [[ -n "$previous_web_image" ]] && ! wait_for_health "$WEB_HEALTH_URL"; then
  docker logs --tail 100 nox-web >&2 || true
  echo "Rollback web app did not become healthy." >&2
  exit 1
fi

printf '%s\n' "$previous_api_image" >.current-image
printf '%s\n' "$previous_web_image" >.current-web-image
printf '%s\n' "$current_api_image" >.previous-image
printf '%s\n' "$current_web_image" >.previous-web-image
echo "Rolled back API=$previous_api_image web=${previous_web_image:-none}"
