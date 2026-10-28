import type { Rng } from './rng';

export const SEED_PATTERNS = ['random', 'clusters', 'symmetric', 'mixed'] as const;
export type SeedPattern = (typeof SEED_PATTERNS)[number];

/** Produce a fresh w×h board (0/1 per cell). `density` is roughly the fraction of live cells. */
export function generateSeed(w: number, h: number, pattern: SeedPattern, density: number, rnd: Rng): Uint8Array {
	if (pattern === 'mixed') {
		const pick = SEED_PATTERNS[Math.floor(rnd() * 3)];
		return generateSeed(w, h, pick, density, rnd);
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
