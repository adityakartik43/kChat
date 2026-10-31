"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthProvider";
import { useSocket } from "./SocketProvider";
import { useRingtone } from "@/lib/ringtone";
import {
  MediaAccessError,
  PeerConnection,
  canAccessMedia,
  getStreamWithVideoFallback,
  getUserStream,
  stopStream,
} from "@/lib/webrtc";
import { useHasMediaSupport } from "@/lib/use-media-support";
import { readDeviceId } from "@/lib/device-id";
import type { Call, CallKind, PublicUser } from "@/lib/types";

/** Where the local user sits in the current call. */
type CallRole = "caller" | "callee";

/** One signalling blob as it arrives from the socket. */
interface Signal {
  callId: string;
  from: string;
  type: string;
  data: string | null;
}

/** What the server sends when a call is answered. */
interface AcceptedPayload {
  call: Call;
  /** The device that placed the call, and the one that answered it. */
  callerDeviceId: string | null;
  calleeDeviceId: string | null;
}

export interface ActiveCallState {
  call: Call;
  peer: PublicUser;
  role: CallRole;
  kind: CallKind;
  /** Epoch ms when media actually started flowing, for the duration readout. */
  connectedAt: number | null;
}

export interface IncomingCallState {
  call: Call;
  caller: PublicUser;
}

/**
 * A call this account is in, but which is being carried by a different device.
 *
 * Only ever set on a tab that is not a participant. It exists so that tab can
 * stop ringing and stop offering controls it cannot honour: the call is real
 * and the account is in it, but hanging up from here would tear down a
 * conversation happening on a different screen.
 */
export interface RemoteCallState {
  call: Call;
  peer: PublicUser;
  role: CallRole;
}

/**
 * Everything this tab is currently showing about a call, as one value.
 *
 * These used to be four independent pieces of state — an incoming call, an
 * active call, an "elsewhere" call, and a boolean for ringing out — which
 * made it possible for a tab to believe it was ringing and connected at the
 * same time, and gave every socket handler a reason to want to read all four
 * at once. As a single discriminated union, "a tab is ringing while it is also
 * connected" has no representation, and the handlers below can read the
 * current value through a functional update without re-registering themselves
 * on every transition.
 */
type CallScreen =
  | { state: "idle" }
  | { state: "ringing-in"; call: Call; caller: PublicUser }
  | { state: "ringing-out"; call: Call }
  /**
   * This device pressed accept, and the call is not up yet.
   *
   * Its own screen, distinct from `active`, because "answered" and "connected"
   * are different facts and the difference is load-bearing. Answering costs a
   * database round trip on the server and a capture device here, and either can
   * take seconds. Reporting `active` during that window is not a cosmetic
   * choice: the caller is still hearing ringback and every other device of both
   * accounts is still ringing, so a device that claims a connected call makes
   * exactly the reported failure — rings everywhere, one device says yes, the
   * rest never stop — look like it is working.
   */
  | { state: "connecting"; call: Call; caller: PublicUser }
  | {
      state: "active";
      call: Call;
      peer: PublicUser;
      role: CallRole;
      /** Epoch ms when media actually started flowing. */
      connectedAt: number | null;
    }
  | { state: "elsewhere"; call: Call; peer: PublicUser; role: CallRole };

/** The id of the call on screen, or null when nothing is. */
function screenCallId(screen: CallScreen): string | null {
  return screen.state === "idle" ? null : screen.call.id;
}

/**
 * How long to wait for the server to acknowledge an accept before giving up on
 * it.
 *
 * Answering is a database write, and that database is across the internet, so
 * the acknowledgement is not instantaneous. It does have a ceiling: the
 * connection layer abandons a stuck handshake after `CONNECT_TIMEOUT_MS` and
 * makes a second attempt, and it will queue behind other work for up to
 * `POOL_WAIT_TIMEOUT_MS` before giving up. That second number is the one that
 * binds, so this is set above it — an earlier value of twenty sat *inside* the
 * server's own ceiling, and the result was a client that tore down a call the
 * server had accepted moments later, ending it for both parties for no reason.
 * A client deadline below the server's worst case does not fail fast; it fails
 * *wrongly*, and worse than the thing it was meant to protect against.
 *
 * Exceeding this is a soft failure, but not a silent one. The write may or may
 * not have happened, and the only way to find out is to end the call, which
 * resolves both cases — so this is the point where a degraded network stops
 * looking like a working call and starts looking like a failed one.
 *
 * In practice this is never reached: a healthy accept is acknowledged in tens of
 * milliseconds, and the `connecting` screen it waits behind offers a cancel for
 * the whole time.
 */
const ACCEPT_ACK_TIMEOUT_MS = 45_000;

interface CallContextValue {
  /** A call ringing on this device, awaiting a decision. */
  incomingCall: IncomingCallState | null;
  /** The call this device is in, if any. */
  activeCall: ActiveCallState | null;
  /** The account is in this call, but another of its devices is carrying it. */
  remoteCall: RemoteCallState | null;
  /**
   * This device answered a call that is not connected yet.
   *
   * Present only for the seconds between pressing accept and the call being up.
   * It is deliberately not folded into `activeCall`: a device that has answered
   * is not a device carrying media, and the difference is what stops a slow
   * answer from looking like a working call.
   */
  connectingCall: IncomingCallState | null;
  /** True while an outgoing call is ringing and not yet answered. */
  outgoingRinging: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  /** Local stream for the self-view; null when there is no call. */
  localStream: MediaStream | null;
  /** The peer's stream, populated once media starts arriving. */
  remoteStream: MediaStream | null;
  /** Set when media could not be started, with advice for the user. */
  mediaError: string | null;
  /** True when this origin cannot capture media at all (plain HTTP). */
  mediaUnsupported: boolean;

  startCall: (
    conversation: { id: string; peer: PublicUser },
    kind: CallKind,
  ) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  dismissMediaError: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { startRinging, stopRinging } = useRingtone();

  /**
   * Which of this account's devices this tab is, for call routing.
   *
   * One account is many endpoints at once, and it is the right unit for state
   * (a ring reaches every device, and ends on all of them) but the wrong unit
   * for media (a peer connection is negotiated between two specific devices).
   * This id is how a device tells the two apart.
   */
  const [deviceId] = useState(readDeviceId);

  const [screen, setScreen] = useState<CallScreen>({ state: "idle" });
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaUnsupported, setMediaUnsupported] = useState(false);
  const hasMediaSupport = useHasMediaSupport();

  const pcRef = useRef<PeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  /** Signals that arrived before the peer connection was ready. */
  const signalQueueRef = useRef<Signal[]>([]);

  /**
   * The screen, mirrored so the socket handlers can read it.
   *
   * Kept in step by an effect rather than by a ref assignment during render,
   * which React correctly forbids. The mirror can therefore be one commit
   * behind, and the handlers that use it are written so that being behind is
   * harmless: the busy check it feeds is a courtesy that declines a call this
   * tab cannot answer, and anything it lets through is caught by the server,
   * which refuses an accept on a call that is no longer ringing.
   */
  const screenRef = useRef<CallScreen>(screen);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  const selfId = user?.id ?? "";

  /**
   * Drops everything the current call holds open: peer connection, capture
   * devices, queued signalling, and the ringtone.
   *
   * Idempotent, and deliberately separate from clearing the screen so that a
   * peer connection can be released without touching what the user is looking
   * at — `onconnectionstatechange` needs the first without the second.
   */
  const releaseResources = useCallback(() => {
    stopRinging();
    pcRef.current?.close();
    pcRef.current = null;
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setRemoteStream(null);
    setLocalStream(null);
    signalQueueRef.current = [];
    setMicEnabled(true);
    setCameraEnabled(false);
  }, [stopRinging]);

  /** Ends the call this tab is showing and releases what it held. */
  const teardown = useCallback(() => {
    setScreen({ state: "idle" });
    releaseResources();
  }, [releaseResources]);

  const sendSignal = useCallback(
    (
      callId: string,
      type: "offer" | "answer" | "candidate" | "hangup",
      payload?: unknown,
    ) => {
      socket?.emit("call:signal", {
        callId,
        type,
        data: payload === undefined ? undefined : JSON.stringify(payload),
        deviceId,
      });
    },
    [socket, deviceId],
  );

  /** Applies one incoming signalling blob to an established peer connection. */
  const applySignal = useCallback(
    async (peer: PeerConnection, signal: Signal) => {
      if (!signal.data) return;

      let payload: unknown;
      try {
        payload = JSON.parse(signal.data);
      } catch {
        // A blob we cannot parse is not worth failing the call over; the
        // remaining signals may still negotiate a working connection.
        return;
      }

      if (signal.type === "offer") {
        const answer = await peer.createAnswer(
          payload as RTCSessionDescriptionInit,
        );
        sendSignal(signal.callId, "answer", answer);
      } else if (signal.type === "answer") {
        await peer.acceptAnswer(payload as RTCSessionDescriptionInit);
      } else if (signal.type === "candidate") {
        await peer.addCandidate(payload as RTCIceCandidateInit);
      } else if (signal.type === "hangup") {
        teardown();
      }
    },
    [sendSignal, teardown],
  );

  /**
   * Opens the capture devices and builds the peer connection.
   *
   * Returns null when capture is impossible, recording why in `mediaError`,
   * so the caller can abort instead of building a connection that could never
   * carry media.
   */
  const establishPeer = useCallback(
    async (
      callId: string,
      wantVideo: boolean,
    ): Promise<PeerConnection | null> => {
      let stream: MediaStream;

      try {
        if (wantVideo) {
          const result = await getStreamWithVideoFallback();
          stream = result.stream;
          if (result.warning) setMediaError(result.warning);
        } else {
          stream = await getUserStream("audio");
        }
      } catch (error) {
        if (error instanceof MediaAccessError) {
          setMediaError(error.message);
          if (error.reason === "insecure-context") setMediaUnsupported(true);
        } else {
          setMediaError((error as Error).message);
        }
        return null;
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraEnabled(stream.getVideoTracks().length > 0);

      const peer = new PeerConnection((candidate) =>
        sendSignal(callId, "candidate", candidate),
      );
      peer.addStream(stream);

      peer.pc.ontrack = (event) => {
        const [remote] = event.streams;
        if (remote) {
          remoteStreamRef.current = remote;
          setRemoteStream(remote);
        }
      };

      peer.pc.onconnectionstatechange = () => {
        // `connectionState` is an aggregate of ICE plus DTLS; "connected" is
        // the point at which media can actually flow. ("completed" belongs to
        // `iceConnectionState`, not this one.)
        if (peer.pc.connectionState === "connected") {
          setScreen((current) =>
            current.state === "active" && current.connectedAt === null
              ? { ...current, connectedAt: Date.now() }
              : current,
          );
          return;
        }

        if (peer.pc.connectionState === "failed") {
          setMediaError(
            "The direct connection could not be established. Both devices " +
              "must be on the same network for calls to connect.",
          );
        }
      };

      pcRef.current = peer;

      // Drain anything the peer sent while the camera was still opening.
      const queued = signalQueueRef.current.splice(0);
      for (const signal of queued) {
        if (signal.callId === callId) void applySignal(peer, signal);
      }

      return peer;
    },
    [applySignal, sendSignal],
  );

  // Reset on sign-out so a second user never inherits a live call.
  useEffect(() => {
    if (user) return;
    /* eslint-disable react-hooks/set-state-in-effect --
     * Teardown on sign-out, mirroring SocketProvider. */
    teardown();
    setMediaError(null);
    setMediaUnsupported(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [user, teardown]);

  // -------------------------------------------------------------- socket ---

  useEffect(() => {
    if (!socket || !user) return;

    const onIncoming = (payload: { call: Call; caller: PublicUser }) => {
      // Busy: decline automatically rather than leaving the caller ringing
      // against a device that will not answer. Every non-idle screen counts —
      // including "elsewhere", because the account is in that call even though
      // this tab is not carrying it.
      if (screenRef.current.state !== "idle") {
        socket.emit("call:reject", {
          callId: payload.call.id,
          reason: "busy",
          deviceId,
        });
        return;
      }

      setScreen({
        state: "ringing-in",
        call: payload.call,
        caller: payload.caller,
      });
      startRinging();
    };

    /**
     * Another tab of this account placed a call.
     *
     * The calling tab is excluded from this event server-side and updates
     * itself from the acknowledgement instead, so there is nothing to
     * de-duplicate here.
     */
    const onOutgoing = (payload: { call: Call }) => {
      setScreen((current) =>
        current.state === "active" || current.state === "elsewhere"
          ? current
          : { state: "ringing-out", call: payload.call },
      );
    };

    /**
     * Somebody picked the call up.
     *
     * This reaches every device of both accounts, and which of three things a
     * device does about it is decided by comparing the device ids the server
     * sent against this tab's own. Getting that wrong is what left the other
     * tabs ringing after the call had already been answered: they were sent
     * nothing at all, and because the call is now `ACCEPTED` in the database
     * the 45-second missed-call sweep would never have reached it either. It
     * was not a transient glitch — those tabs stayed wrong until reloaded.
     */
    const onAccepted = async (payload: AcceptedPayload) => {
      const isCallingDevice = payload.callerDeviceId === deviceId;
      const isAnsweringDevice = payload.calleeDeviceId === deviceId;

      // Whoever answered, the ring is over on this device.
      stopRinging();

      if (isAnsweringDevice) {
        // This tab pressed accept, so it owns this transition end to end: it is
        // the one holding the `call:accept` acknowledgement, and the only one
        // that has to wait for its capture device. Touching the screen here
        // would race `acceptCall` and could report a connected call before
        // there is any media behind it — or resurrect one this tab has already
        // torn down after the acknowledgement never came.
        return;
      }

      if (!isCallingDevice) {
        // A bystander tab of either account: reflect the call, carry no media.
        // Building a peer connection here would be a second, competing
        // negotiation against the same call.
        setScreen({
          state: "elsewhere",
          call: payload.call,
          peer: payload.call.peer,
          role: payload.call.callerId === selfId ? "caller" : "callee",
        });
        return;
      }

      const peer = await establishPeer(
        payload.call.id,
        payload.call.kind === "VIDEO",
      );

      if (!peer) {
        socket.emit("call:end", {
          callId: payload.call.id,
          reason: "media-unavailable",
          deviceId,
        });
        return;
      }

      setScreen({
        state: "active",
        call: payload.call,
        peer: payload.call.peer,
        role: "caller",
        connectedAt: null,
      });

      try {
        sendSignal(payload.call.id, "offer", await peer.createOffer());
      } catch (error) {
        setMediaError((error as Error).message);
        socket.emit("call:end", {
          callId: payload.call.id,
          reason: "sdp-failed",
          deviceId,
        });
        teardown();
      }
    };

    const onSignal = (payload: Signal) => {
      if (payload.from === selfId) return;

      const peer = pcRef.current;

      if (!peer) {
        // The server only delivers signalling to the device holding the other
        // end of the leg, so anything arriving with no peer connection is
        // either an early arrival for a call being set up, or the tail of a
        // call already torn down here.
        signalQueueRef.current.push(payload);
        return;
      }

      void applySignal(peer, payload);
    };

    const onEnded = (payload: { callId: string }) => {
      // Only tear down if this is about the call on screen; a late
      // notification for an already-replaced call must not cancel the new one.
      setScreen((current) => {
        const onScreen = screenCallId(current);

        return onScreen === null || onScreen === payload.callId
          ? { state: "idle" }
          : current;
      });

      releaseResources();
    };

    socket.on("call:incoming", onIncoming);
    socket.on("call:outgoing", onOutgoing);
    socket.on("call:accepted", onAccepted);
    socket.on("call:signal", onSignal);
    socket.on("call:ended", onEnded);

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:outgoing", onOutgoing);
      socket.off("call:accepted", onAccepted);
      socket.off("call:signal", onSignal);
      socket.off("call:ended", onEnded);
    };
    // The live screen is read through `screenRef` and updated functionally, so
    // the handlers are registered once and stay registered for the whole
    // session. Re-registering them on every transition is not free: it drops
    // and re-adds five listeners mid-call, and a signalling message landing in
    // that gap is lost with no error raised anywhere.
  }, [
    socket,
    user,
    selfId,
    deviceId,
    establishPeer,
    applySignal,
    releaseResources,
    teardown,
    sendSignal,
    startRinging,
    stopRinging,
  ]);

  // ------------------------------------------------------------- actions ---

  const startCall = useCallback(
    async (
      conversation: { id: string; peer: PublicUser },
      kind: CallKind,
    ) => {
      setMediaError(null);

      if (!canAccessMedia()) {
        setMediaUnsupported(true);
        setMediaError(
          "Calling needs a secure (HTTPS) connection. This page is served " +
            "over plain HTTP, so the browser has not exposed the camera or " +
            "microphone to it.",
        );
        return;
      }

      if (screen.state !== "idle") return;

      // The acknowledgement carries the created call, which is the only place
      // its id is known — it is required to cancel the ring.
      socket?.emit(
        "call:start",
        { conversationId: conversation.id, kind, deviceId },
        (ack: { call?: Call; error?: string } | undefined) => {
          if (ack?.call) {
            setScreen({ state: "ringing-out", call: ack.call });
            return;
          }
          setMediaError(ack?.error ?? "The call could not be started.");
        },
      );
    },
    [socket, deviceId, screen.state],
  );

  const acceptCall = useCallback(async () => {
    if (screen.state !== "ringing-in") return;

    const { call, caller } = screen;
    stopRinging();

    // Tell the server first, and only then wait on the hardware. These are two
    // independent latencies — a database round trip and opening a capture
    // device — and doing them in sequence charges the user for both. Started
    // together they overlap, and the call is answered the moment the server
    // says so rather than the moment this machine finishes negotiating with
    // its own camera.
    const media = establishPeer(call.id, call.kind === "VIDEO");

    setScreen({ state: "connecting", call, caller });

    const accepted = await new Promise<boolean>((resolve) => {
      if (!socket) return resolve(false);

      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      // The server writes the row before it acknowledges, so a missing
      // acknowledgement means the write is not known to have happened. Giving
      // up quietly would leave the call ringing everywhere with nobody
      // carrying it; ending it is the only outcome that tells every other
      // device what happened.
      const timer = setTimeout(() => settle(false), ACCEPT_ACK_TIMEOUT_MS);

      socket.emit(
        "call:accept",
        { callId: call.id, deviceId },
        (ack: { call?: Call; error?: string } | undefined) => {
          if (ack?.error) {
            setMediaError(ack.error);
            settle(false);
            return;
          }
          settle(Boolean(ack?.call));
        },
      );
    });

    const peer = await media;

    if (!accepted) {
      // Either another device of this account answered first, or the server
      // never confirmed. Both mean this device is not in the call, so it must
      // stop looking like it is — and must not leave the other devices ringing
      // on its behalf.
      if (screenCallId(screenRef.current) === call.id) {
        socket?.emit("call:end", {
          callId: call.id,
          reason: "cancelled",
          deviceId,
        });
      }
      teardown();
      return;
    }

    if (!peer) {
      // Accepted, but there is no camera or microphone to answer with. The
      // `!canAccessMedia` case is refused before the accept is sent, so this is
      // the permission-denied or device-busy case, and the call has to be torn
      // down rather than left accepted and silent.
      socket?.emit("call:end", {
        callId: call.id,
        reason: "media-unavailable",
        deviceId,
      });
      teardown();
      return;
    }

    setScreen({
      state: "active",
      call,
      // `caller`, not `call.peer`: the incoming payload was serialized for the
      // callee, so its `peer` field already points back at us.
      peer: caller,
      role: "callee",
      connectedAt: null,
    });
  }, [
    screen,
    establishPeer,
    socket,
    deviceId,
    stopRinging,
    setMediaError,
    teardown,
  ]);

  const rejectCall = useCallback(() => {
    if (screen.state !== "ringing-in") return;

    socket?.emit("call:reject", {
      callId: screen.call.id,
      reason: "declined",
      deviceId,
    });
    teardown();
  }, [screen, socket, deviceId, teardown]);

  const endCall = useCallback(() => {
    // A tab that is only watching a call on another device must not hang it
    // up: it holds no media, and ending the call from here would drop a
    // conversation happening on a different screen. It renders no hang-up
    // control, but this is reachable from anywhere, so it is guarded.
    if (screen.state === "elsewhere") {
      setScreen({ state: "idle" });
      return;
    }

    if (screen.state === "idle") {
      releaseResources();
      return;
    }

    const callId = screen.call.id;

    if (screen.state === "active") {
      socket?.emit("call:end", { callId, reason: "hangup", deviceId });
    } else if (screen.state === "connecting") {
      // Abandoned while the server was still being asked. `call:end` is the
      // right verb for both halves of that race: if the accept landed the call
      // ends, and if it did not the row is still ringing and ending it as the
      // callee records a decline. Either way the other devices stop ringing,
      // which is the property that matters and the one that is easy to lose by
      // treating this as a local-only cancel.
      socket?.emit("call:end", { callId, reason: "cancelled", deviceId });
    } else if (screen.state === "ringing-in") {
      socket?.emit("call:reject", { callId, reason: "declined", deviceId });
    } else {
      // Still ringing: withdraw it rather than ending a call nobody joined.
      // Any of this account's devices may withdraw the ring — the others are
      // only showing a label, and no media is lost by doing it from a tab that
      // never carried any.
      socket?.emit("call:cancel", { callId, reason: "cancelled", deviceId });
    }

    teardown();
  }, [screen, socket, deviceId, teardown, releaseResources]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const next = !micEnabled;
    for (const track of stream.getAudioTracks()) track.enabled = next;
    setMicEnabled(next);
  }, [micEnabled]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const next = !cameraEnabled;
    for (const track of stream.getVideoTracks()) track.enabled = next;
    setCameraEnabled(next);
  }, [cameraEnabled]);

  const dismissMediaError = useCallback(() => setMediaError(null), []);

  // The four values consumers see, derived from one screen. Memoised on the
  // screen itself so they keep a stable identity between renders and do not
  // churn every context consumer on an unrelated state change.
  const incomingCall = useMemo<IncomingCallState | null>(
    () =>
      screen.state === "ringing-in"
        ? { call: screen.call, caller: screen.caller }
        : null,
    [screen],
  );

  const activeCall = useMemo<ActiveCallState | null>(
    () =>
      screen.state === "active"
        ? {
            call: screen.call,
            peer: screen.peer,
            role: screen.role,
            kind: screen.call.kind,
            connectedAt: screen.connectedAt,
          }
        : null,
    [screen],
  );

  const remoteCall = useMemo<RemoteCallState | null>(
    () =>
      screen.state === "elsewhere"
        ? { call: screen.call, peer: screen.peer, role: screen.role }
        : null,
    [screen],
  );

  // Answered, not yet connected. Exposed separately from `activeCall` so the
  // overlay can say so, and so a test can tell "this device answered" apart
  // from "this device is carrying the call" — the distinction the reported bug
  // lives inside.
  const connectingCall = useMemo<IncomingCallState | null>(
    () =>
      screen.state === "connecting"
        ? { call: screen.call, caller: screen.caller }
        : null,
    [screen],
  );

  const outgoingRinging = screen.state === "ringing-out";

  // Derived, not stored: the origin's capability cannot change while the
  // document is open, and duplicating it in state would need an effect.
  const mediaUnavailable = mediaUnsupported || !hasMediaSupport;

  const value = useMemo<CallContextValue>(
    () => ({
      incomingCall,
      activeCall,
      remoteCall,
      connectingCall,
      outgoingRinging,
      micEnabled,
      cameraEnabled,
      localStream,
      remoteStream,
      mediaError,
      mediaUnsupported: mediaUnavailable,
      startCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMic,
      toggleCamera,
      dismissMediaError,
    }),
    [
      incomingCall,
      activeCall,
      remoteCall,
      connectingCall,
      outgoingRinging,
      micEnabled,
      cameraEnabled,
      localStream,
      remoteStream,
      mediaError,
      mediaUnavailable,
      startCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMic,
      toggleCamera,
      dismissMediaError,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCalls(): CallContextValue {
  const context = useContext(CallContext);

  if (!context) {
    throw new Error("useCalls must be used inside CallProvider");
  }

  return context;
}
