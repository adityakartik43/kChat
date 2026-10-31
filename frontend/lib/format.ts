/** Formats a private number for display: 4821993017 -> "4821-9930-17". */
export function formatConnectNumber(value: string): string {
  const digits = value.replace(/\D/g, "");

  if (digits.length !== 10) return digits;

  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
}

/** Groups digits as the user types, e.g. "482199" -> "4821-99". */
export function groupDigits(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);

  if (digits.length <= 4) return digits;

  if (digits.length <= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** "now", "5m", "3h", "Yesterday", "12 Mar" */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";

  const date = new Date(iso);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 45) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;

  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`;

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDayDivider(iso: string): string {
  const date = new Date(iso);
  const today = new Date();

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(date, today)) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function lastSeenLabel(iso: string | null | undefined): string {
  if (!iso) return "Offline";

  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 120) return "Online";
  if (seconds < 3600) return `Last seen ${Math.floor(seconds / 60)}m ago`;

  return `Last seen ${new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
