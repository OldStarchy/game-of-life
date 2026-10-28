import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, View, type ViewBounds } from '../src/view';

const bounds = (wrap: boolean): ViewBounds => ({ w: 100, h: 50, wrap, vw: 1000, vh: 500, cell: 10 });

describe('View', () => {
	it('zooming keeps the board point under the cursor fixed', () => {
		const v = new View(() => bounds(true));
		const before = v.toCell(300, 200);
		v.zoomAt(300, 200, 2.5);
		const after = v.toCell(300, 200);
		expect(after[0]).toBeCloseTo(before[0]);
		expect(after[1]).toBeCloseTo(before[1]);
		expect(v.zoom).toBe(2.5);
	});

	it('clamps zoom', () => {
		const v = new View(() => bounds(true));
		v.zoomAt(0, 0, 1000);
		expect(v.zoom).toBe(MAX_ZOOM);
		v.zoomAt(0, 0, 1e-6);
		expect(v.zoom).toBe(MIN_ZOOM);
	});

	it('panning moves content with the pointer', () => {
		const v = new View(() => bounds(true));
		v.zoomAt(0, 0, 2);
		const before = v.toCell(500, 250);
		v.panBy(40, 0); // drag right by 40 px = 2 cells at 20 px/cell
		const after = v.toCell(500, 250);
		// Board positions on a torus are equal modulo the width.
		expect((((before[0] - after[0]) % 100) + 100) % 100).toBeCloseTo(2);
	});

	it('wraps the offset on a torus so it never grows', () => {
		const v = new View(() => bounds(true));
		for (let i = 0; i < 100; i++) v.panBy(-370, 230);
		expect(v.x).toBeGreaterThanOrEqual(0);
		expect(v.x).toBeLessThan(100);
		expect(v.y).toBeGreaterThanOrEqual(0);
		expect(v.y).toBeLessThan(50);
	});

	it('keeps the screen centre on the board with walls', () => {
		const v = new View(() => bounds(false));
		v.panBy(100000, 100000);
		const [cx, cy] = v.toCell(500, 250);
		expect(cx).toBeCloseTo(0);
		expect(cy).toBeCloseTo(0);
		v.panBy(-1e6, -1e6);
		const [cx2, cy2] = v.toCell(500, 250);
		expect(cx2).toBeCloseTo(100);
		expect(cy2).toBeCloseTo(50);
	});

	it('animated steps glide to the target, and reset returns to default', () => {
		const v = new View(() => bounds(true));
		v.zoomAt(500, 250, 2, true);
		expect(v.zoom).toBe(1);
		expect(v.targetZoom).toBe(2);
		for (let i = 0; i < 120; i++) v.update(1 / 60);
		expect(v.zoom).toBeCloseTo(2);
		expect(v.isDefault).toBe(false);
		v.reset();
		for (let i = 0; i < 120; i++) v.update(1 / 60);
		expect(v.isDefault).toBe(true);
		expect(v.zoom).toBe(1);
	});
});

describe('moveLockedPointer', async () => {
	const { moveLockedPointer } = await import('../src/view');
	// 100×50 board, 10 px cells on a 995×500 screen: the board is 5 px wider than the screen.
	const b = (wrap: boolean): ViewBounds => ({ w: 100, h: 50, wrap, vw: 995, vh: 500, cell: 10 });
	const cam = { x: 0, y: 0, zoom: 1 };

	it('wraps to the opposite edge on a torus, reporting the shift', () => {
		let p = { x: 99.4, y: 10, sx: 0, sy: 0 };
		p = moveLockedPointer(cam, b(true), p.x, p.y, 0.5, 0); // small move, still on screen
		expect(p.x).toBeCloseTo(99.45);
		expect(p.sx).toBe(0);
		p = moveLockedPointer(cam, b(true), p.x, p.y, 40, 0); // keep pushing: comes out on the left
		expect(p.sx).toBe(-100);
		expect(p.x).toBeGreaterThanOrEqual(0);
		expect(p.x).toBeLessThan(4);
		p = moveLockedPointer(cam, b(true), 0.2, 49.9, -10, 10); // up-left corner trip: wraps both ways
		expect(p.sx).toBe(100);
		expect(p.sy).toBe(-50);
	});

	it('bordered: clamps on the border ring, just outside the board', () => {
		const wide = { ...b(false), vw: 2000, vh: 1000 }; // whole world plus ring on screen
		const view = { x: -5, y: -5, zoom: 1 };
		const p = moveLockedPointer(view, wide, 99, 49, 5000, 5000);
		expect(p.x).toBeGreaterThan(100);
		expect(p.x).toBeLessThan(101);
		expect(p.y).toBeGreaterThan(50);
		expect(p.y).toBeLessThan(51);
		const q = moveLockedPointer(view, wide, 5, 5, -10000, -10000);
		expect(q.x).toBe(-1);
		expect(q.y).toBe(-1);
	});

	it('clamp mode keeps a torus pointer inside the world', () => {
		const clamp = { ...b(true), pointer: 'clamp' as const };
		const p = moveLockedPointer(cam, clamp, 99, 10, 400, 0);
		expect(p.sx).toBe(0);
		expect(p.x).toBeLessThan(100);
		expect(p.x).toBeGreaterThan(99);
		const q = moveLockedPointer(cam, clamp, 1, 10, -400, 0);
		expect(q.x).toBe(0);
	});

	it('clamps to the screen on a torus when zoomed in (the far edge is not on screen)', () => {
		const p = moveLockedPointer({ x: 10, y: 10, zoom: 4 }, b(true), 30, 15, 10000, 0);
		expect(p.sx).toBe(0);
		expect(p.x).toBeCloseTo(10 + 995 / 40 - 1e-3);
	});
});

describe('View home', () => {
	it('centres a fixed-size world and counts torus-equivalent offsets as home', () => {
		const b: ViewBounds = { w: 40, h: 20, wrap: true, vw: 1000, vh: 500, cell: 10, centre: true };
		const v = new View(() => b);
		v.snapHome();
		const [cx, cy] = v.toCell(500, 250);
		expect(((cx % 40) + 40) % 40).toBeCloseTo(20); // torus: equal modulo the world size
		expect(((cy % 20) + 20) % 20).toBeCloseTo(10);
		expect(v.isDefault).toBe(true);
		v.panBy(-400, 0); // exactly one world width (40 cells × 10 px)
		expect(v.isDefault).toBe(true);
		v.panBy(-10, 0);
		expect(v.isDefault).toBe(false);
	});
});
