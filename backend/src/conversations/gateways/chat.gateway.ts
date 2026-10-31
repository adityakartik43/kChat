import { Logger, OnModuleDestroy, UseFilters } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { CallStatus, ConnectionStatus } from '../../generated/prisma/client';
import { EnvConfig } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { MessagesService } from '../../messages/messages.service';
import {
  CallsService,
  isTerminal,
  type CallAnnouncement,
} from '../../calls/calls.service';
import { ConversationsService } from '../conversations.service';
import { validateWsPayload } from '../../common/utils/ws-validation.util';
import { WsHttpExceptionFilter } from '../../common/filters/ws-http-exception.filter';
import {
  WsConversationPayload,
  WsEditMessagePayload,
  WsMessagePayload,
  WsReadPayload,
  WsSendMessagePayload,
  WsTypingPayload,
} from './dto/ws-payloads';
import {
  WsCallActionPayload,
  WsCallSignalPayload,
  WsCallStartPayload,
} from './dto/ws-call-payloads';

/**
 * Data attached to a socket once the handshake JWT has been verified.
 *
 * `Socket#data` is `any` by default, so without this every `client.data.userId`
 * would be an unchecked lookup — a typo would compile and then silently fail at
 * runtime. The fields are optional because `handleDisconnect` also runs for
 * sockets that were rejected before authentication ever populated them.
 */
interface ChatSocketData {
  userId?: string;
  email?: string;
}

/** A socket with a typed, possibly not-yet-authenticated `data` bag. */
type AuthedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  ChatSocketData
>;

/** Room holding every socket belonging to one user. */
const userRoom = (userId: string) => `user:${userId}`;
/** Room holding every socket currently viewing a conversation. */
const conversationRoom = (conversationId: string) => `conv:${conversationId}`;

/**
 * How long a signalling leg is trusted after its last use.
 *
 * A leg lives only as long as the call it belongs to. This is a backstop for
 * rows that get closed without going through the gateway at all — an
 * `expireRinging` sweep triggered by someone reading call history, say — so
 * the map cannot grow without bound.
 */
const LEG_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Which two devices are actually carrying one call's media.
 *
 * A signed-in user is one *account* but many *endpoints*. WebRTC negotiates a
 * peer connection per pair of endpoints, so once an account is open in more
 * than one tab the server has to know which two tabs are talking. Without this
 * the only addressable unit is the account, and every signalling blob has to be
 * broadcast to it — which makes each extra tab run its own competing
 * negotiation against the same call, and leaves the tabs that are only
 * watching unable to tell that they should stop ringing.
 *
 * Device ids are supplied by the client and are only ever compared for
 * equality. Socket ids are tracked alongside them because a reconnect mints a
 * new one, and Socket.IO keeps each socket in a room named after its own id,
 * which is what makes a single-socket emit possible.
 */
interface CallLeg {
  /**
   * Set when the call is placed. Nullable because a server restart in the
   * middle of a ring loses the map, and the calling device re-claims its end
   * with its first signalling message rather than the call being stranded.
   */
  callerDeviceId: string | null;
  callerSocketId: string | null;
  /** Null until somebody picks the call up. */
  calleeDeviceId: string | null;
  calleeSocketId: string | null;
  /** Last time this leg was created or refreshed, for TTL pruning. */
  touchedAt: number;
}

/**
 * Reads the authenticated user off a socket, refusing the event if the
 * handshake never authenticated. Throwing a `WsException` surfaces to the
 * client as a clean `exception` event via `WsHttpExceptionFilter`.
 */
function requireUserId(client: AuthedSocket): string {
  const { userId } = client.data;

  if (!userId) {
    throw new WsException('Unauthorized');
  }

  return userId;
}

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  // Long-lived chat connections should not be dropped aggressively.
  pingTimeout: 30_000,
})
@UseFilters(new WsHttpExceptionFilter())
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(ChatGateway.name);

  /** userId -> the socket ids currently connected for that user. */
  private readonly presence = new Map<string, Set<string>>();

  /** The conversations each socket has joined, used to clean up on leave. */
  private readonly socketRooms = new Map<string, Set<string>>();

  /**
   * callId -> the two devices carrying that call's media.
   *
   * Only ever holds live calls. See `CallLeg` for why this is needed and
   * `announceCallEnd` for where the entries are dropped.
   */
  private readonly callLegs = new Map<string, CallLeg>();

  @WebSocketServer()
  private server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly messagesService: MessagesService,
    private readonly callsService: CallsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async handleConnection(client: AuthedSocket) {
    try {
      const token = extractToken(client);

      if (!token) {
        throw new Error('Missing token');
      }

      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
        type: string;
      }>(token, {
        secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
      });

      if (payload.type !== 'access') {
        throw new Error('Invalid token type');
      }

      const user = await this.usersService.findActiveById(payload.sub);

      if (!user) {
        throw new Error('User not found or inactive');
      }

      client.data.userId = user.id;
      client.data.email = user.email;

      await client.join(userRoom(user.id));
      // Joining a room named after our own id is what lets `call:signal` be
      // aimed at one device instead of broadcast to the whole account. Socket.IO
      // does this implicitly, but relying on it makes the single-socket emits
      // below depend on an implementation detail; doing it explicitly costs
      // nothing and makes the routing rule visible here.
      await client.join(client.id);
      this.socketRooms.set(client.id, new Set([userRoom(user.id)]));
      this.trackPresence(user.id, client.id);

      // Fire-and-forget: a failure here must not drop the connection.
      this.usersService.touchLastSeen(user.id).catch(() => undefined);

      client.emit('connection:ready', { userId: user.id });
      this.broadcastPresence(user.id, true);
    } catch (error) {
      this.logger.warn(
        `Rejected socket ${client.id}: ${(error as Error).message}`,
      );
      client.emit('auth:error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket) {
    const userId = client.data?.userId;

    if (!userId) {
      return;
    }

    this.releasePresence(userId, client.id);

    for (const room of this.socketRooms.get(client.id) ?? []) {
      // Fire-and-forget: the socket is already gone, and the room is dropped
      // from our own bookkeeping on the next line regardless.
      void client.leave(room);
    }

    this.socketRooms.delete(client.id);

    // Ends a call only if this socket was the one carrying its media, or if
    // it was the account's last socket. A bystander tab closing is harmless.
    void this.teardownCallsForSocket(client);
  }

  onModuleDestroy() {
    void this.server?.close();
  }

  /** Subscribes the socket to a conversation's live event stream. */
  @SubscribeMessage('conversation:join')
  async onJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const { conversationId } = await validateWsPayload(
      WsConversationPayload,
      body,
    );

    await this.assertMember(client, conversationId);

    const room = conversationRoom(conversationId);
    await client.join(room);
    this.socketRooms.get(client.id)?.add(room);

    return { conversationId };
  }

  @SubscribeMessage('conversation:leave')
  async onLeave(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const { conversationId } = await validateWsPayload(
      WsConversationPayload,
      body,
    );

    const room = conversationRoom(conversationId);
    await client.leave(room);
    this.socketRooms.get(client.id)?.delete(room);

    return { conversationId };
  }

  @SubscribeMessage('message:send')
  async onSend(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsSendMessagePayload, body);

    const message = await this.messagesService.send(
      payload.conversationId,
      requireUserId(client),
      payload,
    );

    await this.broadcastToConversation(payload.conversationId, 'message:new', {
      message,
    });

    return { message };
  }

  @SubscribeMessage('message:edit')
  async onEdit(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsEditMessagePayload, body);

    const message = await this.messagesService.edit(
      payload.messageId,
      requireUserId(client),
      { body: payload.body },
    );

    await this.broadcastToConversation(
      message.conversationId,
      'message:updated',
      { message },
    );

    return { message };
  }

  @SubscribeMessage('message:delete')
  async onDelete(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsMessagePayload, body);

    const message = await this.messagesService.remove(
      payload.messageId,
      requireUserId(client),
    );

    await this.broadcastToConversation(
      message.conversationId,
      'message:deleted',
      { message },
    );

    return { message };
  }

  @SubscribeMessage('message:read')
  async onRead(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsReadPayload, body);

    const result = await this.messagesService.markRead(
      payload.conversationId,
      requireUserId(client),
      { messageIds: payload.messageIds },
    );

    if (result.messageIds.length > 0) {
      await this.broadcastToConversation(
        payload.conversationId,
        'message:read',
        {
          conversationId: payload.conversationId,
          userId: requireUserId(client),
          messageIds: result.messageIds,
          readAt: result.readAt,
        },
      );
    }

    return {
      conversationId: payload.conversationId,
      count: result.messageIds.length,
    };
  }

  @SubscribeMessage('typing')
  async onTyping(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsTypingPayload, body);

    await this.assertMember(client, payload.conversationId);

    // Broadcast to everyone in the conversation except the typist.
    client.to(conversationRoom(payload.conversationId)).emit('typing', {
      conversationId: payload.conversationId,
      userId: requireUserId(client),
      typing: payload.typing ?? true,
    });

    return { ok: true };
  }

  // ==============================================================
  // CALLS
  //
  // Signalling is relayed by the server but never inspected: the server
  // only proves the sender is one of the two parties on the call and
  // forwards the opaque blob to the other one. SDP and ICE candidates are
  // the browser's private negotiation, not chat content.
  //
  // Two rules follow from an account being open on many devices, and
  // both were broken before:
  //
  //  1. STATE goes to every device of both users. A ringing call should
  //     ring on all of them so it can be picked up wherever the user is,
  //     and once one device decides anything, the others have to hear
  //     that decision or they keep showing a call that no longer exists.
  //
  //  2. MEDIA goes to exactly one device of the other user. An SDP offer
  //     or ICE candidate only means something to the one peer connection
  //     it was generated for, so it is aimed at the socket holding the
  //     other end of the leg (see `CallLeg`).
  // ==============================================================

  @SubscribeMessage('call:start')
  async onCallStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsCallStartPayload, body);
    const callerId = requireUserId(client);

    const { call, superseded } = await this.callsService.start(
      payload.conversationId,
      callerId,
      payload.kind,
    );

    // Re-ringing closed the previous attempt without either party acting.
    // Those devices were showing it, so they are told before anything else.
    for (const stale of superseded) {
      this.announceCallEnd(stale);
    }

    this.rememberLeg(call.id, {
      callerDeviceId: payload.deviceId,
      callerSocketId: client.id,
      calleeDeviceId: null,
      calleeSocketId: null,
    });

    // `call` is resolved for the caller (that is the ack it returns), and
    // `forCallee` for the other party, so neither recipient has to guess which
    // of the two users a `peer` field refers to.
    const forCallee = await this.callsService.viewFor(call.id, call.calleeId);

    // Ring only the callee's own sockets. Emitting into the conversation
    // room would also notify the caller, whose other tabs would then ring
    // themselves.
    this.server.to(userRoom(call.calleeId)).emit('call:incoming', {
      call: forCallee,
      // `forCallee.peer` is the caller, because the payload is resolved from
      // the callee's point of view. Reading it off `call` instead would name
      // the callee — i.e. tell someone ringing you that the call is from
      // themselves.
      caller: forCallee.peer,
    });

    // The caller's other tabs learn about it too, so an account open in two
    // places does not look idle in one of them. `.except` leaves out the tab
    // that asked for the call: it has the ack and is already showing this.
    this.server.to(userRoom(callerId)).except(client.id).emit('call:outgoing', {
      call,
      callerDeviceId: payload.deviceId,
    });

    return { call, callerDeviceId: payload.deviceId };
  }

  @SubscribeMessage('call:accept')
  async onCallAccept(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsCallActionPayload, body);
    const userId = requireUserId(client);

    const leg = this.callLegs.get(payload.callId);

    // Two of the same account's devices pressing answer at the same moment is
    // the case idempotency alone gets wrong: the service happily treats the
    // second accept as a repeat of the first and returns success, which would
    // let a device that is not carrying any media overwrite the callee end of
    // the leg and silently break the call that is already connected.
    //
    // A repeat from the device that already answered is still fine, so this
    // only refuses a *different* device.
    if (leg?.calleeDeviceId && leg.calleeDeviceId !== payload.deviceId) {
      throw new WsException('This call was already answered on another device');
    }

    const call = await this.callsService.accept(payload.callId, userId);

    // The caller end of the leg is preserved from `call:start`; if it is
    // missing — the server restarted mid-ring, say — the calling device
    // re-claims it with its next signalling message.
    this.rememberLeg(call.id, {
      callerDeviceId: leg?.callerDeviceId ?? null,
      callerSocketId: leg?.callerSocketId ?? null,
      calleeDeviceId: payload.deviceId,
      calleeSocketId: client.id,
    });

    // Both sides get told, each with the call resolved from their own point of
    // view, because `peer` is viewer-relative and one payload cannot be
    // correct for both.
    //
    // The device ids are what let each tab work out whether it is the one
    // expected to carry media or merely a bystander. The accepting tab already
    // has its peer connection up; the calling tab builds one now; every other
    // tab of either account falls back to reflecting the state.
    const forCaller = await this.callsService.viewFor(call.id, call.callerId);
    const forCallee = await this.callsService.viewFor(call.id, call.calleeId);

    const shared = {
      callerDeviceId: leg?.callerDeviceId ?? null,
      calleeDeviceId: payload.deviceId,
    };

    this.server.to(userRoom(call.callerId)).emit('call:accepted', {
      call: forCaller,
      ...shared,
    });

    this.server.to(userRoom(call.calleeId)).emit('call:accepted', {
      call: forCallee,
      ...shared,
    });

    return { call, ...shared };
  }

  /**
   * Declines a ringing call. Same teardown as hanging up, but a distinct
   * event so the caller can distinguish "they hung up" from "they said no".
   */
  @SubscribeMessage('call:reject')
  async onCallReject(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsCallActionPayload, body);
    const userId = requireUserId(client);

    const call = await this.callsService.end(
      payload.callId,
      userId,
      'declined',
    );

    this.announceCallEnd(call);

    return { call };
  }

  @SubscribeMessage('call:end')
  async onCallEnd(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsCallActionPayload, body);
    const userId = requireUserId(client);

    const call = await this.callsService.end(payload.callId, userId, 'hangup');

    this.announceCallEnd(call);

    return { call };
  }

  /**
   * Forwards one SDP offer/answer or ICE candidate to the peer device.
   *
   * A client that is not part of the call is rejected, so this cannot be used
   * to inject signalling into somebody else's negotiation.
   *
   * The emit targets a single socket. That is the whole point: a session
   * description is only meaningful to the one peer connection it was made
   * for, so delivering it to every tab the peer has open either duplicates it
   * (two answers to one offer, ICE applied to the wrong connection) or hands
   * it to a tab that was never going to negotiate anything.
   */
  @SubscribeMessage('call:signal')
  async onCallSignal(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsCallSignalPayload, body);
    const userId = requireUserId(client);

    const call = await this.assertCallParty(payload.callId, userId);

    if (isTerminal(call.status)) {
      throw new WsException('This call has already ended');
    }

    const isCaller = call.callerId === userId;
    const leg = this.callLegs.get(call.id);

    // A reconnect mints a new socket id, so the sender's end of the leg is
    // refreshed on every message rather than trusted until the call ends.
    // Refreshing by device id is also what makes a peer that reloaded
    // recoverable: its first message re-registers it.
    this.rememberLeg(call.id, {
      ...(leg ?? {
        callerDeviceId: null,
        callerSocketId: null,
        calleeDeviceId: null,
        calleeSocketId: null,
      }),
      ...(isCaller
        ? { callerDeviceId: payload.deviceId, callerSocketId: client.id }
        : { calleeDeviceId: payload.deviceId, calleeSocketId: client.id }),
    });

    const targetSocketId = isCaller
      ? this.callLegs.get(call.id)?.calleeSocketId
      : this.callLegs.get(call.id)?.callerSocketId;

    if (!targetSocketId) {
      // Nobody has picked the call up yet, so there is no peer connection to
      // negotiate against. Not an error: the caller can legitimately have an
      // offer in flight at this point, and the call will be ended by
      // `teardownCallsForSocket` if it is never answered.
      this.logger.debug(
        `Dropped ${payload.type} for call ${call.id}: no peer device yet`,
      );

      return { ok: true, delivered: false };
    }

    this.server.to(targetSocketId).emit('call:signal', {
      callId: call.id,
      from: userId,
      type: payload.type,
      data: payload.data ?? null,
    });

    return { ok: true, delivered: true };
  }

  /**
   * Marks a still-ringing call as missed when the callee disconnects without
   * answering, so the caller is not left with a call that rings forever.
   */
  @SubscribeMessage('call:cancel')
  async onCallCancel(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ) {
    const payload = await validateWsPayload(WsCallActionPayload, body);
    const userId = requireUserId(client);

    const call = await this.assertCallParty(payload.callId, userId);

    if (call.callerId !== userId) {
      throw new WsException('Only the caller can cancel a ringing call');
    }

    if (call.status !== CallStatus.RINGING) {
      return { call };
    }

    const updated = await this.callsService.end(call.id, userId, 'cancelled');

    this.announceCallEnd(updated);

    return { call: updated };
  }

  /**
   * Ends a live call when a participant's socket goes away, so a browser tab
   * being closed does not leave the peer's call UI up forever.
   *
   * Two different situations are handled, and conflating them was leaving
   * zombie calls behind:
   *
   *  - The socket that dropped was a *leg*. Its peer connection died with it
   *    and no other tab can take over, so the call ends even though the account
   *    is still connected elsewhere. Skipping these because "the user still has
   *    another socket" is what let a call sit ACCEPTED forever with one side
   *    talking to nobody.
   *  - The socket that dropped was a bystander tab. The call is untouched
   *    while the account has anywhere else to be reached.
   */
  private async teardownCallsForSocket(client: AuthedSocket): Promise<void> {
    const userId = client.data?.userId;

    if (!userId) {
      return;
    }

    try {
      const live = await this.prisma.call.findMany({
        where: {
          status: { in: [CallStatus.RINGING, CallStatus.ACCEPTED] },
          OR: [{ callerId: userId }, { calleeId: userId }],
        },
        select: { id: true, callerId: true, calleeId: true },
      });

      // Read once: presence is not consulted per call, and asking inside the
      // loop invites the impression that it could change between iterations.
      const accountElsewhere = this.presence.has(userId);

      for (const call of live) {
        const wasCarryingMedia =
          this.callLegs.get(call.id)?.callerSocketId === client.id ||
          this.callLegs.get(call.id)?.calleeSocketId === client.id;

        // A bystander tab closing is not the end of the account.
        if (!wasCarryingMedia && accountElsewhere) continue;

        const closed = await this.callsService.end(
          call.id,
          userId,
          'peer-disconnected',
        );

        this.announceCallEnd(closed);
      }
    } catch (error) {
      this.logger.error(
        `Failed to tear down calls for ${userId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Emits `call:ended` to every device of *both* parties, and drops the leg.
   *
   * Both rooms, not just the other one: the acting tab clears its own state
   * from the ack it already has, but its sibling tabs were showing the call
   * too and are told by nobody. A decline on one tab while another kept
   * ringing was the visible symptom of that.
   *
   * Redelivery to the acting tab is deliberate rather than filtered out: its
   * own cleanup is idempotent, and suppressing it would mean every terminal
   * handler had to remember to exempt itself.
   */
  private announceCallEnd(call: CallAnnouncement): void {
    this.callLegs.delete(call.id);

    this.server
      .to(userRoom(call.callerId))
      .to(userRoom(call.calleeId))
      .emit('call:ended', {
        callId: call.id,
        status: call.status,
        conversationId: call.conversationId,
      });
  }

  /**
   * Stores a call's leg, dropping any leg that has gone stale.
   *
   * Pruning happens on write rather than on a timer: a call closed outside the
   * gateway (the history endpoint expires missed rings) never reaches
   * `announceCallEnd`, and this is what keeps that from leaking an entry per
   * missed call.
   */
  private rememberLeg(callId: string, leg: Omit<CallLeg, 'touchedAt'>): void {
    const cutoff = Date.now() - LEG_TTL_MS;

    for (const [id, existing] of this.callLegs) {
      if (existing.touchedAt < cutoff) {
        this.callLegs.delete(id);
      }
    }

    this.callLegs.set(callId, { ...leg, touchedAt: Date.now() });
  }

  /**
   * Loads a call and asserts the socket's user is one of its two parties.
   * Returns the minimal row needed for routing.
   */
  private async assertCallParty(
    callId: string,
    userId: string,
  ): Promise<{
    id: string;
    conversationId: string;
    callerId: string;
    calleeId: string;
    status: CallStatus;
  }> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: {
        id: true,
        conversationId: true,
        callerId: true,
        calleeId: true,
        status: true,
      },
    });

    if (!call) {
      throw new WsException('Call not found');
    }

    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new WsException('You were not part of this call');
    }

    return call;
  }

  /** Everyone who is currently able to receive this event. */
  private async conversationRooms(conversationId: string): Promise<string[]> {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, leftAt: null },
      select: { userId: true },
    });

    return [
      conversationRoom(conversationId),
      ...participants.map(({ userId }) => userRoom(userId)),
    ];
  }

  /**
   * Emits to the union of the conversation room and every member's user
   * room in a single call, so a socket that is in both rooms receives the
   * event exactly once.
   */
  private async broadcastToConversation(
    conversationId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    const rooms = await this.conversationRooms(conversationId);
    this.server.to(rooms).emit(event, payload);
  }

  private async assertMember(
    client: AuthedSocket,
    conversationId: string,
  ): Promise<void> {
    const isMember = await this.conversationsService.isMember(
      requireUserId(client),
      conversationId,
    );

    if (!isMember) {
      throw new WsException('Not a member of this conversation');
    }
  }

  private trackPresence(userId: string, socketId: string) {
    const sockets = this.presence.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;

    sockets.add(socketId);
    this.presence.set(userId, sockets);

    if (wasOffline) {
      this.broadcastPresence(userId, true);
    }
  }

  private releasePresence(userId: string, socketId: string) {
    const sockets = this.presence.get(userId);

    if (!sockets) {
      return;
    }

    sockets.delete(socketId);

    if (sockets.size === 0) {
      this.presence.delete(userId);
      this.broadcastPresence(userId, false);
    }
  }

  /** Tells the user's accepted connections whether they are online. */
  private broadcastPresence(userId: string, online: boolean) {
    void this.prisma.connection
      .findMany({
        where: {
          status: ConnectionStatus.ACCEPTED,
          OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
        select: { requesterId: true, addresseeId: true },
      })
      .then((connections) => {
        const peerIds = connections.map((connection) =>
          connection.requesterId === userId
            ? connection.addresseeId
            : connection.requesterId,
        );

        for (const peerId of peerIds) {
          this.server
            .to(userRoom(peerId))
            .emit('presence:update', { userId, online });
        }
      })
      .catch((error: Error) =>
        this.logger.error(`Failed to broadcast presence: ${error.message}`),
      );
  }
}

function extractToken(client: Socket): string | null {
  // `handshake.auth` is typed `any` by socket.io because it is attacker
  // controlled, so read it as `unknown` and narrow before trusting it.
  const authToken: unknown = client.handshake.auth?.token;

  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken.replace(/^Bearer\s+/i, '');
  }

  const header = client.handshake.headers.authorization;

  if (typeof header === 'string' && header.length > 0) {
    return header.replace(/^Bearer\s+/i, '');
  }

  return null;
}
