import { randomInt } from 'crypto';

const CONNECT_NUMBER_LENGTH = 10;

/**
 * Generates a candidate private number.
 *
 * The first digit is always 1-9 so the number never starts with 0, which
 * keeps the value usable as a plain 10 digit string. Uniqueness is enforced
 * by a unique index on `users.connectNumber`; callers retry on conflict.
 */
export function generateConnectNumber(): string {
  let number = String(randomInt(1, 10));

  for (let i = 1; i < CONNECT_NUMBER_LENGTH; i += 1) {
    number += String(randomInt(0, 10));
  }

  return number;
}

/**
 * Formats a private number for display: 4821993017 -> "4821-9930-17".
 * Short numbers are grouped as best as possible.
 */
export function formatConnectNumber(value: string): string {
  const digits = value.replace(/\D/g, '');

  if (digits.length !== CONNECT_NUMBER_LENGTH) {
    return digits;
  }

  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
}

/**
 * Normalises user input into the canonical stored form so a number can be
 * found regardless of the separators the user typed: "4821 9930 17",
 * "+4821993017" and "4821-9930-17" all resolve to "4821993017".
 */
export function normalizeConnectNumber(input: string): string | null {
  const digits = input.replace(/\D/g, '');

  if (digits.length !== CONNECT_NUMBER_LENGTH) {
    return null;
  }

  return digits;
}
