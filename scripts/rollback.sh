#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="${APP_DIR:-/opt/nox}"
readonly PREVIOUS_IMAGE_FILE="$APP_DIR/.previous-image"
readonly HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"

if [[ ! -s "$PREVIOUS_IMAGE_FILE" ]]; then
  echo "No previous image is recorded." >&2
  exit 1
fi

previous_image="$(<"$PREVIOUS_IMAGE_FILE")"
cd "$APP_DIR"
current_image="$(docker inspect --format '{{.Config.Image}}' nox 2>/dev/null || true)"
NOX_IMAGE="$previous_image" docker compose --env-file .env -f docker-compose.yml up -d --no-build nox

healthy=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  docker logs --tail 100 nox >&2 || true
  echo "Rollback image did not become healthy." >&2
  exit 1
fi

printf '%s\n' "$previous_image" >.current-image
if [[ -n "$current_image" ]]; then
  printf '%s\n' "$current_image" >.previous-image
fi
echo "Rolled back to $previous_image"
