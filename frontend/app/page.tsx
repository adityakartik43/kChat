"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";
import { BrandLoader } from "@/components/BrandLoader";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/chats" : "/login");
  }, [loading, user, router]);

  return <BrandLoader message="Starting Connect" full />;
}
