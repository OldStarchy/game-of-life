import { describe, expect, it } from 'vitest';
import { Life } from '../src/life';
import { captureBoard, LIBRARY, parsePattern, population, toRle, transform, type Pattern } from '../src/patterns';

function must(p: Pattern | string): Pattern {
	if (typeof p === 'string') throw new Error(p);
	return p;
}

function boardWith(p: Pattern, size = 64): Life {
	const life = new Life(size, size);
	const ox = Math.floor((size - p.w) / 2);
	const oy = Math.floor((size - p.h) / 2);
	for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.cells[y * p.w + x]) life.set(ox + x, oy + y, 1);
	return life;
}

const byName = (n: string) => must(parsePattern(LIBRARY.find((l) => l.name === n)!.rle));

describe('parsePattern', () => {
	it('reads full RLE with header and comments', () => {
		const p = must(parsePattern('#N Glider\n#C a comment\nx = 3, y = 3, rule = B3/S23\nbo$2bo$\n3o!'));
		expect([p.w, p.h, population(p)]).toEqual([3, 3, 5]);
		expect(Array.from(p.cells)).toEqual([0, 1, 0, 0, 0, 1, 1, 1, 1]);
	});

	it('reads plaintext .cells', () => {
		const p = must(parsePattern('!Name: Glider\n.O.\n..O\nOOO\n'));
		expect(toRle(p)).toBe('bo$2bo$3o!');
	});

	it('handles multi-row skips', () => {
		const p = must(parsePattern('o3$o!'));
		expect([p.w, p.h]).toEqual([1, 4]);
		expect(toRle(p)).toBe('o3$o!');
	});

	it('rejects junk with a helpful message', () => {
		expect(typeof parsePattern('hello world?')).toBe('string');
		expect(typeof parsePattern('')).toBe('string');
		expect(typeof parsePattern('3b!')).toBe('string');
	});

	it('round-trips every library pattern through compact RLE', () => {
		for (const { rle } of LIBRARY) {
			const p = must(parsePattern(rle));
			const q = must(parsePattern(toRle(p)));
			expect(q).toEqual(p);
		}
	});
});

describe('library patterns behave as advertised', () => {
	it('pulsar is a period-3 oscillator with 48 cells', () => {
		const life = boardWith(byName('Pulsar'));
		expect(life.population).toBe(48);
		for (let i = 0; i < 6; i++) life.step();
		expect(life.cyclePeriod).toBe(3);
	});

	it('pentadecathlon has period 15', () => {
		const life = boardWith(byName('Pentadecathlon'));
		for (let i = 0; i < 30; i++) life.step();
		expect(life.cyclePeriod).toBe(15);
	});

	for (const name of ['Glider', 'Lightweight spaceship']) {
		it(`${name} keeps its shape after 4 generations, but moves`, () => {
			const life = boardWith(byName(name));
			const start = captureBoard(life.cells, life.w, life.h)!;
			const before = Array.from(life.cells);
			for (let i = 0; i < 4; i++) life.step();
			expect(captureBoard(life.cells, life.w, life.h)).toEqual(start);
			expect(Array.from(life.cells)).not.toEqual(before);
		});
	}

	it('Gosper gun grows by a glider every 30 generations', () => {
		const life = boardWith(byName('Gosper glider gun'), 120);
		const p0 = life.population;
		for (let i = 0; i < 120; i++) life.step();
		expect(life.population).toBeGreaterThan(p0 + 10);
	});

	it('diehard dies out after 130 generations', () => {
		const life = boardWith(byName('Diehard'), 200);
		for (let i = 0; i < 130; i++) life.step();
		expect(life.population).toBe(0);
	});
});

describe('transform', () => {
	it('four quarter turns are the identity; rotation swaps dimensions', () => {
		const p = byName('Gosper glider gun');
		let q = p;
		for (let i = 0; i < 4; i++) q = transform(q, 1, false);
		expect(q).toEqual(p);
		const r = transform(p, 1, false);
		expect([r.w, r.h]).toEqual([p.h, p.w]);
		expect(population(r)).toBe(population(p));
		expect(transform(transform(p, 0, true), 0, true)).toEqual(p);
	});
});

describe('custom seeds and URL settings', () => {
	it('centres a single copy of the pattern', async () => {
		const { generateSeed } = await import('../src/seed');
		const { mulberry32 } = await import('../src/rng');
		const glider = byName('Glider');
		const board = generateSeed(20, 10, { pattern: 'custom', density: 0, custom: [glider], layout: 'centre' }, mulberry32(1));
		const got = captureBoard(board, 20, 10)!;
		expect(got).toEqual(glider);
		expect(board[4 * 20 + 10]).toBe(1); // middle cell of the glider's top row (x=10, y=4)
	});

	it('stamps the requested number of copies in a grid', async () => {
		const { generateSeed } = await import('../src/seed');
		const { mulberry32 } = await import('../src/rng');
		const board = generateSeed(120, 60, { pattern: 'custom', density: 0, custom: [byName('Pulsar')], layout: 'grid', copies: 6 }, mulberry32(1));
		expect(board.reduce((a, b) => a + b, 0)).toBe(6 * 48);
	});

	it('round-trips patterns through the URL', async () => {
		const { parseSettings, serializeSettings } = await import('../src/settings');
		const s = parseSettings('?pattern=custom&rle=bo%242bo%243o!&rle=' + encodeURIComponent('x = 3, y = 1\n3o!') + '&rle=garbage%3F');
		expect(s.pattern).toBe('custom');
		expect(s.customPatterns).toEqual(['bo$2bo$3o!', '3o!']);
		expect(parseSettings(serializeSettings(s)).customPatterns).toEqual(s.customPatterns);
	});

	it('Surprise me rotates custom patterns in only when there are some', async () => {
		const { generateSeed } = await import('../src/seed');
		const { mulberry32 } = await import('../src/rng');
		const pulsar = byName('Pulsar');
		const rnd = mulberry32(3);
		let customs = 0;
		for (let i = 0; i < 40; i++) {
			const b = generateSeed(60, 40, { pattern: 'mixed', density: 0.3, custom: [pulsar], layout: 'centre' }, rnd);
			if (b.reduce((a, c) => a + c, 0) === 48) customs++;
		}
		expect(customs).toBeGreaterThan(3);
		expect(customs).toBeLessThan(25);
		for (let i = 0; i < 20; i++) {
			const b = generateSeed(60, 40, { pattern: 'mixed', density: 0.3, custom: [] }, rnd);
			expect(b.reduce((a, c) => a + c, 0)).not.toBe(0);
		}
	});
});
