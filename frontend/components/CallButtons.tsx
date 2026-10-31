"use client";

import { useCalls } from "@/context/CallProvider";
import { useHasMediaSupport } from "@/lib/use-media-support";
import type { Conversation, PublicUser } from "@/lib/types";
import { IconPhone, IconVideo } from "./icons";

/**
 * Audio and video call buttons for a one-to-one chat header.
 *
 * Hidden for groups, because the peer connection is a direct two-party
 * negotiation and a group call would need mesh signalling. When the origin
 * cannot capture media the buttons are disabled with an explanation rather
 * than left to fail silently on click.
 */
export function CallButtons({
  conversation,
  peer,
}: {
  conversation: Pick<Conversation, "id" | "type">;
  peer: PublicUser | null;
}) {
  const { startCall, activeCall, incomingCall, outgoingRinging } = useCalls();
  const supported = useHasMediaSupport();

  const busy = Boolean(activeCall) || Boolean(incomingCall) || outgoingRinging;

  if (conversation.type !== "DIRECT" || !peer) return null;

  const call = (kind: "AUDIO" | "VIDEO") => {
    void startCall({ id: conversation.id, peer }, kind);
  };

  const title = supported
    ? busy
      ? "Already on a call"
      : undefined
    : "Calling needs an HTTPS connection";

  const shared =
    "flex h-9 w-9 items-center justify-center rounded-xl text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-2";

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => call("AUDIO")}
        disabled={busy || !supported}
        aria-label="Start voice call"
        title={title}
        className={shared}
      >
        <IconPhone size={19} />
      </button>

      <button
        type="button"
        onClick={() => call("VIDEO")}
        disabled={busy || !supported}
        aria-label="Start video call"
        title={title}
        className={shared}
      >
        <IconVideo size={19} />
      </button>
    </div>
  );
}
