import { describe, expect, it } from 'vitest';
import { Life } from '../src/life';
import { mulberry32 } from '../src/rng';
import { generateSeed } from '../src/seed';
import { Watchdog } from '../src/watchdog';

function naiveStep(cells: Uint8Array, w: number, h: number, wrap = true, border: (x: number, y: number) => number = () => 0): Uint8Array {
	const out = new Uint8Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			let n = 0;
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					if (!dx && !dy) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (!wrap && (nx < 0 || ny < 0 || nx >= w || ny >= h)) {
						n += border(nx, ny);
						continue;
					}
					n += cells[((ny + h) % h) * w + ((nx + w) % w)];
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

	it('matches a naive implementation with walls instead of wrapping', () => {
		for (const [w, h, seed] of [
			[37, 23, 11],
			[64, 40, 12],
			[3, 3, 13],
			[90, 2, 14],
		] as const) {
			const rnd = mulberry32(seed);
			const life = new Life(w, h);
			life.setWrap(false);
			let ref: Uint8Array = new Uint8Array(w * h);
			for (let i = 0; i < w * h; i++) {
				ref[i] = rnd() < 0.35 ? 1 : 0;
				life.setIndex(i, ref[i]);
			}
			for (let g = 0; g < 200; g++) {
				life.step();
				ref = naiveStep(ref, w, h, false);
				expect(Array.from(life.cells)).toEqual(Array.from(ref));
			}
		}
	});

	it('matches a naive implementation with a random border ring, edited mid-run', () => {
		for (const [w, h, seed] of [
			[30, 20, 31],
			[5, 4, 32],
			[1, 6, 33],
			[40, 1, 34],
		] as const) {
			const rnd = mulberry32(seed);
			const life = new Life(w, h);
			life.setWrap(false);
			const ring = new Map<string, number>();
			const setRing = (x: number, y: number, v: number) => {
				ring.set(`${x},${y}`, v);
				life.set(x, y, v);
			};
			for (let x = -1; x <= w; x++) {
				setRing(x, -1, rnd() < 0.5 ? 1 : 0);
				setRing(x, h, rnd() < 0.5 ? 1 : 0);
			}
			for (let y = 0; y < h; y++) {
				setRing(-1, y, rnd() < 0.5 ? 1 : 0);
				setRing(w, y, rnd() < 0.5 ? 1 : 0);
			}
			const border = (x: number, y: number) => ring.get(`${x},${y}`) ?? 0;
			let ref: Uint8Array = new Uint8Array(w * h);
			for (let i = 0; i < w * h; i++) {
				ref[i] = rnd() < 0.3 ? 1 : 0;
				life.setIndex(i, ref[i]);
			}
			for (let g = 0; g < 150; g++) {
				if (g % 25 === 24) {
					// Flip a few random border cells, including corners.
					for (let k = 0; k < 4; k++) {
						const side = Math.floor(rnd() * 4);
						const t = side < 2 ? Math.floor(rnd() * (w + 2)) - 1 : Math.floor(rnd() * h);
						const [x, y] = side === 0 ? [t, -1] : side === 1 ? [t, h] : side === 2 ? [-1, t] : [w, t];
						setRing(x, y, 1 - border(x, y));
					}
				}
				life.step();
				ref = naiveStep(ref, w, h, false, border);
				expect(Array.from(life.cells)).toEqual(Array.from(ref));
			}
			// Off the ring is ignored and reads as dead.
			life.set(-2, 0, 1);
			expect(life.get(-2, 0)).toBe(0);
		}
	});

	it('a fully alive border feeds the edges', () => {
		const life = new Life(10, 10);
		life.setWrap(false);
		life.fillBorder(1);
		life.step();
		// Every edge cell has 3 live border neighbours (corners have 5): edges are born, corners stay dead.
		expect(life.get(5, 0)).toBe(1);
		expect(life.get(0, 0)).toBe(0);
		expect(life.get(5, 5)).toBe(0);
	});

	it('switches edge mode mid-run and rescans the edges', () => {
		const w = 40;
		const h = 30;
		const rnd = mulberry32(21);
		const life = new Life(w, h);
		let ref: Uint8Array = new Uint8Array(w * h);
		for (let i = 0; i < w * h; i++) {
			ref[i] = rnd() < 0.35 ? 1 : 0;
			life.setIndex(i, ref[i]);
		}
		for (let g = 0; g < 120; g++) {
			const wrap = g < 40 || g >= 80;
			life.setWrap(wrap);
			life.step();
			ref = naiveStep(ref, w, h, wrap);
			expect(Array.from(life.cells)).toEqual(Array.from(ref));
		}
	});

	it('a glider stops at a wall instead of wrapping', () => {
		const life = new Life(16, 16);
		life.setWrap(false);
		place(life, [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]], 8, 8);
		for (let i = 0; i < 64; i++) life.step();
		// It turns into a still life (block) in the bottom-right corner; nothing reaches the top-left.
		expect(life.cyclePeriod).toBe(1);
		for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(life.get(x, y)).toBe(0);
		expect(life.get(-1, 0)).toBe(0);
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

describe('Watchdog.boredom', () => {
	it('is threshold / rate, capped at 100% at and below the threshold', () => {
		const dog = new Watchdog();
		dog.freshRate = 100;
		expect(dog.boredom(2)).toBeCloseTo(0.02);
		dog.freshRate = 4;
		expect(dog.boredom(2)).toBeCloseTo(0.5);
		dog.freshRate = 2;
		expect(dog.boredom(2)).toBe(1);
		dog.freshRate = 0;
		expect(dog.boredom(2)).toBe(1);
		expect(dog.boredom(0)).toBe(0);
	});
});
