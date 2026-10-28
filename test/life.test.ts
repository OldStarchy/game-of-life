import { describe, expect, it } from 'vitest';
import { Life } from '../src/life';
import { mulberry32 } from '../src/rng';
import { generateSeed } from '../src/seed';
import { makeGeom, Wipe } from '../src/wipe';
import { Watchdog } from '../src/watchdog';

function naiveStep(cells: Uint8Array, w: number, h: number): Uint8Array {
	const out = new Uint8Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			let n = 0;
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					if (!dx && !dy) continue;
					n += cells[((y + dy + h) % h) * w + ((x + dx + w) % w)];
				}
			const a = cells[y * w + x];
			out[y * w + x] = n === 3 || (n === 2 && a) ? 1 : 0;
		}
	return out;
}

function place(life: Life, pts: [number, number][], ox = 0, oy = 0) {
	for (const [x, y] of pts) life.set(x + ox, y + oy, 1);
}

describe('Life', () => {
	it('matches a naive toroidal implementation on random soups', () => {
		for (const [w, h, seed] of [
			[37, 23, 1],
			[64, 64, 2],
			[5, 7, 3],
			[120, 3, 4],
		] as const) {
			const rnd = mulberry32(seed);
			const life = new Life(w, h);
			let ref: Uint8Array = new Uint8Array(w * h);
			for (let i = 0; i < w * h; i++) {
				ref[i] = rnd() < 0.35 ? 1 : 0;
				life.setIndex(i, ref[i]);
			}
			for (let g = 0; g < 200; g++) {
				life.step();
				ref = naiveStep(ref, w, h);
				expect(Array.from(life.cells)).toEqual(Array.from(ref));
				// Drawing mid-run must also be picked up by the sparse scan.
				if (g === 100) {
					life.set(3, 1, 1);
					life.set(4, 1, 1);
					life.set(5, 1, 1);
					ref[1 * w + (3 % w)] = 1;
					ref[1 * w + (4 % w)] = 1;
					ref[1 * w + (5 % w)] = 1;
				}
			}
			const pop = life.cells.reduce((a, b) => a + b, 0);
			expect(life.population).toBe(pop);
		}
	});

	it('keeps the GPU buffer in sync with cell state', () => {
		const life = new Life(30, 30);
		const rnd = mulberry32(9);
		for (let i = 0; i < life.size; i++) life.setIndex(i, rnd() < 0.4 ? 1 : 0);
		for (let g = 0; g < 50; g++) life.step();
		for (let i = 0; i < life.size; i++) expect(life.gpu[i * 4]).toBe(life.cells[i]);
	});

	it('detects a still life as period 1', () => {
		const life = new Life(20, 20);
		place(life, [[5, 5], [6, 5], [5, 6], [6, 6]]);
		life.step();
		life.step();
		expect(life.cyclePeriod).toBe(1);
	});

	it('detects a blinker as period 2', () => {
		const life = new Life(20, 20);
		place(life, [[5, 5], [6, 5], [7, 5]]);
		for (let i = 0; i < 4; i++) life.step();
		expect(life.cyclePeriod).toBe(2);
	});

	it('wraps a glider around the torus and returns to its start after 4·W generations', () => {
		const w = 16;
		const life = new Life(w, w);
		place(life, [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]], w - 2, w - 2);
		const start = Array.from(life.cells);
		for (let i = 0; i < 4 * w; i++) life.step();
		expect(Array.from(life.cells)).toEqual(start);
		expect(life.population).toBe(5);
	});
});

describe('Watchdog', () => {
	it('calls a lone glider on a big board stagnant, but not active soup', () => {
		const life = new Life(200, 120);
		place(life, [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]], 50, 50);
		const dog = new Watchdog();
		let reason = null;
		for (let i = 0; i < 2000 && !reason; i++) {
			life.step();
			reason = dog.afterStep(life, 1, 0);
		}
		expect(reason?.kind).toBe('stagnant');

		const soup = new Life(200, 120);
		const seed = generateSeed(200, 120, { pattern: 'random', density: 0.3 }, mulberry32(5));
		for (let i = 0; i < soup.size; i++) soup.setIndex(i, seed[i]);
		const dog2 = new Watchdog();
		for (let i = 0; i < 150; i++) {
			soup.step();
			expect(dog2.afterStep(soup, 1, 0)).toBeNull();
		}
	});
});

describe('Wipe', () => {
	for (const style of ['swipe', 'diagonal', 'radial'] as const) {
		it(`${style} wipe ends with exactly the new seed`, () => {
			const w = 50;
			const h = 30;
			const rnd = mulberry32(7);
			const life = new Life(w, h);
			const old = generateSeed(w, h, { pattern: 'random', density: 0.5 }, rnd);
			for (let i = 0; i < life.size; i++) life.setIndex(i, old[i]);
			const seed = generateSeed(w, h, { pattern: 'clusters', density: 0.4 }, rnd);
			const wipe = new Wipe(seed, w, h, makeGeom(style, w, h, rnd), 0, 0);
			let done = false;
			for (let p = 0; !done; p += 0.07) done = wipe.advance(life, p);
			expect(Array.from(life.cells)).toEqual(Array.from(seed));
		});
	}
});
