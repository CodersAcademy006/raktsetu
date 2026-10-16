import type { BloodGroup } from "../matching/compatibility.ts";

// Deterministic cross-checks on what Gemma extracted: each field must be
// literally present in the staff's own text. A model that "helpfully" fills
// a gap is caught here and the request goes back to staff instead.

const GROUP_RE = /(?<![a-z])(ab|a|b|o)\s*(\+\s*ve|-\s*ve|\+|-|−|positive|negative|pos(?![a-z])|neg(?![a-z]))/gi;

export function mentionedBloodGroups(text: string): Set<BloodGroup> {
  const found = new Set<BloodGroup>();
  for (const m of text.matchAll(GROUP_RE)) {
    const sign = /^(\+|pos)/i.test(m[2]) ? "+" : "-";
    found.add(`${m[1].toUpperCase()}${sign}` as BloodGroup);
  }
  return found;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export function mentionedNumbers(text: string): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(/\d+/g)) found.add(Number(m[0]));
  const lower = text.toLowerCase();
  NUMBER_WORDS.forEach((w, n) => {
    if (new RegExp(`(?<![a-z])${w}(?![a-z])`).test(lower)) found.add(n);
  });
  return found;
}

export function mentionsLocality(text: string, locality: string): boolean {
  return locality.length > 0 && text.toLowerCase().includes(locality.toLowerCase());
}
