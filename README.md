# Life wallpaper

Conway's Game of Life as a full-screen, self-running "living wallpaper" — built for stream scenes (Starting Soon / BRB) but happy anywhere a browser can go.

**Live:** https://oldstarchy.github.io/game-of-life/

- Fills the viewport on a wrap-around (toroidal) board.
- Runs unattended: when the world settles into a loop or goes quiet it pauses briefly, then a fresh world sweeps in.
- Every setting lives in the query string, so a configured look is just a URL.
- Move the mouse (or press any key) to open the settings panel; it slides away after a few idle seconds and the cursor hides.

## Using it in OBS

Add a **Browser** source, paste your URL, and set the width/height to your canvas size (e.g. 1920×1080). Nothing ever shows except the wallpaper unless someone interacts with the source.

To make a link that never shows the panel at all, add `ui=0`.

## Controls

| Input | Action |
| --- | --- |
| Drag on the background | Draw cells (Shift-drag or right-drag erases) |
| <kbd>Space</kbd> | Pause / resume |
| <kbd>S</kbd> or <kbd>.</kbd> | Step one generation (pauses first) |
| <kbd>R</kbd> | New world |
| <kbd>C</kbd> | Clear the board |
| <kbd>H</kbd> / double-click | Hide / bring back the panel |
| Scroll wheel / pinch | Zoom around the pointer (25%–1600%) |
| Middle-drag (or drag when drawing is off), two-finger drag | Pan |
| <kbd>+</kbd> <kbd>−</kbd> / arrow keys / <kbd>0</kbd> | Zoom / pan / reset the view |
| Middle-click a control | Reset it to its default (on a pool, a row resets that option and the heading resets the whole pool; the pattern list is never cleared this way) |

While you drag, the mouse is captured (Pointer Lock) and a ring stands in for the cursor: on a wrapping world a stroke carries on from the opposite edge when it crosses the border (when the whole world width is on screen; zoomed in, it stops at the screen edge), and in a bordered world it stops on the border ring (so you can draw border cells). When you let go, the cursor reappears where the drag started. Turn this off with **Capture the mouse while dragging** under Overlay.

The view (zoom and pan) is never saved in links. With a fixed world size the default view centres the board (a wrapping world tiles around it); **Reset view** returns there. With wrap-around edges you can pan forever; in a bordered world the border ring is drawn just outside the edge and everything beyond it is dimmed. A **Reset view** pill appears at the top while the view isn't the default (it hides with the cursor).

After drawing, Clear or Show, automatic restarts hold off for 30 seconds so your creation gets a chance to run. Switch off **Pause restarts for 30 s after drawing** (under Reseeding) when you're testing the boredom settings; that toggle isn't saved in the link and resets on reload.

## Custom patterns

Switch on **My patterns** under **New worlds start from** (on its own, or weighted against the soups), then add patterns in any of three ways:

- **Library:** glider, lightweight spaceship, R-pentomino, acorn, diehard, rabbits, Gosper glider gun, pulsar, pentadecathlon, and a 7-cell line that settles into a honey farm.
- **Paste:** RLE (as on LifeWiki or from Golly, header optional) or plaintext `.cells` (`.` and `O` rows).
- **Capture the board:** press Pause, Clear, drag on the background to draw (Step lets you check how it evolves), then Capture. The live cells are trimmed to their bounding box.

Each new world from **My patterns** stamps copies of your patterns according to the placement settings. **Show** next to a pattern starts a world from just that pattern straight away and holds off automatic restarts for 30 seconds, which is handy for testing (it keeps the board paused if you were paused, so you can Step through it). Patterns are stored in the link as compact RLE, so a shared URL carries them too.

## Weighted pools

**New worlds start from** and **Transitions** are pools rather than single choices. Switch each option on or off and set its weight (1–10); the panel shows the resulting chance of each. The last option still on can't be switched off. Links from older versions using `pattern=` / `transition=` still work.

## URL parameters

Only values that differ from the defaults are written into the link. Colours are hex without `#`.

| Key | Default | Meaning |
| --- | --- | --- |
| `bg` `young` `old` `trailColor` `gridColor` | Aurora palette | Background, newborn cells, old cells, trails, grid lines |
| `colorMode` | `age` | `age` (newborn → old), `rainbow`, `solid` |
| `ageSpan` | `60` | Generations for a cell to reach the "old" colour |
| `hueSpeed` / `hueSpread` | `12` / `0.6` | Rainbow drift (°/s) and how much hue varies across the screen |
| `paletteShift` | `0` | Rotate the palette's hue with every reseed |
| `cell` | `10` | Cell size in CSS pixels (2–48) |
| `gap` | `0.12` | Gap between cells as a fraction of a cell |
| `shape` | `rounded` | `square`, `rounded`, `circle`, `diamond` |
| `worldSize` | `window` | `window` (as many cells as fit the window) or `fixed` |
| `worldW` / `worldH` | `192` / `108` | World size in cells when `worldSize=fixed` (8–2000 each; over ~1M cells can slow down when busy) |
| `edges` | `wrap` | `wrap` (torus) or `bordered`: the world is ringed by border cells that count as neighbours but never change by themselves (old `walls` links load as a dead border) |
| `borderFill` | `dead` | Bordered worlds: reset the whole border ring to `dead` or `alive`. Draw just outside the edge to switch single border cells; they persist through new worlds |
| `clampCursor` | `0` | Wrapping worlds, mouse captured: stop the cursor at the world's edge instead of wrapping
| `gridAlpha` | `0.25` | Grid line strength |
| `speed` | `12` | Generations per second |
| `smooth` | `1` | Fade cells in/out between generations |
| `pop` | `0.5` | How much cells grow when born and shrink when dying |
| `trail` | `24` | Trail length in generations (0 = off) |
| `glow` / `glowRadius` | `0.9` / `2.5` | Bloom strength and spread (cells) |
| `aberration` | `0.25` | Colour fringing on the bloom |
| `vignette` `scanlines` `grain` | `0.55` `0` `0.15` | Screen effects |
| `seeds` | `random:1,clusters:1,symmetric:1,custom:1` | Weighted pool each new world is drawn from: `random`, `clusters`, `symmetric` (kaleidoscope), `custom` (your patterns; skipped while you have none). Omitted options are off |
| `density` | `0.28` | Soup density: share of cells alive at the start of Random soup / Clusters / Kaleidoscope (clusters and kaleidoscope are denser inside their shapes) |
| `rle` | — | A custom pattern in RLE; repeat the key for several (`&rle=bo$2bo$3o!&rle=...`) |
| `customLayout` | `scatter` | `centre` (one copy), `scatter`, `grid` |
| `customAmount` | `count` | For `scatter` / `grid`: `count` (fixed number) or `area` (scales with the screen) |
| `customCopies` | `6` | Copies per world when `customAmount=count` (1–200); each copy picks one of your patterns |
| `customPerArea` | `3` | Copies per 100×100 cells when `customAmount=area` (a 1080p screen at 10 px cells is ~2 areas) |
| `customTransform` | `1` | Randomly rotate and mirror each copy |
| `customSoup` | `0` | Density of random cells around the patterns |
| `transitions` | `swipe:1,diagonal:1,radial:1` | Weighted pool of reseed transitions: `swipe`, `diagonal`, `radial`, `instant` |
| `transitionTime` | `2.5` | Seconds for the reseed sweep |
| `autoRestart` | `1` | `0`: never restart on its own (loops, quiet, time limit); only **New world** does |
| `boredom` | `2` | Restart when fresh births drop below this per 10k cells per generation (0 = only exact loops) |
| `linger` | `3` | Seconds to hold a settled world before restarting |
| `maxMinutes` | `0` | Force a restart at least this often (0 = never) |
| `seed` | — | Fixed random seed; the same seed gives the same sequence of worlds |
| `stats` | `0` | Show generation, population, fps, how bored the watchdog is (`threshold ÷ activity`, 100% = restart), and why/when the next restart happens |
| `showUrl` | `0` | Show the site address (without your settings) in the bottom-right corner |
| `draw` | `1` | `0`: clicking and dragging the background doesn't draw or erase |
| `captureMouse` | `1` | Lock the mouse while dragging: strokes wrap across the world's edge (or stop on the border ring), pans never run out of screen |
| `ui` | `1` | `0` disables the panel and drawing entirely |

## How it works

- **Simulation** (`src/life.ts`) — a three-row rolling scan: each row keeps a sliding window of three vertical column sums, so a neighbour count costs one new column sum. It's sparse per row: only the span of columns that changed last generation (plus a one-cell margin, and the rows above and below) is rescanned, so settled regions cost nothing.
- **Loop detection** — a Zobrist hash, updated incrementally on each flip, catches exact cycles up to period 256 (still lifes, blinkers, pulsars). A lone glider on a torus repeats far too slowly for that, so a second signal counts *fresh births*: births in cells that haven't been alive in the last 30 generations. Oscillators score zero; when the smoothed rate falls below `boredom`, the world is considered done (`src/watchdog.ts`).
- **Reseeding** (`src/wipe.ts`) — cells are bucket-sorted by when the sweep reaches them, so the new seed is stamped in behind a glowing edge while both worlds keep evolving.
- **Rendering** (`src/renderer.ts`) — WebGL2. The CPU only uploads changed rows of an `[alive, birthGen, deathGen]` texture; fades, ageing and trails are derived on the GPU from those stamps. Bloom is a separable blur at cell resolution, which keeps it cheap at any screen size.

## Development

```sh
npm install
npm run dev     # local dev server
npm test        # simulation tests (checked against a naive implementation)
npm run build   # typecheck + production build into dist/
```

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.
