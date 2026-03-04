# Coverage Map Generator — Web App Spec

## Overview

A single-page, vanilla HTML/CSS/JS web app that lets a user log in with their ArcGIS account, supply a point layer of antenna locations, select one or more mobile signal technologies, and generate viewshed-based coverage polygons visualised on an interactive ArcGIS JS API v4 map. Each resulting layer can be downloaded as GeoJSON.

---

## Prerequisites

- An ArcGIS Online account with sufficient credits (viewshed + export operations).
- A registered app in [ArcGIS Developers](https://developers.arcgis.com) with OAuth 2.0 enabled and the app's redirect URI pointing to where the app is hosted (e.g. `http://localhost:8080` for local dev). The **Client ID** is a required configuration value.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Markup / styles | Vanilla HTML5 + CSS3 |
| Logic | Vanilla ES2022 (modules via `<script type="module">`) |
| Map | ArcGIS JS API v4 (CDN) |
| Authentication | ArcGIS JS API `IdentityManager` (OAuth 2.0 PKCE) |
| No build step | ✓ |

---

## File Structure

```
/
├── index.html
├── css/
│   └── style.css
└── js/
    ├── config.js       # Client ID, default endpoints, signal profiles
    ├── auth.js         # OAuth sign-in/sign-out via esriId
    ├── api.js          # All ArcGIS REST API calls
    ├── workflow.js     # Job orchestration (parallel or sequential)
    ├── map.js          # Map init, layer rendering, legend
    └── app.js          # UI wiring, event listeners, state
```

---

## Configuration (`js/config.js`)

```js
export const CLIENT_ID = "YOUR_CLIENT_ID_HERE"; // replace before use

export const PORTAL_URL = "https://www.arcgis.com";
export const VIEWSHED_SUBMIT_URL =
  "https://analysis3.arcgis.com/arcgis/rest/services/tasks/GPServer/CreateViewshed/submitJob";
export const VIEWSHED_JOB_BASE =
  "https://analysis3.arcgis.com/arcgis/rest/services/tasks/GPServer/CreateViewshed/jobs";

export const SIGNAL_PROFILES = {
  "2G_GSM":      { observerHeight: 100, observerHeightUnits: "Feet", targetHeight: 5, targetHeightUnits: "Feet", maximumDistance: 12, maxDistanceUnits: "Miles", color: [108, 117, 125, 0.35] },
  "3G_UMTS":     { observerHeight: 100, observerHeightUnits: "Feet", targetHeight: 5, targetHeightUnits: "Feet", maximumDistance: 8,  maxDistanceUnits: "Miles", color: [40,  167, 69,  0.35] },
  "4G_LTE":      { observerHeight: 100, observerHeightUnits: "Feet", targetHeight: 5, targetHeightUnits: "Feet", maximumDistance: 10, maxDistanceUnits: "Miles", color: [255, 140, 0,   0.35] },
  "5G_NR_sub6":  { observerHeight: 100, observerHeightUnits: "Feet", targetHeight: 5, targetHeightUnits: "Feet", maximumDistance: 3,  maxDistanceUnits: "Miles", color: [111, 66,  193, 0.35] },
  "5G_NR_mmWave":{ observerHeight: 100, observerHeightUnits: "Feet", targetHeight: 5, targetHeightUnits: "Feet", maximumDistance: 0.6,maxDistanceUnits: "Miles", color: [220, 53,  69,  0.35] },
};
```

---

## Screens / UI Sections

The app is a single page divided into four collapsible sections that appear sequentially as the user progresses.

### 1. Header bar (always visible)
- App title: **Coverage Map Generator**
- Right side: `[Sign in with ArcGIS]` button → becomes user avatar + username + `[Sign out]` after login.

---

### 2. Input Panel (visible after sign-in)

#### 2a. Input Layer Source (tab/radio group)

**Tab A — Public Feature Layer**
```
URL:    [____________________________________________]
Filter: [optional SQL WHERE clause, e.g. LocCounty='RIVERSIDE']
```

**Tab B — Private Feature Layer**
```
URL:           [_________________________________________]
Service Token: [_________________________________________]
Filter:        [optional SQL WHERE clause]
```

**Tab C — Upload GeoJSON**
```
[Choose file…]  or drag-and-drop a .geojson / .json file
(must be a FeatureCollection of Point features)
```

#### 2b. Signal Technologies (checkbox group)
```
[ ] 2G GSM       — max 12 mi
[ ] 3G UMTS      — max 8 mi
[ ] 4G LTE       — max 10 mi
[ ] 5G NR sub-6  — max 3 mi
[ ] 5G NR mmWave — max 0.6 mi
```
At least one must be selected.

#### 2c. Processing Mode (radio)
```
(●) Parallel   — submit all jobs simultaneously (faster)
( ) Sequential — process one technology at a time
```

#### 2d. Output naming
```
Title prefix: [coverage]   →  files named like  coverage_4G_LTE_2026-02-26.geojson
```

#### 2e. Action button
```
[ Generate Coverage Maps ]
```
Disabled until: user is signed in, at least one technology selected, input layer configured.

---

### 3. Progress Panel (appears after Generate is clicked)

One row per selected technology, columns:

| Technology | Status | Detail |
|---|---|---|
| 4G LTE | ⏳ Submitting job… | — |
| 2G GSM | 🔄 Processing (poll 3/∞) | jobId: abc123 |
| 5G NR sub-6 | 📤 Exporting GeoJSON… | — |
| 3G UMTS | ✅ Done | [⬇ Download] |
| 5G NR mmWave | ❌ Failed | Job timed out after 5 min |

Statuses (in order):
1. `Pending`
2. `Submitting job`
3. `Processing` (shows poll count; polls every 5 s, timeout 10 min)
4. `Fetching layer info`
5. `Exporting GeoJSON`
6. `Waiting for export` (polls every 3 s)
7. `Downloading`
8. `Done` — shows individual ⬇ Download button
9. `Failed` — shows error message

---

### 4. Map Panel (appears as layers complete)

Full-width ArcGIS JS API v4 map. As each technology finishes:
- Its GeoJSON is added as a `GeoJSONLayer` with the technology's colour.
- The map zooms/pans to fit all loaded layers.
- A collapsible **legend** in the bottom-left shows each technology's colour swatch and label, with a visibility toggle (eye icon).
- A **Download All** button in the top-right downloads a zip of all completed GeoJSON files.

---

## API Workflow (per technology)

### Step 1 — Build `inputLayer`

| Source tab | JSON shape |
|---|---|
| Public URL | `{ "url": "…", "filter": "…" }` |
| Private URL | `{ "url": "…", "serviceToken": "…", "filter": "…" }` |
| GeoJSON upload | ArcGIS Feature Collection (see `COVERAGE_GENERATION.md §ArcGIS Feature Collection`) |

### Step 2 — Submit Viewshed job

`GET https://analysis3.arcgis.com/…/CreateViewshed/submitJob`

Key params from `SIGNAL_PROFILES[tech]` plus:
```
outputName.serviceProperties.name = "{tech}_coverage"
outputName.itemProperties.title   = "{tech}_coverage_{YYYY-MM-DD}"
context.outSR.latestWkid          = 4326
f                                  = json
token                              = <from esriId>
inputLayer                         = <from Step 1, JSON-stringified>
```

Response → `jobId`.

### Step 3 — Poll job status

`GET …/CreateViewshed/jobs/{jobId}?token=…&f=json`  every 5 s.

- `esriJobSucceeded` → continue.
- `esriJobFailed` / `esriJobCancelled` → mark row as Failed.
- Timeout after 10 min → mark row as Failed.

### Step 4 — Fetch viewshed layer info

`GET …/CreateViewshed/jobs/{jobId}/results/viewshedLayer?returnType=data&f=json&token=…`

Response → `value.itemId`, `value.url`.

### Step 5 — Get current user ID (once, cached)

`GET https://www.arcgis.com/sharing/rest/portals/self?f=json&token=…`

Response → `user.username` (used in export URL).

### Step 6 — Export as GeoJSON

`POST https://www.arcgis.com/sharing/rest/content/users/{username}/export`

```
f            = json
itemId       = <from Step 4>
title        = "{titlePrefix}_{tech}_{YYYY-MM-DD}"
exportFormat = GeoJson
token        = …
```

Response → `exportItemId`, `jobId` (export job).

### Step 7 — Poll export status

`GET …/content/users/{username}/items/{exportItemId}/status?f=json&jobId={exportJobId}&jobType=export&token=…`  every 3 s.

- `status === "completed"` → continue.
- Any failure status → mark row as Failed.

### Step 8 — Download GeoJSON

`GET https://www.arcgis.com/sharing/rest/content/items/{exportItemId}/data?token=…`

Save the response as `{titlePrefix}_{tech}_{date}.geojson` and add to the map.

---

## Authentication (`js/auth.js`)

Uses ArcGIS JS API `IdentityManager`:

```js
import OAuthInfo from "@arcgis/core/identity/OAuthInfo.js";
import esriId    from "@arcgis/core/identity/IdentityManager.js";

esriId.registerOAuthInfo(new OAuthInfo({
  appId: CLIENT_ID,
  popup: false,          // redirect flow (no popup blocker issues)
  portalUrl: PORTAL_URL,
}));

// Check existing session on load
await esriId.checkSignInStatus(`${PORTAL_URL}/sharing`);

// Trigger sign-in
await esriId.getCredential(`${PORTAL_URL}/sharing`);

// Get token for API calls
const cred = await esriId.getCredential(`${PORTAL_URL}/sharing`);
cred.token; // use this in all API calls
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| OAuth sign-in fails | Show banner: "Sign-in failed. Check your Client ID and redirect URI." |
| Input validation (no tech selected, empty URL) | Inline field error, Generate button stays disabled |
| Viewshed job fails | Row marked Failed with ArcGIS error message |
| Export/download fails | Row marked Failed; other technologies are unaffected |
| Network error during polling | Retry up to 3× then mark Failed |
| GeoJSON upload not a Point FeatureCollection | Inline error before submission |

---

## Visual Design Notes

- Clean, light theme. No heavy frameworks — plain CSS variables for colours.
- Progress rows use colour-coded left borders matching the technology colour from `SIGNAL_PROFILES`.
- Map fills the bottom half of the viewport (or full screen toggle button).
- Responsive: panels stack vertically on narrow screens; map goes full-width.

---

## Out of Scope (v1)

- Drawing points directly on the map (upload GeoJSON covers this use case).
- Saving sessions or history.
- Multi-user / back-end server.
- Merging coverage layers across technologies.
- Custom viewshed parameters per antenna.
