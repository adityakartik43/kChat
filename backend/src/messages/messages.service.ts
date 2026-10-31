import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MessageType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertConversationMember } from '../common/utils/chat-access.util';
import { EditMessageDto, MarkReadDto } from './dto/edit-message.dto';
import { ListMessagesDto, SendMessageDto } from './dto/send-message.dto';
import { SerializedMessage, serializeMessage } from './message.serializer';

const messageInclude = {
  sender: {
    select: { id: true, name: true, avatarUrl: true, connectNumber: true },
  },
  reads: { select: { userId: true, readAt: true } },
} satisfies Prisma.MessageInclude;

const PREVIEW_LENGTH = 120;

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a message and bumps the conversation preview.
   *
   * Idempotent: when the same (senderId, clientId) pair is replayed — which
   * happens when a client retries after a dropped socket — the original
   * message is returned instead of creating a duplicate.
   */
  async send(
    conversationId: string,
    senderId: string,
    dto: SendMessageDto,
  ): Promise<SerializedMessage> {
    await assertConversationMember(this.prisma, conversationId, senderId);

    const body = dto.body.trim();

    if (body.length === 0) {
      throw new BadRequestException('Message body cannot be empty');
    }

    if (dto.replyToId) {
      const replyTarget = await this.prisma.message.findFirst({
        where: { id: dto.replyToId, conversationId, deletedAt: null },
        select: { id: true },
      });

      if (!replyTarget) {
        throw new BadRequestException('Message being replied to was not found');
      }
    }

    const existing = dto.clientId
      ? await this.prisma.message.findUnique({
          where: {
            senderId_clientId: { senderId, clientId: dto.clientId },
          },
          include: messageInclude,
        })
      : null;

    if (existing) {
      return serializeMessage(existing);
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          senderId,
          body,
          type: dto.type ?? MessageType.TEXT,
          clientId: dto.clientId,
          replyToId: dto.replyToId,
        },
        include: messageInclude,
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: created.createdAt,
          lastMessagePreview: body.slice(0, PREVIEW_LENGTH),
        },
      });

      return created;
    });

    return serializeMessage(message);
  }

  /** Keyset pagination, newest first. Returns messages in ascending order. */
  async list(
    conversationId: string,
    userId: string,
    dto: ListMessagesDto,
  ): Promise<SerializedMessage[]> {
    await assertConversationMember(this.prisma, conversationId, userId);

    const before = dto.before ? new Date(dto.before) : undefined;

    if (before && Number.isNaN(before.getTime())) {
      throw new BadRequestException('before must be a valid ISO timestamp');
    }

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: dto.limit,
    });

    return rows.reverse().map(serializeMessage);
  }

  async edit(
    messageId: string,
    userId: string,
    dto: EditMessageDto,
  ): Promise<SerializedMessage> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: messageInclude,
    });

    if (!message || message.deletedAt) {
      throw new NotFoundException('Message not found');
    }

    await assertConversationMember(this.prisma, message.conversationId, userId);

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    const body = dto.body.trim();

    if (body.length === 0) {
      throw new BadRequestException('Message body cannot be empty');
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { body, editedAt: new Date() },
      include: messageInclude,
    });

    return serializeMessage(updated);
  }

  /** Soft delete: the row is kept so replies and ids stay valid. */
  async remove(messageId: string, userId: string): Promise<SerializedMessage> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: messageInclude,
    });

    if (!message || message.deletedAt) {
      throw new NotFoundException('Message not found');
    }

    await assertConversationMember(this.prisma, message.conversationId, userId);

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    const deleted = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
      include: messageInclude,
    });

    return serializeMessage(deleted);
  }

  /**
   * Marks messages as read by the caller, advances the participant's
   * lastReadAt, and returns the messages that became read so the caller can
   * broadcast read receipts.
   */
  async markRead(
    conversationId: string,
    userId: string,
    dto: MarkReadDto,
  ): Promise<{ messageIds: string[]; readAt: Date }> {
    await assertConversationMember(this.prisma, conversationId, userId);

    const readAt = new Date();

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        senderId: { not: userId },
        ...(dto.messageIds?.length ? { id: { in: dto.messageIds } } : {}),
      },
      select: { id: true },
    });

    const messageIds = messages.map((message) => message.id);

    if (messageIds.length > 0) {
      await this.prisma.messageRead.createMany({
        data: messageIds.map((messageId) => ({ messageId, userId, readAt })),
        skipDuplicates: true,
      });
    }

    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: readAt },
    });

    return { messageIds, readAt };
  }
}
