# CLAUDE.md — Basemap Effects Code Explorer

Project-level instructions for Claude Code. Read this at the start of every session.
For technical reference (stack, API patterns, file map, gotchas), see [AGENTS.md](AGENTS.md).

---

## What this project is

A read-only developer-education tool: load a public ArcGIS Online webmap, visualize its
basemap effects in 2D and 3D side-by-side (tab-toggled), and surface copy-pasteable SDK
code that reproduces those effects programmatically.

Full spec: [SPEC.md](SPEC.md). Phased build plan and progress tracking: [TODO.md](TODO.md).

---

## Behaviour rules (always follow these)

### TODO.md is the source of truth for progress
- After completing any task (or part of a task), **immediately check it off** in TODO.md.
- Do not batch completions — mark done as soon as each atomic step is finished.
- If a task turns out to be wrong, out of scope, or superseded, remove it or annotate it.

### Proactively propose file updates after changes
After any session where we have:
- Fixed one or more errors (lint, build, or runtime)
- Made architectural decisions not already recorded
- Discovered a new gotcha or API behaviour
- Changed how a module works

…ask the user at the end: **"Want me to update CLAUDE.md / AGENTS.md with what we learned?"**
Do not silently skip this. It is important for reducing repeated mistakes across sessions.

### Ask before destructive actions
Confirm before: deleting files, force-pushing, resetting git state, dropping things from
package.json. A quick "shall I?" costs nothing; an accidental deletion can cost a lot.

### Keep responses concise
- Prefer showing the changed code over explaining it at length.
- Do not repeat back the SPEC or these instructions to confirm you read them.
- Use markdown link syntax for file references: [filename.js](src/filename.js).

---

## Coding style

- **Plain JavaScript (ES modules).** No TypeScript, no JSX, no framework.
- **No over-engineering.** Three similar lines of code is better than a premature abstraction.
- **No unsolicited improvements.** If the task is "fix the lint error", fix the lint error —
  don't also refactor, add comments, or rename things.
- **No defensive code for impossible cases.** Only validate at real system boundaries (user
  input, external API responses). Do not add null-guards for things that cannot be null.
- **No docstrings on untouched functions.** Only add JSDoc if you wrote or substantially
  changed that function.
- **CSS co-located with its module.** Each `src/<module>/` directory owns its own `.css` file,
  imported centrally from `src/main.js`.
- **Imports** — use explicit `.js` extensions on local imports. Named exports preferred over
  default exports for module files.

---

## Constraints from the SPEC

- **Read-only.** No editing of blend modes, effects, or opacity in-app. Never add controls
  that mutate layer properties.
- **No backend.** All data from AGOL public REST API. No server-side logic, no auth (v1).
- **No operational layers.** Show a warning banner if a webmap has them; do not load them.
- **Public webmaps only.** Do not add IdentityManager / OAuth in v1.
- **Effects live in memory only.** Never serialize to WebScene — the shared Map instance
  carries effects across views without round-tripping through WebScene JSON.
- **Never mutate layer properties to work around 3D limitations.** Both views share the same
  layer objects — mutating `layer.effect` etc. breaks SceneView ground rendering. See AGENTS.md
  "2D vs 3D rendering differences" for the known limitation table and the correct detection-only pattern.

---

## Stack (quick reference)

| Concern | Choice |
|---|---|
| Language | Plain JS (ES modules) |
| Bundler | Vite 7.x |
| Mapping SDK | `@arcgis/core` v5 |
| Map web components | `@arcgis/map-components` v5 |
| UI components | `@esri/calcite-components` v5 |
| CSS | `@esri/calcite-components/main.css` + co-located module CSS |
| Dark mode | `class="calcite-mode-dark"` on `<body>` |

See AGENTS.md for version-specific API patterns and known pitfalls.

---

## Phase-based development

We are following the phased plan in TODO.md. Before starting a new phase:
1. Confirm all tasks in the current phase are checked off.
2. Check the "Feedback needed" section at the end of the phase — these require user input.
3. Do not jump ahead to implement features from a later phase mid-phase.
