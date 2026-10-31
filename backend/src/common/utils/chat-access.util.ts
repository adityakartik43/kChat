import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Guards every conversation-scoped operation: the caller must be an active
 * (not left) participant of the conversation. Throws otherwise.
 *
 * Kept as a standalone function so the messages and conversations services
 * can share it without depending on each other.
 */
export async function assertConversationMember(
  prisma: PrismaService,
  conversationId: string,
  userId: string,
): Promise<{ role: string; lastReadAt: Date | null }> {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { role: true, leftAt: true, lastReadAt: true },
  });

  if (!participant) {
    // Do not reveal whether the conversation exists.
    throw new NotFoundException('Conversation not found');
  }

  if (participant.leftAt) {
    throw new ForbiddenException('You are no longer part of this conversation');
  }

  return { role: participant.role, lastReadAt: participant.lastReadAt };
}

/** Throws unless the caller has at least the given role in the conversation. */
export function assertRole(role: string, allowed: readonly string[]): void {
  if (!allowed.includes(role)) {
    throw new ForbiddenException('Insufficient permissions for this action');
  }
}
