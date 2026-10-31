import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CallKind,
  CallStatus,
  ConversationType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertConversationMember } from '../common/utils/chat-access.util';

/** How long a ringing call survives before it is recorded as missed. */
export const RING_TIMEOUT_MS = 45_000;

/** Shape returned to clients for a call. */
export interface SerializedCall {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  kind: CallKind;
  status: CallStatus;
  answeredAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  createdAt: Date;
  /** Wall-clock seconds the call was connected, or null if never answered. */
  durationSeconds: number | null;
  peer: {
    id: string;
    name: string;
    avatarUrl: string | null;
    connectNumber: string;
  };
}

type CallWithPeer = {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  kind: CallKind;
  status: CallStatus;
  answeredAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  createdAt: Date;
  caller: {
    id: string;
    name: string;
    avatarUrl: string | null;
    connectNumber: string;
  };
  callee: {
    id: string;
    name: string;
    avatarUrl: string | null;
    connectNumber: string;
  };
};

const peerSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  connectNumber: true,
} as const;

export function serializeCall(
  call: CallWithPeer,
  viewerId: string,
): SerializedCall {
  const peer = call.callerId === viewerId ? call.callee : call.caller;

  const durationSeconds =
    call.answeredAt && call.endedAt
      ? Math.max(
          0,
          Math.round(
            (call.endedAt.getTime() - call.answeredAt.getTime()) / 1000,
          ),
        )
      : null;

  return {
    id: call.id,
    conversationId: call.conversationId,
    callerId: call.callerId,
    calleeId: call.calleeId,
    kind: call.kind,
    status: call.status,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    endReason: call.endReason,
    createdAt: call.createdAt,
    durationSeconds,
    peer,
  };
}

/**
 * The identity and outcome of a call, without a viewer-relative `peer`.
 *
 * This is what the gateway needs in order to tell *both* parties that a call
 * finished. It is deliberately not a `SerializedCall`: `peer` depends on who
 * is reading, and an announcement has to be correct for the caller and the
 * callee in the same message.
 */
export interface CallAnnouncement {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  status: CallStatus;
}

@Injectable()
export class CallsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Starts a call by ringing the other participant.
   *
   * Only 1:1 conversations are supported: the peer connection is a direct
   * two-party negotiation, so a group call would need mesh signalling.
   *
   * Returns the live calls it closed alongside the new one. Re-ringing
   * supersedes the previous attempt, and the caller has to announce that as
   * well — a call closed silently here would leave the other device's UI
   * showing a call that no longer exists, which is exactly the stale-ring bug
   * this endpoint used to cause.
   */
  async start(
    conversationId: string,
    callerId: string,
    kind: CallKind,
  ): Promise<{ call: SerializedCall; superseded: CallAnnouncement[] }> {
    await assertConversationMember(this.prisma, conversationId, callerId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        type: true,
        participants: {
          where: { leftAt: null, userId: { not: callerId } },
          select: { userId: true },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.type !== ConversationType.DIRECT) {
      throw new BadRequestException(
        'Calls are only supported in one-to-one conversations',
      );
    }

    if (conversation.participants.length !== 1) {
      throw new BadRequestException(
        'The other participant is no longer available',
      );
    }

    const calleeId = conversation.participants[0].userId;

    // One live call per pair, in either direction. Ringing again supersedes
    // the previous attempt so a retried ring cannot leave two live rows.
    const superseded = await this.endStaleCalls(
      conversationId,
      callerId,
      calleeId,
    );

    const call = await this.prisma.call.create({
      data: { conversationId, callerId, calleeId, kind },
      include: {
        caller: { select: peerSelect },
        callee: { select: peerSelect },
      },
    });

    return { call: serializeCall(call, callerId), superseded };
  }

  /** Records that the callee accepted, which starts the duration clock. */
  async accept(callId: string, userId: string): Promise<SerializedCall> {
    const call = await this.assertParticipant(callId, userId);

    if (call.status === CallStatus.ACCEPTED) {
      // Idempotent: a duplicate accept should not restart the clock.
      return serializeCall(await this.withPeers(call), userId);
    }

    if (call.status !== CallStatus.RINGING) {
      throw new BadRequestException('This call is no longer ringing');
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: CallStatus.ACCEPTED, answeredAt: new Date() },
      include: {
        caller: { select: peerSelect },
        callee: { select: peerSelect },
      },
    });

    return serializeCall(updated, userId);
  }

  /**
   * Ends a call and records why.
   *
   * The status is derived from who ended it rather than trusted from the
   * client, so a caller cannot mark itself as the callee having declined.
   */
  async end(
    callId: string,
    userId: string,
    reason?: string,
  ): Promise<SerializedCall> {
    const call = await this.assertParticipant(callId, userId);

    if (isTerminal(call.status)) {
      return serializeCall(await this.withPeers(call), userId);
    }

    const status =
      call.status === CallStatus.RINGING
        ? call.callerId === userId
          ? CallStatus.ENDED_BY_CALLER
          : CallStatus.DECLINED
        : call.callerId === userId
          ? CallStatus.ENDED_BY_CALLER
          : CallStatus.ENDED_BY_CALLEE;

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: {
        status,
        endedAt: new Date(),
        // Only a short machine-ish label is persisted; never peer free text.
        endReason: sanitizeReason(reason),
      },
      include: {
        caller: { select: peerSelect },
        callee: { select: peerSelect },
      },
    });

    return serializeCall(updated, userId);
  }

  /**
   * Marks still-ringing calls older than the timeout as missed.
   *
   * Called opportunistically when history is read, so a missed call shows up
   * in the list without needing a background worker.
   */
  async expireRinging(
    conversationId: string,
    viewerId: string,
  ): Promise<SerializedCall[]> {
    const cutoff = new Date(Date.now() - RING_TIMEOUT_MS);

    await this.prisma.call.updateMany({
      where: {
        conversationId,
        status: CallStatus.RINGING,
        createdAt: { lt: cutoff },
      },
      data: { status: CallStatus.MISSED, endedAt: cutoff },
    });

    return this.list(conversationId, viewerId);
  }

  /**
   * Re-serializes a call for a specific viewer.
   *
   * `serializeCall` resolves `peer` relative to whoever asked, so a payload
   * built for the callee names the *caller* as the peer. That is correct for
   * the person it was built for and wrong for anyone else, which matters as
   * soon as a payload is relayed: `call:accepted` is produced while handling
   * the callee's accept but delivered to the caller, who needs it resolved the
   * other way round. Re-serializing per recipient is the fix.
   */
  async viewFor(callId: string, viewerId: string): Promise<SerializedCall> {
    const call = await this.prisma.call.findUniqueOrThrow({
      where: { id: callId },
      include: {
        caller: { select: peerSelect },
        callee: { select: peerSelect },
      },
    });

    return serializeCall(call, viewerId);
  }

  /** Call history for a conversation, newest first. */
  async list(
    conversationId: string,
    viewerId: string,
    take = 50,
  ): Promise<SerializedCall[]> {
    await assertConversationMember(this.prisma, conversationId, viewerId);

    const rows = await this.prisma.call.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        caller: { select: peerSelect },
        callee: { select: peerSelect },
      },
    });

    return rows.map((row) => serializeCall(row, viewerId));
  }

  /** Loads one call and asserts the caller is one of its two parties. */
  private async assertParticipant(
    callId: string,
    userId: string,
  ): Promise<{
    id: string;
    conversationId: string;
    callerId: string;
    calleeId: string;
    kind: CallKind;
    status: CallStatus;
    answeredAt: Date | null;
    endedAt: Date | null;
    endReason: string | null;
    createdAt: Date;
  }> {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });

    if (!call) {
      throw new NotFoundException('Call not found');
    }

    if (call.callerId !== userId && call.calleeId !== userId) {
      // Do not leak the existence of a call between other people.
      throw new ForbiddenException('You were not part of this call');
    }

    return call;
  }

  private async withPeers(call: { id: string }): Promise<CallWithPeer> {
    const row = await this.prisma.call.findUniqueOrThrow({
      where: { id: call.id },
      include: {
        caller: { select: peerSelect },
        callee: { select: peerSelect },
      },
    });

    return row;
  }

  /**
   * Closes any live call between the same pair before ringing again.
   *
   * Returns what it closed. Re-ringing is the only way a live call is closed
   * without either party acting, so the caller needs the identities in order
   * to tell the affected devices.
   */
  private async endStaleCalls(
    conversationId: string,
    callerId: string,
    calleeId: string,
  ): Promise<CallAnnouncement[]> {
    const stale = await this.prisma.call.findMany({
      where: {
        conversationId,
        status: { in: [CallStatus.RINGING, CallStatus.ACCEPTED] },
        OR: [
          { callerId, calleeId },
          { callerId: calleeId, calleeId: callerId },
        ],
      },
      select: {
        id: true,
        conversationId: true,
        callerId: true,
        calleeId: true,
      },
    });

    if (stale.length === 0) {
      return [];
    }

    await this.prisma.call.updateMany({
      where: { id: { in: stale.map((call) => call.id) } },
      data: { status: CallStatus.ENDED_BY_CALLER, endedAt: new Date() },
    });

    return stale.map((call) => ({
      ...call,
      status: CallStatus.ENDED_BY_CALLER,
    }));
  }
}

/**
 * A status the call cannot leave.
 *
 * Exported because the gateway has to make the same judgement when relaying
 * signalling: a call that has been declined or hung up must stop accepting
 * offers, answers and candidates even though its row still exists.
 */
export function isTerminal(status: CallStatus): boolean {
  return status !== CallStatus.RINGING && status !== CallStatus.ACCEPTED;
}

/**
 * Keeps the persisted reason short and free of anything that looks like
 * injected content. It is rendered in the history list, so it is treated as
 * untrusted even though it originates from our own client.
 */
function sanitizeReason(reason?: string): string | null {
  if (!reason) return null;

  const cleaned = reason
    .replace(/[^\w\s:.,()-]/g, '')
    .trim()
    .slice(0, 120);

  return cleaned.length > 0 ? cleaned : null;
}
