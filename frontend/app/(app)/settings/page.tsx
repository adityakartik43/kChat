"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthProvider";
import { useSocket } from "@/context/SocketProvider";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { PrivateNumberCard } from "@/components/PrivateNumberCard";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { formatConnectNumber } from "@/lib/format";
import { IconCheck, IconLogout, IconSettings, IconShield } from "@/components/icons";

export default function SettingsPage() {
  const { user, updateProfile, logout } = useAuth();
  const { connected } = useSocket();

  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    setSaving(true);

    try {
      await updateProfile({ name: name.trim() });
      setNotice("Profile updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-line bg-surface px-5 py-4 sm:px-8">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-2">
          Your profile, your number, and how the app looks.
        </p>
      </header>

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-8 sm:py-8">
        {/* ------------------------------------------------------ identity */}
        <section className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <Avatar name={user?.name ?? "?"} src={user?.avatarUrl} size="lg" />

          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold tracking-tight">
              {user?.name}
            </p>
            <p className="truncate text-sm text-ink-2">{user?.email}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connected ? "bg-success" : "bg-ink-3"
                }`}
              />
              {connected ? "Connected in realtime" : "Reconnecting…"}
            </p>
          </div>
        </section>

        <PrivateNumberCard number={user?.connectNumber ?? ""} />

        {/* ------------------------------------------------------- profile */}
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <IconSettings size={16} className="text-brand" />
            Profile
          </h2>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <Input
              label="Display name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={50}
              hint="Shown to everyone you chat with."
            />

            {notice && (
              <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                <IconCheck size={15} />
                {notice}
              </p>
            )}
            {error && <p className="text-sm font-medium text-danger">{error}</p>}

            <div className="flex justify-end">
              <Button type="submit" loading={saving}>
                Save changes
              </Button>
            </div>
          </form>
        </section>

        {/* --------------------------------------------------- appearance */}
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <div>
            <h2 className="text-sm font-semibold">Appearance</h2>
            <p className="mt-0.5 text-xs text-ink-3">
              Follow the system, or pin the theme yourself.
            </p>
          </div>
          <ThemeSegmented />
        </section>

        {/* ------------------------------------------------------ account */}
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <IconShield size={16} className="text-brand" />
            Account
          </h2>

          <dl className="mt-3 divide-y divide-line text-sm">
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-ink-2">Private number</dt>
              <dd className="font-mono tabular-nums">
                {formatConnectNumber(user?.connectNumber ?? "") || "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-ink-2">Email</dt>
              <dd className="truncate">{user?.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-ink-2">Joined</dt>
              <dd>
                {user?.createdAt
                  ? new Date(user.createdAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </dd>
            </div>
          </dl>
        </section>

        <div className="flex justify-end pb-4">
          <Button variant="outline" onClick={() => void logout()}>
            <IconLogout size={16} className="text-danger" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
