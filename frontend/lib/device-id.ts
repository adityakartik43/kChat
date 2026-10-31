/**
 * A stable identifier for this browser tab, used to work out which device is
 * carrying a call's media.
 *
 * One signed-in account is many endpoints at once — several tabs, a phone, a
 * laptop — and the account is the right unit for *state* (a call rings on
 * every device, and stops ringing on all of them once any one answers) but
 * the wrong unit for *media*. A peer connection is negotiated between two
 * specific endpoints, so both sides have to be able to name the device they
 * are talking to.
 *
 * `sessionStorage` is the right store: it is partitioned per tab, so two tabs
 * of one account are two devices, and it survives a reload in the same tab.
 * That last part matters more than it looks — a reload mid-call creates a new
 * socket, and keeping the id lets the tab be recognised as the same device
 * when the server re-registers it.
 */

const STORAGE_KEY = "connect.deviceId";

/**
 * Mints an id without depending on `crypto.randomUUID`.
 *
 * That function is secure-context-only, and this runs during server rendering
 * where there is no `window` at all. The id is not a secret — it is a label
 * the server compares for equality — so the fallback's weaker randomness costs
 * nothing that matters.
 */
function mintDeviceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.().replace(/-/g, "");

  if (uuid) return `d${uuid}`;

  const stamp = Date.now().toString(36);
  const noise = Math.random().toString(36).slice(2, 12);

  return `d${stamp}${noise}`;
}

/**
 * Returns this tab's device id, creating and storing one on first use.
 *
 * Storage can be unavailable (private modes, embedded webviews, and Safari
 * with third-party storage blocked all throw rather than degrade), and a call
 * should still work when `sessionStorage` does not. Falling back to a freshly
 * minted id costs only the ability to recognise the same tab after a reload —
 * strictly better than failing the call.
 */
export function readDeviceId(): string {
  if (typeof window === "undefined") {
    // Server render. Never reaches the socket, which only exists in the
    // browser; the client render produces the real value.
    return "server-render";
  }

  try {
    const existing = window.sessionStorage.getItem(STORAGE_KEY);

    if (existing) return existing;

    const minted = mintDeviceId();
    window.sessionStorage.setItem(STORAGE_KEY, minted);

    return minted;
  } catch {
    return mintDeviceId();
  }
}
