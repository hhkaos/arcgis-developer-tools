# TODO: Basemap Effects Code Explorer

Phased implementation plan optimized for early feedback and incremental delivery.
Each phase produces a testable, observable result before moving to the next.

---

## Phase 1 — Scaffold + Working 2D Map with One Hardcoded Webmap

**Objective:** Get a working 2D map on screen ASAP. Confirm that WebMap loading with effects
works before building any UI around it.

**Scope (in):** package.json, vite.config.js, eslint.config.js, index.html shell, src/main.js
loading one hardcoded webmap ID into an arcgis-map element.

**Scope (out):** Gallery, 3D, code panel, error handling, state module.

**Deliverable:** `npm run dev` → browser shows 2D map with a webmap's basemap effects visible.

**Dependencies:** Identify at least one public ArcGIS Online webmap whose basemap layers have
`blendMode`, `effect`, or `opacity` configured. Use MapViewer → Save as WebMap to create one
if needed.

**Risks / unknowns:**
- WebMap loading needs the webmap item to be publicly accessible (no auth in v1).
- Effect rendering in 2D depends on `blendMode`/`effect` being set on basemap layers — verify
  that your chosen webmap actually stores these (not all do).

### Tasks

- [x] Copy `package.json` from basemap-composer, change `"name"` to `"basemap-effects-code-explorer"`, remove simple-git-hooks (add in Phase 6).
- [x] Copy `vite.config.js` from basemap-composer (no changes needed).
- [x] Copy `eslint.config.js` from basemap-composer (no changes needed). Note: added `console`, `navigator`, `Promise`, `URL` globals.
- [x] Run `npm install` in this directory.
- [x] Write `index.html`:
  - `<body class="calcite-mode-dark">`
  - One `<arcgis-map id="mapView">` element sized to fill the viewport (`width: 100%; height: 100vh`)
  - A `<script type="module" src="/src/main.js">` tag
- [x] Write `src/main.js`:
  - Import `@esri/calcite-components/main.css`
  - Import `@arcgis/map-components/components/arcgis-map` (side-effect)
  - Import `WebMap` from `@arcgis/core/WebMap.js`
  - Hardcoded webmap ID: `43d74eaeeb294d5d836b3edae35779f4` (imagery + Earth at Night, overlay blend mode)
  - Wrapped in `async function init()` — top-level await not supported at `es2020` build target
  - `console.log("basemap layers:", ...)` after `viewOnReady()`
- [x] Run `npm run lint` — fix any errors.
- [x] Run `npm run build` — fix any errors.

### How to test

1. Run: `npm run dev`
2. Open `http://localhost:5173` in Chrome.
3. **Expected:** Map loads and shows the webmap's basemap with effects applied (you should see the
   visual blend/filter effects in the map tiles).
4. Open DevTools → Console:
   - **Expected:** No errors. The `console.log` prints an array of layer objects with non-default
     `blendMode` / `effect` / `opacity` values (not all `"normal"` / `null` / `1`).
5. Run `npm run build` — **Expected:** exits 0 with no errors.

### Feedback needed before Phase 2

- Confirm which webmap ID you are using and that effects are visually obvious in the browser.
- Confirm `console.log` shows non-default effect values on the basemap layers.
- Decision: do you want the MapView to fill the full viewport or leave room for a top bar?

---

## Phase 2 — Tab Toggle: 2D / 3D with Lazy SceneView

**Objective:** Add the 2D / 3D tab bar and implement the lazy SceneView lifecycle (init on first
3D activation, destroy on return to 2D). Confirm that basemap effects are visible in both views
and that viewpoint sync works.

**Scope (in):** Tab bar HTML, `src/views/views.js` (initMapView, lazy initSceneView,
destroySceneView, syncViewpoint), tab switching logic wired in main.js.

**Scope (out):** Gallery, code panel, state module, error handling.

**Deliverable:** Clicking "3D" creates a SceneView with effects applied; clicking "2D" destroys
it; viewpoint is approximately carried over on each switch.

**Dependencies:** Phase 1 complete.

**Risks / unknowns:**
- `blendMode` and `effect` on basemap layers work in SceneView (same API) — verify visually.
- SceneView destroy/re-create: confirm the WebMap's basemap layer effects survive (they live on
  the Map instance, not the view, so they should).
- `Camera.fromExtent()` / `Viewpoint.fromCamera()` for viewpoint conversion — test at various
  zoom levels.

### Tasks

- [x] Update `index.html`:
  - Used `calcite-segmented-control` (not plain buttons) in `calcite-navigation` `content-start` slot.
  - `#view-container` was already in place from Phase 1 layout decision.
  - Added `arcgis-scene` to CSS selectors for sizing.
- [x] Create `src/views/views.js`:
  - Skipped `sharedMap` export — WebMap IS the shared map, passed directly to both views.
  - `initMapView(mapEl, webmap)` — sets map, awaits ready.
  - `initSceneView(container, webmap, mapEl)` — creates `<arcgis-scene>` dynamically, sets map,
    awaits ready, syncs via `sceneEl.view.goTo(mapEl.view.extent)`.
  - `destroySceneView(sceneEl)` — clones camera position, destroys view, removes element,
    returns position so caller can sync 2D viewpoint.
  - Skipped separate sync exports — sync logic is inline in initSceneView/destroySceneView.
- [x] Update `src/main.js`:
  - Toggle wired via `calciteSegmentedControlChange` event.
  - Toggle disabled until map is ready; re-disabled during tab switch, re-enabled after.
  - `activeTab`, `sceneEl`, `currentWebmap` tracked at module level.
- [x] Run `npm run lint && npm run build`.

### How to test

1. Run: `npm run dev` — map loads in 2D as before.
2. Click **3D** tab:
   - **Expected:** SceneView appears. Basemap effects are visible (same visual style as 2D).
   - **Expected:** Camera is near the location you were viewing in 2D.
   - Open DevTools → Elements: `<arcgis-scene>` element exists in DOM.
3. Click **2D** tab:
   - **Expected:** MapView returns. Viewpoint is near where you were in 3D.
   - Open DevTools → Elements: `<arcgis-scene>` element is **gone** from DOM.
   - Open DevTools → Memory (take heap snapshot): no obvious SceneView leak.
4. Repeat 2→3 switch several times — no console errors, no stacking of scene elements.
5. Run `npm run build` — exits 0.

### Feedback needed before Phase 3

- Confirm effects are visually present in 3D (same style as 2D).
- Confirm SceneView element is removed from DOM on return to 2D.
- Is viewpoint sync close enough, or do you want more precision?

---

## Phase 3 — Curated Gallery + State Module

**Objective:** Replace the hardcoded webmap ID with a gallery of curated example cards. Clicking
a card loads that webmap. Add `state.js` to track active webmap and active tab cleanly.

**Scope (in):** `curated-examples.json` (3–5 entries), `src/state/state.js`,
`src/gallery/gallery.js` (renderGallery), gallery bar HTML in index.html, wiring in main.js.

**Scope (out):** Load-by-ID input, error handling, code panel.

**Deliverable:** Gallery bar renders 3–5 cards; clicking any card loads that webmap into both
the active view and the dormant view (effects applied once, shared Map).

**Dependencies:** Phase 2 complete. You need 3–5 public webmap IDs with effects configured.

**Risks / unknowns:**
- Finding 3–5 good public webmaps with interesting effects — this is a content curation task,
  not a coding task. Block time for it. Use ArcGIS Online search: `type:"Web Map" access:public`
  + filter by presence of blend modes (MapViewer → Layers panel → Effects indicator).
- Re-loading a webmap while SceneView is active: destroy SceneView first, load new webmap, then
  let user re-open 3D (simplest path for v1).

### Tasks

- [x] Create `curated-examples.json` at the project root:
  ```json
  [
    {
      "id": "example-1",
      "title": "...",
      "description": "...",
      "webmapId": "<AGOL_ITEM_ID>",
      "thumbnailUrl": "https://..."
    }
  ]
  ```
  Fill in 3–5 real entries. Use AGOL thumbnail URLs (`https://www.arcgis.com/sharing/rest/content/items/<id>/info/thumbnail/...`).
  Note: 6 entries added, with an extra `primaryBasemap` field for future grouping. Descriptions left empty for now.
- [x] Create `src/state/state.js`:
  - Module-level state object: `{ activeWebmapId: null, activeTab: "2d" }`.
  - Export `getState()`, `setState(patch)`.
- [x] Create `src/gallery/gallery.js`:
  - Export `renderGallery(container, examples, onSelect)`:
    - For each example, create a card element (thumbnail img, title, description).
    - On click → calls `onSelect(example.webmapId)`.
    - Highlight the active card.
  - Export `setActiveCard(id)` to update visual selection.
  Note: CSS co-located in `src/gallery/gallery.css`, imported in `main.js`.
- [x] Update `index.html`:
  - Added `<div id="gallery-bar">` via `#app-body` flex wrapper (gallery above view-container).
  - Styled as horizontal scroll row of cards in `gallery.css`.
- [x] Extract webmap loading into `loadWebmap(webmapId)` function in main.js:
  - Creates `new WebMap({ portalItem: { id: webmapId } })`.
  - Sets `mapEl.map = webmap` and `sceneEl.map = webmap`, awaits both `viewOnReady()`.
  - Calls `setState({ activeWebmapId: webmapId })`.
  - Updates active card highlight.
  Note: No SceneView destroy — both views stay in DOM per Phase 2 architecture.
- [x] Wire gallery in main.js: `renderGallery(galleryEl, examples, loadWebmap)`.
- [x] On startup, auto-load the first curated example (no more hardcoded ID in main.js).
- [x] Run `npm run lint && npm run build`.

### How to test

1. Run `npm run dev`.
2. **Expected:** Gallery bar shows 3–5 cards with thumbnails and titles.
3. Click card 1 — **Expected:** Map loads that webmap; card 1 is highlighted.
4. Switch to 3D tab — **Expected:** SceneView shows same webmap with effects.
5. Switch back to 2D — **Expected:** MapView still shows same webmap.
6. Click card 2 — **Expected:** Map reloads with new webmap; card 2 is highlighted; card 1 is
   no longer highlighted.
7. Check console — **Expected:** No errors on any card click.
8. Run `npm run build` — exits 0.

### Feedback needed before Phase 4

- Are the curated examples visually compelling? (This is the primary demo content — needs to
  be impressive.)
- Is the gallery layout / card design acceptable, or do you want a redesign?
- Does switching between examples feel smooth enough?

---

## Phase 4 — Code Snippet Panel

**Objective:** Implement the "< > Code" button that opens a right-side drawer with a
syntax-highlighted, tab-aware, copy-able code snippet reconstructing the current webmap's
basemap in code.

**Scope (in):** create `src/layers/layers.js` (readBasemapLayers, BLEND_MODE_SUPPORTED_3D_TYPES),
`src/codegen/codegen.js` (generateSnippet), `src/ui/ui.js` (renderCodePanel,
wireControls), code panel HTML, copy button, 2D/3D mode awareness, visible-range 3D comment.

**Scope (out):** Syntax highlighting library (use plain `<pre>` with manual token spans — no
external highlighter needed for v1).

**Deliverable:** Clicking "< > Code" slides open a drawer with accurate, copy-pasteable JS
for the active webmap's basemap layers; snippet updates when switching 2D ↔ 3D tabs.

**Dependencies:** Phase 3 complete.

**Risks / unknowns:**
- Effect serialization: `layer.effect` can be a string (CSS filter syntax) or an array of
  effect objects. Inspect the actual value at runtime before coding the serializer — the SDK
  may return different shapes depending on how the webmap was saved.
- `blendMode` value: confirm it is a plain string (not an object).
- `minScale` / `maxScale`: confirm they exist on basemap TileLayers (they may not on all layer
  types). Guard with `typeof layer.minScale === "number"`.
- The scale → altitude formula: `altitude ≈ scale / 1000 * 180` (rough, equatorial). Note this
  explicitly in the comment.

### Tasks

- [x] Create `src/layers/layers.js`:
  - `BLEND_MODE_SUPPORTED_3D_TYPES` was already in layers.js — added `export` keyword.
  - `readBasemapLayers` uses `webmap.allLayers` for limitation detection; codegen reads
    `webmap.basemap.baseLayers.toArray()` directly.
- [x] Create `src/codegen/codegen.js`:
  - `serializeEffect`, `scaleToAltitude`, `generateSnippet` exported.
  - Layer type → class name mapping (TileLayer, VectorTileLayer, ImageryTileLayer, etc.).
  - Import block generated dynamically from layer types present.
  - 3D mode: effect/featureEffect → comment; unsupported blendMode → comment; minScale/maxScale → altitude comments.
- [x] Add code panel HTML to `index.html`:
  - `<div id="code-container" hidden>` inside `calcite-panel`, with `.code-toolbar` + copy button + `<pre id="code-output">`.
  - Uses existing `calcite-shell-panel` side panel (no separate drawer needed — code action already wired).
- [x] Create `src/ui/ui.js` + `src/ui/ui.css`:
  - `renderCodePanel(webmap, mode)` reads `webmap.basemap.baseLayers.toArray()`, calls `generateSnippet`.
  - `wireCopyButton()` wires clipboard write on `#copy-btn`.
- [x] Update `main.js`:
  - Panel action click: show/hide `galleryEl`/`codeContainerEl`, render snippet on code open.
  - Re-renders on tab switch and after each `loadWebmap` if code panel is open.
- [x] Run `npm run lint && npm run build`.

### How to test

1. Load a curated webmap with known effects (e.g., `blendMode: "multiply"`, `effect: "bloom(...)"`).
2. Click **< > Code**:
   - **Expected:** Drawer slides in from right.
   - **Expected:** `const baseLayers = [...]` snippet is shown with correct layer URLs, blendMode,
     opacity, and effect values for each layer.
   - **Expected:** Only non-default properties are included (no `blendMode: "normal"`, no
     `opacity: 1` unless actually set).
3. Click **Copy**:
   - **Expected:** Paste into DevTools console / a text editor → content is the raw JS snippet.
4. Click **3D** tab while panel is open:
   - **Expected:** Snippet updates to show "3D Code" in header.
   - **Expected:** `layer.effect` and `layer.featureEffect` are omitted; replaced by `// not supported in SceneView` comments.
   - **Expected:** `layer.blendMode` omitted (with comment) for any non-tile layer types.
   - **Expected:** `minScale`/`maxScale` replaced by altitude comment (if applicable).
   - **Expected:** Supported properties (blendMode on tile layers, opacity) are unchanged from 2D snippet.
5. Click **Close** — **Expected:** Drawer slides back out.
6. Load a different webmap — click "< > Code" again:
   - **Expected:** Snippet reflects the new webmap's layers.
7. Load a webmap with a layer that has `minScale`/`maxScale` set → switch to 3D → verify the
   altitude comment block appears with plausible numbers.
8. Run `npm run build` — exits 0.

### Feedback needed before Phase 5

- Is the generated code accurate and useful? Paste a snippet into a fresh Vite project and
  verify it runs without modification.
- Is the effect serialization correct for all your curated webmaps?
- Does the panel layout/width feel right on your screen?

---

## Phase 5 — Load-by-ID Input + Error Handling

**Objective:** Add the "Load by ID" input at the end of the gallery bar, and implement all four
error states from the SPEC.

**Scope (in):** Load-by-ID HTML input + button, extend `src/layers/layers.js`
(add hasEffects, warnIfOperationalLayers, extractItemId), error/info banners, all error states.

**Scope (out):** Code panel (complete as Phase 4).

**Deliverable:** User can paste any public AGOL webmap item ID or URL and see it load — or see
a clear, specific error message for each failure mode.

**Dependencies:** Phase 4 complete.

**Risks / unknowns:**
- Detecting "no effects" requires reading `blendMode`, `effect`, `opacity` on each basemap layer
  and checking they are all at defaults. Define "default" precisely:
  `blendMode === "normal"`, `effect === null`, `opacity === 1`.
- Operational layer detection: `webmap.layers.length > 0` after load. Confirm this is reliable
  (operational layers appear in `WebMap.layers`, not `WebMap.basemap.baseLayers`).
- Item-ID extraction from a full URL (e.g. `https://arcgis.com/home/item.html?id=abc123`):
  parse with `new URL(input)` and extract the `id` query param, or match the last path segment.

### Tasks

- [x] Add a Load-by-ID section inside `#gallery-container` in `index.html`:
  - `calcite-input-text` + `calcite-button` in `#load-by-id` div (top of gallery panel).
  - `calcite-notice` with `id="load-notice"` below the input for banners.
- [x] Extend `src/layers/layers.js` (add these exports alongside existing ones from Phase 4):
  - Export `hasEffects(layers)`:
    - Returns `true` if any layer has `blendMode !== "normal"` OR `effect !== null` OR `opacity !== 1`.
  - Export `warnIfOperationalLayers(webmap)`:
    - Returns `true` if `webmap.layers.length > 0`.
  - Export `extractItemId(input)`:
    - If input looks like a UUID (32 hex chars, no hyphens), return as-is.
    - If input is a URL, try `new URL(input).searchParams.get("id")`.
    - Otherwise return null (invalid).
- [x] Add `calcite-notice#load-notice` to `index.html` (inside `#gallery-container`); styled via `gallery.css`.
- [x] Implement `showBanner(message, type)` + `hideBanner()` in main.js (`type`: `"error"` | `"warning"` | `"info"`).
- [x] Update `loadWebmap(rawInput)` in main.js:
  1. Extract item ID with `extractItemId(rawInput)` → if null, show error banner "Invalid item ID or URL." and return.
  2. Create `new WebMap({ portalItem: { id } })`.
  3. Wrap `await webmap.load()` in try/catch → if error, show "Webmap not found or not accessible."
  4. Check `webmap.portalItem.type !== "Web Map"` → show "This item is not a Web Map."
  5. Check `warnIfOperationalLayers(webmap)` → show non-blocking warning banner.
  6. Load layers and check `hasEffects(baseLayers + referenceLayers)` → if false (and no operational layers), show info notice.
  7. Proceed to display.
- [x] Wire the Load button and `Enter` keydown on the input.
- [x] Run `npm run lint && npm run build`.

### How to test

**Happy path:**
1. Paste a known-good public webmap ID with effects → **Expected:** map loads, no errors.

**Error states (test each):**
2. Paste `"not-an-id"` → **Expected:** banner "Invalid item ID or URL."
3. Paste `"00000000000000000000000000000000"` (32 zeros, valid format but non-existent) → **Expected:** banner "Webmap not found or not accessible."
4. Paste a known public Feature Layer item ID (not a webmap) → **Expected:** banner "This item is not a Web Map."
5. Paste a public webmap with operational layers → **Expected:** non-blocking warning banner appears; map still loads; operational layers not shown.
6. Paste a public webmap with a plain basemap (no effects) → **Expected:** info notice "This webmap has no effects applied to basemap layers."

**URL format:**
7. Paste `https://www.arcgis.com/home/item.html?id=<validId>` → **Expected:** extracts ID and loads correctly.

**Keyboard:**
8. Type a valid ID and press Enter → **Expected:** same as clicking Load.

### Feedback needed before Phase 6

- Are all error messages clear and user-friendly?
- Should the warning banner for operational layers be dismissible?
- Any edge cases with item ID extraction you want to handle?

---

## Phase 6 — Pre-commit Hook + Final Polish

**Objective:** Lock in quality gates, run the full SPEC smoke-test checklist, and ship.

**Scope (in):** `simple-git-hooks` devDependency, `npm run prepare`, CSS polish, smoke-test
checklist pass.

**Scope (out):** Any SPEC "Future Considerations" items (shareable URL, side-by-side layout,
export as Vite project, etc.).

**Deliverable:** `npm run prepare` installs a pre-commit hook that runs `lint + build`. Full
smoke-test checklist passes. Demo is ready to present.

**Dependencies:** All previous phases complete.

### Tasks

- [ ] Add `simple-git-hooks` to devDependencies in `package.json`:
  ```json
  "devDependencies": {
    "simple-git-hooks": "^2.11.0",
    ...
  }
  ```
- [ ] Add `simple-git-hooks` config and `"prepare"` script to `package.json`:
  ```json
  "simple-git-hooks": {
    "pre-commit": "npm run lint && npm run build"
  },
  "scripts": {
    "prepare": "simple-git-hooks",
    ...
  }
  ```
- [ ] Run `npm install && npm run prepare` to register the hook.
- [ ] Polish: ensure `index.html` `<title>` reads `"Basemap Effects Code Explorer | ArcGIS Maps SDK for JavaScript"`.
- [ ] Polish: add `<meta name="description">` to `index.html`.
- [ ] Polish: gallery cards show a loading spinner while webmap is fetching.
- [ ] Polish: disable "< > Code" button if no webmap is loaded yet.
- [ ] Polish: "Load" button shows loading state (disabled + spinner icon) while fetch is in progress.
- [ ] Run full SPEC smoke-test checklist (see below).
- [ ] Run `npm run build` one final time — exits 0.

### How to test (SPEC smoke-test checklist)

Run through each item in order:

- [ ] App loads without console errors on `npm run dev`
- [ ] Curated gallery renders; each example loads a valid map with visible effects in 2D
- [ ] Basemap effects (blending, filters) are visually obvious in the 2D MapView
- [ ] Tab switch → 3D: SceneView initializes; effects are applied (same visual style)
- [ ] Tab switch → 2D: MapView still renders; verify SceneView element removed from DOM
- [ ] Viewpoint is approximately preserved after each tab switch (not wildly different location)
- [ ] "< > Code" panel opens and closes without errors
- [ ] 2D snippet reflects the loaded webmap's basemap layer configuration accurately
- [ ] 3D snippet: `layer.effect` / `layer.featureEffect` / unsupported `blendMode` omitted with comments; scale values replaced by altitude comments; supported properties unchanged
- [ ] Copy button writes the snippet to clipboard (paste to verify)
- [ ] Load-by-ID: valid public webmap loads correctly
- [ ] Load-by-ID: invalid ID format → "Invalid item ID or URL." banner
- [ ] Load-by-ID: valid format but non-existent ID → "Webmap not found or not accessible." banner
- [ ] Load-by-ID: valid non-webmap item → "This item is not a Web Map." banner
- [ ] Load-by-ID: webmap with no effects → info notice appears; map still loads
- [ ] Load-by-ID: webmap with operational layers → non-blocking warning banner; map loads; operational layers not shown
- [ ] Make a commit → pre-commit hook runs lint + build; commit only proceeds if both pass

### Feedback needed

- Does the demo tell a clear story for a developer-summit audience in < 5 minutes?
- Any edge cases in curated webmaps that break the code generation?
- Any visual polish before presentation?

---

## Curated Webmap IDs — Content Research Checklist

These need to be found before Phase 3 can be completed. Use ArcGIS Online to search for public
webmaps with basemap effects:

- [ ] Find webmap with `blendMode: "multiply"` on a basemap layer (e.g. dark base + multiply overlay)
- [ ] Find webmap with `blendMode: "screen"` (e.g. night-time glow effect)
- [ ] Find webmap with CSS filter `effect` (e.g. `"bloom(1, 0.5px, 0)"` or `"grayscale(100%)"`)
- [ ] Find webmap combining multiple effects (effect array with 2+ items)
- [ ] (Optional) Find webmap with `opacity < 1` on a basemap layer as the primary technique

For each, record:
- AGOL item ID
- Title
- Short description of the visual technique
- Thumbnail URL (`https://www.arcgis.com/sharing/rest/content/items/<id>/info/thumbnail/<filename>`)

> **Tip:** The basemap-composer demo in this repo uses similar effects — check its
> `map-configurations.json` for inspiration on what effect combinations look good.
