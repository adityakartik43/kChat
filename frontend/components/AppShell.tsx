"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthProvider";
import { CallProvider } from "@/context/CallProvider";
import { useSocket } from "@/context/SocketProvider";
import { api } from "@/lib/api";
import type { Conversation } from "@/lib/types";
import { totalUnread } from "@/lib/conversation";
import { Avatar } from "./Avatar";
import { CallMediaNotice } from "./CallMediaNotice";
import { CallOverlay } from "./CallOverlay";
import { RequireAuth } from "./RequireAuth";
import { ThemeToggle } from "./ThemeToggle";
import {
  IconChat,
  IconInbox,
  IconLink,
  IconLogo,
  IconLogout,
  IconSettings,
} from "./icons";

const NAV = [
  { href: "/chats", label: "Chats", icon: IconChat },
  { href: "/connect", label: "Connect", icon: IconLink },
  { href: "/requests", label: "Requests", icon: IconInbox },
  { href: "/settings", label: "Settings", icon: IconSettings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      {/* Calls live above the shell so a call survives navigating between
          chats, and an incoming call is visible from any page. */}
      <CallProvider>
        <Shell>{children}</Shell>
        <CallOverlay />
        <CallMediaNotice />
      </CallProvider>
    </RequireAuth>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(0);

  // Keep the nav badges fresh. Cheap enough to poll while the tab is open.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [conversations, requests] = await Promise.all([
          api.get<Conversation[]>("/conversations"),
          api
            .get<unknown[]>("/connections?status=PENDING&scope=incoming")
            .catch(() => []),
        ]);

        if (cancelled) return;

        setUnread(totalUnread(conversations));
        setPending(requests.length);
      } catch {
        // Ignore transient failures; the next tick retries.
      }
    }

    void load();
    const timer = setInterval(load, 20_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  const badges: Record<string, number> = {
    "/chats": unread,
    "/requests": pending,
  };

  // A conversation takes the whole screen on mobile, so the tab bar steps
  // out of the way and the chat header's back button becomes the way home.
  const inConversation = /^\/chats\/[^/]+/.test(pathname);

  async function onSignOut() {
    await logout();
    router.push("/login");
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas text-ink">
      {/* ------------------------------------------------------- desktop rail */}
      <aside className="hidden w-[76px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-4 md:flex">
        <Link
          href="/chats"
          className="mb-3 flex h-11 w-11 items-center justify-center"
          aria-label="Connect home"
        >
          <IconLogo size={34} />
        </Link>

        <nav className="flex flex-1 flex-col items-center gap-1.5">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const badge = badges[item.href] ?? 0;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={`group relative flex w-[62px] flex-col items-center gap-1 rounded-xl py-2.5 transition-colors duration-150 ${
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-ink-2 hover:bg-muted hover:text-ink"
                }`}
              >
                <Icon size={21} />
                <span className="text-[10px] leading-none font-medium">
                  {item.label}
                </span>

                {badge > 0 && (
                  <span className="absolute top-1.5 right-2 min-w-4 rounded-full bg-[image:var(--gradient-brand)] px-1 text-center text-[10px] leading-4 font-semibold text-on-brand shadow-xs">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col items-center gap-1.5">
          <ThemeToggle />

          <Link
            href="/settings"
            title={user?.name ?? "Profile"}
            className="relative rounded-full"
          >
            <Avatar name={user?.name ?? "?"} src={user?.avatarUrl} size="sm" />
            <span
              className={`absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${
                connected ? "bg-success" : "bg-ink-3"
              }`}
            />
          </Link>

          <button
            type="button"
            onClick={() => void onSignOut()}
            title="Sign out"
            aria-label="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"
          >
            <IconLogout size={18} />
          </button>
        </div>
      </aside>

      {/* ---------------------------------------------------------- content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact top bar for small screens. */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 md:hidden">
          <IconLogo size={28} />
          <span className="font-semibold tracking-tight">Connect</span>

          <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-3">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-success" : "bg-ink-3"
              }`}
            />
            {connected ? "Live" : "Reconnecting"}
          </span>

          <Link href="/settings" aria-label="Settings">
            <Avatar name={user?.name ?? "?"} src={user?.avatarUrl} size="xs" />
          </Link>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>

        {/* Bottom tab bar, mobile only and hidden inside a conversation. */}
        {!inConversation && (
          <nav className="flex shrink-0 items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              const badge = badges[item.href] ?? 0;
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors ${
                    active ? "text-brand" : "text-ink-3"
                  }`}
                >
                  <Icon size={21} />
                  <span className="text-[10px] font-medium">{item.label}</span>

                  {badge > 0 && (
                    <span className="absolute top-1.5 right-[22%] min-w-4 rounded-full bg-[image:var(--gradient-brand)] px-1 text-center text-[10px] leading-4 font-semibold text-on-brand">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
