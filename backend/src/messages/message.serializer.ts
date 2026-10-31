import { MessageType } from '../generated/prisma/client';

/** Shape returned to clients for a single message. */
export interface SerializedMessage {
  id: string;
  conversationId: string;
  body: string;
  type: MessageType;
  clientId: string | null;
  replyToId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deleted: boolean;
  sender: {
    id: string;
    name: string;
    avatarUrl: string | null;
    connectNumber: string;
  };
  readBy: Array<{ userId: string; readAt: Date }>;
}

type MessageWithRelations = {
  id: string;
  conversationId: string;
  body: string;
  type: MessageType;
  clientId: string | null;
  replyToId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  sender: {
    id: string;
    name: string;
    avatarUrl: string | null;
    connectNumber: string;
  };
  reads: Array<{ userId: string; readAt: Date }>;
};

export function serializeMessage(
  message: MessageWithRelations,
): SerializedMessage {
  const deleted = message.deletedAt !== null;

  return {
    id: message.id,
    conversationId: message.conversationId,
    body: deleted ? '' : message.body,
    type: deleted ? MessageType.SYSTEM : message.type,
    clientId: message.clientId,
    replyToId: message.replyToId,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deleted,
    sender: message.sender,
    readBy: deleted
      ? []
      : message.reads.map(({ userId, readAt }) => ({ userId, readAt })),
  };
}
