#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="${APP_DIR:-/opt/nox}"
readonly PREVIOUS_IMAGE_FILE="$APP_DIR/.previous-image"

if [[ ! -s "$PREVIOUS_IMAGE_FILE" ]]; then
  echo "No previous image is recorded." >&2
  exit 1
fi

previous_image="$(<"$PREVIOUS_IMAGE_FILE")"
cd "$APP_DIR"
NOX_IMAGE="$previous_image" docker compose --env-file .env -f docker-compose.yml up -d --no-build nox
echo "Rolled back to $previous_image"

