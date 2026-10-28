import { parsePattern, toRle } from './patterns';
import { decodeWeights, encodeWeights, weightsEqual, type Weights } from './pool';
import { CUSTOM_LAYOUTS, SEED_PATTERNS } from './seed';
import { WIPE_STYLES } from './wipe';

export const COLOR_MODES = ['age', 'rainbow', 'solid'] as const;
export const SHAPES = ['square', 'rounded', 'circle', 'diamond'] as const;
export const EDGE_MODES = ['wrap', 'walls'] as const;
export const WORLD_SIZES = ['window', 'fixed'] as const;
export const AMOUNT_MODES = ['count', 'area'] as const;

export interface Settings {
	// Colours
	bg: string;
	young: string;
	old: string;
	trailColor: string;
	gridColor: string;
	colorMode: (typeof COLOR_MODES)[number];
	ageSpan: number;
	hueSpeed: number;
	hueSpread: number;
	paletteShift: boolean;
	// Cells
	cell: number;
	/** 'window': as many cells as fit the window. 'fixed': worldW × worldH cells. */
	worldSize: (typeof WORLD_SIZES)[number];
	worldW: number;
	worldH: number;
	gap: number;
	shape: (typeof SHAPES)[number];
	gridAlpha: number;
	// Motion
	speed: number;
	smooth: boolean;
	pop: number;
	// Effects
	trail: number;
	glow: number;
	glowRadius: number;
	aberration: number;
	vignette: number;
	scanlines: number;
	grain: number;
	// Reseeding
	/** Weighted pool of seed kinds; one is drawn for every new world. */
	seeds: Weights<(typeof SEED_PATTERNS)[number]>;
	density: number;
	/** Compact RLE bodies for the 'custom' seed. */
	customPatterns: string[];
	customLayout: (typeof CUSTOM_LAYOUTS)[number];
	customCopies: number;
	/** How the number of copies is decided for scattered / evenly spaced placement. */
	customAmount: (typeof AMOUNT_MODES)[number];
	/** Copies per 100×100 cells, when customAmount is 'area'. */
	customPerArea: number;
	customTransform: boolean;
	customSoup: number;
	/** Weighted pool of reseed transitions. */
	transitions: Weights<(typeof WIPE_STYLES)[number]>;
	transitionTime: number;
	boredom: number;
	linger: number;
	maxMinutes: number;
	seed: string;
	// Overlay
	ui: boolean;
	stats: boolean;
	/** Worlds restart on their own (loops, quiet, time limit). Off: only New world restarts. */
	autoRestart: boolean;
	edges: (typeof EDGE_MODES)[number];
	/** Clicking and dragging the background draws / erases cells. */
	draw: boolean;
	/** Lock the mouse while dragging, so strokes can wrap at the world border (or stop at walls). */
	captureMouse: boolean;
	/** Show the site's address in the bottom-right corner. */
	showUrl: boolean;
	/** Session-only: pause automatic restarts for a while after drawing, Clear or Show. */
	holdAfterEdit: boolean;
}

export const DEFAULTS: Settings = {
	bg: '#060a12',
	young: '#8ff7ff',
	old: '#7a5cff',
	trailColor: '#1d3fd6',
	gridColor: '#1a2436',
	colorMode: 'age',
	ageSpan: 60,
	hueSpeed: 12,
	hueSpread: 0.6,
	paletteShift: false,
	cell: 10,
	worldSize: 'window',
	worldW: 192,
	worldH: 108,
	gap: 0.12,
	shape: 'rounded',
	gridAlpha: 0.25,
	speed: 12,
	smooth: true,
	pop: 0.5,
	trail: 24,
	glow: 0.9,
	glowRadius: 2.5,
	aberration: 0.25,
	vignette: 0.55,
	scanlines: 0,
	grain: 0.15,
	seeds: { random: 1, clusters: 1, symmetric: 1, custom: 1 },
	density: 0.28,
	customPatterns: [],
	customLayout: 'scatter',
	customCopies: 6,
	customAmount: 'count',
	customPerArea: 3,
	customTransform: true,
	customSoup: 0,
	transitions: { swipe: 1, diagonal: 1, radial: 1, instant: 0 },
	transitionTime: 2.5,
	boredom: 2,
	linger: 3,
	maxMinutes: 0,
	seed: '',
	ui: true,
	stats: false,
	autoRestart: true,
	edges: 'wrap',
	draw: true,
	captureMouse: true,
	showUrl: false,
	holdAfterEdit: true,
};

type Key = keyof Settings;

interface Base<K extends Key> {
	key: K;
	label: string;
	hint?: string;
	/** Never written to or read from the URL; lasts until the page reloads. */
	transient?: boolean;
	/** Only show this field when the predicate holds. */
	when?: (s: Settings) => boolean;
}
export type Field =
	| (Base<Key> & { kind: 'color' })
	| (Base<Key> & { kind: 'range'; min: number; max: number; step: number; unit?: string; format?: (v: number) => string })
	| (Base<Key> & { kind: 'select'; options: readonly string[]; labels?: Record<string, string> })
	| (Base<Key> & { kind: 'toggle' })
	| (Base<Key> & { kind: 'text'; placeholder?: string })
	| (Base<Key> & { kind: 'patterns' })
	| (Base<Key> & { kind: 'weights'; options: readonly string[]; labels: Record<string, string>; max: number });

export interface Section {
	title: string;
	fields: Field[];
}

export const SECTIONS: Section[] = [
	{
		title: 'Colours',
		fields: [
			{ key: 'bg', label: 'Background', kind: 'color' },
			{ key: 'young', label: 'Newborn cells', kind: 'color' },
			{ key: 'old', label: 'Old cells', kind: 'color' },
			{ key: 'trailColor', label: 'Trail', kind: 'color' },
			{ key: 'gridColor', label: 'Grid lines', kind: 'color' },
			{
				key: 'colorMode',
				label: 'Colouring',
				kind: 'select',
				options: COLOR_MODES,
				labels: { age: 'Fade with age', rainbow: 'Rainbow', solid: 'Solid' },
			},
			{ key: 'ageSpan', label: 'Generations to fully age', kind: 'range', min: 2, max: 400, step: 1 },
			{ key: 'hueSpeed', label: 'Rainbow drift', kind: 'range', min: 0, max: 120, step: 1, unit: '°/s' },
			{ key: 'hueSpread', label: 'Rainbow spread', kind: 'range', min: 0, max: 3, step: 0.05 },
			{
				key: 'paletteShift',
				label: 'New hue on every reseed',
				kind: 'toggle',
				hint: 'Rotates the cell colours a little each time the world restarts.',
			},
		],
	},
	{
		title: 'Cells',
		fields: [
			{ key: 'cell', label: 'Cell size', kind: 'range', min: 2, max: 48, step: 1, unit: 'px' },
			{
				key: 'worldSize',
				label: 'World size',
				kind: 'select',
				options: WORLD_SIZES,
				labels: { window: 'Match the window', fixed: 'Fixed' },
				hint: 'Match the window: the world is exactly as many cells as fit on screen. Fixed: you pick the size, then zoom and pan to explore it.',
			},
			{ key: 'worldW', label: 'Width', kind: 'range', min: 8, max: 2000, step: 1, unit: ' cells', when: (s) => s.worldSize === 'fixed' },
			{
				key: 'worldH',
				label: 'Height',
				kind: 'range',
				min: 8,
				max: 2000,
				step: 1,
				unit: ' cells',
				when: (s) => s.worldSize === 'fixed',
				hint: 'Worlds over about a million cells can slow down while they’re busy.',
			},
			{ key: 'gap', label: 'Gap between cells', kind: 'range', min: 0, max: 0.45, step: 0.01, format: pct },
			{
				key: 'shape',
				label: 'Shape',
				kind: 'select',
				options: SHAPES,
				labels: { square: 'Square', rounded: 'Rounded', circle: 'Circle', diamond: 'Diamond' },
			},
			{ key: 'gridAlpha', label: 'Grid lines', kind: 'range', min: 0, max: 1, step: 0.01, format: pct },
			{
				key: 'edges',
				label: 'Screen edges',
				kind: 'select',
				options: EDGE_MODES,
				labels: { wrap: 'Wrap around', walls: 'Walls (always dead)' },
				hint: 'Wrap around: things leaving one side come back on the other. Walls: cells past the edge are always dead.',
			},
		],
	},
	{
		title: 'Motion',
		fields: [
			{ key: 'speed', label: 'Speed', kind: 'range', min: 0.5, max: 60, step: 0.5, unit: ' gen/s' },
			{ key: 'smooth', label: 'Fade between generations', kind: 'toggle' },
			{ key: 'pop', label: 'Grow and shrink', kind: 'range', min: 0, max: 1, step: 0.01, format: pct },
		],
	},
	{
		title: 'Effects',
		fields: [
			{ key: 'trail', label: 'Trail length', kind: 'range', min: 0, max: 200, step: 1, unit: ' gen' },
			{ key: 'glow', label: 'Glow', kind: 'range', min: 0, max: 3, step: 0.05 },
			{ key: 'glowRadius', label: 'Glow spread', kind: 'range', min: 0.5, max: 8, step: 0.1, unit: ' cells' },
			{ key: 'aberration', label: 'Colour fringing', kind: 'range', min: 0, max: 1, step: 0.01, format: pct },
			{ key: 'vignette', label: 'Vignette', kind: 'range', min: 0, max: 1, step: 0.01, format: pct },
			{ key: 'scanlines', label: 'Scanlines', kind: 'range', min: 0, max: 1, step: 0.01, format: pct },
			{ key: 'grain', label: 'Film grain', kind: 'range', min: 0, max: 1, step: 0.01, format: pct },
		],
	},
	{
		title: 'Reseeding',
		fields: [
			{
				key: 'seeds',
				label: 'New worlds start from',
				kind: 'weights',
				options: SEED_PATTERNS,
				labels: { random: 'Random soup', clusters: 'Clusters', symmetric: 'Kaleidoscope', custom: 'My patterns' },
				max: 10,
				hint: 'Each new world picks one of the switched-on options. Higher weights come up more often.',
			},
			{
				key: 'density',
				label: 'Soup density',
				kind: 'range',
				min: 0.03,
				max: 0.7,
				step: 0.01,
				format: pct,
				when: usesSoup,
				hint: 'Share of cells that start alive in the soups. Too few and most die of loneliness; too many and most die of overcrowding.',
			},
			{
				key: 'customPatterns',
				label: 'My patterns',
				kind: 'patterns',
				when: isCustom,
			},
			{
				key: 'customLayout',
				label: 'Placement',
				kind: 'select',
				options: CUSTOM_LAYOUTS,
				labels: { centre: 'One in the centre', scatter: 'Scattered', grid: 'Evenly spaced' },
				when: isCustom,
			},
			{
				key: 'customAmount',
				label: 'Number of copies',
				kind: 'select',
				options: AMOUNT_MODES,
				labels: { count: 'A fixed number', area: 'Based on screen size' },
				when: multiCopy,
			},
			{ key: 'customCopies', label: 'Copies', kind: 'range', min: 1, max: 200, step: 1, when: (s) => multiCopy(s) && s.customAmount === 'count' },
			{
				key: 'customPerArea',
				label: 'Copies per 100×100 cells',
				kind: 'range',
				min: 0.1,
				max: 40,
				step: 0.1,
				when: (s) => multiCopy(s) && s.customAmount === 'area',
				hint: 'A 1080p screen with 10 px cells is about 2 of these areas. Always at least one copy.',
			},
			{ key: 'customTransform', label: 'Randomly rotate and mirror', kind: 'toggle', when: isCustom },
			{
				key: 'customSoup',
				label: 'Random cells around them',
				kind: 'range',
				min: 0,
				max: 0.5,
				step: 0.01,
				format: pct,
				when: isCustom,
			},
			{
				key: 'transitions',
				label: 'Transitions',
				kind: 'weights',
				options: WIPE_STYLES,
				labels: { swipe: 'Swipe', diagonal: 'Diagonal swipe', radial: 'Ripple', instant: 'Instant' },
				max: 10,
			},
			{ key: 'transitionTime', label: 'Transition time', kind: 'range', min: 0.3, max: 10, step: 0.1, unit: ' s', when: usesWipe },
			{
				key: 'autoRestart',
				label: 'Restart automatically',
				kind: 'toggle',
				hint: 'Off: the world only changes when you press New world, so you can play without interruptions.',
			},
			{
				key: 'boredom',
				label: 'Restart when quieter than',
				kind: 'range',
				min: 0,
				max: 20,
				step: 0.1,
				hint: 'New births per 10,000 cells per generation. Higher restarts sooner; 0 only restarts on exact loops.',
				when: autoOn,
			},
			{ key: 'linger', label: 'Hold before restarting', kind: 'range', min: 0, max: 30, step: 0.5, unit: ' s', when: autoOn },
			{
				key: 'holdAfterEdit',
				label: 'Pause restarts for 30 s after drawing',
				kind: 'toggle',
				transient: true,
				hint: 'Also applies after Clear and Show. Not saved in the link; resets when the page reloads.',
				when: autoOn,
			},
			{
				key: 'maxMinutes',
				label: 'Restart at least every',
				kind: 'range',
				min: 0,
				max: 60,
				step: 1,
				format: (v) => (v === 0 ? 'Never' : `${v} min`),
				when: autoOn,
			},
			{
				key: 'seed',
				label: 'Random seed',
				kind: 'text',
				placeholder: 'Blank for a new world each load',
			},
		],
	},
	{
		title: 'Overlay',
		fields: [
			{ key: 'stats', label: 'Show stats', kind: 'toggle' },
			{
				key: 'draw',
				label: 'Draw with the mouse',
				kind: 'toggle',
				hint: 'Off: clicking and dragging the background does nothing. Moving the mouse still opens this panel.',
			},
			{
				key: 'captureMouse',
				label: 'Capture the mouse while dragging',
				kind: 'toggle',
				hint: 'Strokes wrap around the world’s edge (or stop at walls) and pans never run out of screen. The cursor returns to where you started when you let go.',
			},
			{
				key: 'showUrl',
				label: 'Show the site address',
				kind: 'toggle',
				hint: 'Puts the address in the bottom-right corner so viewers can find it. Your settings aren’t included.',
			},
			{
				key: 'ui',
				label: 'Show controls on interaction',
				kind: 'toggle',
				hint: 'Turn off for a link that never shows this panel. Add ?ui=1 to the URL to get it back.',
			},
		],
	},
];

function autoOn(s: Settings): boolean {
	return s.autoRestart;
}
function multiCopy(s: Settings): boolean {
	return isCustom(s) && s.customLayout !== 'centre';
}
function isCustom(s: Settings): boolean {
	return s.seeds.custom > 0;
}
function usesSoup(s: Settings): boolean {
	return s.seeds.random + s.seeds.clusters + s.seeds.symmetric > 0;
}
function usesWipe(s: Settings): boolean {
	return s.transitions.swipe + s.transitions.diagonal + s.transitions.radial > 0;
}

function pct(v: number): string {
	return `${Math.round(v * 100)}%`;
}

export const FIELDS: Field[] = SECTIONS.flatMap((s) => s.fields);

export interface Preset {
	name: string;
	values: Partial<Settings>;
}

export const PRESETS: Preset[] = [
	{ name: 'Aurora', values: { bg: '#060a12', young: '#8ff7ff', old: '#7a5cff', trailColor: '#1d3fd6', gridColor: '#1a2436', colorMode: 'age' } },
	{ name: 'Ember', values: { bg: '#0c0605', young: '#ffd08a', old: '#ff2d55', trailColor: '#6e1408', gridColor: '#24130f', colorMode: 'age' } },
	{ name: 'Phosphor', values: { bg: '#020803', young: '#c8ffb0', old: '#1f9e45', trailColor: '#0d4a1c', gridColor: '#0b1f10', colorMode: 'age' } },
	{ name: 'Synthwave', values: { bg: '#0d0520', young: '#ff7ae0', old: '#5b3bff', trailColor: '#2a0f6b', gridColor: '#221040', colorMode: 'age' } },
	{ name: 'Glacier', values: { bg: '#05090d', young: '#ffffff', old: '#5fa8d3', trailColor: '#123a57', gridColor: '#13202b', colorMode: 'age' } },
	{ name: 'Graphite', values: { bg: '#0a0a0b', young: '#f2f2f2', old: '#5c5c66', trailColor: '#26262c', gridColor: '#1a1a1e', colorMode: 'age' } },
	{ name: 'Prism', values: { bg: '#07070c', young: '#ffffff', old: '#ffffff', trailColor: '#2a2050', gridColor: '#16162a', colorMode: 'rainbow' } },
];

// ---- URL (de)serialisation -------------------------------------------------

function decimals(step: number): number {
	const s = String(step);
	return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
}

export function parseSettings(search: string): Settings {
	const q = new URLSearchParams(search);
	const out: Settings = { ...DEFAULTS };
	const o = out as unknown as Record<string, unknown>;
	for (const f of FIELDS) {
		if (f.kind === 'patterns' || f.transient) continue;
		const raw = q.get(f.key);
		if (raw === null) continue;
		if (f.kind === 'weights') {
			const w = decodeWeights(raw, f.options, f.max);
			if (w) o[f.key] = w;
			continue;
		}
		switch (f.kind) {
			case 'color': {
				const hex = raw.replace(/^#/, '').toLowerCase();
				if (/^[0-9a-f]{6}$/.test(hex)) o[f.key] = `#${hex}`;
				else if (/^[0-9a-f]{3}$/.test(hex)) o[f.key] = `#${hex.replace(/./g, (c) => c + c)}`;
				break;
			}
			case 'range': {
				const n = Number(raw);
				if (Number.isFinite(n)) o[f.key] = Math.min(f.max, Math.max(f.min, n));
				break;
			}
			case 'select':
				if (f.options.includes(raw)) o[f.key] = raw;
				break;
			case 'toggle':
				o[f.key] = raw === '1' || raw === 'true' || raw === '';
				break;
			case 'text':
				o[f.key] = raw.slice(0, 64);
				break;
		}
	}
	// Links from before the weighted pools: ?pattern=custom / ?transition=radial etc.
	const legacyPattern = q.get('pattern');
	if (legacyPattern && !q.has('seeds')) {
		if ((SEED_PATTERNS as readonly string[]).includes(legacyPattern))
			out.seeds = { random: 0, clusters: 0, symmetric: 0, custom: 0, [legacyPattern]: 1 } as Settings['seeds'];
	}
	const legacyTransition = q.get('transition');
	if (legacyTransition && !q.has('transitions')) {
		if ((WIPE_STYLES as readonly string[]).includes(legacyTransition))
			out.transitions = { swipe: 0, diagonal: 0, radial: 0, instant: 0, [legacyTransition]: 1 } as Settings['transitions'];
	}

	// Patterns repeat: ?rle=...&rle=... ; normalised to compact RLE, junk dropped.
	out.customPatterns = q
		.getAll('rle')
		.map((r) => parsePattern(r))
		.flatMap((p) => (typeof p === 'string' ? [] : [toRle(p)]));
	return out;
}

/** Query string containing only the settings that differ from the defaults. */
export function serializeSettings(s: Settings): string {
	const q = new URLSearchParams();
	const o = s as unknown as Record<string, unknown>;
	const d = DEFAULTS as unknown as Record<string, unknown>;
	for (const f of FIELDS) {
		const v = o[f.key];
		if (f.transient) continue;
		if (f.kind === 'patterns') {
			for (const rle of v as string[]) q.append('rle', rle);
			continue;
		}
		if (f.kind === 'weights') {
			if (!weightsEqual(v as Weights<string>, d[f.key] as Weights<string>)) q.set(f.key, encodeWeights(v as Weights<string>));
			continue;
		}
		if (v === d[f.key]) continue;
		switch (f.kind) {
			case 'color':
				q.set(f.key, String(v).replace('#', ''));
				break;
			case 'range': {
				const r = Number((v as number).toFixed(decimals(f.step)));
				if (r !== d[f.key]) q.set(f.key, String(r));
				break;
			}
			case 'toggle':
				q.set(f.key, v ? '1' : '0');
				break;
			default:
				if (v !== '') q.set(f.key, String(v));
		}
	}
	// These are legal unescaped in a query string; leaving them readable keeps RLE and pools legible.
	const str = q.toString().replace(/%(2C|3A|24|21)/g, (m) => decodeURIComponent(m));
	return str ? `?${str}` : '';
}
