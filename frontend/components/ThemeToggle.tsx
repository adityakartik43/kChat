"use client";

import { useTheme, type ThemePreference } from "@/context/ThemeProvider";
import { IconMonitor, IconMoon, IconSun } from "./icons";

const ORDER: ThemePreference[] = ["system", "light", "dark"];

const LABELS: Record<ThemePreference, string> = {
  system: "Match system",
  light: "Light",
  dark: "Dark",
};

const ICONS = {
  system: IconMonitor,
  light: IconSun,
  dark: IconMoon,
} as const;

/** Icon button that steps through system → light → dark. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = ICONS[theme];

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Theme: ${LABELS[theme]} — click for ${LABELS[next]}`}
      aria-label={`Theme: ${LABELS[theme]}. Switch to ${LABELS[next]}.`}
      className={`flex h-10 w-10 items-center justify-center rounded-xl text-ink-2 transition-colors hover:bg-muted hover:text-ink ${className}`}
    >
      <Icon size={19} />
    </button>
  );
}

/** Three-way segmented control, used on the settings page. */
export function ThemeSegmented() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="inline-flex gap-1 rounded-xl border border-line bg-muted p-1"
    >
      {ORDER.map((option) => {
        const Icon = ICONS[option];
        const active = theme === option;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(option)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
              active
                ? "bg-surface text-ink shadow-xs"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            <Icon size={15} />
            {LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
