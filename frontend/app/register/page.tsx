"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthProvider";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { AuthCard, AuthError } from "@/components/AuthCard";

export default function RegisterPage() {
  const { register, user, loading } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
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
      await register(name.trim(), email.trim(), password);
      router.replace("/chats");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create account");
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="We will assign you a private number to share."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <AuthError message={error} />

        <Input
          label="Name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

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
          autoComplete="new-password"
          placeholder="At least 8 characters"
          hint="Minimum 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />

        <Button
          type="submit"
          size="lg"
          loading={submitting}
          className="w-full"
        >
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--color-ink-soft)]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--color-brand)] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
