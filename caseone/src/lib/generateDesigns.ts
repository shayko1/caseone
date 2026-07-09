// Pure, deterministic "AI studio" design picker — no I/O. Given the same
// prompt + style filter + pool, always returns the same ordered slice, so the
// simulated generation feels stable across reloads/requests for the same input.
import type { Design } from "./wix";

// FNV-1a, 32-bit. Cheap, deterministic string -> uint32 hash used to seed the PRNG.
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32 — small, fast, deterministic PRNG. Returns a () => number in [0, 1).
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDesigns(
  prompt: string,
  styleSlug: string | null,
  pool: Design[],
  count = 4,
): Design[] {
  const filtered = styleSlug
    ? pool.filter((design) => design.styleSlug === styleSlug)
    : pool;

  const seed = hashSeed(`${prompt.trim().toLowerCase()}|${styleSlug ?? "any"}`);
  const random = mulberry32(seed);

  // Deterministic Fisher-Yates: same seed -> same shuffle order every time.
  const shuffled = filtered.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, count);
}
