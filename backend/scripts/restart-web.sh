#!/usr/bin/env bash
# Rebuild the frontend and restart `next start` on $PORT (default 3000).
# Binds 0.0.0.0 so the app is reachable from the LAN.
# Usage: ./scripts/restart-web.sh
set -euo pipefail

cd "$(dirname "$0")/../../frontend"

PORT="${PORT:-3000}"
BIND="${HOST:-0.0.0.0}"

pid="$(ss -lptnH "sport = :${PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
if [ -n "${pid}" ]; then
  kill "${pid}" 2>/dev/null || true
  sleep 1
fi

npm run build

nohup npx next start --port "${PORT}" --hostname "${BIND}" > /tmp/connect-web.log 2>&1 &
echo "started web pid $! on ${BIND}:${PORT}"

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}" > /dev/null 2>&1; then
    echo "web healthy on http://${BIND}:${PORT}"
    exit 0
  fi
  sleep 0.5
done

echo "web failed to become healthy; last log lines:" >&2
tail -20 /tmp/connect-web.log >&2
exit 1
