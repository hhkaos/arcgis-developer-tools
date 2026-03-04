# AGENTS.md — Basemap Effects Code Explorer

Technical reference for agents. Updated as lessons are learned.
For behaviour rules and coding style, see [CLAUDE.md](CLAUDE.md).

---

## Quick commands

```bash
npm run dev      # Vite dev server (HMR) — http://localhost:5173
npm run build    # Production build (run after every set of changes)
npm run lint     # ESLint over src/**/*.js
npm run prepare  # Register simple-git-hooks pre-commit hook (run once after install)
```

Pre-commit hook (after Phase 6 setup): `npm run lint && npm run build` — both must pass.

---

## Stack

| Package | Version | Notes |
|---|---|---|
| `@arcgis/core` | 5.x | ES module imports with explicit `.js` extension |
| `@arcgis/map-components` | 5.x | Web components: `arcgis-map`, `arcgis-scene`, `arcgis-search` |
| `@esri/calcite-components` | 5.x | Lit-based (NOT Stencil). Import CSS + component side effects. |
| Vite | 7.x | No special plugins needed for ArcGIS v5 |
| ESLint | 10.x | Flat config (`eslint.config.js`). Globals declared manually. |
| simple-git-hooks | 2.x | Pre-commit only. Added in Phase 6. |

---

## File map

```
demos/basemap-effects-code-explorer/
├── index.html                  # Entry point. <body class="calcite-mode-dark">
├── package.json
├── vite.config.js              # build.target: "es2020" — no other config needed
├── eslint.config.js            # Flat config. Browser globals declared manually.
├── curated-examples.json       # [{ id, title, description, webmapId, thumbnailUrl }]
├── SPEC.md                     # Full product spec — source of truth for requirements
├── CLAUDE.md                   # Claude Code instructions (this file's companion)
├── TODO.md                     # Phased checklist — keep updated as work progresses
└── src/
    ├── main.js                 # Entry: CSS imports, bootstrap, wiring
    ├── state/
    │   └── state.js            # Module-level state: activeWebmapId, activeTab
    ├── views/
    │   └── views.js            # initViews, switchTo2D, switchTo3D
    ├── gallery/
    │   └── gallery.js          # renderGallery, setActiveCard
    ├── layers/
    │   └── layers.js           # readBasemapLayers, detectSceneViewLimitations
    ├── codegen/
    │   └── codegen.js          # generateSnippet(layers, mode: '2d'|'3d') → string
    └── ui/
        └── ui.js               # renderCodePanel, openCodePanel, closeCodePanel, wireCodePanelControls
```

Each `src/<module>/` directory owns a co-located `.css` file imported in `main.js`.

---

## Architecture decisions

### Shared Map instance
Both `MapView` and `SceneView` reference the **same `ArcGISMap` instance**. This means:
- Basemap layers (with their `blendMode`, `effect`, `opacity`) are set once and reflected in both views.
- Do not copy or re-apply layer properties between views — they are already shared.
- WebScene JSON does not persist effects — this is intentional. Effects live in memory only,
  set programmatically from the loaded WebMap.

### WebMap → shared Map flow
1. Load `new WebMap({ portalItem: { id } })` — reads basemap layer definitions and effects.
2. Set `mapEl.map = webmap` and `sceneEl.map = webmap` — both elements share the same WebMap.
3. Effects are already on the layers — both views render them automatically.

### View lifecycle (both always in DOM)
- Both `<arcgis-map>` and `<arcgis-scene>` are declared in `index.html` and loaded in parallel
  via `Promise.all([mapEl.viewOnReady(), sceneEl.viewOnReady()])`.
- **Do NOT dynamically create/destroy the SceneView** — doing so causes the MapView to lose its
  rendered size and go blank when switching back to 2D. See "What to avoid" below.
- Switching is purely a CSS visibility toggle (`.view--active` class) combined with a synchronous
  viewpoint transfer using the element's `.viewpoint` setter.

### Webmap loading and error flow
`loadWebmap(rawInput)` in `main.js`:
1. `extractItemId(rawInput)` — null means invalid format → show error banner, return.
2. `new WebMap({ portalItem: { id } })` + `await webmap.load()` — catch errors → show banner.
3. Check `webmap.portalItem.type !== "Web Map"` → show banner.
4. Check `warnIfOperationalLayers(webmap)` → non-blocking warning banner.
5. `readBasemapLayers(webmap)` → if `!hasEffects(layers)` → show info notice.
6. Proceed to display (set `mapEl.map = webmap`).

---

## Key API patterns

### @arcgis/core v5 — imports
Always use explicit `.js` extension:
```js
import WebMap from "@arcgis/core/WebMap.js";
import ArcGISMap from "@arcgis/core/Map.js";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
// Also valid: "@arcgis/core/reactiveUtils.js"
```
`@arcgis/core/buildAssets` does NOT exist in v5 (was a v4 pattern). Do not import it.

### @arcgis/map-components v5

Package structure: components live at `node_modules/@arcgis/map-components/dist/components/<name>/`.
Import path (via `./components/*` package export): `@arcgis/map-components/components/<name>` — no `dist/` prefix.
To check if a component exists: `ls node_modules/@arcgis/map-components/dist/components/ | grep <name>`.

```js
// Register components as side effects:
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-search";

// Wait for view ready:
await mapEl.viewOnReady();  // returns Promise<View>

// Access underlying SDK view:
mapEl.view  // → MapView

// Set viewpoint on the element (not on .view):
mapEl.viewpoint = someViewpoint.clone();

// Camera on arcgis-scene (autocasts plain objects):
sceneEl.camera = { position: { longitude, latitude, z }, tilt, heading };
```

### arcgis-search — usage outside map/scene elements
`arcgis-search` can live anywhere in the DOM (e.g. in a nav bar). Link it to a view via
`referenceElement` (JS property) or `reference-element` (HTML attribute — accepts element ID string).
When the active view changes (e.g. 2D↔3D tab switch), update the reference:
```js
// HTML (initial):
// <arcgis-search id="nav-search" reference-element="mapView"></arcgis-search>

// JS — switch to 3D view:
navSearchEl.referenceElement = sceneEl;   // pass element reference directly

// JS — switch back to 2D:
navSearchEl.referenceElement = mapEl;
```
Property type: `ArcgisReferenceElement | string | undefined`.

### arcgis-map / arcgis-scene — custom UI slots
Both elements accept slotted content for UI widget positions:
```html
<arcgis-map>
  <div slot="top-right">
    <!-- any HTML here — buttons, links, etc. -->
  </div>
</arcgis-map>
```
Valid slot names: `top-left`, `top-right`, `bottom-left`, `bottom-right`,
`top-start`, `top-end`, `bottom-start`, `bottom-end`.

### Viewpoint sync (2D ↔ 3D) — correct pattern
Use the **element's `.viewpoint` setter** (synchronous, instant, no animation) rather than
`view.goTo()`. Apply a scale correction for Web Mercator distortion:

```js
// 2D → 3D
const vp = mapEl.viewpoint.clone();
const factor = Math.cos((vp.targetGeometry.latitude * Math.PI) / 180);
vp.scale *= factor;   // remove Mercator scale inflation
sceneEl.viewpoint = vp;

// 3D → 2D
const vp = sceneEl.viewpoint.clone();
const factor = Math.cos((vp.targetGeometry.latitude * Math.PI) / 180);
vp.scale /= factor;   // add Mercator scale inflation back
mapEl.viewpoint = vp;
```

Why the scale factor: Web Mercator inflates distances away from the equator, so the same
`scale` value looks more "zoomed out" in 2D than in 3D. The cosine of latitude corrects for
this so the map appears at the same zoom level after switching.

**Do NOT use `view.goTo()` for view switching** — it is async and can animate. The
`.viewpoint` setter is always instant.

### WebMap basemap layers
```js
// After webmap.load():
const layers = webmap.basemap.baseLayers.toArray();

// Each layer may have:
layer.blendMode   // string, default: "normal"
layer.effect      // string | null (CSS filter syntax) or array of effect objects
layer.opacity     // number 0–1, default: 1
layer.minScale    // number, 0 means no limit
layer.maxScale    // number, 0 means no limit
layer.url         // string — the tile service URL
```

### Effect serialization (critical — inspect before coding)
`layer.effect` shape varies by how the webmap was saved. **Log a real layer's effect value
before writing the serializer:**
```js
console.log(JSON.stringify(layer.effect));
```
Possible shapes:
- `null` — no effect set
- `"bloom(1, 0.5px, 0) saturate(200%)"` — CSS filter string (MapViewer v1 format)
- Array of effect objects with `type`, parameters — (newer SDK format)

Handle both. The serializer in `codegen.js` must check `typeof effect === "string"` vs array.

### @esri/calcite-components v5
```js
// Must import CSS (the only export):
import "@esri/calcite-components/main.css";

// Dark mode requires class on ancestor:
// <body class="calcite-mode-dark">
// Do NOT rely on color-scheme: dark alone.

// Component side-effect imports:
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-input-text";

// Event values:
el.addEventListener("calciteInputTextChange", (e) => e.target.value);
```

### calcite-button — anchor mode & appearance
```html
<!-- Renders as <a> when href is set: -->
<calcite-button href="https://..." target="_blank" rel="noopener">Label</calcite-button>
```
Set `href` from JS: `buttonEl.href = url;`

`appearance` values:
- `"solid"` — filled (default)
- `"outline"` — outlined, transparent background
- `"outline-fill"` — outlined with solid background fill — **best for buttons over maps**
- `"transparent"` — no background; poor contrast over maps, avoid

CSS custom properties (set on a parent to cascade to multiple buttons):
```css
--calcite-button-text-color: white;
--calcite-button-border-color: white;
```

### calcite-navigation — slots
Available slots: `logo`, `user`, `content-start`, `content-end`, `navigation-action`.
- `content-start` — appears immediately after the logo (left side of center area).
- `content-end` — right side (where the 2D/3D toggle lives).
There is no default (unnamed) slot — every child must have a `slot` attribute.

### ESLint globals
Browser globals must be manually declared in `eslint.config.js`:
```js
globals: {
  document: "readonly",
  window: "readonly",
  navigator: "readonly",   // needed for clipboard API
  AbortController: "readonly",
  Promise: "readonly",
  URL: "readonly",         // needed for extractItemId
}
```
If a new global causes a lint error, add it here.

---

## Scale → altitude formula (for 3D code snippets)

Rough approximation used in `codegen.js` for converting `minScale`/`maxScale` to camera altitude:

```js
// altitude in meters ≈ scale / 1000 * 180
// Example: minScale 500000 → ~90000m, maxScale 1000 → ~180m
const scaleToAltitude = (scale) => Math.round(scale / 1000 * 180);
```

This is intentionally approximate. Always emit it as a comment in the snippet, not as live code.

---

## What to avoid

- **No `@arcgis/core/buildAssets`** — v4 pattern, does not exist in v5.
- **No Vite plugin for ArcGIS** — SDK loads workers/assets from CDN by default in v5.
- **No `calcite-mode-auto`** — demo uses explicit dark mode; don't add auto-switching.
- **No operational layers** — do not set `mapEl.view.map.layers` from the webmap. Operational
  layers are detected and warned about, not loaded.
- **No `WebScene`** — use `WebMap` for both views. WebScene JSON does not persist effects.
- **No direct mutation of `state`** — always use `getState()` / `setState(patch)` from
  `src/state/state.js`.
- **No event listener leaks** — if a function that registers `document.addEventListener` can
  be called multiple times (e.g. a re-render), use a module-level `AbortController` and abort
  the previous listener before re-registering.
- **No `display: none` on `arcgis-map` / `arcgis-scene`** — collapsing an ArcGIS view element
  to zero size via `display: none` breaks it; the view does not recover when shown again.
  Use `visibility: hidden/visible` (element retains its layout size) or absolute stacking.
- **No dynamic create/destroy of SceneView for tab switching** — keeping both views always in
  the DOM and toggling visibility is simpler and correct. Dynamic lifecycle was attempted and
  caused blank-view bugs.
- **Never mutate `layer.effect` (or any layer property) to work around SceneView limitations.**
  Both views share the same WebMap layer objects. Setting `layer.effect = null` on a shared layer
  causes SceneView to lose its ground/terrain rendering. SceneView already degrades gracefully by
  silently ignoring unsupported effects — let it. Only detect and notify the user; do not strip.

---

## Lessons learned

- [2026-03-02] **Top-level `await` fails at `es2020` build target.** Wrap async startup code
  in `async function init() { ... } init();`. Do not use top-level await.

- [2026-03-02] **`console` is not in ESLint's globals by default** (even with `js.configs.recommended`
  + explicit globals block). Must add `console: "readonly"` to the globals list in `eslint.config.js`.

- [2026-03-02] **`display: none` on an ArcGIS view element permanently breaks it.** The view
  collapses to 0×0 and the internal ResizeObserver does not recover it when `display` is restored.
  Always use `visibility: hidden/visible` — the element keeps its layout size, the view stays valid.

- [2026-03-02] **Dynamic SceneView create/destroy for tab switching is unreliable.** Even with
  correct DOM cleanup, the MapView went blank after a 2D→3D→2D cycle. The correct approach:
  keep both `<arcgis-map>` and `<arcgis-scene>` in HTML from the start, load both with
  `Promise.all([mapEl.viewOnReady(), sceneEl.viewOnReady()])`, and toggle with CSS only.

- [2026-03-02] **Viewpoint sync must use the element `.viewpoint` setter, not `view.goTo()`.
  `goTo()` is async and animates; the `.viewpoint` setter is synchronous and instant. Apply
  `Math.cos(lat × π/180)` scale correction in both directions to compensate for Web Mercator
  distortion.

- [2026-03-02] **Calcite `calcite-segmented-control` event is `calciteSegmentedControlChange`.**
  Value is read from `event.target.value`.

## 2D vs 3D rendering differences (known)

These were discovered by comparing MapView and SceneView with the same shared WebMap.
**More differences likely exist** — add entries here as they are found.

| Feature | MapView (2D) | SceneView (3D) | Notes |
|---|---|---|---|
| `VectorTileLayer.effect` — any type (bloom, hue‑rotate, saturate, …) | ✅ Rendered | ❌ Silently ignored | SceneView renders the layer normally but ignores the `effect` property entirely |
| `TileLayer.blendMode` (e.g. `color-burn`) | ✅ Rendered | ✅ Rendered | Confirmed with World Hillshade + color-burn |
| `TileLayer.effect` | ✅ Rendered | Unknown | Not yet tested |

**How to handle SceneView limitations in this app:**
1. Read basemap layers after `viewOnReady()`.
2. Call `detectSceneViewLimitations(layers)` — returns an array of effect type names that won't render.
3. Show a `calcite-notice` if the array is non-empty; hide it when switching back to 2D.
4. Do NOT strip/modify `layer.effect` — see "What to avoid" above.

- [2026-03-02] **`arcgis-search` can live outside `arcgis-map`/`arcgis-scene`.** Place it
  anywhere in the DOM (e.g. `calcite-navigation` `content-start` slot) and link it to a view
  via `referenceElement` (JS property) or `reference-element` attribute (string element ID).
  Update `referenceElement` whenever the active view changes.

- [2026-03-02] **`calcite-button` with `appearance="transparent"` is unreadable over maps.**
  Use `appearance="outline-fill"` for buttons placed inside map view slots — it provides a
  solid background that contrasts against any basemap.

- [2026-03-02] **`calcite-button` CSS tokens `--calcite-button-text-color` and
  `--calcite-button-border-color` can be set on a wrapper element** and cascade down to all
  `calcite-button` children within it.

- [2026-03-02] **`arcgis-map` and `arcgis-scene` accept named slots for custom UI.**
  Use `<div slot="top-right">` (or other positions) as a direct child to place buttons,
  links, etc. in the map widget area. The `div` wrapper is needed; bare `calcite-button`
  elements placed directly as children may not render in the correct position.

- [2026-03-02] **`@arcgis/map-components` package exports pattern is `./components/*`.**
  Physical files are in `dist/components/<name>/`. Import as
  `@arcgis/map-components/components/<name>` (no `dist/` prefix). To verify a component
  exists before importing, check `ls node_modules/@arcgis/map-components/dist/components/`.
