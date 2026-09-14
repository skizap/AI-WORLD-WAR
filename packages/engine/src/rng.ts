/**
 * Deterministic seeded pseudo-randomness.
 *
 * All engine randomness (turn-order shuffles, mock agent decisions) derives
 * from the simulation seed plus a context string, so a given seed and
 * configuration always reproduce the same run. This must never be replaced
 * with Math.random() inside the engine.
 */

/** FNV-1a 32-bit hash. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG. Deterministic, fast, adequate for simulation tie-breaks. */
export function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next01: () => number;

  constructor(seed: number) {
    this.next01 = mulberry32(seed);
  }

  static fromParts(...parts: (string | number)[]): Rng {
    return new Rng(hashString(parts.join('|')));
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.next01();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next01() * n) % Math.max(1, n);
  }

  /** Weighted pick from [weights] (positive numbers). */
  weighted(weights: number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return 0;
    let r = this.next01() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  pick<T>(items: T[]): T {
    return items[this.int(items.length)];
  }

  /** Deterministic in-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }
}
