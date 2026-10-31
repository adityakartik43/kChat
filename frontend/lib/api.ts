/**
 * Thin API client.
 *
 * Holds the access token in memory and the refresh token in localStorage.
 * On a 401 it transparently rotates the refresh token once and replays the
 * original request, so an expired access token never surfaces to the UI.
 */

const API_PORT = process.env.NEXT_PUBLIC_API_PORT ?? "4000";

/**
 * Resolve the API base at call time rather than baking it in at build time.
 *
 * `NEXT_PUBLIC_API_URL` is inlined by Next at build time, so hardcoding
 * `http://localhost:4000` would make every visitor on the LAN point at
 * port 4000 of their *own* machine. Three configurations are supported, in
 * order of preference:
 *
 *   unset        Derive the origin from the page the browser is on
 *                (same hostname, `API_PORT`). One build serves localhost,
 *                a LAN IP, or a DNS name with no rebuild.
 *
 *   a path       Same-origin mode. Returns the path prefix — usually `/api`
 *                — and every request becomes relative. Nothing is
 *                cross-origin, so CORS does not apply and the API port
 *                never has to be reachable by the browser. This is the mode
 *                used behind the TLS terminator, where it is what makes
 *                camera and microphone access possible (they require a
 *                secure context, and a second http:// origin would also be
 *                blocked as mixed content on an https:// page).
 *
 *   an origin    Talk to the API directly at that absolute URL.
 *
 * In same-origin mode this returns a string beginning with `/`, which
 * `SocketProvider` reads as "connect to the page's own origin".
 */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (configured) {
    const withoutTrailingSlash = configured.replace(/\/+$/, "");

    if (/^https?:\/\//i.test(withoutTrailingSlash)) return withoutTrailingSlash;
    if (withoutTrailingSlash.startsWith("/")) return withoutTrailingSlash;
  }

  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
  }

  return `http://localhost:${API_PORT}`;
}

/** True when requests should be relative to the page's own origin. */
export function isSameOriginApi(): boolean {
  return getApiBaseUrl().startsWith("/");
}

/**
 * Where Socket.IO should connect, or `undefined` for the page's own origin.
 *
 * REST and the WebSocket cannot always share a target, and the reason is a
 * hard limitation in Next's dev/prod proxy:
 *
 *   - REST goes through `/api` in same-origin mode, and Next's rewrite proxy
 *     forwards it fine.
 *   - The WebSocket **cannot**. Next does not handle the HTTP `upgrade`
 *     event, so a `ws://` request to a rewritten path is not proxied at all:
 *     the connection hangs, or the server answers with something that is not
 *     an HTTP response. Measured against `next start` on this project, a
 *     rewrite to `/socket.io/` never completes the handshake.
 *
 * So the socket target depends on the page's scheme, and each branch is
 * forced rather than preferred:
 *
 *   https   Must be same-origin. An https page is not permitted to open an
 *           insecure WebSocket, and the TLS terminator (deploy/Caddyfile)
 *           does handle the upgrade, routing /socket.io to the API.
 *
 *   http    Must bypass Next and address the API directly, because the
 *           alternative does not connect. Fine for localhost, where the
 *           browser already treats the origin as secure and calling works
 *           without TLS.
 */
export function getSocketUrl(): string | undefined {
  const base = getApiBaseUrl();

  if (!base.startsWith("/")) return base;

  if (typeof window === "undefined") return undefined;

  if (window.location.protocol === "https:") return undefined;

  return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
}


const ACCESS_TOKEN_KEY = "connect.accessToken";
const REFRESH_TOKEN_KEY = "connect.refreshToken";

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  if (typeof window === "undefined") return null;

  accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY);
  return accessToken;
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;

  if (typeof window === "undefined") return;

  if (access) window.localStorage.setItem(ACCESS_TOKEN_KEY, access);
  else window.localStorage.removeItem(ACCESS_TOKEN_KEY);

  if (refresh) window.localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  else window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const message = body?.message;

    if (Array.isArray(message)) return message.join(", ");
    if (typeof message === "string") return message;
  } catch {
    // fall through to the status text
  }

  return response.statusText || "Request failed";
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();

  if (!refreshToken) return false;

  // Collapse concurrent refreshes into a single in-flight request.
  refreshPromise ??= (async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        setTokens(null, null);
        return false;
      }

      const data = await response.json();
      setTokens(data.tokens.accessToken, data.tokens.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function request<T>(
  path: string,
  method: Method = "GET",
  body?: unknown,
  retry = true,
): Promise<T> {
  const token = getAccessToken();

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 401 && retry && getRefreshToken()) {
    if (await refreshAccessToken()) {
      return request<T>(path, method, body, false);
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, "GET"),
  post: <T>(path: string, body?: unknown) => request<T>(path, "POST", body),
  patch: <T>(path: string, body?: unknown) => request<T>(path, "PATCH", body),
  del: <T>(path: string) => request<T>(path, "DELETE"),
  refreshAccessToken,
};
