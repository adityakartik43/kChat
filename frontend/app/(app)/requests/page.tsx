"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthProvider";
import { formatRelativeTime } from "@/lib/format";
import type { Connection } from "@/lib/types";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { BrandLoader } from "@/components/BrandLoader";
import {
  IconInbox,
  IconUserPlus,
  IconUsers,
  IconX,
} from "@/components/icons";

type Tab = "incoming" | "outgoing" | "connected";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "incoming", label: "Incoming" },
  { key: "outgoing", label: "Sent" },
  { key: "connected", label: "Connected" },
];

export default function RequestsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("incoming");
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);

    try {
      const data =
        tab === "connected"
          ? await api.get<Connection[]>("/connections?status=ACCEPTED")
          : await api.get<Connection[]>(
              `/connections?status=PENDING&scope=${tab}`,
            );

      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load requests");
      setRows([]);
    }
  }, [tab]);

  useEffect(() => {
    // Clearing to the loading state on tab change is a deliberate reset of
    // derived data; the fetch that follows is async.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(null);
    void load();
  }, [load]);

  async function respond(id: string, status: "ACCEPTED" | "DECLINED" | "BLOCKED") {
    setBusyId(id);
    setError(null);

    try {
      await api.patch(`/connections/${id}`, { status });

      // Accepting moves the person to "Connected", so switch there so the
      // user has a direct path into the chat instead of an empty list.
      if (status === "ACCEPTED") {
        setTab("connected");
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);

    try {
      await api.del(`/connections/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function openChat(userId: string) {
    setBusyId(userId);

    try {
      const conversation = await api.post<{ id: string }>("/conversations/direct", {
        userId,
      });
      router.push(`/chats/${conversation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the chat");
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-line bg-surface px-5 py-4 sm:px-8">
        <h1 className="text-lg font-semibold tracking-tight">Requests</h1>
        <p className="mt-0.5 text-sm text-ink-2">
          People you can talk to, and the ones waiting on you.
        </p>

        <div
          role="tablist"
          aria-label="Request views"
          className="mt-4 inline-flex gap-1 rounded-xl border border-line bg-muted p-1"
        >
          {TABS.map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                tab === item.key
                  ? "bg-surface text-ink shadow-xs"
                  : "text-ink-2 hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
        <div className="mx-auto max-w-2xl">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
              {error}
            </div>
          )}

          {!rows && <BrandLoader message="Loading requests" />}

          {rows && rows.length === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                {tab === "connected" ? <IconUsers size={22} /> : <IconInbox size={22} />}
              </div>
              <p className="mt-3 text-sm font-semibold">
                {tab === "incoming" && "No pending requests"}
                {tab === "outgoing" && "No requests sent"}
                {tab === "connected" && "Not connected to anyone yet"}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-3">
                {tab === "incoming" &&
                  "When someone looks you up by number, their request lands here."}
                {tab === "outgoing" &&
                  "Requests you send from Connect show up here until they answer."}
                {tab === "connected" &&
                  "Accept a request and the two of you can message each other."}
              </p>
            </div>
          )}

          {rows && rows.length > 0 && (
            <ul className="space-y-2">
              {rows.map((connection) => {
                const isIncoming = connection.addressee.id === user?.id;
                const other = isIncoming ? connection.requester : connection.addressee;
                const busy = busyId === connection.id;

                return (
                  <li
                    key={connection.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-xs transition-shadow hover:shadow-sm"
                  >
                    <Avatar name={other.name} src={other.avatarUrl} size="md" />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{other.name}</p>
                      <p className="truncate text-xs text-ink-3">
                        <span className="font-mono">{other.connectNumber}</span>
                        {" · "}
                        {formatRelativeTime(connection.createdAt)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {tab === "incoming" && (
                        <>
                          <Button
                            size="sm"
                            loading={busy}
                            onClick={() => void respond(connection.id, "ACCEPTED")}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void respond(connection.id, "DECLINED")}
                            disabled={busy}
                          >
                            Decline
                          </Button>
                        </>
                      )}

                      {tab === "outgoing" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void remove(connection.id)}
                        >
                          <IconX size={14} />
                          Cancel
                        </Button>
                      )}

                      {tab === "connected" && (
                        <>
                          <Button
                            size="sm"
                            loading={busy}
                            onClick={() => void openChat(other.id)}
                          >
                            Message
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:bg-danger-soft"
                            disabled={busy}
                            onClick={() => void remove(connection.id)}
                          >
                            Remove
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {tab === "incoming" && rows && rows.length > 0 && (
            <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-ink-3">
              <IconUserPlus size={14} />
              Accepting opens a direct conversation for both of you.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
