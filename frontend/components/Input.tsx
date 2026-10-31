"use client";

import type { InputHTMLAttributes, ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string;
  /** Leading adornment — an icon or a symbol such as the number prefix. */
  leading?: ReactNode;
}

export function Input({
  label,
  error,
  hint,
  leading,
  id,
  className = "",
  ...props
}: InputProps) {
  const inputId = id ?? props.name ?? label;

  return (
    <label htmlFor={inputId} className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">
        {label}
      </span>

      <div
        className={`flex items-center gap-2 rounded-xl border bg-surface transition-shadow duration-150 focus-within:ring-4 ${
          error
            ? "border-danger focus-within:ring-danger/15"
            : "border-line-strong focus-within:border-brand focus-within:ring-brand/12"
        }`}
      >
        {leading && (
          <span className="pl-3 text-ink-3" aria-hidden>
            {leading}
          </span>
        )}

        <input
          id={inputId}
          {...props}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`h-11 w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 ${
            leading ? "pr-3" : "px-3.5"
          } ${className}`}
        />
      </div>

      {error ? (
        <span
          id={`${inputId}-error`}
          className="mt-1.5 block text-xs font-medium text-danger"
        >
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}
