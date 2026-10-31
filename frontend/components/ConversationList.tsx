"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSocket } from "@/context/SocketProvider";
import { api } from "@/lib/api";
import { sortConversations } from "@/lib/conversation";
import type { Conversation } from "@/lib/types";
import { ConversationRow } from "./ConversationRow";
import { PrivateNumberCard } from "./PrivateNumberCard";
import { Button } from "./Button";
import { IconCompose, IconLink, IconSearch, IconX } from "./icons";
import { useAuth } from "@/context/AuthProvider";

/**
 * The conversation panel: search, list, and the user's own number.
 *
 * It lives in the chats layout rather than in the list page, so selecting a
 * conversation on desktop does not tear the list down and rebuild it — the
 * panel stays mounted and only the detail pane swaps.
 */
export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.get<Conversation[]>("/conversations");
      setConversations(sortConversations(data));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load chats");
    }
  }, []);

  useEffect(() => {
    // `load` is async: every setState runs after an await, so this cannot
    // cascade within the same render pass.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Keep previews and unread badges current as messages arrive.
  useEffect(() => {
    if (!socket) return;

    const refresh = () => void load();

    socket.on("message:new", refresh);
    socket.on("message:updated", refresh);
    socket.on("message:deleted", refresh);
    socket.on("message:read", refresh);

    return () => {
      socket.off("message:new", refresh);
      socket.off("message:updated", refresh);
      socket.off("message:deleted", refresh);
      socket.off("message:read", refresh);
    };
  }, [socket, load]);

  const filtered = useMemo(() => {
    if (!conversations) return null;

    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;

    return conversations.filter((conversation) => {
      const title = conversation.title ?? "";
      const names = conversation.participants.map((p) => p.user.name).join(" ");
      const preview = conversation.lastMessagePreview ?? "";

      return `${title} ${names} ${preview}`.toLowerCase().includes(needle);
    });
  }, [conversations, query]);

  return (
    <div className="flex h-full w-full min-h-0 flex-col border-r border-line bg-surface">
      <header className="shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg leading-tight font-semibold tracking-tight">
              Chats
            </h1>
            <p className="text-xs text-ink-3">
              {conversations && conversations.length > 0
                ? `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`
                : "Say hello to someone"}
            </p>
          </div>

          <Link
            href="/connect"
            title="Find someone by number"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-[image:var(--gradient-brand)] text-on-brand shadow-xs transition-[filter] hover:brightness-110"
          >
            <IconCompose size={18} />
          </Link>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-muted px-3 transition-shadow focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/12">
          <IconSearch size={16} className="shrink-0 text-ink-3" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-ink-3 transition-colors hover:text-ink"
            >
              <IconX size={15} />
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {error && (
          <div className="m-2 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {error}
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!filtered && !error && <ListSkeleton />}

        {filtered && filtered.length === 0 && (
          <EmptyList hasQuery={query.trim().length > 0} />
        )}

        {filtered && filtered.length > 0 && (
          <ul className="space-y-0.5">
            {filtered.map((conversation) => (
              <li key={conversation.id}>
                <ConversationRow
                  conversation={conversation}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="shrink-0 border-t border-line p-3">
        <PrivateNumberCard number={user?.connectNumber ?? ""} variant="compact" />
      </footer>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-1 p-1" aria-hidden>
      {Array.from({ length: 6 }).map((_, index) => (
        <li key={index} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          <div className="skeleton h-11 w-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3 w-1/3 rounded-full" />
            <div className="skeleton h-3 w-2/3 rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyList({ hasQuery }: { hasQuery: boolean }) {
  if (hasQuery) {
    return (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-ink-3">
          <IconSearch size={20} />
        </div>
        <p className="mt-3 text-sm font-medium">No matches</p>
        <p className="mt-1 text-xs text-ink-3">
          Nothing here fits that search.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <IconLink size={22} />
      </div>
      <p className="mt-3 text-sm font-semibold">No conversations yet</p>
      <p className="mt-1 max-w-[15rem] text-xs leading-relaxed text-ink-3">
        Every chat starts with a private number. Paste someone&apos;s and send a
        request.
      </p>
      <Link href="/connect" className="mt-4">
        <Button size="sm">Find someone</Button>
      </Link>
    </div>
  );
}
