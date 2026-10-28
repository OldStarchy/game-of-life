export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
	const n = parseInt(hex.replace('#', ''), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: RGB): string {
	const c = (v: number) =>
		Math.round(Math.min(1, Math.max(0, v)) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${c(r)}${c(g)}${c(b)}`;
}

/** Rotate hue by `turns` (1 = 360°) in YIQ space. Mirrors `hueRotate` in the shaders. */
export function hueRotate([r, g, b]: RGB, turns: number): RGB {
	const y = 0.299 * r + 0.587 * g + 0.114 * b;
	const i = 0.596 * r - 0.274 * g - 0.322 * b;
	const q = 0.211 * r - 0.523 * g + 0.312 * b;
	const a = turns * Math.PI * 2;
	const ci = i * Math.cos(a) - q * Math.sin(a);
	const cq = i * Math.sin(a) + q * Math.cos(a);
	return [y + 0.956 * ci + 0.621 * cq, y - 0.272 * ci - 0.647 * cq, y - 1.106 * ci + 1.703 * cq];
}
