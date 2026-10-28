import type { Life } from './life';
import type { Rng } from './rng';

export const WIPE_STYLES = ['swipe', 'diagonal', 'radial', 'instant'] as const;
export type WipeStyle = (typeof WIPE_STYLES)[number];

/**
 * Geometry shared by the CPU (which cells to replace) and the shader (where to
 * draw the glowing edge). Position p is measured in cells.
 *   mode 0 (linear): t = (dot(p, v) - off) * scale
 *   mode 1 (radial): t = length(p - v) * scale
 * t runs 0 → 1 across the board.
 */
export interface WipeGeom {
	mode: 0 | 1;
	vx: number;
	vy: number;
	off: number;
	scale: number;
}

export function wipeT(g: WipeGeom, px: number, py: number): number {
	if (g.mode === 0) return (px * g.vx + py * g.vy - g.off) * g.scale;
	return Math.hypot(px - g.vx, py - g.vy) * g.scale;
}

export function makeGeom(style: Exclude<WipeStyle, 'instant'>, w: number, h: number, rnd: Rng): WipeGeom {
	if (style === 'radial') {
		// Burst from somewhere near the middle third of the screen.
		const cx = w * (0.3 + rnd() * 0.4);
		const cy = h * (0.3 + rnd() * 0.4);
		const far = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
		return { mode: 1, vx: cx, vy: cy, off: 0, scale: 1 / far };
	}
	const angles = style === 'swipe' ? [0, 90, 180, 270] : [45, 135, 225, 315];
	const a = (angles[Math.floor(rnd() * angles.length)] * Math.PI) / 180;
	// Direction in cell space, weighted so diagonals follow the screen corners.
	let vx = Math.cos(a);
	let vy = Math.sin(a);
	if (style === 'diagonal') {
		vx = Math.sign(vx) / w;
		vy = Math.sign(vy) / h;
	}
	const corners = [0, w * vx, h * vy, w * vx + h * vy];
	const lo = Math.min(...corners);
	const hi = Math.max(...corners);
	return { mode: 0, vx, vy, off: lo, scale: 1 / (hi - lo) };
}

/** How many cells one unit of t spans along the wipe direction (for drawing the edge at a fixed width). */
export function cellsPerT(g: WipeGeom): number {
	return g.mode === 0 ? 1 / (g.scale * Math.hypot(g.vx, g.vy)) : 1 / g.scale;
}

const BUCKETS = 1024;

/** An in-progress reseed transition: cells are replaced with the new seed as the edge passes them. */
export class Wipe {
	readonly geom: WipeGeom;
	private order: Uint32Array;
	private bucketStart: Uint32Array;
	private applied = 0;
	progress = 0;
	readonly hueFrom: number;
	readonly hueTo: number;

	constructor(
		readonly seed: Uint8Array,
		w: number,
		h: number,
		geom: WipeGeom,
		hueFrom: number,
		hueTo: number,
	) {
		this.geom = geom;
		this.hueFrom = hueFrom;
		this.hueTo = hueTo;
		const n = w * h;
		const bucketOf = new Uint16Array(n);
		const counts = new Uint32Array(BUCKETS + 1);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const t = wipeT(geom, x + 0.5, y + 0.5);
				const b = Math.max(0, Math.min(BUCKETS - 1, Math.floor(t * BUCKETS)));
				bucketOf[y * w + x] = b;
				counts[b + 1]++;
			}
		}
		for (let b = 0; b < BUCKETS; b++) counts[b + 1] += counts[b];
		this.bucketStart = counts.slice();
		const fill = counts.slice(0, BUCKETS);
		this.order = new Uint32Array(n);
		for (let i = 0; i < n; i++) this.order[fill[bucketOf[i]]++] = i;
	}

	/** Move the edge to `progress` (0..1), stamping the new seed onto every cell it has passed. */
	advance(life: Life, progress: number): boolean {
		this.progress = Math.min(1, Math.max(this.progress, progress));
		const target = this.progress >= 1 ? BUCKETS : Math.floor(this.progress * BUCKETS);
		const end = this.bucketStart[target];
		for (let k = this.bucketStart[this.applied]; k < end; k++) {
			const i = this.order[k];
			life.setIndex(i, this.seed[i]);
		}
		this.applied = Math.max(this.applied, target);
		return this.progress >= 1;
	}
}
