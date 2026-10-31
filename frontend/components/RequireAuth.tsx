"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";
import { BrandLoader } from "@/components/BrandLoader";

/** Sends unauthenticated visitors to /login and waits out the auth restore. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return <BrandLoader message="Loading your chats" full />;
  }

  return <>{children}</>;
}
