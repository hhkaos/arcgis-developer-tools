import "./style.css";
import assetsConfig from "./config/assets.json";
import { fetchItemMetadata, fetchAllMetadata, getItemPageUrl, getMapViewerUrl } from "./api.js";
import { invalidateAllCache, getCacheAge } from "./cache.js";

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  selectedCategory: "all",
  searchQuery: "",
  selectedTypes: new Set(), // type strings currently filtered; empty = show all
  metadata: {}, // itemId → metadata | Error
  loading: new Set(), // itemIds currently being fetched
};

const ISSUE_URL = "https://github.com/hhkaos/arcgis-developer-tools/issues";
const CONTACT_URL = "https://links.rauljimenez.info/";
const VALID_CATEGORY_IDS = new Set(["all", ...assetsConfig.categories.map((cat) => cat.id)]);

const SEARCH_FIELD_WEIGHTS = {
  title: 12,
  snippet: 8,
  description: 5,
  type: 6,
  tags: 4,
  typeKeywords: 3,
  itemId: 2,
};

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitSearchTerms(value) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function isSubsequenceMatch(needle, haystack) {
  let needleIndex = 0;
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i++) {
    if (haystack[i] === needle[needleIndex]) needleIndex++;
  }
  return needleIndex === needle.length;
}

function getLevenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, idx) => idx);

  for (let i = 0; i < a.length; i++) {
    const curr = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      curr[j + 1] = Math.min(
        curr[j] + 1,
        prev[j + 1] + 1,
        prev[j] + cost
      );
    }
    prev = curr;
  }

  return prev[b.length];
}

function getFieldMatchStrength(term, text) {
  if (!term || !text) return 0;
  if (text === term) return 1;

  const words = text.split(/\s+/).filter(Boolean);

  if (words.includes(term)) return 0.97;
  if (text.startsWith(term)) return 0.93;
  if (words.some((word) => word.startsWith(term))) return 0.88;
  if (text.includes(term)) return 0.74;

  let best = 0;
  for (const word of words) {
    if (word.length < 3 || term.length < 3) continue;

    const maxLen = Math.max(word.length, term.length);
    const maxDistance = Math.max(1, Math.floor(maxLen * 0.34));
    const distance = getLevenshteinDistance(term, word);
    if (distance <= maxDistance) {
      const similarity = 1 - distance / maxLen;
      best = Math.max(best, 0.45 + similarity * 0.35);
    } else if (isSubsequenceMatch(term, word)) {
      const density = term.length / word.length;
      best = Math.max(best, 0.35 + density * 0.2);
    }
  }

  return best;
}

function getSearchFields(item) {
  const meta = state.metadata[item.id];

  return {
    title: normalizeSearchText(item.hardcoded?.title ?? meta?.title),
    snippet: normalizeSearchText(item.hardcoded?.snippet ?? meta?.snippet),
    description: normalizeSearchText(meta?.description),
    type: normalizeSearchText(item.hardcoded?.type ?? meta?.type),
    tags: normalizeSearchText((meta?.tags ?? []).join(" ")),
    typeKeywords: normalizeSearchText((meta?.typeKeywords ?? []).join(" ")),
    itemId: normalizeSearchText(item.id),
  };
}

function getSearchScore(item, rawQuery) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return 0;

  const terms = splitSearchTerms(query);
  if (terms.length === 0) return 0;

  const fields = getSearchFields(item);
  let totalScore = 0;

  for (const term of terms) {
    let termScore = 0;

    for (const [fieldName, weight] of Object.entries(SEARCH_FIELD_WEIGHTS)) {
      const matchStrength = getFieldMatchStrength(term, fields[fieldName]);
      if (matchStrength > 0) {
        termScore += matchStrength * weight;
      }
    }

    if (termScore === 0) return 0;
    totalScore += termScore;
  }

  if (fields.title.startsWith(query)) totalScore += 10;
  else if (fields.title.includes(query)) totalScore += 7;

  if (fields.snippet.startsWith(query)) totalScore += 5;
  else if (fields.snippet.includes(query)) totalScore += 3;

  if (fields.description.includes(query)) totalScore += 2;

  return totalScore;
}

// ─── Derived: items visible given current category + search ──────────────────

// Items matching category + search, before type-chip filter
function getFilteredItemsBase() {
  const q = state.searchQuery.trim();
  const rankedItems = [];

  assetsConfig.items.forEach((item, index) => {
    if (state.selectedCategory !== "all") {
      if (!item.categories.includes(state.selectedCategory)) return;
    }

    if (!q) {
      rankedItems.push({ item, index, score: 0 });
      return;
    }

    const score = getSearchScore(item, q);
    if (score > 0) {
      rankedItems.push({ item, index, score });
    }
  });

  if (!q) {
    return rankedItems.map(({ item }) => item);
  }

  rankedItems.sort((a, b) => b.score - a.score || a.index - b.index);
  return rankedItems.map(({ item }) => item);
}

function getVisibleItems() {
  const base = getFilteredItemsBase();
  if (state.selectedTypes.size === 0) return base;
  return base.filter((item) => {
    const type = item.hardcoded?.type ?? state.metadata[item.id]?.type ?? "";
    return state.selectedTypes.has(type);
  });
}

// ─── Type badge helpers ───────────────────────────────────────────────────────

const TYPE_BADGE = {
  "Vector Tile Layer": { label: "Vector Tile", cls: "bg-indigo-100 text-indigo-700" },
  "Map Service": { label: "Map Service", cls: "bg-amber-100 text-amber-700" },
  "Feature Service": { label: "Feature Service", cls: "bg-green-100 text-green-700" },
  "Image Service": { label: "Image Service", cls: "bg-yellow-100 text-yellow-700" },
  "Web Map": { label: "Web Map", cls: "bg-blue-100 text-blue-700" },
  "Web Scene": { label: "Web Scene", cls: "bg-cyan-100 text-cyan-700" },
  "External": { label: "External", cls: "bg-orange-100 text-orange-700" },
};

function typeBadge(type) {
  const info = TYPE_BADGE[type] ?? { label: type, cls: "bg-gray-100 text-gray-600" };
  return `<span class="inline-block px-2 py-0.5 rounded text-xs font-medium ${info.cls}">${info.label}</span>`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg = "Copied!") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("opacity-0");
  el.classList.add("opacity-100");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("opacity-100");
    el.classList.add("opacity-0");
  }, 1800);
}

// ─── Copy to clipboard ────────────────────────────────────────────────────────

async function copyToClipboard(text, successMessage = "Item ID copied!") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    // Fallback for http/non-secure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast(successMessage);
  }
}

// ─── URL state ────────────────────────────────────────────────────────────────

function buildFilterUrl() {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  params.delete("q");
  params.delete("category");
  params.delete("type");

  const query = state.searchQuery.trim();
  if (query) params.set("q", query);

  if (state.selectedCategory !== "all") {
    params.set("category", state.selectedCategory);
  }

  [...state.selectedTypes]
    .sort((a, b) => a.localeCompare(b))
    .forEach((type) => params.append("type", type));

  url.search = params.toString();
  return url;
}

function syncUrlState() {
  const url = buildFilterUrl();
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const searchQuery = params.get("q");
  const category = params.get("category");
  const types = params.getAll("type");

  state.searchQuery = searchQuery ?? "";

  if (category && VALID_CATEGORY_IDS.has(category)) {
    state.selectedCategory = category;
  }

  state.selectedTypes.clear();
  types
    .map((type) => type.trim())
    .filter(Boolean)
    .forEach((type) => state.selectedTypes.add(type));
}

async function copyShareLink() {
  const shareUrl = buildFilterUrl().toString();
  await copyToClipboard(shareUrl, "Share link copied!");
}

// ─── Cache status bar ─────────────────────────────────────────────────────────

function updateCacheStatus() {
  const ageMs = getCacheAge();
  const ageText = document.getElementById("cache-age-text");
  const refreshBtn = document.getElementById("refresh-all-btn");

  if (ageMs === null) {
    ageText.textContent = "";
    refreshBtn.classList.add("hidden");
    return;
  }

  const mins = Math.floor(ageMs / 60000);
  const hrs = Math.floor(mins / 60);
  const label = hrs > 0 ? `${hrs}h ago` : mins > 0 ? `${mins}m ago` : "just now";

  ageText.textContent = `Last updated: ${label}`;
  refreshBtn.classList.remove("hidden");
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function renderSidebar() {
  const nav = document.getElementById("category-nav");

  // Update "All" count
  document.getElementById("count-all").textContent =
    assetsConfig.items.length;

  // Remove old category buttons (keep "All")
  const existing = nav.querySelectorAll("[data-category]:not([data-category='all'])");
  existing.forEach((el) => el.remove());

  assetsConfig.categories.forEach((cat) => {
    const count = assetsConfig.items.filter((i) => i.categories.includes(cat.id)).length;
    const isActive = state.selectedCategory === cat.id;
    const btn = document.createElement("button");
    btn.dataset.category = cat.id;
    btn.className = `category-btn w-full text-left px-3 py-2 rounded-lg text-sm font-medium flex items-start gap-2 transition-colors ${
      isActive
        ? "bg-blue-50 text-blue-700"
        : "text-gray-600 hover:bg-gray-100"
    }`;
    btn.innerHTML = `
      <span class="flex-none">${cat.icon}</span>
      <span class="flex-1 leading-snug">${cat.label}</span>
      <span class="flex-none text-xs font-normal ${isActive ? "text-blue-500" : "text-gray-400"}">${count}</span>
    `;
    nav.appendChild(btn);
  });

  // Update active state on "All" button
  const allBtn = nav.querySelector("[data-category='all']");
  const allActive = state.selectedCategory === "all";
  allBtn.className = `category-btn w-full text-left px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
    allActive ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100"
  }`;
  allBtn.querySelector("span:last-child").className = `ml-auto text-xs font-normal ${allActive ? "text-blue-500" : "text-gray-400"}`;
}

// ─── Card rendering ───────────────────────────────────────────────────────────

function renderCard(item) {
  const meta = state.metadata[item.id];
  const isLoading = state.loading.has(item.id);
  const isError = meta instanceof Error;
  const isHardcoded = !!item.hardcoded;
  const isExternal = isHardcoded && item.hardcoded.type === "External";

  const title = isHardcoded
    ? item.hardcoded.title
    : isError ? item.id : (meta?.title ?? "");

  const snippet = isHardcoded
    ? item.hardcoded.snippet
    : isError ? "" : (meta?.snippet ?? "");

  const type = isHardcoded
    ? item.hardcoded.type
    : isError ? "" : (meta?.type ?? "");

  const thumbnailUrl = isHardcoded
    ? item.hardcoded.thumbnailUrl
    : isError ? "" : (meta?.thumbnailUrl ?? "");

  const card = document.createElement("div");
  card.dataset.itemId = item.id;
  card.className =
    "group relative bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col";

  // Thumbnail area
  const thumbSection = document.createElement("div");
  thumbSection.className = "relative bg-gray-100 aspect-video flex items-center justify-center overflow-hidden";

  if (isLoading) {
    thumbSection.innerHTML = `
      <div class="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
    `;
  } else if (thumbnailUrl) {
    thumbSection.innerHTML = `
      <img
        src="${thumbnailUrl}"
        alt="${title}"
        class="w-full h-full object-cover"
        loading="lazy"
        onerror="this.parentElement.innerHTML='<div class=\\'text-gray-400 text-xs text-center p-2\\'>No preview</div>'"
      />
    `;
  } else {
    thumbSection.innerHTML = `
      <div class="text-gray-300 text-xs text-center px-3">${isExternal ? "🔗" : "No thumbnail"}</div>
    `;
  }

  // Refresh icon (appears on hover, not shown for hardcoded/external items)
  if (!isHardcoded) {
    const refreshBtn = document.createElement("button");
    refreshBtn.className =
      "absolute top-1.5 right-1.5 p-1 rounded bg-white/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-gray-900 z-10";
    refreshBtn.title = "Refresh item";
    refreshBtn.innerHTML = `
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
      </svg>
    `;
    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      refreshItem(item.id);
    });
    thumbSection.appendChild(refreshBtn);
  }

  card.appendChild(thumbSection);

  // Body
  const body = document.createElement("div");
  body.className = "flex flex-col gap-1 p-3 flex-1";

  // Title row with type badge
  body.innerHTML = `
    <div class="flex items-start gap-1.5 justify-between">
      <span class="text-sm font-medium text-gray-900 leading-tight line-clamp-2 flex-1">${title || "Loading…"}</span>
    </div>
    ${type ? `<div class="mt-0.5">${typeBadge(type)}</div>` : ""}
    ${snippet ? `<p class="text-xs text-gray-500 line-clamp-2 leading-relaxed mt-0.5">${snippet}</p>` : ""}
    ${isError ? `<p class="text-xs text-red-500 flex items-center gap-1 mt-1">
      <svg class="w-3 h-3 flex-none" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
      Unable to load
    </p>` : ""}
  `;

  // Action bar
  const actions = document.createElement("div");
  actions.className =
    "flex items-center gap-1 mt-2 pt-2 border-t border-gray-100";

  if (isExternal) {
    actions.innerHTML = `
      <a href="${item.hardcoded.externalUrl}" target="_blank" rel="noopener"
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
        title="Open collection"
        onclick="event.stopPropagation()">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
        </svg>
        Open
      </a>
    `;
  } else if (!isLoading && !isError) {
    const itemId = item.id;
    actions.innerHTML = `
      <button data-action="copy" data-id="${itemId}"
        class="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
        title="Copy item ID">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
        ID
      </button>
      <a href="${getItemPageUrl(itemId)}" target="_blank" rel="noopener"
        class="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
        title="Open item page"
        onclick="event.stopPropagation()">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
        </svg>
        Page
      </a>
      <button data-action="preview" data-id="${itemId}"
        class="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-md transition-colors ml-auto"
        title="Preview in Map Viewer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.069A1 1 0 0121 8.868V15.13a1 1 0 01-1.447.899L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
        Preview
      </button>
    `;
  }

  body.appendChild(actions);
  card.appendChild(body);

  // Click card body → detail modal
  if (!isLoading && !isError) {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-action]") || e.target.closest("a")) return;
      openDetailModal(item.id);
    });
  }

  // Delegate action buttons
  actions.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.action === "copy") copyToClipboard(btn.dataset.id);
    if (btn.dataset.action === "preview") openPreview(btn.dataset.id);
  });

  return card;
}

function renderMissingResourceCard({ compact = false } = {}) {
  const card = document.createElement("div");
  card.className = compact
    ? "bg-gradient-to-br from-slate-50 to-blue-50 border border-dashed border-blue-200 rounded-xl p-4 flex flex-col justify-between min-h-[12rem]"
    : "w-full max-w-xl bg-white border border-dashed border-blue-200 rounded-2xl p-5 text-left shadow-sm";

  const titleClass = compact ? "text-sm font-semibold text-gray-900" : "text-base font-semibold text-gray-900";
  const bodyClass = compact ? "text-xs text-gray-600 leading-relaxed mt-2" : "text-sm text-gray-600 leading-relaxed mt-2";
  const actionClass = compact
    ? "inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
    : "inline-flex items-center justify-center px-3 py-2 text-sm font-medium rounded-lg transition-colors";

  card.innerHTML = `
    <div>
      <p class="${titleClass}">Missing resource?</p>
      <p class="${bodyClass}">
        Tell me what you are looking for so I can add it. Open a GitHub issue or use my links page to get in touch.
      </p>
    </div>
    <div class="mt-4 flex flex-wrap gap-2">
      <a href="${ISSUE_URL}" target="_blank" rel="noopener"
        class="${actionClass} bg-blue-600 text-white hover:bg-blue-700">
        Open an issue
      </a>
      <a href="${CONTACT_URL}" target="_blank" rel="noopener"
        class="${actionClass} border border-gray-300 text-gray-700 hover:bg-gray-50">
        Contact Raul
      </a>
    </div>
  `;

  return card;
}

// ─── Type filter chips ────────────────────────────────────────────────────────

function renderTypeChips() {
  const bar = document.getElementById("type-filter-bar");
  const baseItems = getFilteredItemsBase();

  // Tally types present in the current base-filtered set
  const typeCounts = {};
  baseItems.forEach((item) => {
    const type = item.hardcoded?.type ?? state.metadata[item.id]?.type ?? "";
    if (type) typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  });

  const types = Object.keys(typeCounts);

  // No point showing chips when ≤1 distinct type
  if (types.length <= 1) {
    bar.innerHTML = "";
    return;
  }

  bar.innerHTML = types.map((type) => {
    const isActive = state.selectedTypes.has(type);
    const badge = TYPE_BADGE[type] ?? { label: type, cls: "bg-gray-100 text-gray-600" };
    const count = typeCounts[type];
    const activeCls = `${badge.cls} ring-1 ring-current`;
    const inactiveCls = "bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600";
    return `<button data-type-chip="${type}"
      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${isActive ? activeCls : inactiveCls}">
      ${badge.label}<span class="font-normal opacity-60">${count}</span>
    </button>`;
  }).join("");
}

// ─── Grid rendering ───────────────────────────────────────────────────────────

function countItemsAcrossAllCategories() {
  const saved = state.selectedCategory;
  state.selectedCategory = "all";
  const count = getVisibleItems().length;
  state.selectedCategory = saved;
  return count;
}

function renderGrid() {
  renderTypeChips();
  const grid = document.getElementById("card-grid");
  const empty = document.getElementById("empty-state");
  const visible = getVisibleItems();

  grid.innerHTML = "";

  if (visible.length > 0) {
    empty.classList.add("hidden");
    empty.classList.remove("flex");
    visible.forEach((item) => grid.appendChild(renderCard(item)));
    grid.appendChild(renderMissingResourceCard({ compact: true }));
    return;
  }

  empty.classList.remove("hidden");
  empty.classList.add("flex");

  const q = state.searchQuery.trim();
  const isFiltered = state.selectedCategory !== "all";
  const hiddenCount = q && isFiltered ? countItemsAcrossAllCategories() : 0;

  if (hiddenCount > 0) {
    const catLabel =
      assetsConfig.categories.find((c) => c.id === state.selectedCategory)?.label ??
      "this category";
    empty.innerHTML = `
      <svg class="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"/>
      </svg>
      <p class="text-sm font-medium text-gray-600">No results in <span class="font-semibold">${catLabel}</span></p>
      <p class="text-xs text-gray-400 mt-1">
        ${hiddenCount} result${hiddenCount !== 1 ? "s" : ""} found in other categories
      </p>
      <div class="mt-3 flex items-center gap-2">
        <button id="show-all-results"
          class="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors">
          Show all ${hiddenCount} result${hiddenCount !== 1 ? "s" : ""}
        </button>
        <button id="clear-search"
          class="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
          Clear search
        </button>
      </div>
    `;
    empty.appendChild(renderMissingResourceCard());
    document.getElementById("show-all-results").addEventListener("click", () => {
      state.selectedCategory = "all";
      renderSidebar();
      renderGrid();
      syncUrlState();
    });
    document.getElementById("clear-search").addEventListener("click", () => {
      state.searchQuery = "";
      document.getElementById("search-input").value = "";
      renderGrid();
      syncUrlState();
    });
  } else {
    empty.innerHTML = `
      <svg class="w-12 h-12 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <p class="text-sm font-medium text-gray-600">No assets found</p>
    `;
    empty.appendChild(renderMissingResourceCard());
  }
}

// ─── Detail modal ────────────────────────────────────────────────────────────

function setSection(id, content, show) {
  const el = document.getElementById(id);
  el.classList.toggle("hidden", !show);
  if (content !== null) el.innerHTML = content;
}

function openDetailModal(itemId) {
  const item = assetsConfig.items.find((i) => i.id === itemId);
  if (!item) return;

  const meta = state.metadata[itemId];
  const isHardcoded = !!item.hardcoded;
  const isExternal = isHardcoded && item.hardcoded.type === "External";

  const title = isHardcoded ? item.hardcoded.title : (meta?.title ?? "");
  const snippet = isHardcoded ? item.hardcoded.snippet : (meta?.snippet ?? "");
  const description = isHardcoded ? "" : (meta?.description ?? "");
  const type = isHardcoded ? item.hardcoded.type : (meta?.type ?? "");
  const typeKeywords = isHardcoded ? [] : (meta?.typeKeywords ?? []);
  const tags = isHardcoded ? [] : (meta?.tags ?? []);
  const thumbnailUrl = isHardcoded ? item.hardcoded.thumbnailUrl : (meta?.thumbnailUrl ?? "");

  // Title + type badge
  document.getElementById("detail-title").textContent = title;
  document.getElementById("detail-type-badge").innerHTML = type ? typeBadge(type) : "";

  // Thumbnail
  const thumbWrap = document.getElementById("detail-thumb-wrap");
  const thumbImg = document.getElementById("detail-thumb");
  if (thumbnailUrl) {
    thumbImg.src = thumbnailUrl;
    thumbImg.alt = title;
    thumbWrap.classList.remove("hidden");
  } else {
    thumbWrap.classList.add("hidden");
  }

  // Snippet
  const snippetEl = document.getElementById("detail-snippet");
  snippetEl.textContent = snippet;
  document.getElementById("detail-snippet-wrap").classList.toggle("hidden", !snippet);

  // Description — ArcGIS returns HTML; strip script tags before rendering
  const cleanDesc = description.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  setSection("detail-desc", cleanDesc || null, !!cleanDesc);
  document.getElementById("detail-desc-wrap").classList.toggle("hidden", !cleanDesc);

  // Item ID
  if (!isExternal) {
    document.getElementById("detail-id").textContent = itemId;
    document.getElementById("detail-copy-id").onclick = () => copyToClipboard(itemId);
    document.getElementById("detail-id-wrap").classList.remove("hidden");
  } else {
    document.getElementById("detail-id-wrap").classList.add("hidden");
  }

  // Tags
  const tagsHtml = tags.map(
    (t) => `<span class="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">${t}</span>`
  ).join("");
  setSection("detail-tags", tagsHtml, tags.length > 0);
  document.getElementById("detail-tags-wrap").classList.toggle("hidden", tags.length === 0);

  // Type keywords (skip generic noise that adds no value)
  const SKIP_KW = new Set([
    "Registered", "Hosted Service", "Item", "Requires Subscription",
    "Requires Credits", "Public", "Shareable", "Configurable",
  ]);
  const filteredKw = typeKeywords.filter((k) => !SKIP_KW.has(k));
  const kwHtml = filteredKw.map(
    (k) => `<span class="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-xs rounded-full">${k}</span>`
  ).join("");
  setSection("detail-kw", kwHtml, filteredKw.length > 0);
  document.getElementById("detail-kw-wrap").classList.toggle("hidden", filteredKw.length === 0);

  // Footer actions
  const pageLink = document.getElementById("detail-page-link");
  const pageLabel = document.getElementById("detail-page-label");
  const previewBtn = document.getElementById("detail-preview-btn");

  if (isExternal) {
    pageLink.href = item.hardcoded.externalUrl;
    pageLabel.textContent = "Open Collection";
    previewBtn.classList.add("hidden");
  } else {
    pageLink.href = getItemPageUrl(itemId);
    pageLabel.textContent = "Item Page";
    previewBtn.classList.remove("hidden");
    previewBtn.onclick = () => {
      closeDetailModal();
      openPreview(itemId);
    };
  }

  document.getElementById("detail-modal").classList.remove("hidden");
}

function closeDetailModal() {
  document.getElementById("detail-modal").classList.add("hidden");
}

// ─── Preview ──────────────────────────────────────────────────────────────────

function openPreview(itemId) {
  const meta = state.metadata[itemId];
  const item = assetsConfig.items.find((i) => i.id === itemId);
  if (!meta || meta instanceof Error) return;

  const url = getMapViewerUrl(itemId, meta.type);

  // Switch views
  document.getElementById("grid-view").classList.add("hidden");
  document.getElementById("preview-view").classList.remove("hidden");
  document.getElementById("preview-view").classList.add("flex");

  // Title
  document.getElementById("preview-title").textContent = meta.title;

  // Actions in preview bar
  const actionsEl = document.getElementById("preview-actions");
  actionsEl.innerHTML = `
    <button data-copy-id="${itemId}"
      class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
      </svg>
      Copy ID
    </button>
    <a href="${getItemPageUrl(itemId)}" target="_blank" rel="noopener"
      class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
      </svg>
      Item Page
    </a>
    <a href="${url.replace("&embedded=1", "")}" target="_blank" rel="noopener"
      class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
      </svg>
      Open in Map Viewer
    </a>
  `;

  actionsEl.querySelector("[data-copy-id]").addEventListener("click", (e) => {
    copyToClipboard(e.currentTarget.dataset.copyId);
  });

  // Load iframe
  document.getElementById("preview-iframe").src = url;
}

function closePreview() {
  document.getElementById("preview-view").classList.add("hidden");
  document.getElementById("preview-view").classList.remove("flex");
  document.getElementById("grid-view").classList.remove("hidden");
  document.getElementById("preview-iframe").src = "";
}

function closeFeedbackPanel() {
  const panel = document.getElementById("feedback-panel");
  const trigger = document.getElementById("feedback-trigger");
  if (!panel || !trigger) return;
  panel.classList.add("hidden");
  trigger.setAttribute("aria-expanded", "false");
}

function toggleFeedbackPanel() {
  const panel = document.getElementById("feedback-panel");
  const trigger = document.getElementById("feedback-trigger");
  if (!panel || !trigger) return;

  const isHidden = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !isHidden);
  trigger.setAttribute("aria-expanded", String(isHidden));
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

async function refreshItem(itemId) {
  state.loading.add(itemId);
  renderGrid();

  try {
    const meta = await fetchItemMetadata(itemId, { force: true });
    state.metadata[itemId] = meta;
  } catch (err) {
    state.metadata[itemId] = err;
  } finally {
    state.loading.delete(itemId);
    renderGrid();
    updateCacheStatus();
  }
}

async function refreshAll() {
  const apiItemIds = assetsConfig.items
    .filter((i) => !i.hardcoded)
    .map((i) => i.id);

  apiItemIds.forEach((id) => state.loading.add(id));
  renderGrid();

  const results = await fetchAllMetadata(apiItemIds, { force: true }, (done, total) => {
    // Update cache status as items come in
    if (done === total) updateCacheStatus();
  });

  Object.assign(state.metadata, results);
  apiItemIds.forEach((id) => state.loading.delete(id));
  renderGrid();
  updateCacheStatus();
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function init() {
  restoreStateFromUrl();

  // Build sidebar
  renderSidebar();

  document.getElementById("search-input").value = state.searchQuery;

  // Sidebar click events
  document.getElementById("category-nav").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-category]");
    if (!btn) return;
    closePreview();
    state.selectedCategory = btn.dataset.category;
    state.selectedTypes.clear();
    renderSidebar();
    renderGrid();
    syncUrlState();
  });

  // Type filter chip clicks
  document.getElementById("type-filter-bar").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-type-chip]");
    if (!chip) return;
    const type = chip.dataset.typeChip;
    if (state.selectedTypes.has(type)) {
      state.selectedTypes.delete(type);
    } else {
      state.selectedTypes.add(type);
    }
    renderTypeChips();
    renderGrid();
    syncUrlState();
  });

  // Search
  document.getElementById("search-input").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    if (state.searchQuery) {
      // When searching, switch to "all" to search across categories
      state.selectedCategory = "all";
      renderSidebar();
    }
    renderGrid();
    syncUrlState();
  });

  document.getElementById("share-filters-btn").addEventListener("click", copyShareLink);

  // Refresh all button
  document.getElementById("refresh-all-btn").addEventListener("click", refreshAll);

  // Back from preview
  document.getElementById("back-btn").addEventListener("click", closePreview);

  // Detail modal close
  document.getElementById("detail-close").addEventListener("click", closeDetailModal);
  document.getElementById("detail-backdrop").addEventListener("click", closeDetailModal);

  // Feedback menu
  document.getElementById("feedback-trigger").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFeedbackPanel();
  });

  document.getElementById("feedback-panel").addEventListener("click", (e) => {
    e.stopPropagation();
    closeFeedbackPanel();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#feedback-menu")) closeFeedbackPanel();
  });

  // Escape closes modal or preview
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!document.getElementById("detail-modal").classList.contains("hidden")) {
        closeDetailModal();
      } else if (!document.getElementById("feedback-panel").classList.contains("hidden")) {
        closeFeedbackPanel();
      } else {
        closePreview();
      }
    }
  });

  // Initial render (show loading state)
  const apiItemIds = assetsConfig.items
    .filter((i) => !i.hardcoded)
    .map((i) => i.id);

  apiItemIds.forEach((id) => state.loading.add(id));
  renderGrid();
  syncUrlState();

  // Fetch all metadata (cached where available)
  const results = await fetchAllMetadata(apiItemIds, { force: false });
  Object.assign(state.metadata, results);
  apiItemIds.forEach((id) => state.loading.delete(id));

  renderGrid();
  updateCacheStatus();
  syncUrlState();
}

init();
