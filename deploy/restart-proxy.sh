#!/usr/bin/env bash
# Start (or restart) the TLS terminator in front of the API and web app.
#
# The upstream services must already be running:
#   backend/scripts/restart-api.sh
#   backend/scripts/restart-web.sh
#
# Usage:
#   deploy/restart-proxy.sh          start or recreate
#   deploy/restart-proxy.sh --reload reload the Caddyfile without dropping TLS
set -euo pipefail

cd "$(dirname "$0")"

# The certificate is issued for this address, and it is the only address that
# resolves on the network (the machine's own hostname points at 127.0.1.1).
# If the DHCP lease changed, edit SITE_ADDRESS in the Caddyfile to match.
SITE_ADDRESS="192.168.1.46"

if ! grep -q "https://${SITE_ADDRESS}" Caddyfile; then
  echo "Caddyfile does not mention ${SITE_ADDRESS}." >&2
  echo "Update SITE_ADDRESS if the machine's IP changed, then re-run." >&2
  exit 1
fi

if [[ "${1:-}" == "--reload" ]]; then
  # Reloads in place: existing connections survive, and the issued certificate
  # is untouched because the CA key lives in the caddy-data volume. Browsers
  # that already accepted it do not see a new one.
  #
  # This needs Caddy's admin API, so the Caddyfile must NOT say `admin off`.
  # The admin listener stays on the container's own loopback and is not
  # published, so it is not reachable from the host or the LAN.
  #
  # Before reloading, confirm the container is actually reading this file.
  # The compose mount is a *bind mount of a single file*, which Docker pins to
  # the inode it saw at start. Any editor that rewrites the file in place by
  # replacing it — `sed -i`, and most "safe write" helpers — leaves the
  # container holding the old inode, so `caddy reload` re-applies the previous
  # configuration and reports success while serving the old addresses. That
  # failure is silent and looks like a broken proxy, so it is checked here
  # rather than left to be rediscovered.
  if ! docker compose exec -T proxy cat /etc/caddy/Caddyfile | diff -q - Caddyfile >/dev/null; then
    echo "the container's Caddyfile differs from the one on disk." >&2
    echo "Editing the file replaced its inode, so the bind mount is stale." >&2
    echo "Re-run without --reload to recreate the container and pick it up." >&2
    exit 1
  fi

  if docker compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile; then
    echo "proxy reloaded (connections preserved)"
  else
    # A failed reload means the new config was rejected; the old one is still
    # running, so say so rather than reporting a restart that did not happen.
    echo "reload failed — the previous config is still in effect" >&2
    echo "check: docker compose logs --tail=20 proxy" >&2
    exit 1
  fi

  # The certificate is cached in memory, so confirm the origin still answers
  # before reporting success.
  if ! curl -sk --max-time 5 -o /dev/null "https://${SITE_ADDRESS}/"; then
    echo "reloaded, but https://${SITE_ADDRESS} is not answering" >&2
    docker compose logs --tail=20 proxy >&2
    exit 1
  fi
  exit 0
fi

# `--wait` blocks until the container is running, which is not the same as the
# certificate having been issued.
docker compose up -d --force-recreate

echo -n "waiting for the certificate on ${SITE_ADDRESS}:443 "
for _ in $(seq 1 30); do
  if curl -sk --max-time 2 -o /dev/null "https://${SITE_ADDRESS}/"; then
    echo "ok"
    echo
    echo "  https://${SITE_ADDRESS}"
    echo
    echo "  Browsers will warn once: the certificate is issued by Caddy's"
    echo "  internal CA. See deploy/README.md to install it and remove the"
    echo "  warning permanently."
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo "failed" >&2
docker compose logs --tail=20 proxy >&2
exit 1
