# Layer Palette — CLAUDE.md

> Curated ArcGIS layers for composing beautiful custom basemaps.

A developer tool for browsing, previewing, and copying ArcGIS item IDs for use in custom basemap compositions. Lives in the `arcgis-developer-tools` GitHub Pages monorepo.

---

## Tech stack

- **Vanilla JS + Vite** (no framework)
- **Tailwind CSS v3** via PostCSS
- No runtime dependencies beyond Vite + Tailwind

Build: `npm run build` → `dist/`
Dev: `npm run dev`

---

## File structure

```
custom-basemaps-assets/
├── index.html               # App shell, all static HTML including modal
├── src/
│   ├── main.js              # All UI logic, state, rendering, event wiring
│   ├── style.css            # Tailwind entry point + custom utilities
│   ├── api.js               # ArcGIS REST fetch, URL builders
│   ├── cache.js             # localStorage TTL cache (24h)
│   └── config/
│       └── assets.json      # Source of truth for all items and categories
├── package.json
├── vite.config.js           # base: "./" for GitHub Pages compatibility
├── tailwind.config.js
└── postcss.config.js
```

---

## Adding or removing assets

All items live in [`src/config/assets.json`](src/config/assets.json). This is the **only file** that needs editing to add/remove items.

### Item with ArcGIS item ID (most common)

```json
{
  "id": "97fa1365da1e43eabb90d0364326bc2d",
  "categories": ["base-layers"]
}
```

- `id` must be the ArcGIS item ID (32-char hex string)
- `categories` is an array — items can belong to multiple categories
- Metadata (title, snippet, description, type, thumbnail) is fetched from the ArcGIS REST API at runtime and cached in localStorage

### External/hardcoded item (search pages, docs, groups)

Used when there is no single item ID (e.g. Living Atlas browse links, ArcGIS group pages):

```json
{
  "id": "_external_my-unique-key",
  "categories": ["utils"],
  "hardcoded": {
    "title": "Human-readable title",
    "snippet": "One-sentence description.",
    "thumbnailUrl": "",
    "externalUrl": "https://...",
    "type": "External"
  }
}
```

- `id` must start with `_external_` and be unique
- `type: "External"` triggers the orange badge and disables Map Viewer preview + item ID copy
- `thumbnailUrl` can be empty string if no thumbnail available

### Adding a new category

Add to the `categories` array in `assets.json`:

```json
{
  "id": "my-category-id",
  "label": "My Category",
  "icon": "🗂️"
}
```

Then reference `"my-category-id"` in item `categories` arrays.

---

## ArcGIS REST API

Metadata endpoint: `https://www.arcgis.com/sharing/rest/content/items/{itemId}?f=json`

Fields used from the response:
- `title`, `snippet`, `description` (HTML), `type`, `typeKeywords[]`, `tags[]`, `thumbnail`

Thumbnail URL pattern: `https://www.arcgis.com/sharing/rest/content/items/{itemId}/info/{thumbnail}`

All items in the config are **public** (no auth required). If a fetch fails, the card shows a warning badge.

---

## Map Viewer URL resolution

Handled in `src/api.js → getMapViewerUrl(itemId, type)`:

| ArcGIS item type | URL param |
|---|---|
| `"Web Map"` | `?webmap=ITEMID` |
| `"Web Scene"` | `?webscene=ITEMID` |
| All others (layers, services) | `?layers=ITEMID` |

Always appends `&embedded=1&locale=en-us` for the in-app iframe preview.

---

## Caching

- **Storage**: `localStorage`, key `arcgis-basemaps-cache`
- **TTL**: 24 hours per item
- **Manual refresh**: tiny ↻ icon on card hover (single item) + header "Last updated · Refresh all" (all items)
- Cache version is stored; incrementing `CACHE_VERSION` in `cache.js` invalidates all existing cache entries

---

## UI architecture

All rendering is in `src/main.js`. No components — plain DOM manipulation.

### State object

```js
const state = {
  selectedCategory: "all",  // category id or "all"
  searchQuery: "",           // raw input value
  metadata: {},              // { [itemId]: metadata | Error }
  loading: new Set(),        // item ids currently being fetched
};
```

### Key functions

| Function | Purpose |
|---|---|
| `renderSidebar()` | Rebuilds category nav, updates active state |
| `renderGrid()` | Renders visible cards based on current state |
| `renderCard(item)` | Returns a single card DOM element |
| `openDetailModal(itemId)` | Populates and shows the detail modal |
| `closeDetailModal()` | Hides the detail modal |
| `openPreview(itemId)` | Switches to Map Viewer iframe view (replaces grid) |
| `closePreview()` | Restores grid view, clears iframe src |
| `refreshItem(itemId)` | Force-refetches a single item, bypassing cache |
| `refreshAll()` | Force-refetches all API items |
| `updateCacheStatus()` | Updates header "Last updated" text |

### Interaction flows

- **Card click** → `openDetailModal()` (full metadata: snippet, description, tags, keywords, ID)
- **Preview button on card** → `openPreview()` (Map Viewer iframe replaces grid)
- **Preview button in modal** → closes modal → `openPreview()`
- **Sidebar category click** → `closePreview()` + switch category + `renderGrid()`
- **Escape key** → closes modal first, then preview if modal already closed

### Empty state logic

When no results are found:
- If a search query is active **and** a category is selected **and** results exist in other categories → show "No results in {Category}" + "Show all N results" + "Clear search" buttons
- Otherwise → plain "No assets found"

---

## Type badges

Defined in `TYPE_BADGE` map in `main.js`. Unrecognized types fall back to a gray badge showing the raw type string. Key types:

| ArcGIS type | Badge label | Color |
|---|---|---|
| Vector Tile Layer | Vector Tile | Indigo |
| Map Service | Map Service | Amber |
| Feature Service | Feature Service | Green |
| Image Service | Image Service | Yellow |
| Web Map | Web Map | Blue |
| Web Scene | Web Scene | Cyan |
| External (hardcoded) | External | Orange |

---

## Noise-filtered type keywords

These are stripped from the Type Keywords display in the detail modal (too generic to be useful):
`Registered`, `Hosted Service`, `Item`, `Requires Subscription`, `Requires Credits`, `Public`, `Shareable`, `Configurable`

---

## GitHub Pages deployment

The monorepo `.gitignore` excludes `custom-basemaps-assets/dist/` and `custom-basemaps-assets/node_modules/`. The GitHub Actions workflow in the repo root handles building and deploying. `vite.config.js` uses `base: "./"` for relative asset paths.
