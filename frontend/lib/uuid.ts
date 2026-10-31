/**
 * RFC 4122 version 4 UUID, with a fallback for insecure contexts.
 *
 * `crypto.randomUUID()` is only exposed in a secure context, so it is
 * `undefined` on a plain-HTTP LAN origin such as `http://192.168.1.46:3000`
 * (browsers treat `localhost` as secure, which hides this in local dev).
 * Calling it unguarded throws "crypto.randomUUID is not a function" and
 * silently breaks sending messages.
 *
 * `crypto.getRandomValues` has no such restriction, so prefer it and fall
 * back to `Math.random` only if even that is unavailable.
 */
export function uuidv4(): string {
  const cryptoObj = globalThis.crypto;

  if (typeof cryptoObj?.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (typeof cryptoObj?.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Pin the version (4) and variant (10xx) bits required by RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
