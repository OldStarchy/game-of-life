import { hexToRgb, hueRotate, type RGB } from './color';
import type { Life } from './life';
import type { Settings } from './settings';
import { cellsPerT, type WipeGeom } from './wipe';

/**
 * WebGL2 renderer, three stages:
 *  1. cell pass   — one fragment per cell. Reads [alive, birthGen, deathGen] and
 *                   resolves fade in/out, age colour, rainbow hue and trails into
 *                   a small RGBA8 texture (rgb = colour, a = "aliveness").
 *  2. glow pass   — separable gaussian blur of that texture, still at cell
 *                   resolution, so bloom costs almost nothing even full screen.
 *  3. composite   — per screen pixel: cell shape SDF, grid lines, bloom with
 *                   colour fringing, the reseed wipe edge, vignette, scanlines
 *                   and grain.
 */

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
	vUv = aPos * 0.5 + 0.5;
	gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
vec3 hueRotate(vec3 c, float turns) {
	float y = dot(c, vec3(0.299, 0.587, 0.114));
	float i = dot(c, vec3(0.596, -0.274, -0.322));
	float q = dot(c, vec3(0.211, -0.523, 0.312));
	float a = turns * 6.28318530718;
	float ci = i * cos(a) - q * sin(a);
	float cq = i * sin(a) + q * cos(a);
	return vec3(y + 0.956 * ci + 0.621 * cq, y - 0.272 * ci - 0.647 * cq, y - 1.106 * ci + 1.703 * cq);
}
vec3 hsv(float h, float s, float v) {
	vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
	return v * mix(vec3(1.0), k, s);
}
uniform int uWipeOn;
uniform vec4 uWipe;      // mode, vx, vy, off
uniform vec3 uWipe2;     // scale, progress, cellsPerT
float wipeT(vec2 p) {
	if (uWipe.x < 0.5) return (dot(p, uWipe.yz) - uWipe.w) * uWipe2.x;
	return length(p - uWipe.yz) * uWipe2.x;
}
`;

const CELL_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uState;
uniform uint uGen;
uniform float uT;
uniform float uAgeSpan;
uniform float uTrail;
uniform vec3 uYoung;
uniform vec3 uOld;
uniform vec3 uTrailColor;
uniform int uMode;
uniform float uHue;
uniform float uHueSpread;
uniform vec2 uGrid;
uniform float uHueFrom;
uniform float uHueTo;
out vec4 outColor;
${COMMON}
void main() {
	ivec2 p = ivec2(gl_FragCoord.xy);
	uvec4 s = texelFetch(uState, p, 0);
	float relB = float((uGen - s.g) & 0xffffu);
	float relD = float((uGen - s.b) & 0xffffu);
	bool alive = s.r == 1u;

	float a = alive ? clamp(relB + uT, 0.0, 1.0) : 1.0 - clamp(relD + uT, 0.0, 1.0);
	float trail = 0.0;
	if (!alive && uTrail > 0.0) {
		float k = clamp(1.0 - (relD + uT) / uTrail, 0.0, 1.0);
		trail = k * k;
	}
	if (a <= 0.0 && trail <= 0.0) { outColor = vec4(0.0); return; }

	// Age at this moment, or at the moment of death for a fading cell.
	float age = alive ? relB + uT : max(relB - relD, 0.0);
	float ageK = smoothstep(0.0, uAgeSpan, age);

	vec2 cell = vec2(p) + 0.5;
	float hueShift = uHueTo;
	if (uWipeOn == 1 && wipeT(cell) > uWipe2.y) hueShift = uHueFrom;

	vec3 col;
	if (uMode == 1) {
		float h = uHue + hueShift + (cell.x / uGrid.x + 0.6 * cell.y / uGrid.y) * uHueSpread + ageK * 0.08;
		col = mix(hsv(h, 0.72, 1.0) * uYoung, hsv(h + 0.05, 0.85, 0.75) * uOld, ageK * 0.6);
	} else {
		col = uMode == 0 ? mix(uYoung, uOld, ageK) : uYoung;
		col = hueRotate(col, hueShift);
	}
	// Brief flash on birth.
	col += vec3(0.35) * (1.0 - clamp(age, 0.0, 1.0)) * float(alive);
	vec3 tc = hueRotate(uTrailColor, uMode == 1 ? 0.0 : hueShift);
	if (uMode == 1) tc = mix(tc, col * 0.6, 0.5);

	vec3 rgb = col * a + tc * trail * (1.0 - a);
	outColor = vec4(clamp(rgb, 0.0, 1.0), a);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;
void main() {
	// 9 taps, sigma ≈ 2 taps.
	const float w0 = 0.2042, w1 = 0.1802, w2 = 0.1238, w3 = 0.0663, w4 = 0.0276;
	vec4 c = texture(uSrc, vUv) * w0;
	c += (texture(uSrc, vUv + uStep) + texture(uSrc, vUv - uStep)) * w1;
	c += (texture(uSrc, vUv + 2.0 * uStep) + texture(uSrc, vUv - 2.0 * uStep)) * w2;
	c += (texture(uSrc, vUv + 3.0 * uStep) + texture(uSrc, vUv - 3.0 * uStep)) * w3;
	c += (texture(uSrc, vUv + 4.0 * uStep) + texture(uSrc, vUv - 4.0 * uStep)) * w4;
	outColor = c;
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uCells;
uniform sampler2D uGlowTex;
uniform vec2 uRes;
uniform vec2 uGrid;
uniform float uCellPx;
uniform float uGap;
uniform int uShape;
uniform float uPop;
uniform vec3 uBg;
uniform vec3 uGridColor;
uniform float uGridAlpha;
uniform float uGlow;
uniform float uAberration;
uniform float uVignette;
uniform float uScanlines;
uniform float uGrain;
uniform float uTime;
uniform vec3 uEdge;
out vec4 outColor;
${COMMON}
float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float shapeSdf(vec2 lp, float half_) {
	vec2 q = abs(lp);
	if (uShape == 0) return max(q.x, q.y) - half_;
	if (uShape == 1) {
		float r = half_ * 0.45;
		vec2 d = q - vec2(half_ - r);
		return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
	}
	if (uShape == 2) return length(lp) - half_;
	return (q.x + q.y) * 0.7071 - half_ * 0.82;
}
void main() {
	vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
	vec2 g = frag / uCellPx;
	ivec2 ci = clamp(ivec2(floor(g)), ivec2(0), ivec2(uGrid) - 1);
	vec2 lp = fract(g) - 0.5;
	float px = 1.0 / uCellPx;

	vec4 c = texelFetch(uCells, ci, 0);
	vec3 col = uBg;

	// Grid lines, faded out when cells get too small to read them.
	float edgeDist = 0.5 - max(abs(lp.x), abs(lp.y));
	float line = 1.0 - smoothstep(0.0, px, edgeDist);
	col = mix(col, uGridColor, line * uGridAlpha * smoothstep(3.0, 7.0, uCellPx));

	float scale = mix(1.0, 0.25 + 0.75 * c.a, uPop);
	float half_ = 0.5 * (1.0 - uGap) * scale;
	float d = shapeSdf(lp, half_);
	float mask = 1.0 - smoothstep(-0.5 * px, 0.5 * px, d);
	col += c.rgb * mask;

	// Bloom from the blurred cell texture, with radial colour fringing.
	vec2 uv = g / uGrid;
	vec2 off = (frag / uRes - 0.5) * uAberration * (6.0 / uGrid);
	vec3 bloom = vec3(texture(uGlowTex, uv + off).r, texture(uGlowTex, uv).g, texture(uGlowTex, uv - off).b);
	col += bloom * uGlow * (1.0 - 0.5 * mask);

	// Leading edge of a reseed wipe.
	if (uWipeOn == 1) {
		float dist = (wipeT(g) - uWipe2.y) * uWipe2.z; // in cells; >0 ahead of the edge
		float width = dist > 0.0 ? 1.2 : 4.0;
		float e = exp(-dist * dist / (width * width));
		col += uEdge * e * 0.9;
		col += uEdge * 0.06 * smoothstep(0.0, -18.0, dist) * exp(dist / 30.0); // faint afterglow behind it
	}

	vec2 v = frag / uRes - 0.5;
	v.x *= uRes.x / uRes.y;
	col *= 1.0 - uVignette * smoothstep(0.25, 1.05, length(v));

	col *= 1.0 - uScanlines * 0.45 * (0.5 + 0.5 * cos(frag.y * 3.14159265));

	col += (hash12(frag + fract(uTime * 7.13) * 917.0) - 0.5) * uGrain * 0.08;

	outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export interface FrameParams {
	/** 0..1 progress from the previous generation to the current one. */
	t: number;
	time: number;
	settings: Settings;
	hueFrom: number;
	hueTo: number;
	wipe: { geom: WipeGeom; progress: number } | null;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

export class Renderer {
	readonly gl: WebGL2RenderingContext;
	private cellProg: WebGLProgram;
	private blurProg: WebGLProgram;
	private compProg: WebGLProgram;
	private u: { cell: Uniforms; blur: Uniforms; comp: Uniforms };
	private vao: WebGLVertexArrayObject;
	private stateTex: WebGLTexture | null = null;
	private cellTex: WebGLTexture | null = null;
	private blurA: WebGLTexture | null = null;
	private blurB: WebGLTexture | null = null;
	private fbCell: WebGLFramebuffer | null = null;
	private fbA: WebGLFramebuffer | null = null;
	private fbB: WebGLFramebuffer | null = null;
	private gw = 0;
	private gh = 0;

	constructor(readonly canvas: HTMLCanvasElement) {
		const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
		if (!gl) throw new Error('WebGL2 is not available in this browser.');
		this.gl = gl;
		this.cellProg = this.program(CELL_FRAG);
		this.blurProg = this.program(BLUR_FRAG);
		this.compProg = this.program(COMPOSITE_FRAG);
		this.u = { cell: this.uniforms(this.cellProg), blur: this.uniforms(this.blurProg), comp: this.uniforms(this.compProg) };

		this.vao = gl.createVertexArray()!;
		gl.bindVertexArray(this.vao);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		for (const p of [this.cellProg, this.blurProg, this.compProg]) {
			const loc = gl.getAttribLocation(p, 'aPos');
			if (loc >= 0) {
				gl.enableVertexAttribArray(loc);
				gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
			}
		}
	}

	private program(frag: string): WebGLProgram {
		const gl = this.gl;
		const compile = (type: number, src: string) => {
			const s = gl.createShader(type)!;
			gl.shaderSource(s, src);
			gl.compileShader(s);
			if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
			return s;
		};
		const p = gl.createProgram()!;
		gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
		gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
		gl.bindAttribLocation(p, 0, 'aPos');
		gl.linkProgram(p);
		if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
		return p;
	}

	private uniforms(p: WebGLProgram): Uniforms {
		const gl = this.gl;
		const out: Uniforms = {};
		const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
		for (let i = 0; i < n; i++) {
			const info = gl.getActiveUniform(p, i)!;
			out[info.name] = gl.getUniformLocation(p, info.name);
		}
		return out;
	}

	private texture(w: number, h: number, internal: number, format: number, type: number, filter: number): WebGLTexture {
		const gl = this.gl;
		const t = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, t);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
		gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
		return t;
	}

	private framebuffer(tex: WebGLTexture): WebGLFramebuffer {
		const gl = this.gl;
		const fb = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
		return fb;
	}

	/**
	 * Wrap the glow around the screen edges (torus) or clamp it (walls), so light
	 * from one edge doesn't leak onto the opposite side.
	 */
	setWrap(wrap: boolean): void {
		const gl = this.gl;
		const mode = wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE;
		for (const t of [this.cellTex, this.blurA, this.blurB]) {
			if (!t) continue;
			gl.bindTexture(gl.TEXTURE_2D, t);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
		}
	}

	/** (Re)allocate GPU resources for a board of the given size. */
	setGrid(w: number, h: number, wrap = true): void {
		const gl = this.gl;
		for (const t of [this.stateTex, this.cellTex, this.blurA, this.blurB]) if (t) gl.deleteTexture(t);
		for (const f of [this.fbCell, this.fbA, this.fbB]) if (f) gl.deleteFramebuffer(f);
		this.gw = w;
		this.gh = h;
		this.stateTex = this.texture(w, h, gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, gl.NEAREST);
		this.cellTex = this.texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
		this.blurA = this.texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
		this.blurB = this.texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
		this.fbCell = this.framebuffer(this.cellTex);
		this.fbA = this.framebuffer(this.blurA);
		this.fbB = this.framebuffer(this.blurB);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.setWrap(wrap);
	}

	/** Upload changed rows of the board, coalescing consecutive dirty rows. */
	upload(life: Life): void {
		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		const { w, h, gpu, gpuDirty } = life;
		if (life.gpuAllDirty) {
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, gpu);
			gpuDirty.fill(0);
			life.gpuAllDirty = false;
			return;
		}
		let y = 0;
		while (y < h) {
			if (!gpuDirty[y]) {
				y++;
				continue;
			}
			const start = y;
			while (y < h && gpuDirty[y]) gpuDirty[y++] = 0;
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, start, w, y - start, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, gpu, start * w * 4);
		}
	}

	render(life: Life, f: FrameParams): void {
		const gl = this.gl;
		const s = f.settings;
		const { cell: uc, blur: ub, comp: up } = this.u;
		gl.bindVertexArray(this.vao);

		const wipe = f.wipe;
		const setWipe = (u: Uniforms) => {
			gl.uniform1i(u.uWipeOn, wipe ? 1 : 0);
			if (wipe) {
				const g = wipe.geom;
				gl.uniform4f(u.uWipe, g.mode, g.vx, g.vy, g.off);
				gl.uniform3f(u.uWipe2, g.scale, wipe.progress, cellsPerT(g));
			}
		};

		// 1. Cells → cellTex
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbCell);
		gl.viewport(0, 0, this.gw, this.gh);
		gl.useProgram(this.cellProg);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
		gl.uniform1i(uc.uState, 0);
		gl.uniform1ui(uc.uGen, life.g16);
		gl.uniform1f(uc.uT, s.smooth ? f.t : 1);
		gl.uniform1f(uc.uAgeSpan, s.ageSpan);
		gl.uniform1f(uc.uTrail, s.trail);
		gl.uniform3fv(uc.uYoung, hexToRgb(s.young));
		gl.uniform3fv(uc.uOld, hexToRgb(s.old));
		gl.uniform3fv(uc.uTrailColor, hexToRgb(s.trailColor));
		gl.uniform1i(uc.uMode, s.colorMode === 'age' ? 0 : s.colorMode === 'rainbow' ? 1 : 2);
		gl.uniform1f(uc.uHue, s.colorMode === 'rainbow' ? (f.time * s.hueSpeed) / 360 : 0);
		gl.uniform1f(uc.uHueSpread, s.hueSpread);
		gl.uniform2f(uc.uGrid, this.gw, this.gh);
		gl.uniform1f(uc.uHueFrom, f.hueFrom);
		gl.uniform1f(uc.uHueTo, f.hueTo);
		setWipe(uc);
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		// 2. Blur cellTex → blurA (horizontal) → blurB (vertical)
		gl.useProgram(this.blurProg);
		const spacing = s.glowRadius / 4;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA);
		gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
		gl.uniform1i(ub.uSrc, 0);
		gl.uniform2f(ub.uStep, spacing / this.gw, 0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
		gl.bindTexture(gl.TEXTURE_2D, this.blurA);
		gl.uniform2f(ub.uStep, 0, spacing / this.gh);
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		// 3. Composite to screen
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.useProgram(this.compProg);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
		gl.uniform1i(up.uCells, 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.blurB);
		gl.uniform1i(up.uGlowTex, 1);
		gl.activeTexture(gl.TEXTURE0);
		const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
		gl.uniform2f(up.uRes, this.canvas.width, this.canvas.height);
		gl.uniform2f(up.uGrid, this.gw, this.gh);
		gl.uniform1f(up.uCellPx, s.cell * dpr);
		gl.uniform1f(up.uGap, s.gap);
		gl.uniform1i(up.uShape, ['square', 'rounded', 'circle', 'diamond'].indexOf(s.shape));
		gl.uniform1f(up.uPop, s.pop);
		gl.uniform3fv(up.uBg, hexToRgb(s.bg));
		gl.uniform3fv(up.uGridColor, hexToRgb(s.gridColor));
		gl.uniform1f(up.uGridAlpha, s.gridAlpha);
		gl.uniform1f(up.uGlow, s.glow);
		gl.uniform1f(up.uAberration, s.aberration);
		gl.uniform1f(up.uVignette, s.vignette);
		gl.uniform1f(up.uScanlines, s.scanlines);
		gl.uniform1f(up.uGrain, s.grain);
		gl.uniform1f(up.uTime, f.time);
		const edge: RGB = hueRotate(hexToRgb(s.young), s.colorMode === 'rainbow' ? 0 : f.hueTo);
		gl.uniform3f(up.uEdge, edge[0] * 0.6 + 0.4, edge[1] * 0.6 + 0.4, edge[2] * 0.6 + 0.4);
		setWipe(up);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}
}
