# SPEC: Basemap Effects Code Explorer

## Purpose

A developer-education tool that helps ArcGIS Maps SDK for JavaScript developers understand how to reproduce Photoshop-like basemap effects programmatically in both 2D and 3D applications.

**The problem it solves:** ArcGIS MapViewer provides a rich UI playground for configuring basemap effects (blend modes, layer effects, opacity, etc.) in 2D. Scene Viewer has no equivalent interface for 3D. Additionally, neither tool shows developers the programmatic SDK code needed to reproduce those configurations in their own apps.

**What this app does:**
1. Load a webmap (from a curated gallery or by user-supplied item ID) whose basemap layers have effects configured
2. Visualize the result simultaneously in a MapView (2D) and a SceneView (3D) — tab-toggled
3. Surface copy-pasteable SDK code that reproduces the exact basemap effect configuration

---

## Anti-Goals

- **Not a parameter editor.** The user cannot change blend modes, effects, or opacity inside this app. It is read-only visualization + code generation.
- **No operational layers.** If the loaded webmap contains operational layers above the basemap, show a warning and ignore them. Code snippets cover basemap layers only.
- **No backend.** Fully static — GitHub Pages / Netlify. No server-side logic.

---

## Target Users

ArcGIS Maps SDK for JavaScript developers who want to move from "I configured this in MapViewer" to "I know how to write this in code."

---

## Effects Scope

All of the following properties are read from each basemap layer and reflected in the code snippet:

| Property | SDK name | 3D support |
|---|---|---|
| Blend mode | `blendMode` | Yes (same API) |
| Layer effects | `effect` | Yes (same API — array, order matters) |
| Opacity / transparency | `opacity` | Yes (same API) |
| Visible range | `minScale` / `maxScale` | Best-effort: convert to approximate camera altitude |

> **Effect array ordering** is semantically significant and must be preserved exactly in generated snippets.

---

## Input & Data Sources

### Curated gallery (3–5 examples, flat)
Hardcoded in the app (JSON or JS config). Each entry has:
- `title` — display name
- `description` — short description of the visual style/technique
- `webmapId` — ArcGIS Online item ID (public)
- `thumbnailUrl` — preview image

### User-supplied webmap
A text input accepting an ArcGIS Online item ID or full item URL. Public items only (no auth in v1). The app extracts the item ID, loads the WebMap, and proceeds identically to the curated path.

**Error states to handle:**
- Invalid / not-found item ID → error message
- Item is not a WebMap → error message
- WebMap loads but has no basemap layer effects configured → informational notice ("This webmap has no effects applied to basemap layers. Try one of the curated examples.")
- WebMap contains operational layers → non-blocking warning banner: "This webmap contains operational layers. They are not loaded — this app focuses on basemap layers only."

---

## Architecture

### Shared Map instance (key decision)

Both the `MapView` and `SceneView` share **the same `Map` instance**. This means:
- Basemap layers (with their `blendMode`, `effect`, `opacity`, etc.) are set once on the Map and automatically reflected in both views
- No need to re-apply or copy properties between views
- The web scene spec limitation (effects not persisted in WebScene JSON) is bypassed entirely — effects live only in memory, set programmatically

**Load flow:**
1. Load the webmap as a `WebMap` (to read layer definitions and configured effects)
2. Use that same `WebMap` instance as the `map` for the `MapView`
3. Pass the same `map` to the `SceneView` when it is first activated
4. Effects are already present on the layers — both views render them

### View lifecycle

| View | Lifecycle |
|---|---|
| `MapView` (2D) | Created eagerly on app init; kept alive for the entire session |
| `SceneView` (3D) | **Lazy init** — created the first time the user activates the 3D tab; **destroyed** when the user switches back to 2D (memory concern), **re-created** on next 3D activation |

When the SceneView is destroyed and re-created, the Map instance is unchanged — layer effects persist.

### Viewpoint sync on tab switch

When switching from 2D → 3D:
- Convert the `MapView.viewpoint` to an equivalent SceneView camera (`Camera.fromExtent()` or `SceneView.goTo()` with the current extent)

When switching from 3D → 2D:
- Convert the `SceneView.camera` back to a 2D viewpoint via `Viewpoint.fromCamera()`

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Curated example 1] [Curated example 2] ... [Load by ID]   │  ← gallery/input bar (top)
├─────────────────────────────────────────────────────────────┤
│  [2D]  [3D]                                    [< > Code]   │  ← tab toggle + code button
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                   Map or Scene View                         │
│                   (full remaining height)                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- **Gallery/input bar**: Horizontal list of curated example cards + a "Load by ID" input at the end
- **Tab bar**: "2D" / "3D" toggle tabs (left); "< > Code" floating button (right) that opens the code panel
- **Map area**: Full-width, remaining height — `MapView` or `SceneView` element
- **Warning banner**: Non-blocking, appears below the tab bar if operational layers were detected

### Code Panel

A **floating drawer** that slides in from the right when the user clicks "< > Code". Does not obscure the full map — narrows the map area or overlaps with partial transparency. Contains:
- Tab-aware header: "2D Code" or "3D Code" (matches the active view tab)
- Syntax-highlighted code block (using a lightweight highlighter or `<pre>` with manual token classes)
- "Copy" button — copies the raw snippet to clipboard
- "Close" button

---

## Code Snippet Design

### What it produces

The snippet shows how to reconstruct the basemap from scratch in code — no webmap loading. It is self-contained enough to drop into an existing app that already has a `MapView` or `SceneView`.

### Structure

```js
// Basemap layers (in order — order matters for blend effects)
const baseLayers = [
  new TileLayer({
    url: "https://...",
    blendMode: "multiply",
    opacity: 0.85,
    effect: [
      new BloomEffect({ strength: 2, radius: 1, threshold: 0.5 }),
      new GrayscaleEffect()
    ]
  }),
  new TileLayer({
    url: "https://...",
    blendMode: "screen"
  })
];

const basemap = new Basemap({ baseLayers });

// Assign to your view's map:
// map.basemap = basemap;
```

### Mode awareness

- When the **2D tab** is active: snippet uses property names and effect classes valid for `MapView`
- When the **3D tab** is active: snippet replaces `minScale`/`maxScale` with approximate camera altitude note; everything else is identical (same API)
- If a property has no 3D equivalent, omit it from the 3D snippet and add an inline comment explaining

### Visible range in 3D

When `minScale`/`maxScale` are set on a basemap layer:
- In the **2D snippet**: include as-is
- In the **3D snippet**: convert to approximate camera altitude using a scale-to-meters formula, render as a comment block:

```js
// visibilityRange: WebMap used minScale=500000 / maxScale=1000
// Approximate 3D equivalent (camera altitude in meters):
// minScale 500000 ≈ altitude 180000m | maxScale 1000 ≈ altitude 360m
// layer.visibilityRange = new LODInfo({ minScale: ... }); // verify for your scene
```

---

## File Structure

```
demos/basemap-effects-code-explorer/
├── index.html                    # Entry point; <body class="calcite-mode-dark">
├── package.json                  # @arcgis/core, @arcgis/map-components, @esri/calcite-components, vite
├── vite.config.js
├── eslint.config.js
├── SPEC.md                       # This file
├── curated-examples.json         # { id, title, description, webmapId, thumbnailUrl }[]
└── src/
    ├── main.js                   # Entry: CSS imports, bootstrap
    ├── state/
    │   └── state.js              # Module-level state: active webmap id, active tab, loaded layers
    ├── views/
    │   └── views.js              # initMapView, initSceneView (lazy), destroySceneView, syncViewpoint
    ├── gallery/
    │   └── gallery.js            # renderGallery, renderLoadByIdInput, handleLoad
    ├── layers/
    │   └── layers.js             # readBasemapLayers, warnIfOperationalLayers
    ├── codegen/
    │   └── codegen.js            # generateSnippet(layers, mode: '2d'|'3d') → string
    └── ui/
        └── ui.js                 # renderTabBar, renderCodePanel, wireControls
```

---

## Tech Stack

Identical to the other demos in this repo:

| Concern | Choice |
|---|---|
| Language | Plain JavaScript (ES modules, no TypeScript) |
| Bundler | Vite 7.x |
| Mapping SDK | `@arcgis/core` v5 |
| Map web components | `@arcgis/map-components` v5 |
| UI components | `@esri/calcite-components` v5 (Lit-based) |
| CSS | Calcite design tokens; `@esri/calcite-components/main.css` |
| Dark mode | `class="calcite-mode-dark"` on `<body>` |
| Deployment | GitHub Pages (or equivalent static host) |

No framework (React, Vue, etc.). No TypeScript. No backend.

---

## Known Limitations & Tradeoffs

### WebScene spec does not persist effects
**Decision:** Share the same `Map` instance between both views. Effects are set in memory only — they are never round-tripped through a WebScene spec. This is a feature, not a workaround: it demonstrates to developers exactly what they need to do programmatically.

### SceneView memory cost
**Decision:** Lazy-init the SceneView, destroy it when the user returns to 2D. Slight re-load cost on re-activation, but acceptable given the educational context. The Map and its layers stay alive — only the WebGL renderer is torn down.

### Visible range translation to 3D is approximate
The scale → altitude conversion uses a rough formula and will not be exact for all coordinate systems or ground resolutions. This is flagged explicitly in the generated snippet comment.

### No real-time effect editing
By design. This is a read-only visualization + code generator. If users want to experiment, they use MapViewer (2D) and come back here for the code.

### Authentication
v1: public webmaps only. Future: optional `IdentityManager` / OAuth flow to load private items.

---

## Testing Strategy

### Quality gates — automated, block every commit

A git pre-commit hook runs these two commands in sequence. Both must exit 0 or the commit is aborted:

```sh
npm run lint    # ESLint — catches undefined variables, bad imports, code style
npm run build   # vite build — catches module resolution errors, syntax errors, missing assets
```

**Implementation:** A `.git/hooks/pre-commit` shell script. For portability across machines, add `simple-git-hooks` as a devDependency and declare the hook in `package.json`:

```json
"simple-git-hooks": {
  "pre-commit": "npm run lint && npm run build"
},
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "lint": "eslint src",
  "prepare": "simple-git-hooks"
}
```

Run `npm run prepare` once after install to register the hook.

### Manual browser smoke checklist — run before each meaningful commit

All map rendering, WebGL, and ArcGIS SDK behavior is browser-only and cannot be automated cheaply. Before committing, verify:

- [ ] App loads without console errors
- [ ] Curated gallery renders; each example loads a valid map
- [ ] Basemap effects are visible in the 2D view
- [ ] Tab switch to 3D: SceneView initializes and effects are applied correctly
- [ ] Tab switch back to 2D: MapView still renders; SceneView is destroyed (check memory)
- [ ] Viewpoint is approximately synced after each tab switch
- [ ] "< > Code" panel opens and closes correctly
- [ ] Code snippet matches the loaded webmap's basemap configuration
- [ ] Copy button writes the snippet to the clipboard
- [ ] Warning banner appears when loading a webmap with operational layers
- [ ] Loading an invalid item ID shows a clear error message
- [ ] Loading a webmap with no effects shows the informational notice

### Future: unit tests for codegen (deferred)

`codegen.js` is a pure function (layer config array → string) with no DOM or SDK dependency — it's ideal for unit testing. Add Vitest coverage only if bugs are found that need regression protection:

```
src/codegen/codegen.test.js   # to be created when needed
```

Add `"test": "vitest run"` to `package.json` scripts at that point.

---

## Future Considerations (out of scope for v1)

- Optional ArcGIS sign-in to load private/org webmaps
- Shareable URL: encode the active webmap ID in `?id=<itemId>` query param
- Side-by-side 2D + 3D (no tab toggle) as a layout option
- Layer-by-layer annotation mode: click a layer in the code panel to highlight it in the map
- Export as a full Vite project (download zip)
