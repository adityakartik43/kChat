#!/usr/bin/env bash
# Rebuild the API, restart it on $PORT (default 4000), and wait until healthy.
# Usage: ./scripts/restart-api.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-4000}"
BIND="${HOST:-0.0.0.0}"

pid="$(ss -lptnH "sport = :${PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
if [ -n "${pid}" ]; then
  kill "${pid}" 2>/dev/null || true
  sleep 1
fi

npx nest build

nohup node dist/main.js > /tmp/connect-api.log 2>&1 &
echo "started api pid $! on ${BIND}:${PORT}"

for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:${PORT}/health" > /dev/null 2>&1; then
    echo "api healthy on http://${BIND}:${PORT}"
    exit 0
  fi
  sleep 0.5
done

echo "api failed to become healthy; last log lines:" >&2
tail -20 /tmp/connect-api.log >&2
exit 1
