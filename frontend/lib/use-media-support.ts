"use client";

import { useSyncExternalStore } from "react";
import { canAccessMedia } from "./webrtc";

/**
 * Nothing to subscribe to: whether the origin can capture media is fixed for
 * the lifetime of the document. The subscription exists only to give
 * `useSyncExternalStore` the shape it requires.
 */
const subscribeToNothing = () => () => {};

/**
 * Whether this page may access the camera and microphone, resolved without a
 * hydration mismatch.
 *
 * `canAccessMedia()` is a browser API, so it cannot be called during render:
 * the server would answer "no" (no `navigator`) and the client's first render
 * would answer "yes", and React would report a mismatch on every call button.
 * `useSyncExternalStore` is the intended fix — it uses the server snapshot for
 * the hydration render and the real one immediately after.
 */
export function useHasMediaSupport(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    canAccessMedia,
    // Assume support on the server so the markup matches the first client
    // render; the corrected value lands in the render right after hydration.
    () => true,
  );
}
