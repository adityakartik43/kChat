import type { CSSProperties } from "react";
import { initials } from "@/lib/format";

const SIZES = {
  xs: "h-7 w-7 text-[10px]",
  sm: "h-9 w-9 text-[11px]",
  md: "h-11 w-11 text-[13px]",
  lg: "h-14 w-14 text-base",
  xl: "h-24 w-24 text-3xl",
} as const;

/** Two-stop gradients, chosen from the name, so a person keeps one identity. */
const TONES: Array<[string, string]> = [
  ["#6366f1", "#8b5cf6"],
  ["#10b981", "#14b8a6"],
  ["#f59e0b", "#f97316"],
  ["#f43f5e", "#ec4899"],
  ["#0ea5e9", "#06b6d4"],
  ["#d946ef", "#a855f7"],
];

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  online?: boolean;
  className?: string;
}

function toneStyle(name: string): CSSProperties {
  let hash = 0;

  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }

  const [from, to] = TONES[hash % TONES.length];
  return { backgroundImage: `linear-gradient(135deg, ${from}, ${to})` };
}

export function Avatar({
  name,
  src,
  size = "md",
  online,
  className = "",
}: AvatarProps) {
  const dotSize =
    size === "xl" ? "h-4 w-4" : size === "xs" ? "h-2 w-2" : "h-3 w-3";

  return (
    <div className={`relative shrink-0 ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className={`${SIZES[size]} rounded-full object-cover ring-1 ring-line`}
        />
      ) : (
        <div
          style={toneStyle(name)}
          className={`${SIZES[size]} flex items-center justify-center rounded-full font-semibold tracking-tight text-white shadow-xs`}
        >
          {initials(name) || "?"}
        </div>
      )}

      {online !== undefined && (
        <span
          aria-label={online ? "Online" : "Offline"}
          className={`absolute right-0 bottom-0 block rounded-full ring-2 ring-surface ${dotSize} ${
            online ? "bg-success" : "bg-ink-3/70"
          }`}
        />
      )}
    </div>
  );
}
