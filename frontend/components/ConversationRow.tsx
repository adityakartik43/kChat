"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";
import { useSocket } from "@/context/SocketProvider";
import { Avatar } from "./Avatar";
import { formatRelativeTime } from "@/lib/format";
import { conversationTitle, peerOf } from "@/lib/conversation";
import type { Conversation } from "@/lib/types";

export function ConversationRow({
  conversation,
  onNavigate,
}: {
  conversation: Conversation;
  /** Mobile navigates away from the list; desktop keeps it rendered. */
  onNavigate?: () => void;
}) {
  const { user } = useAuth();
  const { isOnline } = useSocket();
  const pathname = usePathname();

  const selfId = user?.id ?? "";
  const peer = peerOf(conversation, selfId);
  const isGroup = conversation.type === "GROUP";
  const title = conversationTitle(conversation, selfId);
  const unread = conversation.unreadCount ?? 0;
  const active = pathname === `/chats/${conversation.id}`;

  return (
    <Link
      href={`/chats/${conversation.id}`}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 ${
        active
          ? "bg-brand-soft"
          : "hover:bg-muted"
      }`}
    >
      {isGroup ? (
        <Avatar name={title} size="md" />
      ) : (
        <Avatar
          name={title}
          src={peer?.avatarUrl}
          size="md"
          online={peer ? isOnline(peer.id) : false}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p
            className={`min-w-0 flex-1 truncate text-sm leading-tight font-semibold ${
              active ? "text-brand" : "text-ink"
            }`}
          >
            {title}
          </p>

          {conversation.lastMessageAt && (
            <span
              className={`shrink-0 text-[11px] tabular-nums ${
                unread > 0 ? "font-semibold text-brand" : "text-ink-3"
              }`}
            >
              {formatRelativeTime(conversation.lastMessageAt)}
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2">
          <p
            className={`min-w-0 flex-1 truncate text-[13px] leading-tight ${
              unread > 0 ? "font-medium text-ink-2" : "text-ink-3"
            }`}
          >
            {conversation.lastMessagePreview ?? (
              <span className="italic text-ink-3">No messages yet</span>
            )}
          </p>

          {unread > 0 && (
            <span className="min-w-[18px] shrink-0 rounded-full bg-[image:var(--gradient-brand)] px-1.5 text-center text-[11px] leading-[18px] font-semibold text-on-brand">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
