"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthProvider";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { AuthCard, AuthError } from "@/components/AuthCard";

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/chats");
    }
  }, [loading, user, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email.trim(), password);
      router.replace("/chats");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to pick up your conversations."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <AuthError message={error} />

        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <Button
          type="submit"
          size="lg"
          loading={submitting}
          className="w-full"
        >
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--color-ink-soft)]">
        No account yet?{" "}
        <Link
          href="/register"
          className="font-medium text-[var(--color-brand)] hover:underline"
        >
          Create one
        </Link>
      </p>
    </AuthCard>
  );
}
