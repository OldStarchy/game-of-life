import type { Rng } from './rng';

/** A weight per option; 0 means the option is switched off. */
export type Weights<K extends string> = Record<K, number>;

/**
 * Pick an option with probability proportional to its weight, skipping options
 * that are off or not `eligible`. Returns null if nothing is eligible.
 */
export function pickWeighted<K extends string>(weights: Weights<K>, rnd: Rng, eligible: (k: K) => boolean = () => true): K | null {
	const entries = (Object.entries(weights) as [K, number][]).filter(([k, w]) => w > 0 && eligible(k));
	const total = entries.reduce((a, [, w]) => a + w, 0);
	if (total <= 0) return null;
	let r = rnd() * total;
	for (const [k, w] of entries) {
		r -= w;
		if (r < 0) return k;
	}
	return entries[entries.length - 1][0];
}

/** Compact URL form: `random:1,custom:3` (switched-off options omitted). */
export function encodeWeights<K extends string>(weights: Weights<K>): string {
	return (Object.entries(weights) as [K, number][])
		.filter(([, w]) => w > 0)
		.map(([k, w]) => `${k}:${w}`)
		.join(',');
}

/**
 * Parse the compact form against the known option names. Options not listed are off;
 * a bare name means weight 1. Returns null if nothing valid is switched on.
 */
export function decodeWeights<K extends string>(raw: string, options: readonly K[], max: number): Weights<K> | null {
	const out = Object.fromEntries(options.map((o) => [o, 0])) as Weights<K>;
	let any = false;
	for (const part of raw.split(',')) {
		const [name, w = '1'] = part.trim().split(':');
		if (!(options as readonly string[]).includes(name)) continue;
		const n = Math.round(Number(w));
		if (!Number.isFinite(n) || n <= 0) continue;
		out[name as K] = Math.min(max, n);
		any = true;
	}
	return any ? out : null;
}

export function weightsEqual<K extends string>(a: Weights<K>, b: Weights<K>): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<K>;
	for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
	return true;
}
