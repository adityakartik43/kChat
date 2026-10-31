import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends plain-HTTP visitors to the HTTPS origin.
 *
 * The app is served on 443 by the TLS terminator in `deploy/`, and that is the
 * only origin on which calling works: browsers hide `navigator.mediaDevices`
 * outside a secure context, so on `http://<lan-ip>:3000` the camera and
 * microphone APIs do not exist. Chat still works there, which is what makes the
 * mistake easy to make and hard to notice.
 *
 * Rather than only documenting "use https://", this makes the wrong URL correct
 * itself. Anyone who types the plain-HTTP address is redirected to the address
 * the certificate was issued for.
 *
 * Two guards keep this from breaking the cases that must keep working:
 *
 *   - **Proxied requests are left alone.** Caddy stamps `X-Connect-Proxy` on
 *     everything it forwards, and those requests are already the HTTPS origin.
 *     Redirecting them would loop.
 *   - **`HTTPS_ORIGIN` gates the whole thing.** Unset — as in `npm run dev` or
 *     the documented plain-HTTP LAN mode — nothing is redirected and the
 *     behaviour is exactly what it was before. Set, and only then does this
 *     apply. It is a server-side variable, so it is not inlined into the client
 *     bundle and can differ per environment without a rebuild.
 *
 * Loopback is exempt as well: browsers already treat `localhost` as a secure
 * context, so there is no broken behaviour to correct there, and the
 * development server has no HTTPS listener to redirect to.
 *
 * 308 rather than 301/302 because the redirect also covers `POST /api/...`.
 * A 301 or 302 lets a client downgrade the method to GET, which would turn a
 * login into a bodiless GET; 308 preserves the method and body.
 *
 * One property worth knowing: the hop changes origin (scheme and port), and
 * browsers strip the `Authorization` header on a cross-origin redirect. So an
 * authenticated request deliberately aimed at the plain-HTTP port comes back
 * 401 at the far end. Nothing in the app does that — it calls `/api` relative
 * to the page, and by then the page is already on HTTPS, so those requests are
 * same-origin and never redirect. It only shows up if you point a token-bearing
 * request at port 3000 yourself.
 *
 * Named `proxy.ts` rather than `middleware.ts`: the latter is deprecated as of
 * Next 16 in favour of this convention.
 */
const PROXY_HEADER = "x-connect-proxy";

/** Loopback is already a secure context, so there is nothing to fix there. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The hostname the client actually asked for.
 *
 * Not `new URL(request.url).hostname`: Next builds that URL from the address
 * the server is *bound* to, so with `--hostname 0.0.0.0` every request reports
 * `0.0.0.0` no matter who asked. Reading it from there makes the loopback check
 * above silently never match, which is exactly the bug this function exists to
 * avoid. The real value is in the headers.
 */
function requestedHost(request: NextRequest): string {
  // X-Forwarded-Host may be a comma-separated list; the client is first.
  const raw =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const host = raw.split(",")[0]!.trim().toLowerCase();

  // Bracketed IPv6 keeps its colons, so only cut after the closing bracket.
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }

  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

export function proxy(request: NextRequest) {
  const origin = process.env.HTTPS_ORIGIN;
  if (!origin) return NextResponse.next();

  // Already arrived through the terminator, so this IS the secure origin.
  if (request.headers.get(PROXY_HEADER)) return NextResponse.next();

  if (LOOPBACK.has(requestedHost(request))) return NextResponse.next();

  // The path comes from the request line, which `request.url` does reflect
  // correctly even though its host is wrong — the pathname and query are real.
  const incoming = new URL(request.url);
  const target = new URL(origin);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  target.hash = "";

  return NextResponse.redirect(target, 308);
}

export const config = {
  /**
   * Everything except Next's build output. Static chunks are only ever
   * requested by a page that has already been redirected to HTTPS, so running
   * this on them would be cost without benefit.
   */
  matcher: ["/((?!_next/static|_next/image).*)"],
};
