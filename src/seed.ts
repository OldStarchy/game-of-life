import { transform, type Pattern } from './patterns';
import type { Rng } from './rng';

export const SEED_PATTERNS = ['random', 'clusters', 'symmetric', 'custom'] as const;
export type SeedPattern = (typeof SEED_PATTERNS)[number];

export const CUSTOM_LAYOUTS = ['centre', 'scatter', 'grid'] as const;
export type CustomLayout = (typeof CUSTOM_LAYOUTS)[number];

export interface SeedOptions {
	pattern: SeedPattern;
	/** Roughly the fraction of live cells for soups. */
	density: number;
	/** Patterns for the 'custom' seed; each copy picks one at random. */
	custom?: Pattern[];
	layout?: CustomLayout;
	copies?: number;
	/** Randomly rotate and mirror each copy. */
	randomTransform?: boolean;
	/** Density of random soup underneath the custom patterns (0 = none). */
	soup?: number;
}

/** Produce a fresh w×h board (0/1 per cell). */
export function generateSeed(w: number, h: number, opts: SeedOptions, rnd: Rng): Uint8Array {
	const { pattern, density } = opts;
	if (pattern === 'custom') {
		if (opts.custom?.length) return customSeed(w, h, opts, rnd);
		return generateSeed(w, h, { ...opts, pattern: 'random' }, rnd);
	}
	const out = new Uint8Array(w * h);
	switch (pattern) {
		case 'random':
			for (let i = 0; i < out.length; i++) out[i] = rnd() < density ? 1 : 0;
			break;

		case 'clusters': {
			// Soft-edged blobs of soup; the gaps between them give gliders room to travel.
			const minDim = Math.min(w, h);
			const count = 4 + Math.floor(rnd() * 8);
			const blobs = Array.from({ length: count }, () => ({
				x: rnd() * w,
				y: rnd() * h,
				r: minDim * (0.08 + rnd() * 0.18),
			}));
			const p = Math.min(0.85, density * 1.8);
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					let best = 0;
					for (const b of blobs) {
						// Toroidal distance so blobs straddle edges seamlessly.
						let dx = Math.abs(x - b.x);
						let dy = Math.abs(y - b.y);
						if (dx > w / 2) dx = w - dx;
						if (dy > h / 2) dy = h - dy;
						const f = 1 - Math.hypot(dx, dy) / b.r;
						if (f > best) best = f;
					}
					if (best > 0) out[y * w + x] = rnd() < p * Math.min(1, best * 2.5) ? 1 : 0;
				}
			}
			break;
		}

		case 'symmetric': {
			// Kaleidoscope: a random quadrant mirrored on both axes around the centre.
			const hw = Math.ceil(w / 2);
			const hh = Math.ceil(h / 2);
			const extentX = hw * (0.35 + rnd() * 0.55);
			const extentY = hh * (0.35 + rnd() * 0.55);
			const p = Math.min(0.85, density * 1.4);
			for (let y = 0; y < hh; y++) {
				for (let x = 0; x < hw; x++) {
					// Distance from centre in quadrant space (x,y measured from centre).
					const dx = (hw - 1 - x) / extentX;
					const dy = (hh - 1 - y) / extentY;
					if (dx > 1 || dy > 1) continue;
					if (rnd() >= p) continue;
					out[y * w + x] = 1;
					out[y * w + (w - 1 - x)] = 1;
					out[(h - 1 - y) * w + x] = 1;
					out[(h - 1 - y) * w + (w - 1 - x)] = 1;
				}
			}
			break;
		}
	}
	return out;
}

/** Stamp copies of the custom patterns onto the board, optionally over a thin soup. */
function customSeed(w: number, h: number, opts: SeedOptions, rnd: Rng): Uint8Array {
	const out = new Uint8Array(w * h);
	const soup = opts.soup ?? 0;
	if (soup > 0) for (let i = 0; i < out.length; i++) out[i] = rnd() < soup ? 1 : 0;

	const layout = opts.layout ?? 'centre';
	const count = layout === 'centre' ? 1 : Math.max(1, Math.round(opts.copies ?? 1));

	// Centres for each copy, in cells.
	const centres: [number, number][] = [];
	if (layout === 'centre') centres.push([w / 2, h / 2]);
	else if (layout === 'scatter') for (let i = 0; i < count; i++) centres.push([rnd() * w, rnd() * h]);
	else {
		// As close to square cells as the screen's aspect allows.
		const cols = Math.max(1, Math.round(Math.sqrt((count * w) / h)));
		const rows = Math.ceil(count / cols);
		for (let i = 0; i < count; i++) {
			const r = Math.floor(i / cols);
			// Centre a partial last row.
			const inRow = r === rows - 1 ? count - r * cols : cols;
			const c = i % cols;
			centres.push([((c + 0.5) * w) / inRow, ((r + 0.5) * h) / rows]);
		}
	}

	for (const [cx, cy] of centres) {
		let p = opts.custom![Math.floor(rnd() * opts.custom!.length)];
		if (opts.randomTransform) p = transform(p, Math.floor(rnd() * 4), rnd() < 0.5);
		const ox = Math.round(cx - p.w / 2);
		const oy = Math.round(cy - p.h / 2);
		const margin = soup > 0 ? 2 : 0;
		for (let y = -margin; y < p.h + margin; y++) {
			for (let x = -margin; x < p.w + margin; x++) {
				const inside = x >= 0 && y >= 0 && x < p.w && y < p.h;
				const v = inside ? p.cells[y * p.w + x] : 0;
				const bx = (((ox + x) % w) + w) % w;
				const by = (((oy + y) % h) + h) % h;
				// Clear the pattern's footprint (plus a margin over soup) so it starts clean.
				if (inside || margin) out[by * w + bx] = v;
			}
		}
	}
	return out;
}
