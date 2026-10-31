import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationType,
  MessageType,
  ParticipantRole,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import {
  assertConversationMember,
  assertRole,
} from '../common/utils/chat-access.util';
import { formatConnectNumber } from '../common/utils/connect-number.util';
import {
  AddMembersDto,
  CreateGroupDto,
  MuteConversationDto,
  StartDirectDto,
  UpdateGroupDto,
} from './dto/create-conversation.dto';

const conversationInclude = {
  participants: {
    where: { leftAt: null },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          connectNumber: true,
          lastSeenAt: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  },
} satisfies Prisma.ConversationInclude;

const GROUP_ROLES = [ParticipantRole.OWNER, ParticipantRole.ADMIN];

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connectionsService: ConnectionsService,
  ) {}

  async list(userId: string) {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { userId, leftAt: null },
      orderBy: { conversation: { lastMessageAt: 'desc' } },
      include: {
        conversation: {
          include: {
            participants: {
              where: { leftAt: null },
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    avatarUrl: true,
                    connectNumber: true,
                    lastSeenAt: true,
                  },
                },
              },
              orderBy: { joinedAt: 'asc' },
            },
          },
        },
      },
    });

    const unread = await this.unreadCounts(userId);

    return participants.map(({ conversation, lastReadAt, isMuted }) => ({
      ...this.serialize(conversation),
      isMuted,
      lastReadAt,
      unreadCount: unread[conversation.id] ?? 0,
    }));
  }

  async getById(userId: string, conversationId: string) {
    await assertConversationMember(this.prisma, conversationId, userId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: conversationInclude,
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.serialize(conversation);
  }

  /**
   * Opens (or reuses) the direct conversation with another user. Requires an
   * accepted connection, and is idempotent: calling it twice returns the
   * same conversation thanks to the unique `directKey`.
   */
  async startDirect(userId: string, dto: StartDirectDto) {
    const otherUserId = dto.userId;

    if (otherUserId === userId) {
      throw new BadRequestException('You cannot start a chat with yourself');
    }

    const other = await this.prisma.user.findFirst({
      where: { id: otherUserId, deletedAt: null },
      select: { id: true },
    });

    if (!other) {
      throw new NotFoundException('User not found');
    }

    if (await this.connectionsService.isBlocked(userId, otherUserId)) {
      throw new ForbiddenException('Unable to start a conversation');
    }

    if (!(await this.connectionsService.areConnected(userId, otherUserId))) {
      throw new ForbiddenException(
        'You can only message people you are connected to',
      );
    }

    const directKey = buildDirectKey(userId, otherUserId);

    const existing = await this.prisma.conversation.findUnique({
      where: { directKey },
      include: conversationInclude,
    });

    if (existing) {
      return this.serialize(existing);
    }

    const created = await this.prisma.conversation.create({
      data: {
        type: ConversationType.DIRECT,
        directKey,
        createdById: userId,
        participants: {
          create: [
            { userId, role: ParticipantRole.MEMBER },
            { userId: otherUserId, role: ParticipantRole.MEMBER },
          ],
        },
      },
      include: conversationInclude,
    });

    return this.serialize(created);
  }

  async createGroup(userId: string, dto: CreateGroupDto) {
    const memberIds = [...new Set(dto.memberIds)].filter((id) => id !== userId);

    if (memberIds.length === 0) {
      throw new BadRequestException('Select at least one other member');
    }

    // Every member must already be connected, otherwise the group would leak
    // the existence of a private number to people the creator did not approve.
    const connected = await this.connectionsService.areConnectedMany(
      userId,
      memberIds,
    );

    const missing = memberIds.filter((id) => !connected.has(id));

    if (missing.length > 0) {
      throw new ForbiddenException(
        'You can only add people you are connected to',
      );
    }

    const created = await this.prisma.conversation.create({
      data: {
        type: ConversationType.GROUP,
        title: dto.title.trim(),
        createdById: userId,
        participants: {
          create: [
            { userId, role: ParticipantRole.OWNER },
            ...memberIds.map((id) => ({
              userId: id,
              role: ParticipantRole.MEMBER,
            })),
          ],
        },
      },
      include: conversationInclude,
    });

    return this.serialize(created);
  }

  async updateGroup(
    userId: string,
    conversationId: string,
    dto: UpdateGroupDto,
  ) {
    const { role } = await assertConversationMember(
      this.prisma,
      conversationId,
      userId,
    );

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('Only group conversations can be edited');
    }

    // Only the owner and admins may change group details.
    assertRole(role, GROUP_ROLES);
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
      },
      include: conversationInclude,
    });

    return this.serialize(updated);
  }

  async addMembers(userId: string, conversationId: string, dto: AddMembersDto) {
    const { role } = await assertConversationMember(
      this.prisma,
      conversationId,
      userId,
    );
    assertRole(role, GROUP_ROLES);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true },
    });

    if (conversation?.type !== ConversationType.GROUP) {
      throw new BadRequestException('Members can only be added to groups');
    }

    const userIds = [...new Set(dto.userIds)].filter((id) => id !== userId);

    if (userIds.length === 0) {
      throw new BadRequestException('Select at least one member to add');
    }

    const connected = await this.connectionsService.areConnectedMany(
      userId,
      userIds,
    );

    if (userIds.some((id) => !connected.has(id))) {
      throw new ForbiddenException(
        'You can only add people you are connected to',
      );
    }

    const existingIds = new Set(
      (
        await this.prisma.conversationParticipant.findMany({
          where: { conversationId, userId: { in: userIds }, leftAt: null },
          select: { userId: true },
        })
      ).map((row) => row.userId),
    );

    const toAdd = userIds.filter((id) => !existingIds.has(id));

    if (toAdd.length === 0) {
      throw new ConflictException('Those people are already in this group');
    }

    await this.prisma.conversationParticipant.createMany({
      data: toAdd.map((id) => ({
        conversationId,
        userId: id,
        role: ParticipantRole.MEMBER,
      })),
    });

    await this.systemMessage(
      conversationId,
      `${toAdd.length} member(s) added`,
      userId,
    );

    return this.getById(userId, conversationId);
  }

  async removeMember(
    actorId: string,
    conversationId: string,
    targetUserId: string,
  ) {
    const { role } = await assertConversationMember(
      this.prisma,
      conversationId,
      actorId,
    );

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true },
    });

    if (conversation?.type !== ConversationType.GROUP) {
      throw new BadRequestException('Members can only leave groups');
    }

    const removingSelf = actorId === targetUserId;

    // Anyone may leave; removing somebody else requires OWNER/ADMIN, and an
    // admin may not remove the owner.
    if (!removingSelf) {
      assertRole(role, GROUP_ROLES);

      if (role === ParticipantRole.ADMIN) {
        const target = await this.prisma.conversationParticipant.findUnique({
          where: {
            conversationId_userId: { conversationId, userId: targetUserId },
          },
          select: { role: true },
        });

        if (target?.role === ParticipantRole.OWNER) {
          throw new ForbiddenException('Only the owner can remove the owner');
        }
      }
    }

    await this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId: targetUserId },
      },
      data: { leftAt: new Date() },
    });

    if (removingSelf) {
      return { success: true };
    }

    await this.systemMessage(conversationId, 'A member was removed', actorId);

    return this.getById(actorId, conversationId);
  }

  setMuted(userId: string, conversationId: string, dto: MuteConversationDto) {
    return this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: { isMuted: dto.muted ?? true },
      select: { conversationId: true, isMuted: true },
    });
  }

  /** Ids of every conversation the user is an active member of. */
  activeConversationIds(userId: string): Promise<string[]> {
    return this.prisma.conversationParticipant
      .findMany({
        where: { userId, leftAt: null },
        select: { conversationId: true },
      })
      .then((rows) => rows.map((row) => row.conversationId));
  }

  isMember(userId: string, conversationId: string): Promise<boolean> {
    return this.prisma.conversationParticipant
      .findUnique({
        where: { conversationId_userId: { conversationId, userId } },
        select: { leftAt: true },
      })
      .then((row) => row !== null && row.leftAt === null);
  }

  private async systemMessage(
    conversationId: string,
    body: string,
    actorId: string,
  ) {
    return this.prisma.message.create({
      data: {
        conversationId,
        senderId: actorId,
        body,
        type: MessageType.SYSTEM,
      },
    });
  }

  /**
   * Per-conversation unread counts. Counts messages newer than the caller's
   * own lastReadAt, excluding the caller's own messages.
   */
  private async unreadCounts(userId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ conversationId: string; count: bigint }>
    >`
      SELECT m."conversationId", COUNT(*)::bigint AS count
      FROM "chat"."messages" m
      JOIN "chat"."conversation_participants" p
        ON p."conversationId" = m."conversationId"
       AND p."userId" = ${userId}::uuid
      WHERE m."deletedAt" IS NULL
        AND m."senderId" <> ${userId}::uuid
        AND m."createdAt" > COALESCE(p."lastReadAt", p."joinedAt")
      GROUP BY m."conversationId"
    `;

    return Object.fromEntries(
      rows.map((row) => [row.conversationId, Number(row.count)]),
    );
  }

  private serialize(conversation: {
    id: string;
    type: ConversationType;
    title: string | null;
    avatarUrl: string | null;
    lastMessageAt: Date | null;
    lastMessagePreview: string | null;
    createdAt: Date;
    participants: Array<{
      role: ParticipantRole;
      lastReadAt: Date | null;
      isMuted: boolean;
      user: {
        id: string;
        name: string;
        avatarUrl: string | null;
        connectNumber: string;
        lastSeenAt: Date;
      };
    }>;
  }) {
    return {
      id: conversation.id,
      type: conversation.type,
      title: conversation.title,
      avatarUrl: conversation.avatarUrl,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      createdAt: conversation.createdAt,
      participantCount: conversation.participants.length,
      participants: conversation.participants.map((participant) => ({
        role: participant.role,
        lastReadAt: participant.lastReadAt,
        isMuted: participant.isMuted,
        user: {
          ...participant.user,
          connectNumberFormatted: formatConnectNumber(
            participant.user.connectNumber,
          ),
        },
      })),
    };
  }
}

/** Stable key for the pair of users in a direct conversation. */
export function buildDirectKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}
