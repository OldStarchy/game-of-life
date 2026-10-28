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
| <kbd>R</kbd> | New world |
| <kbd>C</kbd> | Clear the board |
| <kbd>H</kbd> / double-click | Hide / bring back the panel |

After drawing or clearing, automatic restarts hold off for 30 seconds so your creation gets a chance to run.

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
| `gridAlpha` | `0.25` | Grid line strength |
| `speed` | `12` | Generations per second |
| `smooth` | `1` | Fade cells in/out between generations |
| `pop` | `0.5` | How much cells grow when born and shrink when dying |
| `trail` | `24` | Trail length in generations (0 = off) |
| `glow` / `glowRadius` | `0.9` / `2.5` | Bloom strength and spread (cells) |
| `aberration` | `0.25` | Colour fringing on the bloom |
| `vignette` `scanlines` `grain` | `0.55` `0` `0.15` | Screen effects |
| `pattern` | `mixed` | Seed: `random`, `clusters`, `symmetric` (kaleidoscope), `mixed` |
| `density` | `0.28` | Seed density |
| `transition` | `random` | `swipe`, `diagonal`, `radial`, `random`, `instant` |
| `transitionTime` | `2.5` | Seconds for the reseed sweep |
| `boredom` | `2` | Restart when fresh births drop below this per 10k cells per generation (0 = only exact loops) |
| `linger` | `3` | Seconds to hold a settled world before restarting |
| `maxMinutes` | `0` | Force a restart at least this often (0 = never) |
| `seed` | — | Fixed random seed; the same seed gives the same sequence of worlds |
| `stats` | `0` | Show generation / population / fps |
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
