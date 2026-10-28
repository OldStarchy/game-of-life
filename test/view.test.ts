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
