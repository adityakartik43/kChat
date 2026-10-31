import type { NextConfig } from "next";

/**
 * Same-origin proxy to the API.
 *
 * Two deployments share this build:
 *
 *   Direct    With `NEXT_PUBLIC_API_URL` unset, the browser talks to the
 *             API's absolute origin (see `getApiBaseUrl()` in `lib/api.ts`)
 *             and these rewrites are unused.
 *
 *   Proxied   With `NEXT_PUBLIC_API_URL=/api`, every request is relative to
 *             the page and these rewrites route it to the API. Behind the
 *             TLS terminator this is what makes the app single-origin, which
 *             is a precondition for camera and microphone access. It also
 *             works without the terminator, so plain-HTTP development keeps
 *             functioning through the same configuration.
 *
 * The destination is resolved at server start, not build time, so it never
 * goes stale when `.env.local` changes.
 */
const apiOrigin =
  process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // Socket.IO needs a rewrite in the `beforeFiles` phase, and the reason
      // is specific rather than stylistic.
      //
      // Its handshake is GET /socket.io/?EIO=4&transport=... — with a trailing
      // slash, the only form the API answers on. With the default
      // `trailingSlash: false`, Next normalises that to /socket.io, which the
      // API 404s, so an `afterFiles` rewrite dead-ends.
      //
      // Rewriting to /socket.io works for the *polling* transport, where the
      // 308 is followed transparently, but not for WebSocket: the upgrade
      // handshake cannot follow a redirect and the connection simply fails,
      // leaving the app stuck on "Reconnecting".
      //
      // `beforeFiles` runs ahead of that normalisation, so the request is
      // proxied with its trailing slash intact and the upgrade succeeds.
      beforeFiles: [
        { source: "/socket.io/:path*", destination: `${apiOrigin}/socket.io/:path*` },
      ],
      afterFiles: [
        { source: "/api/:path*", destination: `${apiOrigin}/:path*` },
      ],
    };
  },
};

export default nextConfig;
