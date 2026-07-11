#!/usr/bin/env bash
#
# serve-on-gateway.sh
#
# Start the Hermes gateway with the built hermes-ui bundle so the UI is
# served SAME-ORIGIN with the gateway (cookies, CORS, and the WebSocket all
# require this - see ../README.md).
#
# This resolves the absolute path to app/dist, verifies the build exists,
# exports HERMES_WEB_DIST to that path, and execs `hermes serve`.
#
# Usage:
#   scripts/serve-on-gateway.sh [extra hermes serve args...]
#
# Any arguments are passed straight through to `hermes serve`, so bind
# host/port flags or anything else the gateway accepts work unchanged, e.g.:
#   scripts/serve-on-gateway.sh --host 127.0.0.1 --port 9119
#
set -euo pipefail

# Resolve this script's directory, then the hermes-ui repo root (its parent),
# independent of the caller's current working directory.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd -P)"

DIST_DIR="${REPO_ROOT}/app/dist"

# Fail clearly if the bundle has not been built yet.
if [[ ! -d "${DIST_DIR}" ]]; then
  echo "error: build not found at ${DIST_DIR}" >&2
  echo "Build it first:" >&2
  echo "  cd ${REPO_ROOT}/app && bun install && bun run build" >&2
  exit 1
fi

# The gateway mounts <HERMES_WEB_DIST>/assets at /assets, so a build with no
# assets/ subdirectory is broken - catch that early rather than at runtime.
if [[ ! -f "${DIST_DIR}/index.html" || ! -d "${DIST_DIR}/assets" ]]; then
  echo "error: ${DIST_DIR} does not look like a valid build" >&2
  echo "Expected both index.html and an assets/ subdirectory." >&2
  echo "Rebuild it:" >&2
  echo "  cd ${REPO_ROOT}/app && bun run build" >&2
  exit 1
fi

# Point the gateway at the built bundle. HERMES_WEB_DIST must be absolute;
# DIST_DIR already is (pwd -P above).
export HERMES_WEB_DIST="${DIST_DIR}"

echo "HERMES_WEB_DIST=${HERMES_WEB_DIST}" >&2
echo "Starting: hermes serve $*" >&2

# Hand off to the gateway, forwarding any extra args unchanged.
exec hermes serve "$@"
