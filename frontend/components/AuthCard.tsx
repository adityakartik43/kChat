import Link from "next/link";
import type { ReactNode } from "react";
import { IconLogo, IconShield, IconSparkles } from "./icons";

const PROMISES = [
  "Find anyone by their private number — no phone, no contacts sync.",
  "Direct and group messages that land instantly, with typing and read receipts.",
  "One-to-one audio and video over WebRTC, with a call log that persists.",
];

/**
 * Shared frame for sign-in and sign-up: a brand panel on the left, the form on
 * the right. The brand panel is decorative, so it drops out below `lg` and the
 * form becomes a single centred column.
 */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-screen grid-cols-1 bg-canvas lg:grid-cols-[1.05fr_1fr]">
      {/* ---------------------------------------------------------- brand */}
      <section className="relative hidden overflow-hidden border-line bg-canvas lg:flex lg:flex-col lg:justify-between lg:border-r lg:p-12">
        <div
          aria-hidden
          className="absolute -top-40 -left-32 h-[32rem] w-[32rem] rounded-full opacity-20 blur-3xl"
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--color-brand), transparent 65%)",
          }}
        />
        <div
          aria-hidden
          className="absolute -right-40 -bottom-48 h-[34rem] w-[34rem] rounded-full opacity-15 blur-3xl"
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--color-brand-2), transparent 65%)",
          }}
        />

        <Link href="/" className="relative flex items-center gap-3">
          <IconLogo size={38} />
          <span className="text-xl font-semibold tracking-tight">Connect</span>
        </Link>

        <div className="relative max-w-md">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2">
            <IconSparkles size={14} className="text-brand" />
            Private by number, not by phone
          </span>

          <h2 className="mt-6 text-4xl leading-[1.08] font-semibold tracking-tight text-balance">
            Everyone you talk to, reached by a number you choose.
          </h2>

          <ul className="mt-8 space-y-3.5">
            {PROMISES.map((item) => (
              <li key={item} className="flex gap-3 text-sm text-ink-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <svg
                    viewBox="0 0 24 24"
                    width="13"
                    height="13"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-ink-3">
          <IconShield size={14} />
          Nothing is texted or dialed — your number lives only inside the app.
        </p>
      </section>

      {/* ------------------------------------------------------------ form */}
      <section className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Link
            href="/"
            className="mb-8 flex items-center gap-2.5 lg:hidden"
          >
            <IconLogo size={34} />
            <span className="text-lg font-semibold tracking-tight">Connect</span>
          </Link>

          <div className="animate-fade-up">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1.5 mb-7 text-sm text-ink-2">{subtitle}</p>
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="animate-pop-in rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger"
    >
      {message}
    </div>
  );
}
