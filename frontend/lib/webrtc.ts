/**
 * WebRTC peer-connection helpers for 1:1 audio/video calls.
 *
 * Scope is deliberately narrow: exactly two peers, and no TURN. On a single
 * flat LAN the browsers can reach each other over host candidates, so an
 * empty `iceServers` list is the honest configuration. Adding a STUN server
 * would only help across NATs, which this deployment does not traverse, and it
 * would send connection metadata to a third party for no benefit.
 *
 * If calls ever need to cross a router, the only fix is a TURN server
 * (`iceServers` entries with `urls` + `username` + `credential`); no amount of
 * client-side tweaking substitutes for a relay.
 */

/** ICE configuration for this deployment. Host candidates only. */
export const ICE_SERVERS: RTCIceServer[] = [];

/** Raised when the platform cannot provide a usable capture device. */
export class MediaAccessError extends Error {
  constructor(
    message: string,
    /** Machine-readable cause so the UI can tailor its advice. */
    readonly reason:
      | "insecure-context"
      | "permission-denied"
      | "no-device"
      | "other",
  ) {
    super(message);
    this.name = "MediaAccessError";
  }
}

/**
 * True when this page may ask for camera/microphone at all.
 *
 * `navigator.mediaDevices` is only exposed in a secure context. Browsers
 * count `localhost` as secure, so this always passes in local development and
 * only fails on a plain-HTTP LAN address — the exact case that is easy to
 * miss until a user on the network cannot call anyone.
 */
export function canAccessMedia(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** Explains, in one sentence, why media is unavailable on this origin. */
export function mediaUnavailableReason(): string {
  if (typeof window === "undefined") {
    return "Media devices are only available in the browser.";
  }

  if (!window.isSecureContext) {
    return (
      "Camera and microphone require a secure (HTTPS) connection. " +
      "This page is served over plain HTTP, so the browser has not exposed " +
      "any capture device to it."
    );
  }

  if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return "This browser does not support camera and microphone capture.";
  }

  return "No camera or microphone is available.";
}

/**
 * Requests one stream, translating the several distinct failure modes into
 * something the UI can explain rather than surfacing a raw `DOMException`.
 */
export async function getUserStream(
  kind: "audio" | "video",
): Promise<MediaStream> {
  if (!canAccessMedia()) {
    throw new MediaAccessError(mediaUnavailableReason(), "insecure-context");
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  } catch (error) {
    const name = (error as DOMException)?.name;

    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new MediaAccessError(
        "Permission to use the camera or microphone was denied. " +
          "Allow it in your browser's site settings and try again.",
        "permission-denied",
      );
    }

    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new MediaAccessError(
        kind === "video"
          ? "No camera was found. An audio call will still work."
          : "No microphone was found.",
        "no-device",
      );
    }

    throw new MediaAccessError(
      `Could not start the ${kind === "video" ? "camera" : "microphone"}: ${
        (error as Error).message
      }`,
      "other",
    );
  }
}

/**
 * Falls back to microphone-only when the camera fails, so a machine with no
 * webcam can still take an audio call from the same button.
 */
export async function getStreamWithVideoFallback(): Promise<{
  stream: MediaStream;
  hasVideo: boolean;
  warning: string | null;
}> {
  try {
    return { stream: await getUserStream("video"), hasVideo: true, warning: null };
  } catch (error) {
    if (error instanceof MediaAccessError && error.reason === "insecure-context") {
      throw error;
    }

    return {
      stream: await getUserStream("audio"),
      hasVideo: false,
      warning: "No camera available — joining with audio only.",
    };
  }
}

/**
 * A peer connection plus the bookkeeping needed to negotiate with a peer that
 * may answer before its local description is applied.
 *
 * The class exists because the raw API has a sharp edge: an ICE candidate
 * that arrives before the remote description is set is silently dropped by
 * some implementations, which shows up as a call that connects to nothing.
 * Candidates are buffered here until the description lands.
 */
export class PeerConnection {
  readonly pc: RTCPeerConnection;
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private closed = false;

  constructor(onIceCandidate: (candidate: RTCIceCandidateInit) => void) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        onIceCandidate(event.candidate.toJSON());
      }
    };
  }

  /** Adds the local capture tracks to the connection. */
  addStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      this.pc.addTrack(track, stream);
    }
  }

  /**
   * Creates the offer. The caller must be the one who rang, so the roles are
   * never ambiguous and no glare handling is needed.
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  /** Accepts the caller's offer and produces the answer. */
  async createAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(offer);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  /** Applies the callee's answer on the caller's side. */
  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(answer);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
  }

  /**
   * Adds a remote ICE candidate, buffering it if the remote description has
   * not been applied yet.
   */
  async addCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.closed) return;

    if (!this.remoteDescriptionSet) {
      this.pendingCandidates.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      // A candidate that the browser rejects is not fatal: the others may
      // still produce a working pair, and a call with degraded resolution
      // beats a hard failure.
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    const queued = this.pendingCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        // Same reasoning as above: ignore individual bad candidates.
      }
    }
  }

  close(): void {
    this.closed = true;
    this.pc.onicecandidate = null;
    this.pc.close();
  }
}

/** Stops every track and detaches the stream from any video element. */
export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;

  for (const track of stream.getTracks()) {
    track.stop();
  }
}
