// Seeded random helpers for deterministic loot/offline simulation.
// Pure TypeScript: no Cocos dependency, safe for tools/tests.

export type Rng = () => number;

export function hashSeed(seed: string | number): number {
    const text = String(seed);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function createSeededRng(seed: string | number): Rng {
    let s = hashSeed(seed) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

export function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export function rollChance(chance: number, rng: Rng): boolean {
    return rng() < clamp01(chance);
}

export function pickWeighted<T extends string>(
    keys: readonly T[],
    weights: Partial<Record<T, number>>,
    rng: Rng,
): T {
    let total = 0;
    for (const k of keys) total += Math.max(0, weights[k] ?? 0);
    if (total <= 0) return keys[0];

    let roll = rng() * total;
    for (const k of keys) {
        const weight = Math.max(0, weights[k] ?? 0);
        if (weight <= 0) continue;
        if (roll < weight) return k;
        roll -= weight;
    }
    return keys[keys.length - 1];
}
