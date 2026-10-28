import type { Life } from './life';

export type BoredReason = { kind: 'cycle'; period: number } | { kind: 'stagnant' } | { kind: 'timeout' };

/**
 * Decides when the world has become boring enough to reseed.
 *
 * - Exact cycles (still lifes, blinkers, anything with period ≤ CYCLE_MEMORY) are
 *   caught by the board hash.
 * - On a torus a lone glider never repeats within a short window, so we also track
 *   "fresh births" — births into cells that haven't been alive recently. Oscillators
 *   keep re-using the same cells and score zero; chaotic soup scores high. When the
 *   smoothed rate drops below the threshold the board is considered stagnant.
 */
export class Watchdog {
	/** Smoothed fresh births per 10,000 cells per generation. */
	freshRate = 100;
	gensSinceSeed = 0;
	private secondsSinceSeed = 0;

	reset(): void {
		this.freshRate = 100;
		this.gensSinceSeed = 0;
		this.secondsSinceSeed = 0;
	}

	/**
	 * How close the board is to being restarted for being too quiet, 0..1.
	 * threshold / freshRate: 1 when the smoothed rate reaches the threshold (the
	 * restart point) and capped there for quieter boards, including fully static
	 * ones where the rate is 0. Busy boards approach 0 but never reach it.
	 */
	boredom(threshold: number): number {
		if (threshold <= 0) return 0;
		if (this.freshRate <= threshold) return 1;
		return threshold / this.freshRate;
	}

	tickTime(dt: number): void {
		this.secondsSinceSeed += dt;
	}

	/** Call after each generation. `boredom` is the fresh-birth threshold (per 10k cells). */
	afterStep(life: Life, boredom: number, maxMinutes: number): BoredReason | null {
		this.gensSinceSeed++;
		const rate = (life.lastFresh / life.size) * 10000;
		this.freshRate += (rate - this.freshRate) / 60;

		if (life.cyclePeriod > 0 && this.gensSinceSeed > 4) return { kind: 'cycle', period: life.cyclePeriod };
		if (boredom > 0 && this.gensSinceSeed > 120 && this.freshRate < boredom) return { kind: 'stagnant' };
		if (maxMinutes > 0 && this.secondsSinceSeed > maxMinutes * 60) return { kind: 'timeout' };
		return null;
	}
}
