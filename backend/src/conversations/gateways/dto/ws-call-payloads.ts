import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { CallKind } from '../../../generated/prisma/client';

/**
 * A device identifier, sent by the client on every call action.
 *
 * A signed-in user can have any number of tabs and browsers open, and they are
 * all the same person — but they are *not* the same call endpoint. WebRTC
 * negotiates one peer connection per pair of devices, so the server has to know
 * which two devices are actually carrying media. Without this the signalling
 * relay has nowhere to aim and has to broadcast to the whole account, which is
 * what made every extra device negotiate a second, competing connection to the
 * same call.
 *
 * Constrained to a bounded, injection-free token: it is only ever compared for
 * equality and echoed back in payloads, but it crosses the trust boundary and
 * ends up in a socket-targeted emit.
 */
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** `call:start` — ring the other participant. */
export class WsCallStartPayload {
  @IsUUID('4')
  conversationId: string;

  @IsEnum(CallKind)
  kind: CallKind;

  @IsString()
  @Matches(DEVICE_ID, {
    message: 'deviceId must be 8-64 characters of A-Z, a-z, 0-9, _ or -',
  })
  deviceId: string;
}

/** `call:accept` / `call:end` / `call:reject` / `call:cancel` — act on one call. */
export class WsCallActionPayload {
  @IsUUID('4')
  callId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;

  @IsString()
  @Matches(DEVICE_ID, {
    message: 'deviceId must be 8-64 characters of A-Z, a-z, 0-9, _ or -',
  })
  deviceId: string;
}

/**
 * `call:signal` — relay one WebRTC signalling blob to the peer device.
 *
 * The blob is either a session description (SDP offer/answer) or a single ICE
 * candidate. Both are opaque JSON produced by the browser, so it is forwarded
 * as a JSON-encoded string rather than being modelled field by field: the
 * shapes are large, browser-specific, and never inspected by the server.
 *
 * A hard cap keeps a peer from using signalling as a storage channel.
 */
export class WsCallSignalPayload {
  @IsUUID('4')
  callId: string;

  @IsIn(['offer', 'answer', 'candidate', 'hangup'])
  type: 'offer' | 'answer' | 'candidate' | 'hangup';

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  data?: string;

  @IsString()
  @Matches(DEVICE_ID, {
    message: 'deviceId must be 8-64 characters of A-Z, a-z, 0-9, _ or -',
  })
  deviceId: string;
}
