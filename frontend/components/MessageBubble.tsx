"use client";

import { useEffect, useState } from "react";
import type { Message } from "@/lib/types";
import { formatClock } from "@/lib/format";
import { Avatar } from "./Avatar";
import {
  IconCheck,
  IconCheckCheck,
  IconMore,
  IconPencil,
  IconTrash,
} from "./icons";

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showAvatar: boolean;
  isGroup: boolean;
  /** Everyone else in the conversation, for read receipt ticks. */
  participantIds: string[];
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  editing?: boolean;
}

export function MessageBubble({
  message,
  isOwn,
  showAvatar,
  isGroup,
  participantIds,
  onEdit,
  onDelete,
  editing = false,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Click-away behaves like a popover without needing a ref per bubble.
  useEffect(() => {
    if (!menuOpen) return;

    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  if (message.type === "SYSTEM") {
    return (
      <div className="flex justify-center py-1.5">
        <span className="rounded-full border border-line bg-surface/80 px-3 py-1 text-xs text-ink-2 shadow-xs">
          {message.body}
        </span>
      </div>
    );
  }

  const others = participantIds.filter((id) => id !== message.sender.id);
  const seenByOthers = others.filter((id) =>
    message.readBy.some((read) => read.userId === id),
  );
  const allSeen = others.length > 0 && seenByOthers.length === others.length;

  return (
    <div
      className={`group flex items-end gap-2 ${isOwn ? "flex-row-reverse" : ""}`}
    >
      <div className="w-8 shrink-0">
        {showAvatar && !isOwn && isGroup && (
          <Avatar name={message.sender.name} size="sm" />
        )}
      </div>

      <div className="relative max-w-[78%] sm:max-w-[62%]">
        {showAvatar && !isOwn && isGroup && (
          <p className="mb-1 px-1 text-xs font-semibold text-brand">
            {message.sender.name}
          </p>
        )}

        <div
          className={`px-3.5 py-2 text-sm leading-relaxed break-anywhere transition-opacity ${
            isOwn
              ? "rounded-2xl rounded-br-md bg-[image:var(--gradient-brand)] text-on-brand shadow-xs"
              : "rounded-2xl rounded-bl-md border border-line bg-surface text-ink shadow-xs"
          } ${editing ? "opacity-60" : ""}`}
        >
          {message.deleted ? (
            <em className="flex items-center gap-1.5 opacity-70 not-italic">
              <IconTrash size={13} />
              This message was deleted
            </em>
          ) : (
            message.body
          )}
        </div>

        <div
          className={`mt-1 flex items-center gap-1.5 px-1 text-[11px] text-ink-3 ${
            isOwn ? "justify-end" : ""
          }`}
        >
          {message.editedAt && !message.deleted && <span>edited</span>}
          <span className="tabular-nums">{formatClock(message.createdAt)}</span>

          {isOwn && !message.deleted && (
            <span
              title={
                allSeen
                  ? "Seen by everyone"
                  : seenByOthers.length > 0
                    ? `Seen by ${seenByOthers.length}`
                    : "Sent"
              }
              className={allSeen ? "text-brand" : "text-ink-3"}
            >
              {allSeen ? (
                <IconCheckCheck size={13} strokeWidth={2.2} />
              ) : (
                <IconCheck size={13} strokeWidth={2.2} />
              )}
            </span>
          )}
        </div>

        {isOwn && !message.deleted && (onEdit || onDelete) && (
          <>
            <button
              type="button"
              aria-label="Message options"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((open) => !open);
              }}
              className={`absolute top-0 ${
                isOwn ? "-left-9" : "-right-9"
              } hidden h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 shadow-xs transition-colors hover:text-ink group-hover:flex ${
                menuOpen ? "!flex" : ""
              }`}
            >
              <IconMore size={15} />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" aria-hidden />
                <div
                  onClick={(event) => event.stopPropagation()}
                  className={`animate-pop-in absolute top-6 z-30 w-36 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-lg ${
                    isOwn ? "right-0" : "left-0"
                  }`}
                >
                  {onEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onEdit(message);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-muted hover:text-ink"
                    >
                      <IconPencil size={14} />
                      Edit
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete(message);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-danger transition-colors hover:bg-danger-soft"
                    >
                      <IconTrash size={14} />
                      Delete
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
