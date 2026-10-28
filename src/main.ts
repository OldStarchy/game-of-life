import './style.css';
import { Life } from './life';
import { Panel } from './panel';
import { parsePattern, type Pattern } from './patterns';
import { pickWeighted } from './pool';
import { Renderer } from './renderer';
import { hashString, mulberry32, type Rng } from './rng';
import { generateSeed } from './seed';
import { parseSettings, serializeSettings, type Settings } from './settings';
import { Watchdog } from './watchdog';
import { makeGeom, Wipe } from './wipe';

const settings: Settings = parseSettings(location.search);
const canvas = document.getElementById('life') as HTMLCanvasElement;

let renderer: Renderer;
try {
	renderer = new Renderer(canvas);
} catch (err) {
	document.body.classList.add('no-gl');
	const msg = document.createElement('p');
	msg.className = 'fatal';
	msg.textContent = `This wallpaper needs WebGL2, which isn't available here. ${(err as Error).message}`;
	document.body.append(msg);
	throw err;
}

let rnd: Rng = makeRng();
let life = new Life(1, 1);
const watchdog = new Watchdog();
let wipe: Wipe | null = null;
let wipeStart = 0;
let reseedAt = 0; // time (ms) a pending reseed should start, 0 if none
let paused = false;
let acc = 0; // fractional progress toward the next generation
let hue = 0; // palette rotation in turns
let hueTo = 0;
/** After the viewer draws or clears, leave their creation alone for a while. */
let graceUntil = 0;
let lastReason = '';
/** While paused, animates the fade of a manual single step. */
let stepFade = false;
const GRACE_MS = 30000;

function makeRng(): Rng {
	return mulberry32(settings.seed ? hashString(settings.seed) : (Math.random() * 2 ** 32) >>> 0);
}

// ---- sizing ---------------------------------------------------------------

function resize(): void {
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const cssW = window.innerWidth;
	const cssH = window.innerHeight;
	canvas.width = Math.round(cssW * dpr);
	canvas.height = Math.round(cssH * dpr);
	const gw = Math.max(3, Math.ceil(cssW / settings.cell));
	const gh = Math.max(3, Math.ceil(cssH / settings.cell));
	if (gw === life.w && gh === life.h) return;
	const old = life;
	life = new Life(gw, gh);
	life.copyFrom(old);
	if (wipe) {
		// The wipe was built for the old grid; finish it instantly on the new one.
		wipe = null;
		finishReseed();
	}
	renderer.setGrid(gw, gh);
	watchdog.reset();
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
	clearTimeout(resizeTimer);
	resizeTimer = window.setTimeout(resize, 120);
});

// ---- reseeding ------------------------------------------------------------

function reseed(): void {
	reseedAt = 0;
	const seed = generateSeed(
		life.w,
		life.h,
		{
			pattern: pickWeighted(settings.seeds, rnd, (k) => k !== 'custom' || customPatterns().length > 0) ?? 'random',
			density: settings.density,
			custom: customPatterns(),
			layout: settings.customLayout,
			copies: settings.customCopies,
			randomTransform: settings.customTransform,
			soup: settings.customSoup,
		},
		rnd,
	);
	const from = hue;
	if (settings.paletteShift) hueTo = hue + (0.1 + rnd() * 0.25) * (rnd() < 0.5 ? -1 : 1);
	else hueTo = 0;

	const style = pickWeighted(settings.transitions, rnd) ?? 'instant';
	if (style === 'instant') {
		for (let i = 0; i < life.size; i++) life.setIndex(i, seed[i]);
		hue = hueTo;
		finishReseed();
		return;
	}
	wipe = new Wipe(seed, life.w, life.h, makeGeom(style, life.w, life.h, rnd), from, hueTo);
	wipeStart = performance.now();
}

let patternCache: { key: string; patterns: Pattern[] } = { key: '', patterns: [] };
function customPatterns(): Pattern[] {
	const key = settings.customPatterns.join('|');
	if (key !== patternCache.key) {
		const patterns = settings.customPatterns.map((r) => parsePattern(r)).flatMap((p) => (typeof p === 'string' ? [] : [p]));
		patternCache = { key, patterns };
	}
	return patternCache.patterns;
}

function finishReseed(): void {
	hue = hueTo = ((hueTo % 1) + 1) % 1;
	life.resetCycleTracking();
	watchdog.reset();
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ---- drawing with the pointer ---------------------------------------------

let drawing: { erase: boolean; x: number; y: number } | null = null;

function cellAt(e: PointerEvent): [number, number] {
	return [Math.floor(e.clientX / settings.cell), Math.floor(e.clientY / settings.cell)];
}

function paintLine(x0: number, y0: number, x1: number, y1: number, v: number): void {
	const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
	for (let i = 0; i <= n; i++) {
		const x = Math.round(x0 + ((x1 - x0) * i) / n);
		const y = Math.round(y0 + ((y1 - y0) * i) / n);
		life.set(x, y, v);
		if (!v) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) life.set(x + dx, y + dy, 0);
	}
}

if (settings.ui) {
	canvas.addEventListener('pointerdown', (e) => {
		if (e.button !== 0 && e.button !== 2) return;
		const [x, y] = cellAt(e);
		drawing = { erase: e.shiftKey || e.button === 2, x, y };
		canvas.setPointerCapture(e.pointerId);
		paintLine(x, y, x, y, drawing.erase ? 0 : 1);
		watchdog.reset();
		reseedAt = 0;
		graceUntil = settings.holdAfterEdit ? performance.now() + GRACE_MS : 0;
	});
	canvas.addEventListener('pointermove', (e) => {
		if (!drawing) return;
		const [x, y] = cellAt(e);
		paintLine(drawing.x, drawing.y, x, y, drawing.erase ? 0 : 1);
		drawing.x = x;
		drawing.y = y;
	});
	const stop = () => (drawing = null);
	canvas.addEventListener('pointerup', stop);
	canvas.addEventListener('pointercancel', stop);
	canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---- panel ----------------------------------------------------------------

let urlTimer = 0;
const panel = settings.ui
	? new Panel(settings, {
			restart: () => {
				if (wipe) return;
				graceUntil = 0;
				reseed();
			},
			togglePause: () => (paused = !paused),
			step: () => {
				paused = true;
				life.step();
				// Replay the fade into the new generation even though we're paused.
				acc = 0;
				stepFade = true;
			},
			board: () => ({ cells: life.cells, w: life.w, h: life.h }),
			showPattern: (rle) => {
				const p = parsePattern(rle);
				if (typeof p === 'string') return;
				const seed = generateSeed(
					life.w,
					life.h,
					{
						pattern: 'custom',
						density: 0,
						custom: [p],
						layout: settings.customLayout,
						copies: settings.customCopies,
						randomTransform: settings.customTransform,
						soup: settings.customSoup,
					},
					rnd,
				);
				wipe = null;
				for (let i = 0; i < life.size; i++) life.setIndex(i, seed[i]);
				finishReseed();
				reseedAt = 0;
				acc = 0;
				graceUntil = settings.holdAfterEdit ? performance.now() + GRACE_MS : 0;
			},
			clear: () => {
				wipe = null;
				life.clear();
				finishReseed();
				reseedAt = 0;
				graceUntil = settings.holdAfterEdit ? performance.now() + GRACE_MS : 0;
			},
			changed: (key) => {
				if (key === 'cell') resize();
				if (key === 'holdAfterEdit' && !settings.holdAfterEdit) graceUntil = 0;
				if (key === 'seed') rnd = makeRng();
				clearTimeout(urlTimer);
				urlTimer = window.setTimeout(() => history.replaceState(null, '', `${location.pathname}${serializeSettings(settings)}`), 250);
			},
		})
	: null;
if (!settings.ui) document.body.classList.add('idle');

// ---- stats ----------------------------------------------------------------

const statsEl = document.createElement('div');
statsEl.className = 'stats';
statsEl.setAttribute('aria-hidden', 'true');
document.body.append(statsEl);
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;

// The deployed address, without protocol, settings or a trailing slash, e.g. oldstarchy.github.io/game-of-life
const urlEl = document.createElement('div');
urlEl.className = 'site-url';
urlEl.textContent = `${location.host}${location.pathname.replace(/\/(index\.html)?$/, '')}`;
document.body.append(urlEl);

function updateStats(dt: number): void {
	statsEl.hidden = !settings.stats;
	urlEl.hidden = !settings.showUrl;
	fpsFrames++;
	fpsTime += dt;
	if (fpsTime < 0.5) return;
	fps = fpsFrames / fpsTime;
	fpsFrames = 0;
	fpsTime = 0;
	if (!settings.stats) return;
	const now = performance.now();
	const state = wipe
		? 'restarting'
		: reseedAt
			? `${lastReason}, restarting in ${Math.max(0, Math.ceil((reseedAt - now) / 1000))}s`
			: paused
				? 'paused'
				: graceUntil > now
					? `auto-restart held for ${Math.ceil((graceUntil - now) / 1000)}s`
					: 'evolving';
	statsEl.textContent = `gen ${life.gen.toLocaleString()}   pop ${life.population.toLocaleString()}   ${life.w}×${life.h}   activity ${watchdog.freshRate.toFixed(1)}${
		settings.boredom > 0 ? `   ${Math.round(watchdog.boredom(settings.boredom) * 100)}% bored` : ''
	}   ${fps.toFixed(0)} fps   ${state}`;
}

// ---- main loop ------------------------------------------------------------

let last = performance.now();

function frame(now: number): void {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;

	if (paused && stepFade) {
		acc = Math.min(0.9999, acc + dt / 0.18);
		if (acc >= 0.9999) stepFade = false;
	}

	if (!paused) {
		stepFade = false;
		acc += dt * settings.speed;
		// Never try to catch up more than a few generations per frame.
		if (acc > 4) acc = 4;
		while (acc >= 1) {
			acc -= 1;
			life.step();
			if (!wipe && !reseedAt && now >= graceUntil) {
				const bored = watchdog.afterStep(life, settings.boredom, settings.maxMinutes);
				if (bored) {
					reseedAt = now + (bored.kind === 'timeout' ? 0 : settings.linger * 1000);
					lastReason =
						bored.kind === 'cycle'
							? bored.period === 1
								? 'settled'
								: `looping every ${bored.period} gen`
							: bored.kind === 'stagnant'
								? 'too quiet'
								: 'time limit';
				}
			}
		}
		watchdog.tickTime(dt);

		if (wipe) {
			const p = (now - wipeStart) / (settings.transitionTime * 1000);
			if (wipe.advance(life, easeInOut(Math.min(1, p)))) {
				wipe = null;
				finishReseed();
			}
		} else if (reseedAt && now >= reseedAt) {
			reseed();
		}
	}

	renderer.upload(life);
	renderer.render(life, {
		t: acc,
		time: now / 1000,
		settings,
		hueFrom: wipe ? wipe.hueFrom : hue,
		hueTo: wipe ? wipe.hueTo : hue,
		wipe: wipe ? { geom: wipe.geom, progress: wipe.progress } : null,
	});
	updateStats(dt);
	requestAnimationFrame(frame);
}

resize();
reseed(); // the first world sweeps in like any other
requestAnimationFrame(frame);

// Exposed for debugging from the console.
Object.assign(window, { life: () => life, settings, panel });
