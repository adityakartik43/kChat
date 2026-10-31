"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthProvider";
import { useCalls } from "@/context/CallProvider";
import type { Call, CallStatus } from "@/lib/types";
import {
  IconAlert,
  IconArrowDownLeft,
  IconArrowUpRight,
  IconClock,
  IconHistory,
  IconPhone,
  IconVideo,
} from "./icons";

/**
 * Recent calls in a conversation, opened from the chat header.
 *
 * Loading the list also has a side effect worth knowing about: the endpoint
 * marks any still-ringing call older than the ring timeout as missed, so a
 * call whose device went offline shows up correctly without a background job.
 */
export function CallHistory({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  const { activeCall, incomingCall, remoteCall, outgoingRinging } = useCalls();
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Whether the account is in a call right now, on this or any of its devices.
   *
   * A dependency of the load below, not just a value: the list used to be
   * fetched once when the chat page mounted, so a call placed and finished
   * without reloading the page left the history reading "No calls yet" — and
   * the header's missed-call badge, which counts from the same list, stuck at
   * zero. Refetching when a call starts or ends keeps both honest, and a
   * request per call transition is a price worth paying for that.
   */
  const inACall = Boolean(
    activeCall || incomingCall || remoteCall || outgoingRinging,
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await api.get<Call[]>(
          `/calls?conversationId=${encodeURIComponent(conversationId)}&limit=20`,
        );
        if (!cancelled) {
          setCalls(result);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Could not load call history.");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // `open` is included so opening the panel always shows current data, even
    // if a call finished while this component was mounted and unchanged.
  }, [conversationId, inACall, open]);

  // Popover semantics: click away or Escape closes it.
  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = calls?.length ?? 0;
  const missed =
    calls?.filter((call) => call.status === "MISSED").length ?? 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Call history"
        className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
          open ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-muted hover:text-ink"
        }`}
      >
        <IconHistory size={19} />

        {missed > 0 && !open && (
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Call history"
          className="animate-pop-in absolute right-0 z-40 mt-2 w-[19rem] origin-top-right overflow-hidden rounded-2xl border border-line bg-raised shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <IconClock size={15} className="text-ink-3" />
            <span className="text-sm font-semibold">Call history</span>
            <span className="ml-auto text-xs text-ink-3">{count}</span>
          </div>

          {error && (
            <p className="px-4 py-4 text-xs text-ink-3">{error}</p>
          )}

          {!error && calls === null && (
            <ul className="space-y-3 p-4" aria-hidden>
              {Array.from({ length: 3 }).map((_, index) => (
                <li key={index} className="flex items-center gap-3">
                  <div className="skeleton h-8 w-8 rounded-full" />
                  <div className="skeleton h-3 flex-1 rounded-full" />
                </li>
              ))}
            </ul>
          )}

          {!error && calls?.length === 0 && (
            <p className="px-4 py-5 text-center text-xs text-ink-3">
              No calls in this conversation yet.
            </p>
          )}

          {!error && calls && calls.length > 0 && (
            <ul className="max-h-80 overflow-y-auto p-1.5">
              {calls.map((call) => {
                const outbound = call.callerId === user?.id;
                const tone = toneFor(call.status, outbound);

                return (
                  <li
                    key={call.id}
                    className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted"
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.bg} ${tone.text}`}
                    >
                      <StatusIcon call={call} outbound={outbound} size={15} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">
                        {describe(call, user?.id ?? "")}
                      </p>
                      <p className="text-[11px] text-ink-3">
                        {call.kind === "VIDEO" ? "Video" : "Voice"} ·{" "}
                        {formatWhen(call.createdAt)}
                      </p>
                    </div>

                    {call.durationSeconds !== null && (
                      <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">
                        {formatLength(call.durationSeconds)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({
  call,
  outbound,
  size = 15,
}: {
  call: Call;
  outbound: boolean;
  size?: number;
}) {
  if (call.status === "MISSED" || call.status === "DECLINED") {
    return outbound ? (
      <IconArrowUpRight size={size} />
    ) : (
      <IconArrowDownLeft size={size} />
    );
  }

  if (call.status === "FAILED") return <IconAlert size={size} />;

  return call.kind === "VIDEO" ? (
    <IconVideo size={size} />
  ) : (
    <IconPhone size={size} />
  );
}

function toneFor(status: CallStatus, outbound: boolean): {
  bg: string;
  text: string;
} {
  if (status === "MISSED" && !outbound) {
    return { bg: "bg-danger-soft", text: "text-danger" };
  }

  if (status === "MISSED" || status === "DECLINED" || status === "FAILED") {
    return { bg: "bg-danger-soft", text: "text-danger" };
  }

  return { bg: "bg-success-soft", text: "text-success" };
}

function describe(call: Call, selfId: string): string {
  const outbound = call.callerId === selfId;

  switch (call.status) {
    case "MISSED":
      return outbound ? "No answer" : "Missed call";
    case "DECLINED":
      return outbound ? "Declined" : "Call declined";
    case "FAILED":
      return "Call failed";
    case "RINGING":
      return "Ringing…";
    case "ACCEPTED":
      return "In progress";
    case "ENDED_BY_CALLER":
    case "ENDED_BY_CALLEE": {
      const length = formatLength(call.durationSeconds);
      const label = outbound ? "Outgoing" : "Answered";
      // A call torn down before it was ever answered has no length; say
      // what happened without trailing a placeholder dash.
      return length === "—" ? label : `${label} · ${length}`;
    }
    default:
      return statusLabel(call.status);
  }
}

function statusLabel(status: CallStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

function formatLength(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

/** Time for today, otherwise a day/month label. */
function formatWhen(iso: string): string {
  const when = new Date(iso);
  const now = new Date();

  const sameDay = when.toDateString() === now.toDateString();

  if (sameDay) {
    return when.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return when.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
