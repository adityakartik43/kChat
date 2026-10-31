import type { Conversation, PublicUser } from "./types";

/** The other person in a direct conversation, or null for groups. */
export function peerOf(
  conversation: Pick<Conversation, "type" | "participants">,
  selfId: string,
): PublicUser | null {
  if (conversation.type === "GROUP") return null;

  return (
    conversation.participants.find((p) => p.user.id !== selfId)?.user ?? null
  );
}

export function conversationTitle(
  conversation: Pick<Conversation, "type" | "title" | "participants">,
  selfId: string,
): string {
  if (conversation.type === "GROUP") {
    return conversation.title ?? "Group";
  }

  const peer = peerOf(conversation, selfId);
  return peer?.name ?? "Conversation";
}

export function sortConversations(
  conversations: Conversation[],
): Conversation[] {
  return [...conversations].sort((a, b) => {
    const aTime = a.lastMessageAt ?? a.createdAt;
    const bTime = b.lastMessageAt ?? b.createdAt;

    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });
}

/** Total unread across all conversations, used for the nav badge. */
export function totalUnread(conversations: Conversation[]): number {
  return conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
}
