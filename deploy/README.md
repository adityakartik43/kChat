# TLS terminator

This is what makes audio and video calling possible on the LAN.

## The problem it solves

Browsers only expose `navigator.mediaDevices` — the camera and microphone APIs
that every call depends on — inside a **secure context**. `https://` qualifies.
`http://` does not, with one exception: browsers treat `localhost` as secure
for development.

That exception is what makes this so easy to get wrong. On `localhost` the
whole app works, camera included. On `http://192.168.1.46:3000`,
`navigator.mediaDevices` is not merely restricted, it is **undefined** — so
`getUserMedia` cannot be called at all, and no amount of application code
changes that. Chat keeps working, which is why the failure is quiet.

Measured on this machine, on the plain-HTTP LAN origin:

| API                                | `http://localhost:3000` | `http://192.168.1.46:3000` |
| ---------------------------------- | ----------------------- | --------------------------- |
| `window.isSecureContext`           | `true`                  | `false`                     |
| `navigator.mediaDevices`           | present                 | **undefined**               |
| `navigator.mediaDevices.getUserMedia` | function             | **undefined**               |
| `crypto.randomUUID`                | function                | **undefined**               |

Over HTTPS, on the same machine:

| API                                | `https://192.168.1.46` |
| ---------------------------------- | ----------------------- |
| `window.isSecureContext`           | `true`                  |
| `navigator.mediaDevices`           | present                 |
| `navigator.mediaDevices.getUserMedia` | function            |
| `crypto.randomUUID`                | function                |

## What it does

Caddy terminates TLS on 443 and routes:

| Path            | To                                    |
| --------------- | ------------------------------------- |
| `/api/*`        | API on port 4000, with `/api` stripped |
| `/socket.io/*`  | API on port 4000, WebSocket upgrade   |
| everything else | Next on port 3000                     |

Port 8080 redirects to HTTPS. It is not 80 because this host already runs an
unrelated Apache there.

### Why one origin matters

The app is deliberately single-origin behind this proxy, and not only for tidiness:

- **CORS does not apply**, so the API's port 4000 never has to be reachable
  from a browser. Only 443 needs to be open.
- **An `https://` page may not make plain-HTTP requests.** A second origin on
  port 4000 would be blocked as mixed content regardless of any CORS headers,
  so the "just call the API directly" approach cannot work over TLS.

### Port 3000 redirects itself, so the wrong URL cannot be a dead end

Next still listens on `0.0.0.0:3000`, so `http://192.168.1.46:3000` remains
reachable. Left alone it is a trap: chat works, so nothing looks broken, and the
call buttons are dead because that origin has no `navigator.mediaDevices` at
all. That is exactly the bug this directory exists to prevent, reproduced by the
very port it needs to run on.

So `frontend/proxy.ts` sends those requests to `HTTPS_ORIGIN` with a **308**,
preserving path, query, method and body. Typing the plain-HTTP address now lands
on `https://192.168.1.46` and calling works. It is gated on two things:

- **`HTTPS_ORIGIN` must be set.** Unset — `npm run dev`, or the documented
  plain-HTTP LAN mode — nothing is redirected and behaviour is unchanged. There
  is no HTTPS origin to redirect to in that mode.
- **The request must not have come through Caddy.** Caddy stamps
  `X-Connect-Proxy`, and those requests are already the HTTPS origin; redirecting
  them would loop. `localhost` is exempt too, since it is already a secure
  context.

One consequence to be aware of: the hop changes origin, and browsers strip the
`Authorization` header on a cross-origin redirect, so a token-bearing request
pointed at port 3000 arrives unauthenticated. The app never does this — it calls
`/api` relative to the page, which is already on HTTPS by then.

## Running it

The API and web app run on the host; only the proxy is containerised.

```bash
backend/scripts/restart-api.sh     # API on 0.0.0.0:4000
backend/scripts/restart-web.sh     # Next on 0.0.0.0:3000
deploy/restart-proxy.sh            # Caddy on 0.0.0.0:443 and :8080
```

Then open **https://192.168.1.46**.

To pick up a `Caddyfile` change without dropping live connections or the
certificate:

```bash
deploy/restart-proxy.sh --reload
```

`--reload` needs Caddy's admin API, which is why the `Caddyfile` does **not**
say `admin off`. The admin listener stays on `localhost:2019` *inside the
container* — not published in `docker-compose.yml`, so it is unreachable from
the host and the LAN (verified: nothing is listening on 2019 on the host). If
you ever add `- "2019:2019"` to the compose ports, you have just exposed remote
reconfiguration of this proxy to the network.

## The certificate warning, and removing it

The certificate is issued by **Caddy's internal CA**, which no browser trusts
by default. On first visit every browser shows a full-page warning; clicking
through it once is enough, and the origin is then a secure context, so calling
works.

To remove the warning for good, install Caddy's root certificate on each
machine. Get it with:

```bash
docker cp connect-proxy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Verify what you are about to install — the fingerprint must match the one
printed below:

```bash
openssl x509 -in ./caddy-root.crt -noout -subject -fingerprint -sha256
```

```
subject=CN = Caddy Local Authority - 2026 ECC Root
sha256 Fingerprint=79:0B:5C:EB:32:04:0E:21:E7:E8:C3:93:C0:49:82:BE:7B:10:4C:DC:02:B5:83:3C:29:3B:75:B0:10:D0:49:91
```

Then install it per platform:

| Platform | Command |
| -------- | ------- |
| Firefox | Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import, and tick "identify websites" |
| Chrome / Edge (Linux) | `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Caddy Local Authority" -i ./caddy-root.crt` |
| Chrome / Edge (macOS, Windows) | Keychain / Certificate Manager → System, import, then mark it trusted for authentication |
| Debian / Ubuntu (system-wide) | `sudo cp ./caddy-root.crt /usr/local/share/ca-certificates/connect-caddy.crt && sudo update-ca-certificates` |

Chrome on Linux uses the NSS database rather than the system store, so the
`certutil` line is the one that matters there.

## Things that will bite you

**The address is hardcoded.** `SITE_ADDRESS` in `Caddyfile` and in
`restart-proxy.sh` is `192.168.1.46`, and the machine's own hostname is
useless to anyone else because `/etc/hosts` maps it to `127.0.1.1`. If the DHCP
lease changes, update both files and re-run. `restart-proxy.sh` refuses to
start if the two disagree, because a mismatch produces a container that comes
up healthy and serves a certificate for the wrong address.

**`default_sni` is required.** Browsers must not put an IP literal in the TLS
SNI extension, so a client visiting `https://192.168.1.46` arrives with *no*
server name. Without `default_sni 192.168.1.46` in the global options block,
Caddy cannot choose a certificate and aborts the handshake with
`tlsv1 alert internal error` (alert 80). That looks like a broken proxy but is
really a name-selection failure.

**Do not delete the `caddy-data` volume.** It holds the CA private key and
every issued certificate. Removing it issues a new CA, which invalidates the
root every browser has already been told to trust.

**Do not edit the `Caddyfile` with `sed -i`.** Docker pins a single-file bind
mount to the inode it saw when the container started, and `sed -i` writes a
*new* file and renames it over the old one. The host copy then looks correct,
the container is still reading the original inode, and `caddy reload` re-applies
the old config and reports success — so the change appears to have been
rejected by Caddy rather than never having arrived. `restart-proxy.sh --reload`
now diffs the container's mounted copy against the host's and refuses, naming
the mismatch, precisely because this failure is otherwise silent. If you hit it
anyway, recreate the container (`--force-recreate`) rather than reloading.

**`--force-recreate` is safe.** The certificate is loaded from the volume on
start, so recreating the container does not change the CA. `--reload` is
preferred when only the `Caddyfile` changed, since it also keeps live
connections.

## No STUN or TURN

`ICE_SERVERS` in `frontend/lib/webrtc.ts` is empty, so peers exchange host
candidates only. On a single flat LAN that is sufficient and adds no external
dependency.

The limit is real: two devices behind separate routers or separate VLANs will
not connect, and no client-side setting can fix that. If this ever needs to
span networks, the change is a TURN server plus credentials in
`ICE_SERVERS` — it is not a WebRTC tweak.
