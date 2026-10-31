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
import { useRouter } from "next/navigation";
import { api, getAccessToken, getRefreshToken, setTokens } from "@/lib/api";
import type { AuthPayload, Profile } from "@/lib/types";

interface AuthContextValue {
  user: Profile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (changes: { name?: string; avatarUrl?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!getAccessToken()) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const profile = await api.get<Profile>("/auth/me");
        if (!cancelled) setUser(profile);
      } catch {
        setTokens(null, null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void restore();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<AuthPayload>("/auth/login", { email, password });
    setTokens(data.tokens.accessToken, data.tokens.refreshToken);
    setUser(data.user);
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const data = await api.post<AuthPayload>("/auth/register", {
        name,
        email,
        password,
      });
      setTokens(data.tokens.accessToken, data.tokens.refreshToken);
      setUser(data.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        await api.post("/auth/logout", { refreshToken });
      }
    } catch {
      // Signing out locally must succeed even if the server call fails.
    }

    setTokens(null, null);
    setUser(null);
    router.push("/login");
  }, [router]);

  const updateProfile = useCallback(
    async (changes: { name?: string; avatarUrl?: string }) => {
      const profile = await api.patch<Profile>("/users/me", changes);
      setUser(profile);
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout, updateProfile }),
    [user, loading, login, register, logout, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
