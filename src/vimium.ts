/**
 * Vimium (and forks that keep its stylesheet) injects CSS into every page that sets
 * `--vimium-background-color` on :root. Its default bindings take over two of our
 * keys: h (scroll left) and r (reload the page!).
 *
 * The stylesheet is injected even on pages excluded in Vimium's settings, so this
 * can only say "Vimium is installed", not "Vimium is intercepting keys here".
 */
export function vimiumPresent(): boolean {
	try {
		return getComputedStyle(document.documentElement).getPropertyValue('--vimium-background-color').trim() !== '';
	} catch {
		return false;
	}
}

const DISMISS_KEY = 'life-wallpaper:vimium-notice-dismissed';

export function vimiumNoticeDismissed(): boolean {
	try {
		return localStorage.getItem(DISMISS_KEY) === '1';
	} catch {
		return false;
	}
}

export function dismissVimiumNotice(): void {
	try {
		localStorage.setItem(DISMISS_KEY, '1');
	} catch {
		/* storage unavailable: it will just show again next time */
	}
}
