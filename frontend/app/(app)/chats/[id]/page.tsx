"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthProvider";
import { useSocket } from "@/context/SocketProvider";
import { conversationTitle, peerOf } from "@/lib/conversation";
import { formatDayDivider, lastSeenLabel } from "@/lib/format";
import type { Conversation, Message } from "@/lib/types";
import { uuidv4 } from "@/lib/uuid";
import { Avatar } from "@/components/Avatar";
import { CallButtons } from "@/components/CallButtons";
import { CallHistory } from "@/components/CallHistory";
import { Button } from "@/components/Button";
import { MessageBubble } from "@/components/MessageBubble";
import { BrandLoader } from "@/components/BrandLoader";
import {
  IconArrowLeft,
  IconChat,
  IconCheck,
  IconSend,
  IconX,
} from "@/components/icons";

const TYPING_IDLE_MS = 1200;

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  return <ChatView params={params} />;
}

function ChatView({ params }: { params: Promise<{ id: string }> }) {
  const { user } = useAuth();
  const { socket, isOnline, isTyping, emitTyping } = useSocket();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActive = useRef(false);
  const atBottom = useRef(true);

  useEffect(() => {
    let cancelled = false;

    void params.then(({ id }) => {
      if (!cancelled) setConversationId(id);
    });

    return () => {
      cancelled = true;
    };
  }, [params]);

  // ---------------------------------------------------------------- loading

  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;

    async function load() {
      try {
        const [conv, msgs] = await Promise.all([
          api.get<Conversation>(`/conversations/${conversationId}`),
          api.get<Message[]>(`/conversations/${conversationId}/messages`),
        ]);

        if (cancelled) return;

        setConversation(conv);
        setMessages(msgs);
        setHasMore(msgs.length >= 30);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to open this chat",
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // ------------------------------------------------------------- socket wiring

  useEffect(() => {
    if (!socket || !conversationId) return;

    socket.emit("conversation:join", { conversationId });

    const onNew = (payload: { message: Message }) => {
      if (payload.message.conversationId !== conversationId) return;

      setMessages((current) =>
        current.some(
          (m) =>
            m.id === payload.message.id ||
            (payload.message.clientId !== null &&
              m.clientId === payload.message.clientId),
        )
          ? current
          : [...current, payload.message],
      );

      // Reading a chat means reading its messages.
      socket.emit("message:read", { conversationId });
    };

    const onUpdated = (payload: { message: Message }) => {
      setMessages((current) =>
        current.map((m) => (m.id === payload.message.id ? payload.message : m)),
      );
    };

    const onDeleted = (payload: { message: Message }) => {
      setMessages((current) =>
        current.map((m) => (m.id === payload.message.id ? payload.message : m)),
      );
    };

    const onRead = (payload: {
      userId: string;
      messageIds: string[];
      readAt: string;
    }) => {
      setMessages((current) =>
        current.map((m) =>
          payload.messageIds.includes(m.id)
            ? {
                ...m,
                readBy: m.readBy.some((r) => r.userId === payload.userId)
                  ? m.readBy
                  : [
                      ...m.readBy,
                      { userId: payload.userId, readAt: payload.readAt },
                    ],
              }
            : m,
        ),
      );
    };

    socket.on("message:new", onNew);
    socket.on("message:updated", onUpdated);
    socket.on("message:deleted", onDeleted);
    socket.on("message:read", onRead);

    return () => {
      socket.emit("conversation:leave", { conversationId });
      socket.off("message:new", onNew);
      socket.off("message:updated", onUpdated);
      socket.off("message:deleted", onDeleted);
      socket.off("message:read", onRead);
    };
  }, [socket, conversationId]);

  // Mark the conversation read whenever it is opened.
  useEffect(() => {
    if (!socket || !conversationId) return;
    socket.emit("message:read", { conversationId });
  }, [socket, conversationId, messages.length]);

  // ----------------------------------------------------------------- scrolling

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  async function loadOlder() {
    if (!conversationId || !hasMore || loadingOlder) return;

    const oldest = messages[0];

    if (!oldest) return;

    const container = scrollRef.current;
    const previousHeight = container?.scrollHeight ?? 0;

    setLoadingOlder(true);

    try {
      const older = await api.get<Message[]>(
        `/conversations/${conversationId}/messages?before=${encodeURIComponent(oldest.createdAt)}`,
      );

      if (older.length > 0) {
        setMessages((current) => [...older, ...current]);
        setHasMore(older.length >= 30);

        // Older messages are prepended, so push the scroll position down by
        // exactly the height that was inserted to keep the view still.
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop += container.scrollHeight - previousHeight;
            atBottom.current = false;
          }
        });
      } else {
        setHasMore(false);
      }
    } catch {
      // Ignore and let the user retry by scrolling again.
    } finally {
      setLoadingOlder(false);
    }
  }

  // ----------------------------------------------------------------- actions

  function onScroll() {
    const container = scrollRef.current;

    if (!container) return;

    atBottom.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80;

    if (container.scrollTop < 40) {
      void loadOlder();
    }
  }

  function send() {
    const body = draft.trim();

    if (!body || !conversationId || !socket) return;

    const clientId = uuidv4();

    socket.emit("message:send", { conversationId, body, clientId });
    setDraft("");

    if (typingActive.current) {
      emitTyping(conversationId, false);
      typingActive.current = false;
    }
  }

  function onDraftChange(value: string) {
    setDraft(value);

    if (!conversationId) return;

    if (value.trim() && !typingActive.current) {
      emitTyping(conversationId, true);
      typingActive.current = true;
    }

    if (typingTimer.current) clearTimeout(typingTimer.current);

    typingTimer.current = setTimeout(() => {
      emitTyping(conversationId, false);
      typingActive.current = false;
    }, TYPING_IDLE_MS);
  }

  function startEdit(message: Message) {
    setEditing(message);
  }

  async function saveEdit() {
    if (!editing || !socket || !conversationId) return;

    const body = draft.trim();

    if (!body) return;

    socket.emit("message:edit", { messageId: editing.id, body });
    setEditing(null);
    setDraft("");
  }

  function removeMessage(message: Message) {
    if (!socket) return;
    socket.emit("message:delete", { messageId: message.id });
  }

  function cancelEdit() {
    setEditing(null);
    setDraft("");
  }

  // ------------------------------------------------------------------- render

  if (error) {
    return (
      <div className="chat-canvas flex h-full flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
          <IconX size={22} />
        </div>
        <p className="max-w-xs text-sm text-ink-2">{error}</p>
        <Link href="/chats">
          <Button variant="outline">Back to chats</Button>
        </Link>
      </div>
    );
  }

  if (!conversation || !conversationId) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <BrandLoader message="Opening chat" />
      </div>
    );
  }

  const selfId = user?.id ?? "";
  const isGroup = conversation.type === "GROUP";
  const peer = peerOf(conversation, selfId);
  const title = conversationTitle(conversation, selfId);
  const participantIds = conversation.participants.map((p) => p.user.id);

  const othersTyping = conversation.participants
    .filter((p) => p.user.id !== selfId && isTyping(conversationId, p.user.id))
    .map((p) => p.user.name);

  const subtitle = isGroup
    ? `${conversation.participantCount} members${
        othersTyping.length > 0
          ? ` · ${othersTyping.join(", ")} typing…`
          : ""
      }`
    : peer
      ? isOnline(peer.id)
        ? "Online"
        : lastSeenLabel(peer.lastSeenAt)
      : "";

  const showTyping = othersTyping.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* ------------------------------------------------------------ header */}
      <header className="glass z-10 flex shrink-0 items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
        <Link
          href="/chats"
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-xl text-ink-2 transition-colors hover:bg-muted lg:hidden"
          aria-label="Back to chats"
        >
          <IconArrowLeft size={20} />
        </Link>

        {isGroup ? (
          <Avatar name={title} size="sm" />
        ) : (
          <Avatar
            name={title}
            src={peer?.avatarUrl}
            size="sm"
            online={peer ? isOnline(peer.id) : false}
          />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-semibold">{title}</p>
          <p
            className={`truncate text-xs ${
              showTyping || (!isGroup && peer && isOnline(peer.id))
                ? "font-medium text-brand"
                : "text-ink-3"
            }`}
          >
            {subtitle}
          </p>
        </div>

        <div className="flex items-center gap-0.5">
          {!isGroup && <CallHistory conversationId={conversationId} />}
          <CallButtons conversation={conversation} peer={peer} />
        </div>
      </header>

      {/* ----------------------------------------------------------- message */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="chat-canvas min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
      >
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-brand shadow-xs">
              <IconChat size={22} />
            </div>
            <p className="mt-3 text-sm font-semibold">This is the beginning</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-2">
              Messages you send here are delivered in realtime and stay after a
              reload.
            </p>
          </div>
        ) : (
          // `min-h-full` + `justify-end` pins a short thread to the bottom,
          // the way every messenger reads, without the clipping that a plain
          // `justify-end` causes once the thread is taller than the viewport.
          <div className="flex min-h-full flex-col justify-end">
            {hasMore && (
              <div className="flex justify-center pb-3">
                <Button
                  size="sm"
                  variant="outline"
                  loading={loadingOlder}
                  onClick={() => void loadOlder()}
                >
                  Load earlier messages
                </Button>
              </div>
            )}

            <div className="space-y-1.5">
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const showDay =
                  !previous ||
                  new Date(previous.createdAt).toDateString() !==
                    new Date(message.createdAt).toDateString();

                const showAvatar =
                  !previous ||
                  previous.sender.id !== message.sender.id ||
                  new Date(message.createdAt).getTime() -
                    new Date(previous.createdAt).getTime() >
                    5 * 60 * 1000;

                return (
                  <div key={message.id}>
                    {showDay && (
                      <div className="my-4 flex justify-center">
                        <span className="rounded-full border border-line bg-surface/90 px-3 py-1 text-[11px] font-medium text-ink-2 shadow-xs">
                          {formatDayDivider(message.createdAt)}
                        </span>
                      </div>
                    )}

                    <MessageBubble
                      message={message}
                      isOwn={message.sender.id === selfId}
                      showAvatar={showAvatar}
                      isGroup={isGroup}
                      participantIds={participantIds}
                      editing={editing?.id === message.id}
                      onEdit={message.sender.id === selfId ? startEdit : undefined}
                      onDelete={
                        message.sender.id === selfId ? removeMessage : undefined
                      }
                    />
                  </div>
                );
              })}
            </div>

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- typing */}
      <div className="shrink-0 border-t border-line bg-surface">
        {showTyping && (
          <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-ink-2">
            <span className="flex items-end gap-0.5 pb-0.5">
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand" />
            </span>
            <span className="truncate">
              {othersTyping.join(", ")}{" "}
              {othersTyping.length > 1 ? "are" : "is"} typing…
            </span>
          </div>
        )}

        {/* ------------------------------------------------------------ composer */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (editing) void saveEdit();
            else send();
          }}
          className="px-3 pt-2 pb-3 sm:px-4"
        >
          {editing && (
            <div className="animate-fade-in mb-2 flex items-center gap-2 rounded-xl border border-line bg-muted px-3 py-2 text-xs text-ink-2">
              <span className="h-4 w-0.5 rounded-full bg-brand" />
              <span className="min-w-0 flex-1 truncate">
                Editing “{editing.body.slice(0, 60)}”
              </span>
              <button
                type="button"
                onClick={cancelEdit}
                className="text-ink-3 transition-colors hover:text-ink"
                aria-label="Cancel editing"
              >
                <IconX size={15} />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface px-2.5 py-2 shadow-xs transition-shadow focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/12">
            <textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (editing) void saveEdit();
                  else send();
                }
              }}
              rows={1}
              placeholder={
                editing ? "Edit your message…" : `Message${
                  isGroup ? "" : ` ${title}`
                }`
              }
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm leading-relaxed outline-none placeholder:text-ink-3"
            />

            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label={editing ? "Save message" : "Send message"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[image:var(--gradient-brand)] text-on-brand shadow-xs transition-[filter,transform] hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:hover:brightness-100"
            >
              {editing ? (
                <IconCheck size={17} strokeWidth={2.4} />
              ) : (
                <IconSend size={17} />
              )}
            </button>
          </div>

          <p className="mt-1.5 hidden px-1 text-[11px] text-ink-3 sm:block">
            <kbd className="rounded border border-line bg-muted px-1 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            to send ·{" "}
            <kbd className="rounded border border-line bg-muted px-1 py-0.5 font-mono text-[10px]">
              Shift
            </kbd>{" "}
            +{" "}
            <kbd className="rounded border border-line bg-muted px-1 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            for a new line
          </p>
        </form>
      </div>
    </div>
  );
}
