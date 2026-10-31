"use client";

import { useState } from "react";
import { useCalls } from "@/context/CallProvider";
import { mediaUnavailableReason } from "@/lib/webrtc";
import { IconAlert, IconX } from "./icons";

/**
 * Explains why calling is unavailable, or that a call failed, once, in the
 * corner.
 *
 * The unavailable case must render from capability alone, without waiting for a
 * failed call. On a plain-HTTP LAN address the browser hides
 * `navigator.mediaDevices` entirely, so `CallButtons` disables itself — and a
 * disabled button cannot be clicked, so the "call failed" path never runs and
 * an error-driven notice would never appear. The user would be left with a
 * greyed-out button and no explanation at all.
 *
 * That leaves a `title` tooltip as the only clue, which is a poor last resort:
 * native tooltips are slow, some browsers suppress them on disabled controls
 * entirely, and there is no hover on a touchscreen — which is precisely the
 * device most likely to want to place a call.
 */
export function CallMediaNotice() {
  const { mediaError, mediaUnsupported, dismissMediaError } = useCalls();

  /**
   * The text of the notice the user closed, or null.
   *
   * Keyed on the message rather than a boolean because both sources of a notice
   * are outside this component: `mediaUnsupported` is derived from the origin
   * and `dismissMediaError` only clears a call error, so a flag here would need
   * an effect to un-set it and would reappear on the next render anyway. A
   * *different* message always shows regardless, which is the case that
   * matters — fixing the origin, or a new failure, both surface immediately.
   * The cost is that the identical sentence is not shown twice in a row, which
   * is the right behaviour for a notice the user just dismissed.
   */
  const [dismissed, setDismissed] = useState<string | null>(null);

  const message =
    mediaError ?? (mediaUnsupported ? mediaUnavailableReason() : null);

  if (!message || message === dismissed) return null;

  return (
    <div
      role="alert"
      className="animate-pop-in fixed right-4 bottom-4 z-[60] w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-raised shadow-lg"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
          <IconAlert size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {mediaUnsupported ? "Calling is unavailable" : "Call problem"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">{message}</p>
        </div>

        <button
          type="button"
          onClick={() => {
            dismissMediaError();
            setDismissed(message);
          }}
          aria-label="Dismiss"
          className="-mt-1 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-muted hover:text-ink"
        >
          <IconX size={15} />
        </button>
      </div>
    </div>
  );
}
