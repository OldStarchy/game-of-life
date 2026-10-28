/**
 * Toroidal Conway's Game of Life.
 *
 * Stepping uses a three-row rolling scan: for each scanned row we keep a sliding
 * window of three vertical column sums (row above + row + row below), so each
 * cell's neighbour count costs one new column sum instead of eight lookups.
 *
 * It is sparse at the span level: every row remembers the leftmost/rightmost
 * column that changed last generation, and a row is only rescanned across the
 * union of its own and its neighbours' spans (±1 column). Quiet regions of the
 * board cost nothing beyond a memcpy, which matters on a full-screen grid that
 * spends most of its life as scattered ash and oscillators.
 *
 * Alongside the bit grid it maintains a GPU-facing RGBA16UI buffer holding
 * [alive, birthGen, deathGen, 0] per cell (generations mod 65536). The renderer
 * derives fade-in/out, age colouring and trails from those, so the CPU never
 * touches cells that didn't change.
 */

import { mulberry32 } from './rng';

export const GEN_MASK = 0xffff;
/** A birth is "fresh" if the cell hasn't died within this many generations. */
export const FRESH_GAP = 30;
/** Generation deltas beyond this are clamped so 16-bit stamps never wrap visibly. */
const STALE = 20000;
/** How many past generation hashes to remember for cycle detection. */
export const CYCLE_MEMORY = 256;

export class Life {
	readonly w: number;
	readonly h: number;
	readonly size: number;

	/** Current state, one byte per cell (0/1), row-major. */
	cells: Uint8Array;
	private next: Uint8Array;

	/** RGBA16UI texels: [alive, birthGen16, deathGen16, 0]. */
	readonly gpu: Uint16Array;
	/** Rows whose GPU texels changed since the renderer last uploaded them. */
	readonly gpuDirty: Uint8Array;
	gpuAllDirty = true;

	/** true: the board is a torus. false: everything beyond the edges is permanently dead. */
	wrap = true;

	gen = 0;
	population = 0;
	/** Cells that changed in the last step. */
	lastChanges = 0;
	/** Births in the last step into cells that had been dead for > FRESH_GAP generations. */
	lastFresh = 0;
	/** Period of a detected exact cycle (1 = still life), or 0 if none seen. */
	cyclePeriod = 0;

	// Changed spans written during the current generation (and by setCell).
	private pendLo: Int32Array;
	private pendHi: Int32Array;
	// Spans from the previous generation, read while stepping.
	private readLo: Int32Array;
	private readHi: Int32Array;

	// Zobrist hashing: two independent 32-bit tables, XOR-toggled on every change.
	private z0: Uint32Array;
	private z1: Uint32Array;
	private hash0 = 0;
	private hash1 = 0;
	private seen = new Map<number, number>();
	/** Per-row subarray views of each cell buffer, so edge rows can be swapped for zeros. */
	private views = new Map<Uint8Array, Uint8Array[]>();
	private zeroRow: Uint8Array;
	private ring = new Float64Array(CYCLE_MEMORY);
	private ringGen = new Int32Array(CYCLE_MEMORY).fill(-1);

	constructor(w: number, h: number) {
		this.w = w;
		this.h = h;
		this.size = w * h;
		this.cells = new Uint8Array(this.size);
		this.next = new Uint8Array(this.size);
		this.gpu = new Uint16Array(this.size * 4);
		this.gpuDirty = new Uint8Array(h);
		this.zeroRow = new Uint8Array(w);
		this.pendLo = new Int32Array(h).fill(w);
		this.pendHi = new Int32Array(h).fill(-1);
		this.readLo = new Int32Array(h).fill(w);
		this.readHi = new Int32Array(h).fill(-1);

		const rnd = mulberry32(0x9e3779b9 ^ (w * 73856093) ^ (h * 19349663));
		this.z0 = new Uint32Array(this.size);
		this.z1 = new Uint32Array(this.size);
		for (let i = 0; i < this.size; i++) {
			this.z0[i] = (rnd() * 4294967296) >>> 0;
			this.z1[i] = (rnd() * 4294967296) >>> 0;
		}

		const longDead = (0 - STALE - 10000) & GEN_MASK;
		for (let i = 0; i < this.size; i++) this.gpu[i * 4 + 2] = longDead;
	}

	get g16(): number {
		return this.gen & GEN_MASK;
	}

	/** 53-bit combination of the two Zobrist hashes, usable as a Map key. */
	get hash(): number {
		return (this.hash1 & 0x1fffff) * 4294967296 + (this.hash0 >>> 0);
	}

	get(x: number, y: number): number {
		if (!this.wrap && (x < 0 || y < 0 || x >= this.w || y >= this.h)) return 0;
		x = ((x % this.w) + this.w) % this.w;
		y = ((y % this.h) + this.h) % this.h;
		return this.cells[y * this.w + x];
	}

	/** Set a cell outside of stepping (seeding, drawing, wipes). Wraps on a torus; ignored off the edge otherwise. */
	set(x: number, y: number, v: number): void {
		if (!this.wrap && (x < 0 || y < 0 || x >= this.w || y >= this.h)) return;
		x = ((x % this.w) + this.w) % this.w;
		y = ((y % this.h) + this.h) % this.h;
		this.setIndex(y * this.w + x, v);
	}

	/** Change edge behaviour. Forces a full rescan, since edge cells' neighbourhoods change. */
	setWrap(wrap: boolean): void {
		if (wrap === this.wrap) return;
		this.wrap = wrap;
		this.pendLo.fill(0);
		this.pendHi.fill(this.w - 1);
		this.resetCycleTracking();
	}

	private rowsOf(buf: Uint8Array): Uint8Array[] {
		let v = this.views.get(buf);
		if (!v) {
			v = Array.from({ length: this.h }, (_, y) => buf.subarray(y * this.w, (y + 1) * this.w));
			this.views.set(buf, v);
		}
		return v;
	}

	setIndex(i: number, v: number): void {
		v = v ? 1 : 0;
		if (this.cells[i] === v) return;
		const y = (i / this.w) | 0;
		this.cells[i] = v;
		this.record(i, v, y, i - y * this.w);
	}

	clear(): void {
		for (let i = 0; i < this.size; i++) if (this.cells[i]) this.setIndex(i, 0);
	}

	/** Bookkeeping for a single cell flip: GPU texel, hash, population, dirty spans. */
	private record(i: number, v: number, y: number, x: number): void {
		const g = this.gen & GEN_MASK;
		const t = i * 4;
		this.gpu[t] = v;
		if (v) {
			this.gpu[t + 1] = g;
			this.population++;
		} else {
			this.gpu[t + 2] = g;
			this.population--;
		}
		this.hash0 ^= this.z0[i];
		this.hash1 ^= this.z1[i];
		if (x < this.pendLo[y]) this.pendLo[y] = x;
		if (x > this.pendHi[y]) this.pendHi[y] = x;
		this.gpuDirty[y] = 1;
	}

	/** Advance one generation. Returns the number of cells that changed. */
	step(): number {
		const { w, h } = this;
		// Last generation's pending spans become this generation's read spans.
		let t = this.readLo;
		this.readLo = this.pendLo;
		this.pendLo = t.fill(w);
		t = this.readHi;
		this.readHi = this.pendHi;
		this.pendHi = t.fill(-1);

		const cur = this.cells;
		const nxt = this.next;
		nxt.set(cur);
		this.gen++;
		const g = this.gen & GEN_MASK;

		const rLo = this.readLo;
		const rHi = this.readHi;
		const gpu = this.gpu;
		const z0 = this.z0;
		const z1 = this.z1;
		const pLo = this.pendLo;
		const pHi = this.pendHi;
		let changes = 0;
		let fresh = 0;
		let pop = this.population;
		let h0 = this.hash0;
		let h1 = this.hash1;

		const wrap = this.wrap;
		const rows = this.rowsOf(cur);
		const zero = this.zeroRow;
		for (let y = 0; y < h; y++) {
			// Neighbour rows; -1 means "beyond a wall" (all dead).
			const ym = y === 0 ? (wrap ? h - 1 : -1) : y - 1;
			const yp = y === h - 1 ? (wrap ? 0 : -1) : y + 1;
			let hi = rHi[y];
			if (ym >= 0 && rHi[ym] > hi) hi = rHi[ym];
			if (yp >= 0 && rHi[yp] > hi) hi = rHi[yp];
			if (hi < 0) continue; // nothing near this row changed
			let lo = rLo[y];
			if (ym >= 0 && rLo[ym] < lo) lo = rLo[ym];
			if (yp >= 0 && rLo[yp] < lo) lo = rLo[yp];
			lo -= 1;
			hi += 1;
			if (lo < 0 || hi >= w) {
				// Span touches an edge: just scan the full row.
				lo = 0;
				hi = w - 1;
			}

			const A = ym < 0 ? zero : rows[ym];
			const B = rows[y];
			const C = yp < 0 ? zero : rows[yp];
			const b = y * w;
			const w1 = w - 1;
			let left = lo === 0 ? (wrap ? A[w1] + B[w1] + C[w1] : 0) : A[lo - 1] + B[lo - 1] + C[lo - 1];
			let mid = A[lo] + B[lo] + C[lo];

			for (let x = lo; x <= hi; x++) {
				const right = x === w1 ? (wrap ? A[0] + B[0] + C[0] : 0) : A[x + 1] + B[x + 1] + C[x + 1];
				const i = b + x;
				const alive = B[x];
				const n = left + mid + right - alive;
				const ns = n === 3 || (n === 2 && alive === 1) ? 1 : 0;
				if (ns !== alive) {
					nxt[i] = ns;
					const tx = i * 4;
					gpu[tx] = ns;
					if (ns) {
						if (((g - gpu[tx + 2]) & GEN_MASK) > FRESH_GAP) fresh++;
						gpu[tx + 1] = g;
						pop++;
					} else {
						gpu[tx + 2] = g;
						pop--;
					}
					h0 ^= z0[i];
					h1 ^= z1[i];
					if (x < pLo[y]) pLo[y] = x;
					if (x > pHi[y]) pHi[y] = x;
					changes++;
				}
				left = mid;
				mid = right;
			}
			if (pHi[y] >= 0) this.gpuDirty[y] = 1;
		}

		this.cells = nxt;
		this.next = cur;
		this.population = pop;
		this.hash0 = h0;
		this.hash1 = h1;
		this.lastChanges = changes;
		this.lastFresh = fresh;
		this.trackCycle();
		if ((this.gen & 8191) === 0) this.rebase();
		return changes;
	}

	/** Forget cycle history (call after reseeding so old states can't match). */
	resetCycleTracking(): void {
		this.seen.clear();
		this.ringGen.fill(-1);
		this.cyclePeriod = 0;
	}

	private trackCycle(): void {
		const key = this.hash;
		const prev = this.seen.get(key);
		this.cyclePeriod = prev !== undefined ? this.gen - prev : 0;
		const slot = this.gen % CYCLE_MEMORY;
		const oldGen = this.ringGen[slot];
		if (oldGen >= 0 && this.seen.get(this.ring[slot]) === oldGen) this.seen.delete(this.ring[slot]);
		this.ring[slot] = key;
		this.ringGen[slot] = this.gen;
		this.seen.set(key, this.gen);
	}

	/** Clamp very old birth/death stamps so 16-bit generation deltas never wrap. */
	private rebase(): void {
		const g = this.gen & GEN_MASK;
		const floor = (g - STALE) & GEN_MASK;
		const gpu = this.gpu;
		for (let i = 0; i < this.size; i++) {
			const t = i * 4;
			if (((g - gpu[t + 1]) & GEN_MASK) > STALE) gpu[t + 1] = floor;
			if (((g - gpu[t + 2]) & GEN_MASK) > STALE) gpu[t + 2] = floor;
		}
		this.gpuAllDirty = true;
	}

	/** Copy the overlapping region of another board into this one (used on resize). */
	copyFrom(other: Life): void {
		const w = Math.min(this.w, other.w);
		const h = Math.min(this.h, other.h);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) if (other.cells[y * other.w + x]) this.setIndex(y * this.w + x, 1);
	}
}
