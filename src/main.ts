import './style.css';
import { Life } from './life';
import { Panel } from './panel';
import { parsePattern, type Pattern } from './patterns';
import { pickWeighted } from './pool';
import { Renderer } from './renderer';
import { hashString, mulberry32, type Rng } from './rng';
import { generateSeed, type SeedOptions, type SeedPattern } from './seed';
import { parseSettings, serializeSettings, type Settings } from './settings';
import { moveLockedPointer, View } from './view';
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
	const fixed = settings.worldSize === 'fixed';
	const gw = fixed ? settings.worldW : Math.max(3, Math.ceil(cssW / settings.cell));
	const gh = fixed ? settings.worldH : Math.max(3, Math.ceil(cssH / settings.cell));
	// Keep the camera on its default view through size changes, if that's where it was.
	if (gw === life.w && gh === life.h) {
		if (viewAtHome) view.snapHome();
		return;
	}
	const old = life;
	life = new Life(gw, gh);
	life.setWrap(settings.edges === 'wrap');
	life.fillBorder(settings.borderFill === 'alive' ? 1 : 0);
	life.copyFrom(old);
	if (wipe) {
		// The wipe was built for the old grid; finish it instantly on the new one.
		wipe = null;
		finishReseed();
	}
	renderer.setGrid(gw, gh, settings.edges === 'wrap');
	watchdog.reset();
	if (viewAtHome) view.snapHome();
}

/** Whether the camera was on its default view as of the last frame (checked before settings change it). */
let viewAtHome = true;
let worldTimer = 0;

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
		seedOptions(pickWeighted(settings.seeds, rnd, (k) => k !== 'custom' || customPatterns().length > 0) ?? 'random', customPatterns()),
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

function seedOptions(pattern: SeedPattern, custom: Pattern[]): SeedOptions {
	const copies =
		settings.customAmount === 'area'
			? Math.max(1, Math.round((settings.customPerArea * life.w * life.h) / 10000))
			: settings.customCopies;
	return {
		pattern,
		density: settings.density,
		custom,
		layout: settings.customLayout,
		copies,
		randomTransform: settings.customTransform,
		soup: settings.customSoup,
		wrap: settings.edges === 'wrap',
	};
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

// ---- camera ---------------------------------------------------------------

const viewBounds = () => ({
	w: life.w,
	h: life.h,
	wrap: settings.edges === 'wrap',
	vw: window.innerWidth,
	vh: window.innerHeight,
	cell: settings.cell,
	centre: settings.worldSize === 'fixed',
	pointer: settings.edges === 'bordered' ? ('border' as const) : settings.clampCursor ? ('clamp' as const) : ('wrap' as const),
});
const view = new View(viewBounds);

// Small "zoom · Reset view" pill, only while the view isn't the default (and hidden when idle).
const viewPill = document.createElement('div');
viewPill.className = 'view-pill';
viewPill.hidden = true;
const viewZoom = document.createElement('span');
const viewReset = document.createElement('button');
viewReset.type = 'button';
viewReset.textContent = 'Reset view';
viewReset.addEventListener('click', () => view.reset());
viewPill.append(viewZoom, viewReset);
if (settings.ui) document.body.append(viewPill);
let pillZoom = -1;
function updateViewPill(): void {
	const show = !view.isDefault;
	if (viewPill.hidden === show) viewPill.hidden = !show;
	const z = Math.round(view.targetZoom * 100);
	if (show && z !== pillZoom) {
		pillZoom = z;
		viewZoom.textContent = `${z}%`;
	}
}

// ---- pointer: draw, pan, pinch ----------------------------------------------

let drawing: { erase: boolean; x: number; y: number } | null = null;
let panning: { x: number; y: number } | null = null;
const touches = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; mx: number; my: number } | null = null;

/** While the mouse is locked: the virtual pointer, in board cells (unwrapped). */
let vptr: { x: number; y: number } | null = null;
const vcursor = document.createElement('div');
vcursor.className = 'virtual-cursor';
vcursor.hidden = true;
vcursor.setAttribute('aria-hidden', 'true');
if (settings.ui) document.body.append(vcursor);

const isLocked = () => document.pointerLockElement === canvas;

function lockMouse(e: PointerEvent, forDrawing: boolean): void {
	if (!settings.captureMouse || e.pointerType !== 'mouse' || !canvas.requestPointerLock) return;
	vptr = forDrawing ? (() => {
		const [x, y] = view.toCell(e.clientX, e.clientY);
		return { x, y };
	})() : null;
	try {
		// Raw movement where supported; otherwise fall back to a plain lock.
		const r = (canvas.requestPointerLock as (o?: object) => Promise<void> | void)({ unadjustedMovement: true });
		if (r && typeof r.catch === 'function') r.catch(() => Promise.resolve(canvas.requestPointerLock()).catch(() => {}));
	} catch {
		/* no pointer lock: drawing still works with ordinary capture */
	}
}

function unlockMouse(): void {
	vptr = null;
	vcursor.hidden = true;
	if (isLocked()) document.exitPointerLock();
}

function placeVirtualCursor(): void {
	if (!vptr) return;
	const k = settings.cell * view.zoom;
	vcursor.hidden = false;
	vcursor.style.transform = `translate(${(vptr.x - view.x) * k}px, ${(vptr.y - view.y) * k}px)`;
}

// Esc (or the browser) can end the lock mid-drag: just end the drag.
document.addEventListener('pointerlockchange', () => {
	if (!isLocked() && (drawing || panning)) {
		drawing = null;
		panning = null;
		canvas.classList.remove('panning');
		vptr = null;
		vcursor.hidden = true;
	}
});

/** Board cell under the pointer, unwrapped (Life.set wraps or clips as needed). */
function cellAt(e: PointerEvent): [number, number] {
	const [x, y] = view.toCell(e.clientX, e.clientY);
	return [Math.floor(x), Math.floor(y)];
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

function pinchState(): { dist: number; mx: number; my: number } {
	const [a, b] = [...touches.values()];
	return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}

if (settings.ui) {
	canvas.addEventListener('pointerdown', (e) => {
		touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
		canvas.setPointerCapture(e.pointerId);
		if (touches.size === 2) {
			// Second finger: stop drawing, start pinch-zoom / two-finger pan.
			drawing = null;
			panning = null;
			pinch = pinchState();
			return;
		}
		if (touches.size > 2) return;
		// Middle button always pans; left pans too when drawing is switched off.
		if (e.button === 1 || (e.button === 0 && !settings.draw)) {
			panning = { x: e.clientX, y: e.clientY };
			canvas.classList.add('panning');
			lockMouse(e, false);
			return;
		}
		if (!settings.draw || (e.button !== 0 && e.button !== 2)) return;
		const [x, y] = cellAt(e);
		drawing = { erase: e.shiftKey || e.button === 2, x, y };
		paintLine(x, y, x, y, drawing.erase ? 0 : 1);
		lockMouse(e, true);
		watchdog.reset();
		reseedAt = 0;
		graceUntil = settings.holdAfterEdit ? performance.now() + GRACE_MS : 0;
	});
	canvas.addEventListener('pointermove', (e) => {
		if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pinch && touches.size === 2) {
			const p = pinchState();
			view.panBy(p.mx - pinch.mx, p.my - pinch.my);
			view.zoomAt(p.mx, p.my, p.dist / pinch.dist);
			pinch = p;
			return;
		}
		if (isLocked()) {
			// clientX/Y freeze while locked; only the movement deltas are meaningful.
			if (panning) view.panBy(e.movementX, e.movementY);
			else if (drawing && vptr) {
				const m = moveLockedPointer(view, viewBounds(), vptr.x, vptr.y, e.movementX, e.movementY);
				// A wrap moves the pointer by a whole world; move the stroke's last point with it.
				drawing.x += m.sx;
				drawing.y += m.sy;
				vptr = { x: m.x, y: m.y };
				const x = Math.floor(m.x);
				const y = Math.floor(m.y);
				paintLine(drawing.x, drawing.y, x, y, drawing.erase ? 0 : 1);
				drawing.x = x;
				drawing.y = y;
				placeVirtualCursor();
			}
			return;
		}
		if (panning) {
			view.panBy(e.clientX - panning.x, e.clientY - panning.y);
			panning = { x: e.clientX, y: e.clientY };
			return;
		}
		if (!drawing) return;
		const [x, y] = cellAt(e);
		paintLine(drawing.x, drawing.y, x, y, drawing.erase ? 0 : 1);
		drawing.x = x;
		drawing.y = y;
	});
	const stop = (e: PointerEvent) => {
		touches.delete(e.pointerId);
		if (touches.size < 2) pinch = null;
		if (touches.size === 0) {
			drawing = null;
			panning = null;
			canvas.classList.remove('panning');
			unlockMouse();
		}
	};
	canvas.addEventListener('pointerup', stop);
	canvas.addEventListener('pointercancel', stop);
	canvas.addEventListener('contextmenu', (e) => e.preventDefault());
	// Stop the browser's middle-click autoscroll so middle-drag can pan.
	canvas.addEventListener('mousedown', (e) => {
		if (e.button === 1) e.preventDefault();
	});

	canvas.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
			view.zoomAt(e.clientX, e.clientY, Math.exp(-d * 0.0015));
		},
		{ passive: false },
	);

	window.addEventListener('keydown', (e) => {
		const t = e.target;
		if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const cx = window.innerWidth / 2;
		const cy = window.innerHeight / 2;
		const step = Math.min(window.innerWidth, window.innerHeight) * 0.2;
		switch (e.key) {
			case '+':
			case '=':
				view.zoomAt(cx, cy, 1.25, true);
				break;
			case '-':
			case '_':
				view.zoomAt(cx, cy, 0.8, true);
				break;
			case '0':
				view.reset();
				break;
			case 'ArrowLeft':
				view.panBy(step, 0, true);
				break;
			case 'ArrowRight':
				view.panBy(-step, 0, true);
				break;
			case 'ArrowUp':
				view.panBy(0, step, true);
				break;
			case 'ArrowDown':
				view.panBy(0, -step, true);
				break;
			default:
				return;
		}
		e.preventDefault();
	});
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
					seedOptions('custom', [p]),
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
				if (key === 'worldSize' && settings.worldSize === 'fixed') {
					// Start from the current size so switching doesn't change anything yet.
					settings.worldW = Math.min(2000, Math.max(8, life.w));
					settings.worldH = Math.min(2000, Math.max(8, life.h));
					panel?.sync();
				}
				if (key === 'cell' || key === 'worldSize') resize();
				if (key === 'worldW' || key === 'worldH') {
					// Rebuilding a big world per slider tick is wasteful; wait for the slider to settle.
					clearTimeout(worldTimer);
					worldTimer = window.setTimeout(resize, 150);
				}
				if (key === 'holdAfterEdit' && !settings.holdAfterEdit) graceUntil = 0;
				if (key === 'autoRestart' && !settings.autoRestart) reseedAt = 0;
				if (key === 'draw') syncDrawCursor();
				if (key === 'borderFill') life.fillBorder(settings.borderFill === 'alive' ? 1 : 0);
				if (key === 'edges') {
					life.setWrap(settings.edges === 'wrap');
					renderer.setWrap(settings.edges === 'wrap');
					watchdog.reset();
				}
				if (key === 'seed') rnd = makeRng();
				clearTimeout(urlTimer);
				urlTimer = window.setTimeout(() => history.replaceState(null, '', `${location.pathname}${serializeSettings(settings)}`), 250);
			},
		})
	: null;
if (!settings.ui) document.body.classList.add('idle');

function syncDrawCursor(): void {
	document.body.classList.toggle('no-draw', !settings.ui || !settings.draw);
}
syncDrawCursor();

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
				: !settings.autoRestart
					? 'auto-restart off'
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
			if (!wipe) {
				// Always keep the activity measure current (for "% bored"); only act on it when allowed.
				const bored = watchdog.afterStep(life, settings.boredom, settings.maxMinutes);
				if (bored && !reseedAt && settings.autoRestart && now >= graceUntil) {
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

	view.update(dt);
	viewAtHome = view.isDefault;
	if (settings.ui) updateViewPill();
	placeVirtualCursor(); // keeps the ring glued to its cell while the view glides
	renderer.upload(life);
	renderer.render(life, {
		t: acc,
		time: now / 1000,
		settings,
		hueFrom: wipe ? wipe.hueFrom : hue,
		hueTo: wipe ? wipe.hueTo : hue,
		wipe: wipe ? { geom: wipe.geom, progress: wipe.progress } : null,
		view,
	});
	updateStats(dt);
	requestAnimationFrame(frame);
}

resize();
reseed(); // the first world sweeps in like any other
requestAnimationFrame(frame);

// Exposed for debugging from the console.
Object.assign(window, { life: () => life, settings, panel });
