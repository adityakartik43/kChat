"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "connect.theme";

interface ThemeContextValue {
  /** What the user picked. */
  theme: ThemePreference;
  /** What is actually on screen right now. */
  resolved: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    /* Storage can be blocked; the default is fine. */
  }
  return "system";
}

/**
 * Keeps `<html data-theme>` in sync with the user's choice.
 *
 * The attribute — not a class — drives both the token overrides in
 * globals.css and the `dark:` variant, and an inline script in the root
 * layout writes it before first paint so there is no flash of the wrong
 * theme. This provider only has to keep it correct from then on.
 *
 * State starts at the neutral defaults because `localStorage` and
 * `matchMedia` do not exist during SSR; the effect below adopts the real
 * values the moment the client takes over, which is why the first client
 * render matches the server-rendered one.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [system, setSystem] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");

    const sync = () => {
      // Both sources of truth live outside React: a string in localStorage
      // and the OS colour-scheme signal, so these are subscriptions rather
      // than derived re-renders.
      setSystem(query.matches ? "dark" : "light");
      setThemeState(readStored());
    };

    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const resolved: ResolvedTheme = theme === "system" ? system : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Preference is still applied for this session. */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}
