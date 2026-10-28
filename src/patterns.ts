/**
 * Life patterns: parsing (RLE and plaintext .cells), compact RLE encoding for
 * URLs, capturing the live board, and rotation/reflection.
 */

export interface Pattern {
	w: number;
	h: number;
	/** w*h cells, row-major, 0/1. */
	cells: Uint8Array;
}

const MAX_DIM = 2000;

/** Parse RLE (`x = 3, y = 3` header optional) or plaintext (`.O` rows). Returns an error message on failure. */
export function parsePattern(text: string): Pattern | string {
	const lines = text.replace(/\r/g, '').split('\n');
	const content = lines.filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
	if (content.length === 0) return 'Paste a pattern in RLE or plaintext (.cells) format.';

	const plain = content.filter((l) => !l.startsWith('!'));
	if (plain.length > 0 && plain.every((l) => /^[.O*]*\s*$/.test(l)) && plain.some((l) => /[O*]/.test(l))) {
		return fromPoints(
			plain.flatMap((l, y) => [...l.trimEnd()].flatMap((c, x) => (c === 'O' || c === '*' ? [[x, y] as [number, number]] : []))),
		);
	}

	const body = content
		.filter((l) => !/^\s*x\s*=/.test(l))
		.join('')
		.replace(/\s+/g, '');
	const pts: [number, number][] = [];
	let x = 0;
	let y = 0;
	let num = '';
	let ended = false;
	for (const ch of body) {
		if (ch >= '0' && ch <= '9') {
			num += ch;
			continue;
		}
		const n = num ? parseInt(num, 10) : 1;
		num = '';
		if (n > MAX_DIM * MAX_DIM) return 'That pattern is too large.';
		if (ch === '!') {
			ended = true;
			break;
		} else if (ch === '$') {
			y += n;
			x = 0;
		} else if (ch === 'b' || ch === '.') {
			x += n;
		} else if (/[a-zA-Z]/.test(ch)) {
			// 'o' is alive; other letters are multi-state cells, treated as alive.
			for (let i = 0; i < n; i++) pts.push([x + i, y]);
			x += n;
		} else {
			return `Unexpected "${ch}" in the pattern. Paste RLE (like bo$2bo$3o!) or plaintext (.O rows).`;
		}
		if (x > MAX_DIM || y > MAX_DIM) return `Patterns can be at most ${MAX_DIM}×${MAX_DIM} cells.`;
	}
	if (!ended && !body.includes('!') && pts.length === 0) return 'That doesn’t look like an RLE or plaintext pattern.';
	if (pts.length === 0) return 'That pattern has no live cells.';
	return fromPoints(pts);
}

/** Build a pattern trimmed to the bounding box of the given live points. */
function fromPoints(pts: [number, number][]): Pattern {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of pts) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}
	const w = maxX - minX + 1;
	const h = maxY - minY + 1;
	const cells = new Uint8Array(w * h);
	for (const [x, y] of pts) cells[(y - minY) * w + (x - minX)] = 1;
	return { w, h, cells };
}

/** Compact RLE body without header or whitespace, e.g. `bo$2bo$3o!`. */
export function toRle(p: Pattern): string {
	const rows: string[] = [];
	for (let y = 0; y < p.h; y++) {
		let row = '';
		let x = 0;
		while (x < p.w) {
			const v = p.cells[y * p.w + x];
			let run = 1;
			while (x + run < p.w && p.cells[y * p.w + x + run] === v) run++;
			if (v || x + run < p.w) row += (run > 1 ? run : '') + (v ? 'o' : 'b'); // trailing dead cells are implied
			x += run;
		}
		rows.push(row);
	}
	return rows.join('$').replace(/\$+/g, (m) => (m.length > 1 ? `${m.length}$` : '$')) + '!';
}

/** The live cells of a board, trimmed to their bounding box. Null if the board is empty. */
export function captureBoard(cells: Uint8Array, w: number, h: number): Pattern | null {
	const pts: [number, number][] = [];
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cells[y * w + x]) pts.push([x, y]);
	return pts.length ? fromPoints(pts) : null;
}

/** Rotate by `quarterTurns` clockwise, optionally mirroring horizontally first. */
export function transform(p: Pattern, quarterTurns: number, flip: boolean): Pattern {
	const q = ((quarterTurns % 4) + 4) % 4;
	const w = q % 2 ? p.h : p.w;
	const h = q % 2 ? p.w : p.h;
	const cells = new Uint8Array(w * h);
	for (let y = 0; y < p.h; y++) {
		for (let x0 = 0; x0 < p.w; x0++) {
			if (!p.cells[y * p.w + x0]) continue;
			const x = flip ? p.w - 1 - x0 : x0;
			let nx: number;
			let ny: number;
			if (q === 0) [nx, ny] = [x, y];
			else if (q === 1) [nx, ny] = [p.h - 1 - y, x];
			else if (q === 2) [nx, ny] = [p.w - 1 - x, p.h - 1 - y];
			else [nx, ny] = [y, p.w - 1 - x];
			cells[ny * w + nx] = 1;
		}
	}
	return { w, h, cells };
}

export function population(p: Pattern): number {
	let n = 0;
	for (const c of p.cells) n += c;
	return n;
}

/** A small library of well-known patterns to start from. */
export const LIBRARY: { name: string; rle: string; note: string }[] = [
	{ name: 'Glider', rle: 'bo$2bo$3o!', note: 'Spaceship' },
	{ name: 'Lightweight spaceship', rle: 'bo2bo$o4b$o3bo$4o!', note: 'Spaceship' },
	{ name: 'R-pentomino', rle: 'b2o$2o$bo!', note: 'Chaos for ~1,100 generations' },
	{ name: 'Acorn', rle: 'bo5b$3bo3b$2o2b3o!', note: 'Chaos for ~5,200 generations' },
	{ name: 'Diehard', rle: '6bob$2o6b$bo3b3o!', note: 'Vanishes after 130 generations' },
	{ name: 'Rabbits', rle: 'o3b3o$3o2bob$bo!', note: 'Chaos for ~17,000 generations' },
	{ name: 'Gosper glider gun', rle: '24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!', note: 'Fires a glider every 30 generations' },
	{ name: 'Pulsar', rle: '2b3o3b3o2$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2$2b3o3b3o$o4bobo4bo$o4bobo4bo$o4bobo4bo2$2b3o3b3o!', note: 'Period 3 oscillator' },
	{ name: 'Pentadecathlon', rle: '2bo4bo$2ob4ob2o$2bo4bo!', note: 'Period 15 oscillator' },
	{ name: 'Honey farm seed', rle: '7o!', note: 'A line of 7 that settles into four beehives' },
];
