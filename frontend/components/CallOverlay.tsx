"use client";

import { useEffect, useRef, useState } from "react";
import { useCalls } from "@/context/CallProvider";
import { Avatar } from "./Avatar";
import {
  IconMic,
  IconMicOff,
  IconPhone,
  IconPhoneOff,
  IconVideo,
  IconVideoOff,
} from "./icons";

/**
 * The single full-screen surface for every call state: ringing in, ringing
 * out, connected, and any media failure.
 *
 * It is rendered once at the shell level rather than inside a chat page, so a
 * call survives navigating between chats and an incoming call is visible
 * wherever the user happens to be.
 */
export function CallOverlay() {
  const {
    incomingCall,
    activeCall,
    remoteCall,
    connectingCall,
    outgoingRinging,
    acceptCall,
    rejectCall,
    endCall,
  } = useCalls();

  // A tab that is only watching a call on another of this account's devices
  // gets a passive note rather than the full-screen call surface. Rendering
  // the full surface would be actively wrong here: there is no media behind
  // it, and its hang-up button would end a conversation this tab is not in.
  // The note is non-interactive on purpose — dismissing it is not something
  // the account should be able to do, because the call is still happening.
  const bystander = remoteCall && !incomingCall && !activeCall ? remoteCall : null;

  const surface = (() => {
    if (incomingCall) {
      return (
        <IncomingCall
          name={incomingCall.caller.name}
          avatarUrl={incomingCall.caller.avatarUrl}
          kind={incomingCall.call.kind}
          onAccept={() => void acceptCall()}
          onReject={rejectCall}
        />
      );
    }

    if (connectingCall) {
      return (
        <ConnectingCall
          name={connectingCall.caller.name}
          avatarUrl={connectingCall.caller.avatarUrl}
          kind={connectingCall.call.kind}
          onCancel={endCall}
        />
      );
    }

    if (activeCall) {
      return (
        <ActiveCallView
          key={activeCall.call.id}
          name={activeCall.peer.name}
          kind={activeCall.kind}
          connectedAt={activeCall.connectedAt}
          role={activeCall.role}
          onEnd={endCall}
        />
      );
    }

    if (outgoingRinging) {
      return <OutgoingRinging onCancel={endCall} />;
    }

    return null;
  })();

  if (!surface && !bystander) return null;

  return (
    <>
      {bystander ? (
        <div
          role="status"
          // `status` does not take its accessible name from its contents, so
          // without this the note is announced as an unlabelled live region —
          // a screen reader user would hear the status change with no idea
          // what had changed.
          aria-label={
            bystander.role === "caller"
              ? `Calling ${bystander.peer.name} on your other device`
              : `Talking to ${bystander.peer.name} on your other device`
          }
          className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-4"
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-slate-900/95 px-4 py-2 text-sm text-slate-200 shadow-lg backdrop-blur">
            <span
              aria-hidden
              className={`size-2 shrink-0 rounded-full ${
                bystander.call.kind === "VIDEO" ? "bg-sky-400" : "bg-emerald-400"
              }`}
            />
            <span className="truncate">
              {bystander.role === "caller" ? "Calling" : "Talking to"}{" "}
              <span className="font-medium text-white">
                {bystander.peer.name}
              </span>{" "}
              on your other device
            </span>
          </div>
        </div>
      ) : null}
      {surface}
    </>
  );
}

/**
 * Seconds elapsed since a timestamp, ticking once a second.
 *
 * Returns 0 while `since` is null (still connecting) rather than resetting
 * stored state, so the value is derived on every render instead of being
 * synchronised by an effect.
 */
function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);

  if (since === null) return 0;

  return Math.max(0, Math.floor((now - since) / 1000));
}

/** A counter that starts at 0 and ticks once a second. */
function useTicker(): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return seconds;
}

/**
 * This device answered, and the call is not up yet.
 *
 * The distinction from `ActiveCallView` is the point of this component. It
 * exists for the seconds in which the answer has been sent and the server has
 * not yet confirmed it, and in that window the caller is still hearing
 * ringback while this device is waiting on a database round trip and a capture
 * device. Reusing the active-call surface here would show a connection, with a
 * timer and a hang-up button, for a call that is not connected — and the other
 * devices would still be ringing, which is precisely the failure this state
 * was added to make visible.
 */
function ConnectingCall({
  name,
  avatarUrl,
  kind,
  onCancel,
}: {
  name: string;
  avatarUrl: string | null;
  kind: "AUDIO" | "VIDEO";
  onCancel: () => void;
}) {
  const seconds = useTicker();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      // Deliberately not "Video call with …": that name belongs to the
      // connected surface, and reusing it would let this state pass for a call
      // that is carrying media.
      aria-label={`Connecting ${kind === "VIDEO" ? "video" : "voice"} call to ${name}`}
    >
      <div className="animate-pop-in w-full max-w-sm overflow-hidden rounded-3xl border border-line bg-raised text-center shadow-xl">
        <div className="relative overflow-hidden px-6 pt-8 pb-6">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.18]"
            style={{ backgroundImage: "var(--gradient-brand)" }}
          />

          <div className="relative flex justify-center">
            <span className="relative flex h-24 w-24 items-center justify-center">
              <span
                aria-hidden
                className="animate-ring absolute inset-0 rounded-full border-2 border-brand"
              />
              <Avatar name={name} src={avatarUrl} size="lg" />
            </span>
          </div>

          <p className="relative mt-4 text-lg font-semibold tracking-tight">
            {name}
          </p>
          <p className="relative mt-0.5 text-xs font-medium tracking-wide text-ink-3 uppercase">
            Connecting · {seconds}s
          </p>
          <p className="relative mt-3 text-sm text-ink-2">
            Waiting for the other side to pick up. If this does not finish, you
            can cancel and try again.
          </p>
        </div>

        <div className="border-t border-line p-4">
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-xl border border-line px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-raised"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function IncomingCall({
  name,
  avatarUrl,
  kind,
  onAccept,
  onReject,
}: {
  name: string;
  avatarUrl: string | null;
  kind: "AUDIO" | "VIDEO";
  onAccept: () => void;
  onReject: () => void;
}) {
  const seconds = useTicker();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming ${kind === "VIDEO" ? "video" : "voice"} call from ${name}`}
    >
      <div className="animate-pop-in w-full max-w-sm overflow-hidden rounded-3xl border border-line bg-raised text-center shadow-xl">
        <div className="relative overflow-hidden px-6 pt-8 pb-6">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage: "var(--gradient-brand)",
            }}
          />

          <div className="relative flex justify-center">
            <span className="relative flex h-24 w-24 items-center justify-center">
              <span
                aria-hidden
                className="animate-ring absolute inset-0 rounded-full border-2 border-brand"
              />
              <span
                aria-hidden
                className="animate-ring absolute inset-0 rounded-full border-2 border-brand"
                style={{ animationDelay: "0.7s" }}
              />
              <Avatar name={name} src={avatarUrl} size="lg" />
            </span>
          </div>

          <p className="relative mt-4 text-lg font-semibold tracking-tight">
            {name}
          </p>
          <p className="relative mt-0.5 text-xs font-medium tracking-wide text-ink-3 uppercase">
            Incoming {kind === "VIDEO" ? "video" : "voice"} call ·{" "}
            <span className="tabular-nums">{formatDuration(seconds)}</span>
          </p>
        </div>

        <div className="flex items-center justify-center gap-10 border-t border-line bg-surface px-6 py-5">
          <CallAction
            label="Decline"
            tone="danger"
            onClick={onReject}
            icon={<IconPhoneOff size={22} />}
          />
          <CallAction
            label={kind === "VIDEO" ? "Accept video" : "Accept"}
            tone="success"
            onClick={onAccept}
            autoFocus
            icon={kind === "VIDEO" ? <IconVideo size={22} /> : <IconPhone size={22} />}
          />
        </div>
      </div>
    </div>
  );
}

function CallAction({
  label,
  tone,
  icon,
  onClick,
  autoFocus,
}: {
  label: string;
  tone: "danger" | "success";
  icon: React.ReactNode;
  onClick: () => void;
  autoFocus?: boolean;
}) {
  const tones = {
    danger: "bg-danger text-white shadow-[0_10px_24px_-8px_rgba(225,29,72,0.7)]",
    success: "bg-success text-white shadow-[0_10px_24px_-8px_rgba(22,163,74,0.7)]",
  } as const;

  return (
    <button
      type="button"
      onClick={onClick}
      autoFocus={autoFocus}
      className="flex flex-col items-center gap-2"
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-full transition-transform duration-150 hover:scale-105 active:scale-95 ${tones[tone]}`}
      >
        {icon}
      </span>
      <span className="text-xs font-medium text-ink-2">{label}</span>
    </button>
  );
}

function OutgoingRinging({ onCancel }: { onCancel: () => void }) {
  const seconds = useTicker();

  return (
    <div
      className="animate-pop-in fixed right-4 bottom-4 z-50 w-72 overflow-hidden rounded-2xl border border-line bg-raised shadow-xl"
      role="status"
      aria-label="Outgoing call, ringing"
    >
      <div className="relative px-5 py-5 text-center">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14]"
          style={{ backgroundImage: "var(--gradient-brand)" }}
        />

        <p className="relative flex items-center justify-center gap-2 text-xs font-semibold tracking-wide text-brand uppercase">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
          Ringing
        </p>
        <p className="relative mt-2 text-sm text-ink-2">
          Waiting for them to pick up…
        </p>
        <p className="relative mt-1 text-xs text-ink-3 tabular-nums">
          {formatDuration(seconds)}
        </p>
      </div>

      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel call"
        className="flex w-full items-center justify-center gap-2 border-t border-line bg-danger-soft py-3 text-sm font-semibold text-danger transition-colors hover:bg-danger hover:text-white"
      >
        <IconPhoneOff size={17} />
        Cancel
      </button>
    </div>
  );
}

function ActiveCallView({
  name,
  kind,
  connectedAt,
  role,
  onEnd,
}: {
  name: string;
  kind: "AUDIO" | "VIDEO";
  connectedAt: number | null;
  role: "caller" | "callee";
  onEnd: () => void;
}) {
  const { localStream, remoteStream, micEnabled, cameraEnabled, toggleMic, toggleCamera } =
    useCalls();
  const seconds = useElapsedSeconds(connectedAt);
  const connecting = connectedAt === null;

  const showVideo = kind === "VIDEO";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#07090e] text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`${showVideo ? "Video" : "Voice"} call with ${name}`}
    >
      {/* Ambient glow so the audio screen is not a flat black rectangle. */}
      {!showVideo && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(40rem 24rem at 50% 0%, var(--color-brand), transparent 70%)",
          }}
        />
      )}

      <header className="relative flex items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <Avatar name={name} size="sm" />
          <div>
            <p className="text-sm font-semibold">{name}</p>
            <p className="text-xs text-white/55 tabular-nums">
              {connecting
                ? "Connecting…"
                : `${role === "caller" ? "Outgoing" : "Incoming"} · ${formatDuration(seconds)}`}
            </p>
          </div>
        </div>

        <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/70">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connecting ? "animate-pulse bg-amber-400" : "bg-success"
            }`}
          />
          {connecting ? "Negotiating" : "Connected"}
        </span>
      </header>

      <div className="relative min-h-0 flex-1">
        {showVideo ? (
          <>
            <VideoSurface
              stream={remoteStream}
              muted={false}
              className="h-full w-full"
            />

            {/* Self-view, so the caller can check framing and lighting. */}
            <div className="absolute right-4 bottom-4 h-36 w-28 overflow-hidden rounded-2xl border border-white/15 bg-black/70 shadow-lg sm:h-44 sm:w-36">
              <VideoSurface stream={localStream} muted mirror className="h-full w-full" />
            </div>

            {remoteStream === null && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="rounded-full bg-black/60 px-4 py-2 text-sm text-white/80 backdrop-blur">
                  Waiting for their video…
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="relative flex h-full flex-col items-center justify-center gap-5">
            <span className="relative flex h-32 w-32 items-center justify-center">
              <span
                aria-hidden
                className="animate-ring absolute inset-0 rounded-full border border-white/40"
              />
              <Avatar name={name} size="xl" />
            </span>

            <div className="text-center">
              <p className="text-xl font-semibold tracking-tight">{name}</p>
              <p className="mt-1 text-sm text-white/55 tabular-nums">
                {connecting ? "Connecting…" : formatDuration(seconds)}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="relative flex items-start justify-center gap-4 px-5 py-7 sm:gap-6">
        <CallToggle
          active={micEnabled}
          onClick={toggleMic}
          label={micEnabled ? "Mute microphone" : "Unmute microphone"}
          onIcon={<IconMic size={22} />}
          offIcon={<IconMicOff size={22} />}
        />

        {showVideo && (
          <CallToggle
            active={cameraEnabled}
            onClick={toggleCamera}
            label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
            onIcon={<IconVideo size={22} />}
            offIcon={<IconVideoOff size={22} />}
          />
        )}

        <button
          type="button"
          onClick={onEnd}
          aria-label="End call"
          className="flex flex-col items-center gap-2"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white shadow-[0_12px_28px_-8px_rgba(225,29,72,0.8)] transition-transform duration-150 hover:scale-105 active:scale-95">
            <IconPhoneOff size={23} />
          </span>
          <span className="text-xs font-medium text-white/60">End</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Mic / camera control. `active` means the hardware is *on*, which is the
 * confusing one: the icon shows what it does next, and the pressed state
 * (dimmed) is what turns it off.
 */
function CallToggle({
  active,
  onClick,
  label,
  onIcon,
  offIcon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className="flex flex-col items-center gap-2"
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-full transition-all duration-150 hover:scale-105 active:scale-95 ${
          active
            ? "bg-white/15 text-white"
            : "bg-white text-[#07090e] ring-2 ring-white/25"
        }`}
      >
        {active ? onIcon : offIcon}
      </span>
      <span className="text-xs font-medium text-white/60">
        {active ? "On" : "Off"}
      </span>
    </button>
  );
}

/**
 * Renders a MediaStream into a <video> element.
 *
 * The stream is attached in an effect rather than as a prop because React
 * cannot reconcile a `srcObject`; assigning it during render would run on every
 * repaint and interrupt playback.
 *
 * The `<video>` element is rendered unconditionally and the "no video" state is
 * an overlay. Gating the element on whether a video track exists looks
 * equivalent but is not: the attaching effect reads `ref.current`, which is
 * null on the render where the decision is still "no video", and since the
 * effect only re-runs when `stream` changes, the element that appears on the
 * following render never receives the stream at all.
 */
function VideoSurface({
  stream,
  muted,
  mirror = false,
  className,
}: {
  stream: MediaStream | null;
  muted: boolean;
  mirror?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.srcObject = stream;

    if (stream) {
      // Autoplay can be refused until the element is actually in the document
      // and unmuted, so the attempt is repeated on each stream change.
      void element.play().catch(() => undefined);
    }

    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  const hasVideo = stream !== null && stream.getVideoTracks().length > 0;

  return (
    <div className={`relative ${className ?? ""}`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${mirror ? "-scale-x-100" : ""} ${
          hasVideo ? "" : "opacity-0"
        }`}
      />

      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          <span className="text-sm text-white/40">No video</span>
        </div>
      )}
    </div>
  );
}

/** `m:ss`, widening to `h:mm:ss` only if a call ever exceeds an hour. */
function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
