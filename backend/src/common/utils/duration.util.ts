const MULTIPLIERS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses a duration string like "15m" / "30d" / "900s" into milliseconds.
 * Falls back to 30 days when the value cannot be parsed.
 */
export function parseDuration(duration: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(duration.trim());

  if (!match) {
    return 30 * MULTIPLIERS.d;
  }

  return Number.parseInt(match[1], 10) * MULTIPLIERS[match[2]];
}
