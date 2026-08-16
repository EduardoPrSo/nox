#!/usr/bin/env bash
set -Eeuo pipefail

: "${NOX_IMAGE:?NOX_IMAGE must contain the immutable image tag to deploy}"

readonly APP_DIR="${APP_DIR:-/opt/nox}"
readonly HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
readonly COMPOSE=(docker compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.env" -f "$APP_DIR/docker-compose.yml")

cd "$APP_DIR"
previous_image="$(docker inspect --format '{{.Config.Image}}' nox 2>/dev/null || true)"

rollback() {
  if [[ -z "$previous_image" ]]; then
    echo "Deploy failed and no previous image is available for rollback." >&2
    return
  fi
  echo "Healthcheck failed; rolling back to $previous_image" >&2
  NOX_IMAGE="$previous_image" "${COMPOSE[@]}" up -d --no-build nox
}
trap rollback ERR

pulled=false
for attempt in 1 2 3; do
  if "${COMPOSE[@]}" pull --quiet nox; then
    pulled=true
    break
  fi
  echo "Image pull attempt $attempt failed; retrying..." >&2
  sleep $((attempt * 5))
done
if [[ "$pulled" != true ]]; then
  echo "Could not pull $NOX_IMAGE after 3 attempts." >&2
  false
fi

NOX_IMAGE="$NOX_IMAGE" "${COMPOSE[@]}" up -d --no-build --remove-orphans nox

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
  false
fi

trap - ERR
printf '%s\n' "$previous_image" >.previous-image
printf '%s\n' "$NOX_IMAGE" >.current-image
echo "Deployed $NOX_IMAGE"
