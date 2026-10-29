import { captureBoard, LIBRARY, parsePattern, population, toRle, type Pattern } from './patterns';
import { dismissVimiumNotice, vimiumNoticeDismissed, vimiumPresent } from './vimium';
import { DEFAULTS, PRESETS, SECTIONS, serializeSettings, type Field, type Settings } from './settings';

export interface PanelActions {
	restart(): void;
	togglePause(): boolean;
	/** Pause (if running) and advance exactly one generation. */
	step(): void;
	clear(): void;
	board(): { cells: Uint8Array; w: number; h: number };
	/** Immediately start a world from just this pattern (using the placement settings). */
	showPattern(rle: string): void;
	changed(key: keyof Settings): void;
}

const IDLE_MS = 4000;

/**
 * Settings drawer. Hidden until the viewer moves the mouse, touches or presses a
 * key; slides away again after a few idle seconds (unless hovered or focused),
 * so an unattended stream overlay never shows it.
 */
export class Panel {
	readonly el: HTMLElement;
	private inputs = new Map<keyof Settings, { sync(): void }>();
	private conditional: { el: HTMLElement; when: (s: Settings) => boolean }[] = [];
	/** Views that depend on other settings (e.g. pool percentages), refreshed after every change. */
	private dynamic: (() => void)[] = [];
	private scrollEl!: HTMLElement;
	/** Bottom spacer that absorbs content collapsing below the viewport, so the panel never jumps. */
	private overscroll!: HTMLElement;
	/** Scroll position captured when a section header is pressed, before it collapses. */
	private savedTop: number | null = null;
	private hideTimer = 0;
	private suppressed = false;
	private visible = false;
	private pauseBtn!: HTMLButtonElement;
	private shareInput!: HTMLInputElement;
	private toast: HTMLElement;
	/** Vimium is installed: H and R may never reach the page. */
	private readonly vimium = vimiumPresent();

	constructor(
		private settings: Settings,
		private actions: PanelActions,
	) {
		this.el = document.createElement('aside');
		this.el.className = 'panel';
		this.el.setAttribute('aria-label', 'Wallpaper settings');
		this.el.inert = true;
		this.build();
		document.body.append(this.el);

		this.toast = document.createElement('div');
		this.toast.className = 'toast';
		this.toast.setAttribute('role', 'status');
		document.body.append(this.toast);

		const wake = () => this.wake();
		for (const ev of ['pointermove', 'pointerdown', 'wheel', 'touchstart'] as const) window.addEventListener(ev, wake, { passive: true });
		window.addEventListener('keydown', (e) => this.onKey(e));
		window.addEventListener('dblclick', (e) => {
			if (this.suppressed && !this.el.contains(e.target as Node)) {
				this.suppressed = false;
				this.wake();
			}
		});
		this.el.addEventListener('focusin', () => this.wake());
		this.syncAccent();
	}

	// ---- visibility -----------------------------------------------------

	private wake(): void {
		document.body.classList.remove('idle');
		if (!this.suppressed) this.setVisible(true);
		clearTimeout(this.hideTimer);
		this.hideTimer = window.setTimeout(() => this.maybeHide(), IDLE_MS);
	}

	private maybeHide(): void {
		if (this.el.matches(':hover') || this.el.contains(document.activeElement)) {
			this.hideTimer = window.setTimeout(() => this.maybeHide(), IDLE_MS);
			return;
		}
		this.setVisible(false);
		document.body.classList.add('idle');
	}

	private setVisible(v: boolean): void {
		if (v === this.visible) return;
		this.visible = v;
		this.el.classList.toggle('open', v);
		this.el.inert = !v;
		if (v) this.refreshShare();
	}

	close(): void {
		this.suppressed = true;
		this.setVisible(false);
		this.showToast(
			this.vimium ? 'Panel hidden. Double-click the background to bring it back.' : 'Panel hidden. Press H or double-click to bring it back.',
		);
	}

	private onKey(e: KeyboardEvent): void {
		const target = e.target as HTMLElement;
		const typing = target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'url'));
		if (typing) return;
		if (e.key === 'h' || e.key === 'H') {
			if (this.visible) this.close();
			else {
				this.suppressed = false;
				this.wake();
			}
			return;
		}
		if (e.key === 'Escape' && this.visible) return this.close();
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === ' ' && !(target instanceof HTMLButtonElement || target instanceof HTMLSelectElement)) {
			e.preventDefault();
			this.setPaused(this.actions.togglePause());
		} else if (e.key === 's' || e.key === 'S' || e.key === '.') this.step();
		// w is a spare "new world" key: Vimium binds r to reload (but only Shift+W).
		else if (e.key === 'r' || e.key === 'R' || e.key === 'w') this.actions.restart();
		else if (e.key === 'c' || e.key === 'C') this.actions.clear();
		this.wake();
	}

	showToast(msg: string): void {
		this.toast.textContent = msg;
		this.toast.classList.add('show');
		clearTimeout((this.toast as unknown as { t: number }).t);
		(this.toast as unknown as { t: number }).t = window.setTimeout(() => this.toast.classList.remove('show'), 3200);
	}

	// ---- building ---------------------------------------------------------

	private build(): void {
		const head = el('header', 'panel-head');
		const title = el('h1', 'panel-title', 'Life wallpaper');
		const close = button('Close', 'icon-btn', () => this.close());
		close.setAttribute('aria-label', 'Hide panel');
		close.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
		head.append(title, close);

		const actions = el('div', 'actions');
		this.pauseBtn = button('Pause', 'btn', () => this.setPaused(this.actions.togglePause()));
		actions.append(
			button('New world', 'btn btn-primary', () => this.actions.restart()),
			this.pauseBtn,
			button('Step', 'btn', () => this.step()),
			button('Clear', 'btn', () => this.actions.clear()),
		);

		const presets = el('div', 'presets');
		presets.setAttribute('role', 'group');
		presets.setAttribute('aria-label', 'Colour presets');
		for (const p of PRESETS) {
			const b = button(p.name, 'preset', () => this.applyPreset(p.values));
			const v = { ...DEFAULTS, ...p.values };
			const fill = p.values.colorMode === 'rainbow' ? 'linear-gradient(120deg,#ff5f6d,#ffc371,#7cffcb,#5f9dff,#c86bff)' : `linear-gradient(135deg, ${v.young} 0 38%, ${v.old} 62% 100%)`;
			b.style.setProperty('--sw-bg', v.bg);
			b.style.setProperty('--sw-fill', fill);
			b.title = p.name;
			presets.append(b);
		}

		const scroll = el('div', 'panel-scroll');
		this.scrollEl = scroll;
		if (this.vimium && !vimiumNoticeDismissed()) scroll.append(this.vimiumNotice());
		scroll.append(el('p', 'section-label', 'Presets'), presets);
		SECTIONS.forEach((section, idx) => {
			const det = document.createElement('details');
			det.className = 'section';
			if (idx === 0) det.open = true;
			const sum = el('summary', 'section-title', section.title);
			// Collapsing a section near the bottom would otherwise yank the scroll position.
			sum.addEventListener('pointerdown', () => (this.savedTop = scroll.scrollTop));
			sum.addEventListener('keydown', () => (this.savedTop = scroll.scrollTop));
			det.addEventListener('toggle', () => {
				const top = this.savedTop ?? scroll.scrollTop;
				this.savedTop = null;
				this.keepScroll(top);
			});
			det.append(sum);
			const body = el('div', 'section-body');
			for (const f of section.fields) body.append(this.field(f));
			det.append(body);
			scroll.append(det);
		});

		const share = el('div', 'share');
		const shareLabel = el('label', 'field-label', 'Link with these settings');
		shareLabel.setAttribute('for', 'share-url');
		this.shareInput = document.createElement('input');
		this.shareInput.id = 'share-url';
		this.shareInput.type = 'url';
		this.shareInput.readOnly = true;
		this.shareInput.addEventListener('focus', () => this.shareInput.select());
		const copy = button('Copy link', 'btn btn-primary', async () => {
			this.refreshShare();
			try {
				await navigator.clipboard.writeText(this.shareInput.value);
				copy.textContent = 'Copied';
			} catch {
				this.shareInput.select();
				copy.textContent = 'Press Ctrl+C';
			}
			setTimeout(() => (copy.textContent = 'Copy link'), 1800);
		});
		const reset = button('Reset all', 'btn', () => this.applyPreset({ ...DEFAULTS }));
		const shareRow = el('div', 'share-row');
		shareRow.append(this.shareInput, copy);
		share.append(shareLabel, shareRow, reset);

		const keys = el('p', 'keys');
		keys.innerHTML =
			'Drag the background to draw cells, right-drag to erase; hold <kbd>Shift</kbd> for a 3×3 brush. <kbd>Space</kbd> pause · <kbd>S</kbd> step · <kbd>R</kbd> new world · <kbd>C</kbd> clear · <kbd>H</kbd> hide. Middle-click any control to reset it.' +
			(this.vimium ? ' Vimium uses <kbd>H</kbd> and <kbd>R</kbd>: double-click to reopen this panel, <kbd>W</kbd> for a new world.' : '') +
			'<br><br>Scroll to zoom, middle-drag to pan (or just drag when drawing is off), pinch on touch. <kbd>+</kbd> <kbd>−</kbd> zoom · arrows pan · <kbd>0</kbd> resets the view. The view isn’t saved in links.';

		this.overscroll = el('div', 'overscroll');
		this.overscroll.setAttribute('aria-hidden', 'true');
		scroll.append(share, keys, this.overscroll);
		// The spacer only ever shrinks on its own: give the space back as you scroll up.
		scroll.addEventListener('scroll', () => this.trimOverscroll(), { passive: true });
		this.el.append(head, actions, scroll);
	}

	private field(f: Field): HTMLElement {
		const s = this.settings as unknown as Record<string, unknown>;
		const id = `f-${f.key}`;
		const wrap = el('div', `field field-${f.kind}`);
		const label = el('label', 'field-label', f.label);
		label.setAttribute('for', id);
		const commit = (v: unknown) => {
			s[f.key] = v;
			this.actions.changed(f.key);
			if (f.key === 'young') this.syncAccent();
			this.syncVisibility();
			this.refreshShare();
		};

		switch (f.kind) {
			case 'color': {
				const input = document.createElement('input');
				input.type = 'color';
				input.id = id;
				input.addEventListener('input', () => commit(input.value));
				const sync = () => (input.value = String(s[f.key]));
				this.inputs.set(f.key, { sync });
				sync();
				wrap.append(input, label);
				break;
			}
			case 'range': {
				const input = document.createElement('input');
				input.type = 'range';
				input.id = id;
				input.min = String(f.min);
				input.max = String(f.max);
				input.step = String(f.step);
				const out = el('output', 'field-value');
				out.setAttribute('for', id);
				const show = (v: number) => {
					out.textContent = f.format ? f.format(v) : `${+v.toFixed(2)}${f.unit ?? ''}`;
					input.style.setProperty('--fill', `${((v - f.min) / (f.max - f.min)) * 100}%`);
				};
				input.addEventListener('input', () => {
					const v = Number(input.value);
					show(v);
					commit(v);
				});
				const sync = () => {
					input.value = String(s[f.key]);
					show(Number(s[f.key]));
				};
				this.inputs.set(f.key, { sync });
				sync();
				const top = el('div', 'field-top');
				top.append(label, out);
				wrap.append(top, input);
				break;
			}
			case 'select': {
				const sel = document.createElement('select');
				sel.id = id;
				for (const o of f.options) {
					const opt = document.createElement('option');
					opt.value = o;
					opt.textContent = f.labels?.[o] ?? o;
					sel.append(opt);
				}
				sel.addEventListener('change', () => commit(sel.value));
				const sync = () => (sel.value = String(s[f.key]));
				this.inputs.set(f.key, { sync });
				sync();
				wrap.append(label, sel);
				break;
			}
			case 'toggle': {
				const input = document.createElement('input');
				input.type = 'checkbox';
				input.role = 'switch';
				input.id = id;
				input.addEventListener('change', () => commit(input.checked));
				const sync = () => (input.checked = Boolean(s[f.key]));
				this.inputs.set(f.key, { sync });
				sync();
				wrap.append(label, input);
				break;
			}
			case 'weights':
				this.weightsEditor(wrap, label, f, commit);
				break;
			case 'patterns':
				this.patternEditor(wrap, label, commit);
				break;
			case 'text': {
				const input = document.createElement('input');
				input.type = 'text';
				input.id = id;
				input.placeholder = f.placeholder ?? '';
				input.spellcheck = false;
				input.addEventListener('change', () => commit(input.value.trim()));
				const sync = () => (input.value = String(s[f.key]));
				this.inputs.set(f.key, { sync });
				sync();
				wrap.append(label, input);
				break;
			}
		}
		if (f.hint) wrap.append(el('p', 'field-hint', f.hint));
		// Middle-click resets to the default. Not for the pattern list, where it would silently delete work.
		if (f.kind !== 'patterns') {
			onMiddleClick(wrap, () => {
				const d = (DEFAULTS as unknown as Record<string, unknown>)[f.key];
				commit(typeof d === 'object' && d !== null ? { ...d } : d);
				this.inputs.get(f.key)?.sync();
				flash(wrap);
			});
		}
		if (f.when) {
			this.conditional.push({ el: wrap, when: f.when });
			wrap.hidden = !f.when(this.settings);
		}
		return wrap;
	}

	/**
	 * A pool of options, each switched on or off with its own weight. Shows each
	 * option's resulting chance; the last option still on can't be switched off.
	 */
	private weightsEditor(
		wrap: HTMLElement,
		label: HTMLLabelElement,
		f: Extract<Field, { kind: 'weights' }>,
		commit: (v: unknown) => void,
	): void {
		wrap.className = 'field field-weights';
		const heading = el('p', 'field-label', f.label);
		label.replaceWith(heading);
		const group = el('div', 'weight-rows');
		group.setAttribute('role', 'group');
		group.setAttribute('aria-label', f.label);
		const current = () => (this.settings as unknown as Record<string, Record<string, number>>)[f.key];
		const remembered = new Map<string, number>();
		// "My patterns" only counts once there are patterns to draw from.
		const eligible = (k: string) => f.key !== 'seeds' || k !== 'custom' || this.settings.customPatterns.length > 0;

		const rows = f.options.map((opt) => {
			const id = `f-${f.key}-${opt}`;
			const row = el('div', 'weight-row');
			const toggle = document.createElement('input');
			toggle.type = 'checkbox';
			toggle.role = 'switch';
			toggle.id = id;
			const name = el('label', 'weight-name', f.labels[opt] ?? opt);
			name.setAttribute('for', id);
			const slider = document.createElement('input');
			slider.type = 'range';
			slider.min = '1';
			slider.max = String(f.max);
			slider.step = '1';
			slider.setAttribute('aria-label', `${f.labels[opt] ?? opt} weight`);
			const chance = el('output', 'weight-chance');
			const set = (w: number) => commit({ ...current(), [opt]: w });
			toggle.addEventListener('change', () => {
				if (toggle.checked) set(remembered.get(opt) ?? 1);
				else {
					remembered.set(opt, current()[opt]);
					set(0);
				}
			});
			slider.addEventListener('input', () => set(Number(slider.value)));
			// Middle-click a row to reset just that option (the heading resets the whole pool).
			onMiddleClick(row, () => {
				const d = (DEFAULTS as unknown as Record<string, Record<string, number>>)[f.key][opt];
				const next = { ...current(), [opt]: d };
				if (!f.options.some((o) => next[o] > 0 && eligible(o))) return; // would leave nothing to pick
				remembered.delete(opt);
				set(d);
				flash(row);
			});
			row.append(toggle, name, slider, chance);
			group.append(row);
			return { opt, row, toggle, slider, chance };
		});

		const render = () => {
			const w = current();
			const total = f.options.reduce((a, o) => a + (eligible(o) ? w[o] : 0), 0);
			// Lock the last option that can actually be drawn, so the pool never ends up empty.
			const liveCount = f.options.filter((o) => w[o] > 0 && eligible(o)).length;
			for (const r of rows) {
				const on = w[r.opt] > 0;
				r.toggle.checked = on;
				r.toggle.disabled = on && eligible(r.opt) && liveCount === 1;
				r.toggle.title = r.toggle.disabled ? 'At least one option has to stay on' : '';
				r.slider.disabled = !on;
				r.slider.value = String(on ? w[r.opt] : (remembered.get(r.opt) ?? 1));
				r.slider.style.setProperty('--fill', `${((Number(r.slider.value) - 1) / (f.max - 1)) * 100}%`);
				r.row.classList.toggle('off', !on || !eligible(r.opt));
				r.row.title = eligible(r.opt) ? '' : 'Add a pattern below to include My patterns';
				if (!on) r.chance.textContent = 'Off';
				else if (!eligible(r.opt)) r.chance.textContent = '–';
				else r.chance.textContent = total > 0 ? `${Math.round((w[r.opt] / total) * 100)}%` : '';
			}
		};
		this.inputs.set(f.key, { sync: render });
		this.dynamic.push(render);
		wrap.prepend(heading);
		wrap.append(group);
		render();
	}

	/** List of custom seed patterns, plus ways to add them: library, paste, or capture the board. */
	private patternEditor(wrap: HTMLElement, label: HTMLLabelElement, commit: (v: unknown) => void): void {
		wrap.className = 'field field-patterns';
		const list = el('ul', 'pattern-list');
		const empty = el('p', 'field-hint', 'No patterns yet. Pick one from the library, paste one, or draw on the board and capture it.');
		const current = () => this.settings.customPatterns;
		const set = (next: string[]) =>
			this.preserveScroll(() => {
				commit(next);
				render();
			});

		const render = () => {
			list.replaceChildren();
			empty.hidden = current().length > 0;
			current().forEach((rle, i) => {
				const p = parsePattern(rle);
				if (typeof p === 'string') return;
				const known = LIBRARY.find((l) => {
					const lp = parsePattern(l.rle);
					return typeof lp !== 'string' && toRle(lp) === rle;
				});
				const li = el('li', 'pattern-item');
				const text = el('div', 'pattern-text');
				text.append(el('span', 'pattern-name', known?.name ?? 'Custom pattern'), el('span', 'pattern-meta', `${p.w}×${p.h}, ${population(p)} cells`));
				const rm = button('', 'icon-btn', () => set(current().filter((_, j) => j !== i)));
				rm.setAttribute('aria-label', `Remove ${known?.name ?? 'pattern'}`);
				rm.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
				const show = button('Show', 'btn btn-small', () => {
					this.actions.showPattern(rle);
					this.showToast(`Showing ${known?.name ?? 'your pattern'}.${this.settings.holdAfterEdit ? ' Automatic restarts wait 30 seconds.' : ''}`);
				});
				show.setAttribute('aria-label', `Show ${known?.name ?? 'this pattern'} now`);
				li.append(thumbnail(p), text, show, rm);
				list.append(li);
			});
		};
		this.inputs.set('customPatterns', { sync: render });

		const error = el('p', 'field-error');
		error.setAttribute('role', 'alert');
		const add = (rle: string, name: string) => {
			error.textContent = '';
			if (current().includes(rle)) {
				error.textContent = `${name} is already in the list.`;
				return;
			}
			set([...current(), rle]);
			this.showToast(`Added ${name}. Press New world to see it.`);
		};

		const lib = document.createElement('select');
		lib.setAttribute('aria-label', 'Add a pattern from the library');
		lib.append(new Option('Add from library…', ''));
		for (const l of LIBRARY) lib.append(new Option(`${l.name} (${l.note})`, l.name));
		lib.addEventListener('change', () => {
			const l = LIBRARY.find((x) => x.name === lib.value);
			lib.value = '';
			if (!l) return;
			const p = parsePattern(l.rle);
			if (typeof p !== 'string') add(toRle(p), l.name);
		});

		const ta = document.createElement('textarea');
		ta.id = 'f-customPatterns';
		ta.rows = 3;
		ta.spellcheck = false;
		ta.placeholder = 'Paste RLE or plaintext, e.g. bo$2bo$3o!';
		label.setAttribute('for', ta.id);

		const pasteBtn = button('Add pasted', 'btn', () => {
			const p = parsePattern(ta.value);
			if (typeof p === 'string') {
				error.textContent = p;
				return;
			}
			ta.value = '';
			add(toRle(p), 'your pattern');
		});
		const captureBtn = button('Capture the board', 'btn', () => {
			const b = this.actions.board();
			const p = captureBoard(b.cells, b.w, b.h);
			if (!p) {
				error.textContent = 'The board is empty. Press Clear, draw by dragging on the background, then capture.';
				return;
			}
			add(toRle(p), 'the board');
		});
		const row = el('div', 'pattern-actions');
		row.append(pasteBtn, captureBtn);

		const tip = el('p', 'field-hint', 'To design one: Pause, Clear, drag on the background to draw, then Capture the board.');
		wrap.append(label, list, empty, lib, ta, row, error, tip);
		render();
	}

	private applyPreset(values: Partial<Settings>): void {
		const s = this.settings as unknown as Record<string, unknown>;
		for (const [k, v] of Object.entries(values)) {
			if (s[k] === v) continue;
			s[k] = v;
			this.actions.changed(k as keyof Settings);
		}
		for (const i of this.inputs.values()) i.sync();
		this.syncAccent();
		this.syncVisibility();
		this.refreshShare();
	}

	private syncVisibility(): void {
		this.preserveScroll(() => {
			for (const c of this.conditional) c.el.hidden = !c.when(this.settings);
			for (const d of this.dynamic) d();
		});
	}

	/** One-time explanation of the Vimium key clash, with how to fix it. */
	private vimiumNotice(): HTMLElement {
		const box = el('div', 'notice');
		box.setAttribute('role', 'note');
		const title = el('p', 'notice-title', 'Vimium is installed');
		const body = el('p', 'notice-body');
		body.innerHTML =
			'Its shortcuts can catch <kbd>H</kbd> (hide or show this panel) and <kbd>R</kbd> (new world, which Vimium turns into a page reload) before the wallpaper sees them. ' +
			'Until then, double-click the background to reopen this panel and press <kbd>W</kbd> for a new world.';
		const fix = el('p', 'notice-body');
		fix.innerHTML = `To fix it, open Vimium’s options and add an excluded URL: <code>${location.host}${location.pathname.replace(/\/(index\.html)?$/, '')}*</code>. Put <code>hr</code> in that rule’s keys to pass just those two through; leaving the keys blank turns Vimium off on this page.`;
		const ok = button('Got it', 'btn btn-small', () =>
			this.preserveScroll(() => {
				dismissVimiumNotice();
				box.remove();
			}),
		);
		box.append(title, body, fix, ok);
		return box;
	}

	/** Run a layout-changing update without the panel's scroll position moving. */
	private preserveScroll(fn: () => void): void {
		if (!this.scrollEl) return fn();
		const top = this.scrollEl.scrollTop;
		fn();
		this.keepScroll(top);
	}

	/** Grow the spacer just enough that `top` is still a valid scroll position, then restore it. */
	private keepScroll(top: number): void {
		const sc = this.scrollEl;
		const content = sc.scrollHeight - this.overscroll.offsetHeight;
		const need = Math.max(0, Math.ceil(top + sc.clientHeight - content));
		if (need > this.overscroll.offsetHeight) this.overscroll.style.height = `${need}px`;
		sc.scrollTop = top;
	}

	private trimOverscroll(): void {
		const sc = this.scrollEl;
		const cur = this.overscroll.offsetHeight;
		if (!cur) return;
		const content = sc.scrollHeight - cur;
		const need = Math.max(0, Math.ceil(sc.scrollTop + sc.clientHeight - content));
		if (need < cur) this.overscroll.style.height = `${need}px`;
	}

	private step(): void {
		this.actions.step();
		this.setPaused(true);
	}

	private setPaused(paused: boolean): void {
		this.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
		this.pauseBtn.setAttribute('aria-pressed', String(paused));
	}

	private syncAccent(): void {
		document.documentElement.style.setProperty('--accent', this.settings.young);
	}

	/** Re-read every control from the settings (after the app changed some itself). */
	sync(): void {
		for (const i of this.inputs.values()) i.sync();
		this.syncVisibility();
		this.refreshShare();
	}

	refreshShare(): void {
		this.shareInput.value = `${location.origin}${location.pathname}${serializeSettings(this.settings)}`;
	}
}

/** Run `fn` on middle-click, without triggering the browser's autoscroll or reaching parent handlers. */
function onMiddleClick(target: HTMLElement, fn: () => void): void {
	target.addEventListener('mousedown', (e) => {
		if (e.button === 1) e.preventDefault();
	});
	target.addEventListener('auxclick', (e) => {
		if (e.button !== 1) return;
		e.preventDefault();
		e.stopPropagation();
		fn();
	});
}

/** Brief highlight so a reset is noticeable even when the value was off-screen in your head. */
function flash(target: HTMLElement): void {
	target.classList.remove('flash');
	void target.offsetWidth; // restart the animation
	target.classList.add('flash');
	target.addEventListener('animationend', () => target.classList.remove('flash'), { once: true });
}

/** Small preview of a pattern, drawn in the current accent colour. */
function thumbnail(p: Pattern): HTMLCanvasElement {
	const W = 56;
	const H = 40;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	const c = document.createElement('canvas');
	c.className = 'pattern-thumb';
	c.width = W * dpr;
	c.height = H * dpr;
	c.setAttribute('aria-hidden', 'true');
	const ctx = c.getContext('2d')!;
	const size = Math.min((W - 6) / p.w, (H - 6) / p.h, 6) * dpr;
	const ox = (c.width - p.w * size) / 2;
	const oy = (c.height - p.h * size) / 2;
	ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#8ff7ff';
	const gap = size > 3 ? size * 0.15 : 0;
	for (let y = 0; y < p.h; y++)
		for (let x = 0; x < p.w; x++) if (p.cells[y * p.w + x]) ctx.fillRect(ox + x * size, oy + y * size, size - gap, size - gap);
	return c;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	e.className = cls;
	if (text) e.textContent = text;
	return e;
}

function button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
	const b = el('button', cls, text);
	b.type = 'button';
	b.addEventListener('click', onClick);
	return b;
}
