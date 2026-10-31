"use client";

import { useState } from "react";
import { formatConnectNumber } from "@/lib/format";
import { IconCheck, IconCopy, IconEye, IconEyeOff } from "./icons";

interface PrivateNumberCardProps {
  number: string;
  /** `compact` is the one-line version used in the conversation panel footer. */
  variant?: "card" | "compact";
}

/**
 * The number other people type to find you.
 *
 * It is the app's whole onboarding story, so it is shown in three places —
 * the conversation panel footer, Connect and Settings — with the reveal and
 * copy behaviour identical in each.
 */
export function PrivateNumberCard({
  number,
  variant = "card",
}: PrivateNumberCardProps) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const shown = revealed ? formatConnectNumber(number) : "••••-••••-••";

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
            Your number
          </p>
          <p className="truncate font-mono text-[15px] font-semibold tracking-[0.06em] tabular-nums">
            {shown}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          aria-label={revealed ? "Hide number" : "Reveal number"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-muted hover:text-ink"
        >
          {revealed ? <IconEyeOff size={16} /> : <IconEye size={16} />}
        </button>

        <button
          type="button"
          onClick={() => void copy()}
          disabled={!number}
          aria-label="Copy your number"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-muted hover:text-ink disabled:opacity-40"
        >
          {copied ? (
            <IconCheck size={16} className="text-success" />
          ) : (
            <IconCopy size={16} />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
      <div className="bg-[image:var(--gradient-brand)] px-5 py-4 text-on-brand">
        <p className="text-[11px] font-semibold tracking-[0.1em] uppercase opacity-80">
          Your private number
        </p>
        <p className="mt-1.5 font-mono text-2xl font-semibold tracking-[0.12em] break-anywhere">
          {shown}
        </p>
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface text-[13px] font-medium text-ink transition-colors hover:bg-muted"
        >
          {revealed ? <IconEyeOff size={15} /> : <IconEye size={15} />}
          {revealed ? "Hide" : "Reveal"}
        </button>

        <button
          type="button"
          onClick={() => void copy()}
          disabled={!number}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[image:var(--gradient-brand)] text-[13px] font-semibold text-on-brand transition-[filter] hover:brightness-110 disabled:opacity-50"
        >
          {copied ? (
            <IconCheck size={15} />
          ) : (
            <IconCopy size={15} />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <p className="px-4 pb-4 text-xs leading-relaxed text-ink-2">
        Share it so others can find you in Connect. They need the number to send
        you a request — nothing is ever texted or dialed.
      </p>
    </div>
  );
}
