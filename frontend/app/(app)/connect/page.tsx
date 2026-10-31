"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthProvider";
import { groupDigits, lastSeenLabel } from "@/lib/format";
import type { Connection, LookupResult } from "@/lib/types";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { PrivateNumberCard } from "@/components/PrivateNumberCard";
import { IconAlert, IconHash, IconSearch, IconUserPlus, IconUsers } from "@/components/icons";

export default function ConnectPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [number, setNumber] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setActionNote(null);
    setLookup(null);

    const digits = number.replace(/\D/g, "");

    if (digits.length !== 10) {
      setError("Enter a 10 digit private number");
      return;
    }

    setSearching(true);

    try {
      const result = await api.get<LookupResult>(
        `/connections/lookup?number=${encodeURIComponent(digits)}`,
      );
      setLookup(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not look up that number",
      );
    } finally {
      setSearching(false);
    }
  }

  async function sendRequest() {
    if (!lookup) return;

    setActionError(null);
    setActionNote(null);
    setSubmitting(true);

    try {
      await api.post<Connection>("/connections", {
        connectNumber: lookup.user.connectNumber,
      });
      setActionNote("Request sent — they will find it in Requests.");
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.status === 409
          ? "You already have a request with this person"
          : err instanceof Error
            ? err.message
            : "Could not send the request",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function startChat() {
    if (!lookup) return;

    setActionError(null);
    setSubmitting(true);

    try {
      const conversation = await api.post<{ id: string }>("/conversations/direct", {
        userId: lookup.user.id,
      });
      router.push(`/chats/${conversation.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not open chat");
      setSubmitting(false);
    }
  }

  const state = lookup?.connectionState.status;
  const isSelf = lookup?.isSelf;

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-line bg-surface px-5 py-4 sm:px-8">
        <h1 className="text-lg font-semibold tracking-tight">Connect</h1>
        <p className="mt-0.5 text-sm text-ink-2">
          Enter someone&apos;s private number to find them — no contacts, no
          phone book.
        </p>
      </header>

      <div className="mx-auto max-w-xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        <PrivateNumberCard number={user?.connectNumber ?? ""} />

        {/* ------------------------------------------------------- lookup */}
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <IconSearch size={16} className="text-brand" />
            Find someone
          </h2>

          <form onSubmit={onSearch} className="mt-4 space-y-3">
            <label htmlFor="number" className="block text-[13px] font-medium text-ink-2">
              Private number
            </label>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div
                className={`flex h-12 flex-1 items-center gap-2 rounded-xl border bg-canvas px-3.5 transition-shadow focus-within:ring-4 ${
                  error
                    ? "border-danger focus-within:ring-danger/15"
                    : "border-line-strong focus-within:border-brand focus-within:ring-brand/12"
                }`}
              >
                <IconHash size={17} className="shrink-0 text-ink-3" />
                <input
                  id="number"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0000-0000-00"
                  value={number}
                  onChange={(e) => setNumber(groupDigits(e.target.value))}
                  className="h-full w-full min-w-0 bg-transparent font-mono text-base tracking-[0.12em] outline-none placeholder:text-ink-3"
                />
              </div>

              <Button type="submit" size="lg" loading={searching}>
                Find
              </Button>
            </div>

            {error && (
              <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
                <IconAlert size={15} />
                {error}
              </p>
            )}
          </form>
        </section>

        {/* ------------------------------------------------------- result */}
        {lookup && (
          <section className="animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
            <div className="flex items-center gap-4 p-5">
              <Avatar
                name={lookup.user.name}
                src={lookup.user.avatarUrl}
                size="lg"
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold tracking-tight">
                  {lookup.user.name}
                </p>
                <p className="font-mono text-sm text-ink-2">
                  {lookup.user.connectNumberFormatted ??
                    lookup.user.connectNumber}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {lastSeenLabel(lookup.user.lastSeenAt)}
                </p>
              </div>
            </div>

            <div className="border-t border-line bg-canvas px-5 py-4">
              {isSelf ? (
                <p className="text-center text-sm text-ink-2">
                  That&apos;s your own number.
                </p>
              ) : state === "ACCEPTED" ? (
                <Button size="lg" className="w-full" loading={submitting} onClick={startChat}>
                  Open chat
                </Button>
              ) : state === "PENDING" ? (
                <p className="flex items-center justify-center gap-2 text-center text-sm text-ink-2">
                  <IconUsers size={16} className="text-ink-3" />
                  {lookup.connectionState.outgoing
                    ? "Your request is waiting for a response."
                    : "They sent you a request — accept it in Requests."}
                </p>
              ) : state === "BLOCKED" ? (
                <p className="flex items-center justify-center gap-2 text-center text-sm text-ink-2">
                  <IconAlert size={16} className="text-ink-3" />
                  Unable to connect with this number.
                </p>
              ) : (
                <Button
                  size="lg"
                  className="w-full"
                  loading={submitting}
                  onClick={sendRequest}
                >
                  <IconUserPlus size={16} />
                  {state === "DECLINED" ? "Send request again" : "Send request"}
                </Button>
              )}

              {actionNote && (
                <p className="mt-3 text-center text-sm font-medium text-success">
                  {actionNote}
                </p>
              )}

              {actionError && (
                <p className="mt-3 text-center text-sm font-medium text-danger">
                  {actionError}
                </p>
              )}
            </div>
          </section>
        )}

        <p className="px-2 text-center text-xs leading-relaxed text-ink-3">
          Numbers are app-level identifiers — nothing is ever texted or dialed.
          Formatting is forgiving: spaces, dashes and a leading + all resolve to
          the same person.
        </p>
      </div>
    </div>
  );
}
