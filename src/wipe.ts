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
