/**
 * Camera over the board: an offset (in cells) of the screen's top-left corner
 * and a zoom factor on top of the configured cell size. Not saved anywhere.
 *
 * Every operation writes a target; `update` eases the visible view toward it.
 * Direct manipulation (wheel, drag, pinch) passes `animate = false` so the view
 * tracks the pointer exactly; keyboard steps and reset glide.
 */

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 16;

export interface ViewBounds {
	/** Board size in cells. */
	w: number;
	h: number;
	wrap: boolean;
	/** Viewport size in CSS px. */
	vw: number;
	vh: number;
	/** Configured cell size in CSS px (before zoom). */
	cell: number;
	/** Home view centres the board (fixed-size worlds) instead of pinning its top-left corner. */
	centre?: boolean;
}

export class View {
	x = 0;
	y = 0;
	zoom = 1;
	private tx = 0;
	private ty = 0;
	private tz = 1;

	constructor(private bounds: () => ViewBounds) {}

	/** Screen point (CSS px) → board position in cells, unwrapped. */
	toCell(sx: number, sy: number): [number, number] {
		const k = this.bounds().cell * this.zoom;
		return [sx / k + this.x, sy / k + this.y];
	}

	/** Multiply zoom by `factor`, keeping the board point under (sx, sy) fixed. */
	zoomAt(sx: number, sy: number, factor: number, animate = false): void {
		const cell = this.bounds().cell;
		const z0 = this.tz;
		const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z0 * factor));
		const wx = sx / (cell * z0) + this.tx;
		const wy = sy / (cell * z0) + this.ty;
		this.tx = wx - sx / (cell * z);
		this.ty = wy - sy / (cell * z);
		this.tz = z;
		this.settle(animate);
	}

	/** Move the content by (dx, dy) CSS px, like dragging it. */
	panBy(dx: number, dy: number, animate = false): void {
		const k = this.bounds().cell * this.tz;
		this.tx -= dx / k;
		this.ty -= dy / k;
		this.settle(animate);
	}

	/** The default view: top-left at the origin, or the board centred, at zoom 1. */
	home(): { x: number; y: number } {
		const b = this.bounds();
		if (!b.centre) return { x: 0, y: 0 };
		return { x: (b.w - b.vw / b.cell) / 2, y: (b.h - b.vh / b.cell) / 2 };
	}

	reset(): void {
		const h = this.home();
		this.tx = h.x;
		this.ty = h.y;
		this.tz = 1;
		this.constrain();
	}

	/** Jump (no glide) to the default view, e.g. after the world is resized. */
	snapHome(): void {
		this.reset();
		this.x = this.tx;
		this.y = this.ty;
		this.zoom = this.tz;
	}

	/** Snap to the target (unless animating) and keep it in bounds. */
	private settle(animate: boolean): void {
		this.constrain();
		if (!animate) {
			this.x = this.tx;
			this.y = this.ty;
			this.zoom = this.tz;
		}
	}

	update(dt: number): void {
		const k = 1 - Math.exp(-dt * 14);
		this.x += (this.tx - this.x) * k;
		this.y += (this.ty - this.y) * k;
		this.zoom += (this.tz - this.zoom) * k;
		if (Math.abs(this.tx - this.x) < 1e-3 && Math.abs(this.ty - this.y) < 1e-3 && Math.abs(this.tz - this.zoom) < 1e-4) {
			this.x = this.tx;
			this.y = this.ty;
			this.zoom = this.tz;
		}
		this.constrain();
	}

	/**
	 * Torus: shift current and target together by whole boards so numbers stay small
	 * (and an animation never sweeps across the seam). Walls: keep the screen centre
	 * on the board so it can't be lost off-screen.
	 */
	private constrain(): void {
		const b = this.bounds();
		if (b.wrap) {
			const sx = Math.floor(this.tx / b.w) * b.w;
			const sy = Math.floor(this.ty / b.h) * b.h;
			this.tx -= sx;
			this.x -= sx;
			this.ty -= sy;
			this.y -= sy;
			return;
		}
		const clampAxis = (v: number, size: number, viewPx: number, z: number) => {
			const half = viewPx / (2 * b.cell * z);
			return Math.min(size - half, Math.max(-half, v));
		};
		this.tx = clampAxis(this.tx, b.w, b.vw, this.tz);
		this.ty = clampAxis(this.ty, b.h, b.vh, this.tz);
		this.x = clampAxis(this.x, b.w, b.vw, this.zoom);
		this.y = clampAxis(this.y, b.h, b.vh, this.zoom);
	}

	get isDefault(): boolean {
		const h = this.home();
		const b = this.bounds();
		// On a torus, positions a whole world apart look identical.
		const dx = b.wrap ? Math.abs((((this.tx - h.x) % b.w) + b.w * 1.5) % b.w - b.w / 2) : Math.abs(this.tx - h.x);
		const dy = b.wrap ? Math.abs((((this.ty - h.y) % b.h) + b.h * 1.5) % b.h - b.h / 2) : Math.abs(this.ty - h.y);
		return Math.abs(this.tz - 1) < 1e-3 && dx < 1e-3 && dy < 1e-3;
	}

	get targetZoom(): number {
		return this.tz;
	}
}

/**
 * Move a mouse-locked (virtual) pointer by (dx, dy) CSS px. Positions are board
 * cells, unwrapped. The pointer always stays on screen, and:
 *  - walls: it also stays on the board (clamped at the wall);
 *  - torus: pushing past the edge of the screen wraps it to the opposite edge when
 *    that is the same place in the world (the whole world width is on screen, give
 *    or take a cell); otherwise it's clamped to the screen.
 * `sx`/`sy` report the wrap applied (±w / ±h) so a stroke can shift its previous
 * point by the same amount and stay continuous across the seam.
 */
export function moveLockedPointer(
	view: { x: number; y: number; zoom: number },
	b: ViewBounds,
	px: number,
	py: number,
	dx: number,
	dy: number,
): { x: number; y: number; sx: number; sy: number } {
	const k = b.cell * view.zoom;
	const axis = (p: number, d: number, origin: number, viewPx: number, size: number): [number, number] => {
		let lo = origin;
		let hi = origin + viewPx / k - 1e-3;
		let v = p + d / k;
		let shift = 0;
		// Only wrap when the screen shows the whole world width (to within a cell), so the
		// opposite screen edge really is the other side of the border.
		const wholeWorld = hi - lo + 1 >= size;
		if (b.wrap && wholeWorld) {
			if (v > hi) {
				v -= size;
				shift = -size;
			} else if (v < lo) {
				v += size;
				shift = size;
			}
		} else if (!b.wrap) {
			lo = Math.max(lo, 0);
			hi = Math.min(hi, size - 1e-3);
		}
		return [Math.min(hi, Math.max(lo, v)), shift];
	};
	const [x, sx] = axis(px, dx, view.x, b.vw, b.w);
	const [y, sy] = axis(py, dy, view.y, b.vh, b.h);
	return { x, y, sx, sy };
}
