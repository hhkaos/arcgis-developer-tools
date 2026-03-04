/* ─────────────────────────────────────────────────────────────────────────────
   ArcGIS Vector Style Editor – Application Logic
   ───────────────────────────────────────────────────────────────────────────── */

'use strict';

// ═══ Constants ════════════════════════════════════════════════════════════════

const STYLE_URL = (id) =>
  `https://www.arcgis.com/sharing/rest/content/items/${id}/resources/styles/root.json?f=pjson`;
const ITEM_URL = (id) =>
  `https://www.arcgis.com/sharing/rest/content/items/${id}?f=pjson`;
const ITEM_DATA_URL = (id) =>
  `https://www.arcgis.com/sharing/rest/content/items/${id}/data?f=pjson`;

const JSON_PREVIEW_MAX_LAYERS = 400;

/** Layer types available for each source type */
const LAYER_TYPES = {
  vector:      ['fill', 'line', 'symbol', 'circle', 'fill-extrusion', 'heatmap'],
  raster:      ['raster'],
  'raster-dem':['hillshade'],
  geojson:     ['fill', 'line', 'symbol', 'circle', 'heatmap'],
  image:       ['raster'],
  video:       ['raster'],
};

/** Dot colours for layer type indicators */
const TYPE_COLOR = {
  fill:            '#16a34a',
  line:            '#2563eb',
  symbol:          '#7c3aed',
  circle:          '#ea580c',
  raster:          '#dc2626',
  'fill-extrusion':'#0891b2',
  heatmap:         '#d97706',
  hillshade:       '#64748b',
  background:      '#94a3b8',
};

/** Short badge labels for source types */
const SRC_LABEL = {
  vector:      'vector',
  raster:      'raster',
  'raster-dem':'dem',
  geojson:     'geojson',
  image:       'image',
  video:       'video',
};

// ═══ State ════════════════════════════════════════════════════════════════════

const state = {
  itemId:       null,
  original:     null,   // fetched style JSON (untouched)
  layers:       [],     // current ordered layers array
  addedSources: {},     // { [id]: sourceConfig }
  addedLayerIds:new Set(),
  modalImport:  null,
  map:          null,
  previewView:  null,
  previewStyleUrl: null,
  previewRefreshFrame: 0,
  previewRequestId: 0,
  sortable:     null,
  layerElements:new Map(),
  selectedLayerIds:new Set(),
  selectionAnchorId:null,
  layersDirty:  true,
  emptyLayerRow:null,
  jsonFrame:    0,
};

// ═══ DOM helpers ══════════════════════════════════════════════════════════════

const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');
const setVisible = (el, v) => v ? show(el) : hide(el);

function setJsonPanelCollapsed(collapsed) {
  const panel = $('jsonPanel');
  const mapPanel = document.querySelector('.map-panel');
  const btn = $('toggleJsonBtn');
  if (!panel || !btn) return;

  panel.classList.toggle('json-collapsed', collapsed);
  mapPanel?.classList.toggle('json-collapsed', collapsed);
  btn.textContent = collapsed ? 'Show JSON' : 'Hide JSON';
  btn.setAttribute('aria-expanded', String(!collapsed));
}

function showStatus(msg, type = 'info') {
  const s = $('statusMsg');
  s.textContent = msg;
  s.className = `status-msg status-${type}`;
}
function hideStatus() { $('statusMsg').className = 'status-msg hidden'; }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function trunc(str, n = 50) {
  return str && str.length > n ? str.slice(0, n) + '…' : str;
}

function resetModalImportState() {
  state.modalImport = {
    loading: false,
    status: 'idle',
    message: '',
    sourceLayers: [],
    styleSourceId: null,
    styleLayers: [],
    selectedStyleLayerIds: new Set(),
    styleLayerSearch: '',
    styleLayerPickerOpen: false,
    importStyledLayersEnabled: false,
    styleOrigin: null,
  };
}

function normalizePreviewCenter(center) {
  if (!center) return null;

  if (Array.isArray(center) && center.length >= 2) {
    const [x, y] = center;
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }

  const x = center.longitude ?? center.lng ?? center.x;
  const y = center.latitude ?? center.lat ?? center.y;
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function getCurrentPreviewCamera() {
  if (state.map) {
    return {
      center: normalizePreviewCenter(state.map.getCenter()),
      zoom: state.map.getZoom(),
      bearing: state.map.getBearing(),
      pitch: state.map.getPitch(),
    };
  }

  if (state.previewView) {
    return {
      center: normalizePreviewCenter(state.previewView.center),
      zoom: state.previewView.zoom,
      bearing: state.previewView.rotation || 0,
      pitch: state.previewView.camera?.tilt || 0,
    };
  }

  return null;
}

function applyPreviewCamera(style, camera) {
  if (!camera) return style;

  const next = { ...style };
  const center = normalizePreviewCenter(camera.center);
  if (center) next.center = center;
  if (Number.isFinite(camera.zoom)) next.zoom = camera.zoom;
  if (Number.isFinite(camera.bearing)) next.bearing = camera.bearing;
  if (Number.isFinite(camera.pitch)) next.pitch = camera.pitch;
  return next;
}

function schedulePreviewRefresh() {
  if (!state.original) return;

  const requestId = ++state.previewRequestId;
  if (state.previewRefreshFrame) cancelAnimationFrame(state.previewRefreshFrame);

  state.previewRefreshFrame = requestAnimationFrame(() => {
    state.previewRefreshFrame = 0;
    previewMap(requestId);
  });
}

function uniqueLayerId(baseId) {
  let id = baseId;
  let i = 2;
  while (state.layers.some((layer) => layer.id === id)) {
    id = `${baseId}-${i++}`;
  }
  return id;
}

function sanitizeId(value, fallback = 'custom-source') {
  const clean = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || fallback;
}

function markLayersDirty() {
  state.layersDirty = true;
}

function pruneSelectedLayerIds() {
  const validIds = new Set(state.layers.map((layer) => layer.id));
  for (const id of [...state.selectedLayerIds]) {
    if (!validIds.has(id)) state.selectedLayerIds.delete(id);
  }
  if (state.selectionAnchorId && !validIds.has(state.selectionAnchorId)) {
    state.selectionAnchorId = null;
  }
}

function syncLayerSelectionUi() {
  pruneSelectedLayerIds();
  for (const [id, item] of state.layerElements) {
    item.classList.toggle('layer-selected', state.selectedLayerIds.has(id));
  }
}

function setSelectedLayerIds(ids, anchorId = null) {
  const nextIds = Array.from(ids);
  state.selectedLayerIds = new Set(nextIds);
  state.selectionAnchorId = anchorId ?? nextIds[nextIds.length - 1] ?? null;
  syncLayerSelectionUi();
}

function getLayerIndex(layerId) {
  return state.layers.findIndex((layer) => layer.id === layerId);
}

function handleLayerSelection(layerId, options = {}) {
  if (!layerId) return;
  const { range = false, toggle = false } = options;

  if (range) {
    const anchorId = state.selectionAnchorId || layerId;
    const anchorIndex = getLayerIndex(anchorId);
    const targetIndex = getLayerIndex(layerId);

    if (anchorIndex === -1 || targetIndex === -1) {
      setSelectedLayerIds([layerId], layerId);
      return;
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const rangeIds = state.layers.slice(start, end + 1).map((layer) => layer.id);
    setSelectedLayerIds(rangeIds, anchorId);
    return;
  }

  if (toggle) {
    if (state.selectedLayerIds.has(layerId)) {
      state.selectedLayerIds.delete(layerId);
    } else {
      state.selectedLayerIds.add(layerId);
    }
    state.selectionAnchorId = layerId;
  } else if (state.selectedLayerIds.size !== 1 || !state.selectedLayerIds.has(layerId)) {
    state.selectedLayerIds = new Set([layerId]);
    state.selectionAnchorId = layerId;
  }

  syncLayerSelectionUi();
}

function appendQuery(url, key, value) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function buildArcgisRootStyleUrl(serviceUrl) {
  const normalized = normalizeArcgisServiceUrl(serviceUrl);
  return normalized ? appendQuery(`${normalized}/resources/styles/root.json`, 'f', 'pjson') : null;
}

function normalizeArcgisServiceUrl(url) {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  const match = raw.match(/^(https?:\/\/[^?#]*\/VectorTileServer)/i);
  if (match) return match[1].replace(/\/+$/, '');
  return raw.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

function getVectorSourceCandidates(style) {
  if (!style?.sources) return [];
  return Object.entries(style.sources)
    .filter(([, src]) => src?.type === 'vector')
    .map(([id, src]) => ({ id, src }));
}

function pickStyleSource(style, preferredServiceUrl = null) {
  const vectorSources = getVectorSourceCandidates(style);
  if (!vectorSources.length) return null;

  if (preferredServiceUrl) {
    const matched = vectorSources.find(({ src }) =>
      normalizeArcgisServiceUrl(src.url) === preferredServiceUrl
    );
    if (matched) return matched;
  }

  if (vectorSources.length === 1) return vectorSources[0];

  const layerSourceIds = new Set(
    (style.layers || [])
      .map((layer) => layer.source)
      .filter((sourceId) => vectorSources.some(({ id }) => id === sourceId))
  );

  if (layerSourceIds.size === 1) {
    const onlyId = [...layerSourceIds][0];
    return vectorSources.find(({ id }) => id === onlyId) || null;
  }

  return null;
}

function collectSourceLayerNames(serviceMeta, style, styleSourceId) {
  const names = new Set();

  const addName = (name) => {
    if (typeof name === 'string' && name.trim()) names.add(name.trim());
  };

  const vectors = serviceMeta?.vectorLayers;
  if (Array.isArray(vectors)) {
    for (const entry of vectors) addName(entry?.id || entry?.name);
  }

  for (const layer of style?.layers || []) {
    if (styleSourceId && layer.source && layer.source !== styleSourceId) continue;
    addName(layer['source-layer']);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function getSelectedDiscoveredStyleLayers() {
  const allLayers = state.modalImport?.styleLayers || [];
  const selectedIds = state.modalImport?.selectedStyleLayerIds || new Set();
  return allLayers.filter((layer) => selectedIds.has(layer.id));
}

function summarizeDiscoveredStyleLayerSelection() {
  const total = state.modalImport?.styleLayers?.length || 0;
  const selected = getSelectedDiscoveredStyleLayers().length;

  if (!total) return 'No styled layers available';
  if (selected === total) return `All ${total} styled layers selected`;
  if (!selected) return `No styled layers selected`;
  return `${selected} of ${total} styled layers selected`;
}

function bindArcgisDiscoveryControls(canImport) {
  const picker = document.querySelector('.style-layer-picker');
  const importToggle = $('importStyledLayers');
  const searchInput = $('styleLayerSearch');
  const includeAll = $('includeAllStyledLayers');

  picker?.addEventListener('toggle', () => {
    state.modalImport.styleLayerPickerOpen = picker.open;
  });

  searchInput?.addEventListener('input', (event) => {
    state.modalImport.styleLayerSearch = event.target.value;
    renderArcgisDiscovery();
  });

  if (state.modalImport.styleLayerPickerOpen && searchInput) {
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }

  includeAll?.addEventListener('change', (event) => {
    if (event.target.checked) {
      state.modalImport.selectedStyleLayerIds = new Set(
        (state.modalImport?.styleLayers || []).map((layer) => layer.id)
      );
    } else {
      state.modalImport.selectedStyleLayerIds = new Set();
    }
    renderArcgisDiscovery();
  });

  if (!canImport) return;

  for (const checkbox of document.querySelectorAll('.style-layer-option input[type="checkbox"][data-layer-id]')) {
    checkbox.addEventListener('change', (event) => {
      const layerId = event.target.dataset.layerId;
      if (!layerId) return;

      if (event.target.checked) {
        state.modalImport.selectedStyleLayerIds.add(layerId);
      } else {
        state.modalImport.selectedStyleLayerIds.delete(layerId);
      }

      renderArcgisDiscovery();
    });
  }

  importToggle?.addEventListener('change', () => {
    state.modalImport.importStyledLayersEnabled = importToggle.checked;
    if (importToggle.checked && !getSelectedDiscoveredStyleLayers().length) {
      state.modalImport.selectedStyleLayerIds = new Set(
        (state.modalImport?.styleLayers || []).map((layer) => layer.id)
      );
      renderArcgisDiscovery();
    }
  });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${res.statusText}`);
  const data = await res.json();
  return { data, responseUrl: res.url || url };
}

function loadArcgisModules(modules) {
  return new Promise((resolve, reject) => {
    if (typeof window.require !== 'function') {
      reject(new Error('ArcGIS JavaScript SDK failed to load.'));
      return;
    }

    window.require(modules, (...loaded) => resolve(loaded), reject);
  });
}

function absolutizeUrl(url, baseUrl) {
  if (typeof url !== 'string' || !url.trim()) return url;
  if (!baseUrl) return url;

  const templateTokens = [];
  const protectedUrl = url.replace(/\{[^}]+\}/g, (token) => {
    const marker = `__CODEx_TOKEN_${templateTokens.length}__`;
    templateTokens.push(token);
    return marker;
  });

  try {
    let resolved = new URL(protectedUrl, baseUrl).toString();
    templateTokens.forEach((token, index) => {
      resolved = resolved.replace(`__CODEx_TOKEN_${index}__`, token);
    });
    return resolved;
  } catch {
    return url;
  }
}

function normalizeSpriteUrl(url, baseUrl) {
  const resolved = absolutizeUrl(url, baseUrl);
  if (typeof resolved !== 'string' || !resolved.trim()) return resolved;

  try {
    const parsed = new URL(resolved);
    parsed.pathname = parsed.pathname.replace(/(?:@2x)?\.(?:json|png)$/i, '');
    return parsed.toString();
  } catch {
    return resolved.replace(/(?:@2x)?\.(?:json|png)(?=$|[?#])/i, '');
  }
}

function normalizeStyleAssetUrls(style, baseUrl) {
  if (!style || typeof style !== 'object') return style;

  const normalized = {
    ...style,
    glyphs: absolutizeUrl(style.glyphs, baseUrl),
    sprite: normalizeSpriteUrl(style.sprite, baseUrl),
  };

  if (!style.sources || typeof style.sources !== 'object') return normalized;

  normalized.sources = Object.fromEntries(
    Object.entries(style.sources).map(([id, src]) => {
      if (!src || typeof src !== 'object') return [id, src];
      return [id, {
        ...src,
        url: absolutizeUrl(src.url, baseUrl),
      }];
    })
  );

  return normalized;
}

function buildSpriteAssetUrl(spriteBase, suffix) {
  if (typeof spriteBase !== 'string' || !spriteBase.trim()) return null;
  const match = spriteBase.trim().match(/^([^?#]+)([?#].*)?$/);
  if (!match) return null;
  return `${match[1]}${suffix}${match[2] || ''}`;
}

function collectStaticIconNames(style) {
  const icons = new Set();

  for (const layer of style?.layers || []) {
    const icon = layer?.layout?.['icon-image'];
    if (typeof icon === 'string' && icon.trim()) {
      const trimmed = icon.trim();
      // Skip tokenized icon names such as `Road/.../{_len}` because these are
      // runtime templates, not literal sprite keys.
      if (!/[{}]/.test(trimmed)) {
        icons.add(trimmed);
      }
    }
  }

  return [...icons].sort((a, b) => a.localeCompare(b));
}

async function inspectSpriteAssets(style) {
  const spriteBase = typeof style?.sprite === 'string' ? style.sprite.trim() : '';
  if (!spriteBase) {
    return {
      spriteBase: null,
      warnings: [],
      iconNames: [],
      manifestChecks: [],
    };
  }

  const warnings = [];
  const iconNames = collectStaticIconNames(style);
  const manifestTargets = [
    { label: '1x', url: buildSpriteAssetUrl(spriteBase, '.json') },
    { label: '2x', url: buildSpriteAssetUrl(spriteBase, '@2x.json') },
  ].filter((target) => !!target.url);

  const manifestChecks = [];

  for (const target of manifestTargets) {
    try {
      const { data } = await fetchJson(target.url);
      const missingIcons = iconNames.filter((icon) => !Object.prototype.hasOwnProperty.call(data, icon));

      if (missingIcons.length) {
        warnings.push(
          `${target.label} sprite manifest is missing ${missingIcons.length} referenced icon${missingIcons.length === 1 ? '' : 's'}.`
        );
      }

      manifestChecks.push({
        label: target.label,
        url: target.url,
        ok: true,
        iconCount: Object.keys(data || {}).length,
        missingIcons,
      });
    } catch (err) {
      warnings.push(`${target.label} sprite manifest could not be fetched (${err.message}).`);
      manifestChecks.push({
        label: target.label,
        url: target.url,
        ok: false,
        error: err.message,
        missingIcons: [],
      });
    }
  }

  return {
    spriteBase,
    warnings,
    iconNames,
    manifestChecks,
  };
}

async function fetchArcgisServiceInfo(serviceUrl) {
  const { data } = await fetchJson(appendQuery(serviceUrl, 'f', 'pjson'));
  if (data?.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
  return data;
}

async function fetchArcgisItemInfo(itemId) {
  const { data } = await fetchJson(ITEM_URL(itemId.trim()));
  if (data?.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
  return data;
}

async function fetchStyleFromUrl(styleUrl) {
  const { data, responseUrl } = await fetchJson(styleUrl);
  if (data?.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
  if (!data?.version || !Array.isArray(data.layers)) {
    throw new Error('Response is not a valid Mapbox GL style.');
  }
  return normalizeStyleAssetUrls(data, responseUrl);
}

// ═══ JSON Highlighting ════════════════════════════════════════════════════════

function highlightJson(json) {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(
      /("(?:\\u[0-9A-Fa-f]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (m) => {
        if (/^"/.test(m)) return /:$/.test(m) ? `<span class="jk">${m}</span>` : `<span class="js">${m}</span>`;
        if (/true|false/.test(m)) return `<span class="jb">${m}</span>`;
        if (m === 'null')         return `<span class="jn">${m}</span>`;
        return `<span class="jd">${m}</span>`;
      }
    );
}

// ═══ Build Modified Style ═════════════════════════════════════════════════════

function buildModified() {
  if (!state.original) return null;
  return {
    ...state.original,
    sources: { ...state.original.sources, ...state.addedSources },
    layers: state.layers,
  };
}

// ═══ Render: Style Meta ═══════════════════════════════════════════════════════

function renderMeta() {
  const s = state.original;
  $('styleMeta').innerHTML = `
    <div class="meta-name">${esc(s.name || 'Unnamed Style')}</div>
    <div class="meta-details">
      <span class="meta-badge">v${s.version}</span>
      <span class="meta-text">${Object.keys(s.sources).length} orig. sources</span>
      <span class="meta-text">${s.layers.length} orig. layers</span>
    </div>
  `;
}

// ═══ Render: Sources ══════════════════════════════════════════════════════════

function renderSources() {
  const all = { ...state.original.sources, ...state.addedSources };
  const list = $('sourcesList');
  list.innerHTML = '';

  if (!Object.keys(all).length) {
    list.innerHTML = '<div class="empty-list">No sources</div>';
    return;
  }

  for (const [id, src] of Object.entries(all)) {
    const isAdded = !!state.addedSources[id];
    const url = src.url
      || (src.tiles?.[0])
      || (typeof src.data === 'string' ? src.data : null)
      || src.urls?.[0] || '';

    const div = document.createElement('div');
    div.className = `source-item${isAdded ? ' source-added' : ''}`;
    div.innerHTML = `
      <div class="source-type-badge src-${esc(src.type)}">${esc(SRC_LABEL[src.type] || src.type)}</div>
      <div class="source-info">
        <span class="source-id">${esc(id)}</span>
        ${url ? `<span class="source-url" title="${esc(url)}">${esc(trunc(url, 45))}</span>` : ''}
      </div>
      ${isAdded ? `<button class="icon-btn remove-src-btn" data-id="${esc(id)}" title="Remove">×</button>` : ''}
    `;
    list.appendChild(div);
  }

  list.querySelectorAll('.remove-src-btn').forEach((btn) =>
    btn.addEventListener('click', () => removeSource(btn.dataset.id))
  );
}

function removeSource(id) {
  const previousCount = state.layers.length;
  delete state.addedSources[id];
  // Also remove layers added for this source
  state.layers = state.layers.filter((l) => {
    if (l.source === id && state.addedLayerIds.has(l.id)) {
      state.addedLayerIds.delete(l.id);
      return false;
    }
    return true;
  });
  markLayersDirty();
  renderSources();
  renderLayers();
  updateJson();
  if (state.layers.length !== previousCount) schedulePreviewRefresh();
}

// ═══ Render: Layers ═══════════════════════════════════════════════════════════

function createLayerMarkup(layer) {
  const isAdded = state.addedLayerIds.has(layer.id);
  const isSelected = state.selectedLayerIds.has(layer.id);
  const color = TYPE_COLOR[layer.type] || '#94a3b8';
  return `
    <div class="layer-item${isAdded ? ' layer-added' : ''}${isSelected ? ' layer-selected' : ''}" data-id="${esc(layer.id)}">
      <div class="drag-handle" title="Drag to reorder">
        <svg viewBox="0 0 10 16" fill="currentColor" width="9" height="14">
          <circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/>
          <circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/>
          <circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/>
        </svg>
      </div>
      <div class="layer-type-dot" style="background:${color}" title="${esc(layer.type)}"></div>
      <div class="layer-info">
        <span class="layer-id" title="${esc(layer.id)}">${esc(layer.id)}</span>
        <span class="layer-meta">
          <span class="layer-type-label">${esc(layer.type)}</span>
          ${layer.source ? `<span class="layer-source-label">${esc(layer.source)}</span>` : ''}
        </span>
      </div>
      ${isAdded ? `<button class="icon-btn remove-layer-btn" data-id="${esc(layer.id)}" title="Remove layer">×</button>` : ''}
    </div>
  `;
}

function rebuildLayersList() {
  const list = $('layersList');

  if (state.sortable) {
    state.sortable.destroy();
    state.sortable = null;
  }

  list.innerHTML = '';
  state.layerElements = new Map();
  state.emptyLayerRow = null;

  if (!state.layers.length) {
    state.layersDirty = false;
    return;
  }

  list.innerHTML = state.layers.map(createLayerMarkup).join('');

  for (const item of list.querySelectorAll('.layer-item[data-id]')) {
    state.layerElements.set(item.dataset.id, item);
  }

  state.sortable = Sortable.create(list, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'layer-ghost',
    dragClass: 'layer-dragging',
    onStart: handleLayerDragStart,
    onEnd: syncLayerOrder,
  });

  syncLayerSelectionUi();
  state.layersDirty = false;
}

function setLayerEmptyState(message) {
  const list = $('layersList');

  if (!state.emptyLayerRow) {
    state.emptyLayerRow = document.createElement('div');
    state.emptyLayerRow.className = 'empty-list';
  }

  state.emptyLayerRow.textContent = message;

  if (!state.emptyLayerRow.isConnected) {
    list.appendChild(state.emptyLayerRow);
  }
}

function clearLayerEmptyState() {
  if (state.emptyLayerRow?.isConnected) {
    state.emptyLayerRow.remove();
  }
}

function renderLayers(filter = '') {
  const q = filter.trim().toLowerCase();
  $('layerCount').textContent = state.layers.length;
  pruneSelectedLayerIds();

  if (state.layersDirty || state.layerElements.size !== state.layers.length) {
    rebuildLayersList();
  } else {
    syncLayerSelectionUi();
  }

  let visibleCount = 0;
  for (const layer of state.layers) {
    const item = state.layerElements.get(layer.id);
    if (!item) continue;

    const matches = !q || layer.id.toLowerCase().includes(q);
    item.classList.toggle('hidden', !matches);
    if (matches) visibleCount++;
  }

  if (!visibleCount) {
    setLayerEmptyState(q ? 'No layers match filter' : 'No layers');
  } else {
    clearLayerEmptyState();
  }

  if (state.sortable) {
    state.sortable.option('disabled', !!q || !visibleCount);
  }
}

function handleLayerDragStart(evt) {
  const draggedId = evt?.item?.dataset?.id;
  if (!draggedId) return;

  if (!state.selectedLayerIds.has(draggedId) || state.selectedLayerIds.size <= 1) {
    setSelectedLayerIds([draggedId], draggedId);
  }
}

function applyLayerOrder(orderedIds, rerender = false) {
  const orderedIdSet = new Set(orderedIds);
  const map = new Map(state.layers.map((l) => [l.id, l]));

  const reordered = [];
  for (const id of orderedIds) if (map.has(id)) reordered.push(map.get(id));
  // Preserve hidden (filtered-out) layers at their relative positions
  for (const l of state.layers) if (!orderedIdSet.has(l.id)) reordered.push(l);

  state.layers = reordered;
  if (rerender) {
    markLayersDirty();
    renderLayers($('layerSearch').value);
  }
  updateJson();
  schedulePreviewRefresh();
}

function buildMultiLayerOrder(orderedIds, movedId) {
  const movedIndex = orderedIds.indexOf(movedId);
  if (movedIndex === -1) return orderedIds;

  const visibleIdSet = new Set(orderedIds);
  const selectedOrdered = state.layers
    .map((layer) => layer.id)
    .filter((id) => state.selectedLayerIds.has(id) && visibleIdSet.has(id));

  if (selectedOrdered.length <= 1) return orderedIds;

  const unselectedOrdered = orderedIds.filter((id) => !state.selectedLayerIds.has(id));
  const insertAt = orderedIds
    .slice(0, movedIndex)
    .reduce((count, id) => count + (state.selectedLayerIds.has(id) ? 0 : 1), 0);

  return [
    ...unselectedOrdered.slice(0, insertAt),
    ...selectedOrdered,
    ...unselectedOrdered.slice(insertAt),
  ];
}

function syncLayerOrder(evt) {
  const items = $('layersList').querySelectorAll('.layer-item[data-id]');
  const orderedIds = Array.from(items).map((el) => el.dataset.id);
  const movedId = evt?.item?.dataset?.id;

  if (movedId && state.selectedLayerIds.size > 1 && state.selectedLayerIds.has(movedId)) {
    applyLayerOrder(buildMultiLayerOrder(orderedIds, movedId), true);
    return;
  }

  applyLayerOrder(orderedIds);
}

// ═══ JSON Output ══════════════════════════════════════════════════════════════

function updateJson() {
  const modified = buildModified();
  if (!modified) return;
  const output = $('jsonOutput');

  if (state.jsonFrame) cancelAnimationFrame(state.jsonFrame);

  if ((modified.layers?.length || 0) > JSON_PREVIEW_MAX_LAYERS) {
    output.textContent = [
      'JSON preview disabled for large styles to keep the page responsive.',
      `Layers: ${modified.layers.length}`,
      `Sources: ${Object.keys(modified.sources || {}).length}`,
      'Use Copy or Download to export the full style JSON.',
    ].join('\n');
    state.jsonFrame = 0;
    return;
  }

  const jsonText = JSON.stringify(modified, null, 2);
  const useHighlight = jsonText.length <= 120000;

  // Large styles can stall the main thread; defer and skip syntax highlighting past a threshold.
  state.jsonFrame = requestAnimationFrame(() => {
    if (useHighlight) {
      output.innerHTML = highlightJson(jsonText);
    } else {
      output.textContent = jsonText;
    }
    state.jsonFrame = 0;
  });
}

// ═══ Source Type Form Templates ═══════════════════════════════════════════════

function tileUrlInput() {
  return `
    <div class="form-group">
      <label>Input Method</label>
      <div class="radio-toggle" id="urlMethodToggle">
        <button type="button" class="radio-btn active" data-val="url">TileJSON URL</button>
        <button type="button" class="radio-btn" data-val="tiles">Tile URLs</button>
      </div>
    </div>
    <div class="form-group" id="srcUrlGroup">
      <label for="srcUrl">TileJSON / Service URL <span class="req">*</span></label>
      <input type="text" id="srcUrl" class="form-input" placeholder="https://…" />
    </div>
    <div class="form-group hidden" id="srcTilesGroup">
      <label for="srcTiles">Tile URLs <span class="req">*</span></label>
      <textarea id="srcTiles" class="form-input" rows="3" placeholder="https://{z}/{x}/{y}.pbf"></textarea>
      <div class="field-hint">One URL per line. Use {z}, {x}, {y} placeholders.</div>
    </div>
  `;
}

function zoomSchemeFields() {
  return `
    <div class="form-row-3">
      <div class="form-group">
        <label for="srcMinzoom">Min Zoom</label>
        <input type="number" id="srcMinzoom" class="form-input" value="0" min="0" max="24" />
      </div>
      <div class="form-group">
        <label for="srcMaxzoom">Max Zoom</label>
        <input type="number" id="srcMaxzoom" class="form-input" value="22" min="0" max="24" />
      </div>
      <div class="form-group">
        <label for="srcScheme">Scheme</label>
        <select id="srcScheme" class="form-select">
          <option value="xyz">XYZ</option>
          <option value="tms">TMS</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label for="srcAttribution">Attribution</label>
      <input type="text" id="srcAttribution" class="form-input" placeholder="&amp;copy; Provider Name" />
    </div>
  `;
}

function coordInputs() {
  return `
    <div class="form-group">
      <label>Corner Coordinates <span class="req">*</span></label>
      <div class="field-hint" style="margin-bottom:8px">Four corners [longitude, latitude]. Order: NW → NE → SE → SW.</div>
      <div class="coords-grid">
        <div class="coords-header">Corner</div><div class="coords-header">Longitude</div><div class="coords-header">Latitude</div>
        <div class="coords-label">Top-Left (NW)</div>
        <input type="text" id="coordNWlng" class="form-input" placeholder="-80.425" />
        <input type="text" id="coordNWlat" class="form-input" placeholder="46.437" />
        <div class="coords-label">Top-Right (NE)</div>
        <input type="text" id="coordNElng" class="form-input" placeholder="-71.516" />
        <input type="text" id="coordNElat" class="form-input" placeholder="46.437" />
        <div class="coords-label">Bottom-Right (SE)</div>
        <input type="text" id="coordSElng" class="form-input" placeholder="-71.516" />
        <input type="text" id="coordSElat" class="form-input" placeholder="37.936" />
        <div class="coords-label">Bottom-Left (SW)</div>
        <input type="text" id="coordSWlng" class="form-input" placeholder="-80.425" />
        <input type="text" id="coordSWlat" class="form-input" placeholder="37.936" />
      </div>
    </div>
  `;
}

function getSrcFields(type) {
  switch (type) {

    case 'vector':
      return `
        <div class="form-group">
          <label>Input Method</label>
          <div class="radio-toggle" id="urlMethodToggle">
            <button type="button" class="radio-btn active" data-val="arcgis">ArcGIS source import</button>
            <button type="button" class="radio-btn" data-val="url">TileJSON URL</button>
            <button type="button" class="radio-btn" data-val="tiles">Tile URLs</button>
          </div>
        </div>
        <div class="arcgis-assist" id="arcgisImportGroup">
          <div class="arcgis-assist-header">
            <div>
              <div class="arcgis-assist-title">ArcGIS source import</div>
              <div class="field-hint" style="margin-top:2px">Inspect a VectorTileServer, style item ID, or style URL to discover source layers and reuse the source style.</div>
            </div>
          </div>
          <div class="form-group">
            <label for="arcgisSrcUrl">VectorTileServer URL <span class="req">*</span></label>
            <input type="text" id="arcgisSrcUrl" class="form-input" placeholder="https://…/VectorTileServer" />
            <div class="field-hint">Use the full ArcGIS VectorTileServer endpoint.</div>
          </div>
          <div class="form-row-2">
            <div class="form-group">
              <label for="arcgisStyleItemId">Style Item ID (optional)</label>
              <input type="text" id="arcgisStyleItemId" class="form-input" placeholder="ArcGIS item ID for root.json" />
            </div>
            <div class="form-group">
              <label for="arcgisStyleUrl">Style URL (optional)</label>
              <input type="text" id="arcgisStyleUrl" class="form-input" placeholder="…/resources/styles/root.json?f=pjson" />
            </div>
          </div>
          <div class="form-group">
            <button type="button" class="btn btn-sm btn-outline" id="arcgisDetectBtn">Inspect</button>
          </div>
          <div id="arcgisDiscovery" class="arcgis-discovery hidden"></div>
        </div>
        <div class="form-group hidden" id="srcUrlGroup">
          <label for="srcUrl">TileJSON / Service URL <span class="req">*</span></label>
          <input type="text" id="srcUrl" class="form-input" placeholder="https://…" />
        </div>
        <div class="form-group hidden" id="srcTilesGroup">
          <label for="srcTiles">Tile URLs <span class="req">*</span></label>
          <textarea id="srcTiles" class="form-input" rows="3" placeholder="https://{z}/{x}/{y}.pbf"></textarea>
          <div class="field-hint">One URL per line. Use {z}, {x}, {y} placeholders.</div>
        </div>
        <div class="field-hint" style="margin:0 0 10px">
          For ArcGIS imports, use the full service endpoint (e.g. <code>…/VectorTileServer</code>).
        </div>
        ${zoomSchemeFields()}
      `;

    case 'raster':
      return `
        <div class="callout callout-info">
          <strong>ArcGIS REST tiles:</strong> use <code>{z}/{y}/{x}</code> order (row/col reversed from standard XYZ&nbsp;<code>{z}/{x}/{y}</code>).
        </div>
        ${tileUrlInput()}
        <div class="form-row-3">
          <div class="form-group">
            <label for="srcTileSize">Tile Size</label>
            <select id="srcTileSize" class="form-select">
              <option value="256">256 px</option>
              <option value="512" selected>512 px</option>
            </select>
          </div>
          <div class="form-group">
            <label for="srcMinzoom">Min Zoom</label>
            <input type="number" id="srcMinzoom" class="form-input" value="0" min="0" max="24" />
          </div>
          <div class="form-group">
            <label for="srcMaxzoom">Max Zoom</label>
            <input type="number" id="srcMaxzoom" class="form-input" value="22" min="0" max="24" />
          </div>
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label for="srcScheme">Scheme</label>
            <select id="srcScheme" class="form-select">
              <option value="xyz">XYZ</option>
              <option value="tms">TMS</option>
            </select>
          </div>
          <div class="form-group">
            <label for="srcAttribution">Attribution</label>
            <input type="text" id="srcAttribution" class="form-input" placeholder="&amp;copy; Provider" />
          </div>
        </div>
      `;

    case 'raster-dem':
      return `
        ${tileUrlInput()}
        <div class="form-row-3">
          <div class="form-group">
            <label for="srcTileSize">Tile Size</label>
            <select id="srcTileSize" class="form-select">
              <option value="256">256 px</option>
              <option value="512" selected>512 px</option>
            </select>
          </div>
          <div class="form-group">
            <label for="srcEncoding">Encoding</label>
            <select id="srcEncoding" class="form-select">
              <option value="mapbox">mapbox (Terrain RGB)</option>
              <option value="terrarium">terrarium (Mapzen/AWS)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="srcMinzoom">Max Zoom</label>
            <input type="number" id="srcMaxzoom" class="form-input" value="15" min="0" max="24" />
          </div>
        </div>
        <div class="form-group">
          <label for="srcAttribution">Attribution</label>
          <input type="text" id="srcAttribution" class="form-input" placeholder="&amp;copy; Provider" />
        </div>
      `;

    case 'geojson':
      return `
        <div class="form-group">
          <label>Data Input Method</label>
          <div class="radio-toggle" id="urlMethodToggle">
            <button type="button" class="radio-btn active" data-val="url">URL</button>
            <button type="button" class="radio-btn" data-val="inline">Inline JSON</button>
          </div>
        </div>
        <div class="form-group" id="srcUrlGroup">
          <label for="srcUrl">GeoJSON URL <span class="req">*</span></label>
          <input type="text" id="srcUrl" class="form-input" placeholder="https://example.com/data.geojson" />
        </div>
        <div class="form-group hidden" id="srcTilesGroup">
          <label for="srcTiles">Inline GeoJSON <span class="req">*</span></label>
          <textarea id="srcTiles" class="form-input code-input" rows="6" placeholder='{"type":"FeatureCollection","features":[]}'></textarea>
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label for="srcMaxzoom">Max Zoom</label>
            <input type="number" id="srcMaxzoom" class="form-input" value="18" min="0" max="24" />
          </div>
          <div class="form-group" style="display:flex;align-items:flex-end;padding-bottom:2px">
            <label class="toggle-row" style="padding:0;gap:8px">
              <div class="toggle-switch">
                <input type="checkbox" id="srcCluster" />
                <span class="toggle-track"></span>
              </div>
              <span class="toggle-label-text" style="font-size:12px">Enable clustering</span>
            </label>
          </div>
        </div>
        <div class="form-row-2 hidden" id="clusterOptions">
          <div class="form-group">
            <label for="srcClusterRadius">Cluster Radius (px)</label>
            <input type="number" id="srcClusterRadius" class="form-input" value="50" min="1" />
          </div>
          <div class="form-group">
            <label for="srcClusterMaxZoom">Max Cluster Zoom</label>
            <input type="number" id="srcClusterMaxZoom" class="form-input" placeholder="auto" min="0" max="24" />
          </div>
        </div>
      `;

    case 'image':
      return `
        <div class="form-group">
          <label for="srcUrl">Image URL <span class="req">*</span></label>
          <input type="text" id="srcUrl" class="form-input" placeholder="https://example.com/overlay.png" />
          <div class="field-hint">Must be accessible (CORS enabled). Supports PNG, JPEG, WebP.</div>
        </div>
        ${coordInputs()}
      `;

    case 'video':
      return `
        <div class="callout callout-warn">
          Video sources are only supported in web browsers (MapLibre GL JS). Not supported by ArcGIS SDKs.
        </div>
        <div class="form-group">
          <label for="srcTiles">Video URLs <span class="req">*</span></label>
          <textarea id="srcTiles" class="form-input" rows="3" placeholder="https://example.com/video.mp4&#10;https://example.com/video.webm"></textarea>
          <div class="field-hint">One URL per line. Provide multiple formats for browser compatibility.</div>
        </div>
        ${coordInputs()}
      `;

    default: return '';
  }
}

function getSrcPreFields(type) {
  return '';
}

// ═══ Layer Form Templates ═════════════════════════════════════════════════════

function getPaintFields(layerType) {
  switch (layerType) {

    case 'fill': return `
      <div class="form-row-2">
        <div class="form-group">
          <label>Fill Color</label>
          <div class="color-input-group">
            <input type="color" id="paintColorPicker" value="#0079C1" />
            <input type="text" id="paintColor" class="form-input" value="#0079C1" />
          </div>
        </div>
        <div class="form-group">
          <label>Fill Opacity&nbsp;<span class="range-val" id="paintOpacityVal">0.8</span></label>
          <input type="range" id="paintOpacity" min="0" max="1" step="0.05" value="0.8" />
        </div>
      </div>`;

    case 'line': return `
      <div class="form-row-3">
        <div class="form-group">
          <label>Line Color</label>
          <div class="color-input-group">
            <input type="color" id="paintColorPicker" value="#0079C1" />
            <input type="text" id="paintColor" class="form-input" value="#0079C1" />
          </div>
        </div>
        <div class="form-group">
          <label for="paintWidth">Width (px)</label>
          <input type="number" id="paintWidth" class="form-input" value="2" min="0.5" step="0.5" />
        </div>
        <div class="form-group">
          <label>Opacity&nbsp;<span class="range-val" id="paintOpacityVal">1</span></label>
          <input type="range" id="paintOpacity" min="0" max="1" step="0.05" value="1" />
        </div>
      </div>`;

    case 'circle': return `
      <div class="form-row-3">
        <div class="form-group">
          <label>Circle Color</label>
          <div class="color-input-group">
            <input type="color" id="paintColorPicker" value="#0079C1" />
            <input type="text" id="paintColor" class="form-input" value="#0079C1" />
          </div>
        </div>
        <div class="form-group">
          <label for="paintRadius">Radius (px)</label>
          <input type="number" id="paintRadius" class="form-input" value="5" min="1" />
        </div>
        <div class="form-group">
          <label>Opacity&nbsp;<span class="range-val" id="paintOpacityVal">0.9</span></label>
          <input type="range" id="paintOpacity" min="0" max="1" step="0.05" value="0.9" />
        </div>
      </div>`;

    case 'symbol': return `
      <div class="form-row-2">
        <div class="form-group">
          <label for="paintTextField">Text Field (attribute)</label>
          <input type="text" id="paintTextField" class="form-input" placeholder="{name}" />
          <div class="field-hint">Use {attribute_name} syntax or a literal string.</div>
        </div>
        <div class="form-group">
          <label for="paintTextSize">Text Size (px)</label>
          <input type="number" id="paintTextSize" class="form-input" value="12" min="6" max="96" />
        </div>
      </div>
      <div class="form-group">
        <label>Text Color</label>
        <div class="color-input-group">
          <input type="color" id="paintColorPicker" value="#333333" />
          <input type="text" id="paintColor" class="form-input" value="#333333" />
        </div>
      </div>`;

    case 'raster': return `
      <div class="form-group">
        <label>Raster Opacity&nbsp;<span class="range-val" id="paintOpacityVal">1</span></label>
        <input type="range" id="paintOpacity" min="0" max="1" step="0.05" value="1" />
      </div>`;

    case 'hillshade': return `
      <div class="form-row-2">
        <div class="form-group">
          <label>Exaggeration&nbsp;<span class="range-val" id="paintExagVal">0.5</span></label>
          <input type="range" id="paintExag" min="0" max="1" step="0.05" value="0.5" />
        </div>
        <div class="form-group">
          <label>Opacity&nbsp;<span class="range-val" id="paintOpacityVal">1</span></label>
          <input type="range" id="paintOpacity" min="0" max="1" step="0.05" value="1" />
        </div>
      </div>`;

    case 'fill-extrusion': return `
      <div class="form-row-3">
        <div class="form-group">
          <label>Color</label>
          <div class="color-input-group">
            <input type="color" id="paintColorPicker" value="#0079C1" />
            <input type="text" id="paintColor" class="form-input" value="#0079C1" />
          </div>
        </div>
        <div class="form-group">
          <label for="paintHeight">Height (m)</label>
          <input type="number" id="paintHeight" class="form-input" value="10" min="0" />
        </div>
        <div class="form-group">
          <label>Opacity&nbsp;<span class="range-val" id="paintOpacityVal">0.8</span></label>
          <input type="range" id="paintOpacity" min="0" max="1" step="0.05" value="0.8" />
        </div>
      </div>`;

    case 'heatmap': return `
      <div class="form-row-2">
        <div class="form-group">
          <label for="paintRadius">Radius (px)</label>
          <input type="number" id="paintRadius" class="form-input" value="30" min="1" />
        </div>
        <div class="form-group">
          <label>Opacity&nbsp;<span class="range-val" id="paintOpacityVal">0.8</span></label>
          <input type="range" id="paintOpacity" min="0" max="1" step="0.05" value="0.8" />
        </div>
      </div>`;

    default: return '';
  }
}

function getLayerFields(srcType) {
  const types = LAYER_TYPES[srcType] || [];
  const srcId = $('srcId')?.value?.trim() || 'custom-source';
  const defaultLayerId = `${srcId}-layer`;
  const isVectorLike = ['vector', 'geojson'].includes(srcType);

  const typeOptions = types.map((t) => `<option value="${t}">${t}</option>`).join('');

  const beforeOptions = state.layers
    .map((l) => `<option value="${esc(l.id)}">${esc(l.id)}</option>`)
    .join('');

  return `
    <div class="layer-form-inner">
      <div class="form-row-2">
        <div class="form-group">
          <label for="layerId">Layer ID <span class="req">*</span></label>
          <input type="text" id="layerId" class="form-input" value="${esc(defaultLayerId)}" />
        </div>
        <div class="form-group">
          <label for="layerType">Layer Type</label>
          <select id="layerType" class="form-select">
            ${typeOptions}
          </select>
        </div>
      </div>

      ${isVectorLike ? `
        <div class="form-group">
          <label for="layerSrcLayer">Source Layer</label>
          <input type="text" id="layerSrcLayer" class="form-input" placeholder="e.g. road, building, water" />
          <div class="field-hint">Layer name within the vector tile source (leave empty for GeoJSON).</div>
        </div>
      ` : ''}

      <div class="form-row-2">
        <div class="form-group">
          <label for="layerPosition">Insert Position</label>
          <select id="layerPosition" class="form-select">
            <option value="top">Top of stack (renders above all)</option>
            <option value="bottom">Bottom of stack (renders below all)</option>
            <option value="before">Before a specific layer…</option>
          </select>
        </div>
        <div class="form-group hidden" id="beforeLayerGroup">
          <label for="beforeLayer">Before Layer</label>
          <select id="beforeLayer" class="form-select">
            ${beforeOptions}
          </select>
        </div>
      </div>

      <div id="paintFields">
        ${getPaintFields(types[0] || 'fill')}
      </div>

      <details class="advanced-section">
        <summary>Advanced paint / layout properties (JSON)</summary>
        <div>
          <div class="form-group">
            <label for="advPaint">Paint (JSON) — overrides basic fields above</label>
            <textarea id="advPaint" class="form-input code-input" rows="4" placeholder='{"fill-color":"#0079C1","fill-opacity":0.8}'></textarea>
          </div>
          <div class="form-group">
            <label for="advLayout">Layout (JSON)</label>
            <textarea id="advLayout" class="form-input code-input" rows="3" placeholder='{"visibility":"visible"}'></textarea>
          </div>
        </div>
      </details>
    </div>
  `;
}

// ═══ Collect Source Config ════════════════════════════════════════════════════

function collectSource() {
  const type = $('srcType').value;
  const config = { type };
  const v = (id) => $(id)?.value?.trim() || null;
  const n = (id, def) => { const x = parseFloat($(id)?.value); return isNaN(x) ? def : x; };

  // Determine active URL method
  const activeBtn = $('urlMethodToggle')?.querySelector('.radio-btn.active');
  const method = activeBtn?.dataset?.val || (type === 'vector' ? 'arcgis' : 'url');

  switch (type) {
    case 'vector': {
      if (method === 'arcgis') { const u = v('arcgisSrcUrl'); if (u) config.url = u; }
      else if (method === 'url') { const u = v('srcUrl'); if (u) config.url = u; }
      else { const t = v('srcTiles'); if (t) config.tiles = t.split('\n').map((s) => s.trim()).filter(Boolean); }
      const min = n('srcMinzoom', null); if (min !== null) config.minzoom = min;
      const max = n('srcMaxzoom', null); if (max !== null) config.maxzoom = max;
      const scheme = v('srcScheme'); if (scheme && scheme !== 'xyz') config.scheme = scheme;
      const attr = v('srcAttribution'); if (attr) config.attribution = attr;
      break;
    }
    case 'raster': {
      if (method === 'url') { const u = v('srcUrl'); if (u) config.url = u; }
      else { const t = v('srcTiles'); if (t) config.tiles = t.split('\n').map((s) => s.trim()).filter(Boolean); }
      const ts = n('srcTileSize', 512); config.tileSize = ts;
      const min = n('srcMinzoom', null); if (min !== null) config.minzoom = min;
      const max = n('srcMaxzoom', null); if (max !== null) config.maxzoom = max;
      const scheme = v('srcScheme'); if (scheme && scheme !== 'xyz') config.scheme = scheme;
      const attr = v('srcAttribution'); if (attr) config.attribution = attr;
      break;
    }
    case 'raster-dem': {
      if (method === 'url') { const u = v('srcUrl'); if (u) config.url = u; }
      else { const t = v('srcTiles'); if (t) config.tiles = t.split('\n').map((s) => s.trim()).filter(Boolean); }
      const ts = n('srcTileSize', 512); config.tileSize = ts;
      const enc = v('srcEncoding'); if (enc) config.encoding = enc;
      const max = n('srcMaxzoom', null); if (max !== null) config.maxzoom = max;
      const attr = v('srcAttribution'); if (attr) config.attribution = attr;
      break;
    }
    case 'geojson': {
      if (method === 'url') { const u = v('srcUrl'); if (u) config.data = u; }
      else {
        const raw = v('srcTiles');
        if (raw) { try { config.data = JSON.parse(raw); } catch { config.data = raw; } }
      }
      const max = n('srcMaxzoom', 18); config.maxzoom = max;
      if ($('srcCluster')?.checked) {
        config.cluster = true;
        const r = n('srcClusterRadius', 50); config.clusterRadius = r;
        const mz = n('srcClusterMaxZoom', null); if (mz !== null) config.clusterMaxZoom = mz;
      }
      break;
    }
    case 'image': {
      const u = v('srcUrl'); if (u) config.url = u;
      config.coordinates = [
        [parseFloat($('coordNWlng')?.value), parseFloat($('coordNWlat')?.value)],
        [parseFloat($('coordNElng')?.value), parseFloat($('coordNElat')?.value)],
        [parseFloat($('coordSElng')?.value), parseFloat($('coordSElat')?.value)],
        [parseFloat($('coordSWlng')?.value), parseFloat($('coordSWlat')?.value)],
      ];
      break;
    }
    case 'video': {
      const t = v('srcTiles');
      if (t) config.urls = t.split('\n').map((s) => s.trim()).filter(Boolean);
      config.coordinates = [
        [parseFloat($('coordNWlng')?.value), parseFloat($('coordNWlat')?.value)],
        [parseFloat($('coordNElng')?.value), parseFloat($('coordNElat')?.value)],
        [parseFloat($('coordSElng')?.value), parseFloat($('coordSElat')?.value)],
        [parseFloat($('coordSWlng')?.value), parseFloat($('coordSWlat')?.value)],
      ];
      break;
    }
  }

  return config;
}

function renderArcgisDiscovery() {
  const box = $('arcgisDiscovery');
  if (!box) return;

  const info = state.modalImport;
  if (!info || (info.status === 'idle' && !info.loading)) {
    box.innerHTML = '';
    hide(box);
    return;
  }

  if (info.loading) {
    box.innerHTML = '<div class="field-hint">Inspecting ArcGIS source…</div>';
    show(box);
    return;
  }

  const sourceLayers = info.sourceLayers.length
    ? info.sourceLayers.map((name) => `<span class="mini-chip">${esc(name)}</span>`).join('')
    : '<span class="field-hint">No source-layer names were discovered.</span>';

  const canImport = info.status === 'ready' && info.styleLayers.length > 0;
  const selectedCount = getSelectedDiscoveredStyleLayers().length;
  const totalStyleLayers = info.styleLayers.length;
  const styleLayerSearch = info.styleLayerSearch?.trim().toLowerCase() || '';
  const visibleStyleLayers = info.styleLayers.filter((layer) => (
    !styleLayerSearch
    || layer.id.toLowerCase().includes(styleLayerSearch)
    || (layer['source-layer'] || '').toLowerCase().includes(styleLayerSearch)
  ));
  const allSelected = !!totalStyleLayers && selectedCount === totalStyleLayers;

  const styleLayerPicker = info.styleLayers.length
    ? `
      <details class="style-layer-picker" ${info.styleLayerPickerOpen ? 'open' : ''}>
        <summary class="style-layer-picker-summary">${esc(summarizeDiscoveredStyleLayerSelection())}</summary>
        <div class="style-layer-picker-panel">
          <div class="search-wrap modal-search-wrap">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" class="search-icon">
              <circle cx="6.5" cy="6.5" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
            </svg>
            <input
              type="text"
              id="styleLayerSearch"
              class="search-input"
              placeholder="Search styled layers…"
              value="${esc(info.styleLayerSearch || '')}"
            />
          </div>
          <label class="style-layer-option style-layer-option-all">
            <input type="checkbox" id="includeAllStyledLayers" ${allSelected ? 'checked' : ''} />
            <span>Include all styled layers</span>
          </label>
          <div class="style-layer-options">
            ${visibleStyleLayers.length
              ? visibleStyleLayers.map((layer) => `
                <label class="style-layer-option">
                  <input
                    type="checkbox"
                    data-layer-id="${esc(layer.id)}"
                    ${info.selectedStyleLayerIds.has(layer.id) ? 'checked' : ''}
                  />
                  <span class="style-layer-option-text">
                    <span class="style-layer-option-id">${esc(layer.id)}</span>
                    ${layer['source-layer']
                      ? `<span class="style-layer-option-meta">${esc(layer['source-layer'])}</span>`
                      : ''
                    }
                  </span>
                </label>
              `).join('')
              : '<div class="field-hint">No styled layers match the current search.</div>'
            }
          </div>
        </div>
      </details>
    `
    : '<span class="field-hint">No importable style layers were found.</span>';

  box.innerHTML = `
    <div class="arcgis-discovery-status ${info.status === 'error' ? 'arcgis-status-error' : 'arcgis-status-ready'}">
      ${esc(info.message)}
    </div>
    <div>
      <div class="mini-label">Source layers</div>
      <div class="mini-chip-list">${sourceLayers}</div>
    </div>
    <div style="margin-top:12px">
      <div class="mini-label">Style layers${info.styleOrigin ? ` · ${esc(info.styleOrigin)}` : ''}</div>
      ${styleLayerPicker}
    </div>
    <label class="toggle-row${canImport ? '' : ' toggle-disabled'}">
      <div class="toggle-switch">
        <input
          type="checkbox"
          id="importStyledLayers"
          ${canImport ? '' : 'disabled'}
          ${canImport && info.importStyledLayersEnabled ? 'checked' : ''}
        />
        <span class="toggle-track"></span>
      </div>
      <span class="toggle-label-text">Import the selected styled layers for this source</span>
    </label>
  `;

  bindArcgisDiscoveryControls(canImport);
  show(box);
}

function applyUrlMethod(method) {
  const toggle = $('urlMethodToggle');
  if (!toggle) return;
  const isArcgis = method === 'arcgis';
  const isUrl = method === 'url';
  const isTiles = method === 'tiles';

  toggle.querySelectorAll('.radio-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.val === method);
  });

  setVisible($('arcgisImportGroup'), isArcgis);
  setVisible($('srcUrlGroup'), isUrl);
  setVisible($('srcTilesGroup'), isTiles);
}

function hydrateVectorSourceFields(sourceCandidate, preferredServiceUrl = null) {
  if (!sourceCandidate) return;

  const { src } = sourceCandidate;
  const arcgisSrcUrl = $('arcgisSrcUrl');
  const srcTiles = $('srcTiles');
  const srcId = $('srcId');
  const attr = $('srcAttribution');
  const minzoom = $('srcMinzoom');
  const maxzoom = $('srcMaxzoom');

  if (srcId && !srcId.value.trim()) {
    const fallbackId = sourceCandidate.id || preferredServiceUrl?.split('/').slice(-2, -1)[0] || 'custom-source';
    srcId.value = sanitizeId(fallbackId);
  }

  if (src.url || preferredServiceUrl) {
    applyUrlMethod('arcgis');
    if (arcgisSrcUrl) arcgisSrcUrl.value = preferredServiceUrl || src.url;
  } else if (Array.isArray(src.tiles) && src.tiles.length && srcTiles) {
    applyUrlMethod('tiles');
    srcTiles.value = src.tiles.join('\n');
  }

  if (minzoom && Number.isFinite(src.minzoom)) minzoom.value = src.minzoom;
  if (maxzoom && Number.isFinite(src.maxzoom)) maxzoom.value = src.maxzoom;
  if (attr && !attr.value.trim() && src.attribution) attr.value = src.attribution;
}

async function inspectArcgisVectorSource() {
  const type = $('srcType')?.value;
  if (type !== 'vector') return;

  const serviceUrl = normalizeArcgisServiceUrl($('arcgisSrcUrl')?.value);
  const styleItemId = $('arcgisStyleItemId')?.value?.trim() || '';
  const styleUrl = $('arcgisStyleUrl')?.value?.trim() || '';

  if (!serviceUrl && !styleItemId && !styleUrl) {
    resetModalImportState();
    state.modalImport.status = 'error';
    state.modalImport.message = 'Enter a VectorTileServer URL, style item ID, or style URL first.';
    renderArcgisDiscovery();
    return;
  }

  resetModalImportState();
  state.modalImport.loading = true;
  renderArcgisDiscovery();

  let serviceMeta = null;
  let style = null;
  let styleOrigin = null;
  const errors = [];

  if (serviceUrl) {
    try {
      serviceMeta = await fetchArcgisServiceInfo(serviceUrl);
    } catch (err) {
      errors.push(`Service metadata: ${err.message}`);
    }
  }

  const styleAttempts = [
    styleUrl ? { label: 'style URL', fetcher: () => fetchStyleFromUrl(styleUrl) } : null,
    styleItemId ? { label: 'style item', fetcher: () => fetchStyle(styleItemId) } : null,
    serviceUrl ? {
      label: 'service root style',
      fetcher: () => fetchStyleFromUrl(buildArcgisRootStyleUrl(serviceUrl)),
    } : null,
  ].filter(Boolean);

  const fallbackItemId = serviceMeta?.serviceItemId || serviceMeta?.itemId || null;
  if (fallbackItemId && !styleItemId) {
    styleAttempts.push({
      label: 'service item style',
      fetcher: () => fetchStyle(fallbackItemId),
    });
  }

  for (const attempt of styleAttempts) {
    try {
      style = await attempt.fetcher();
      styleOrigin = attempt.label;
      break;
    } catch (err) {
      errors.push(`${attempt.label}: ${err.message}`);
    }
  }

  const chosenSource = pickStyleSource(style, serviceUrl);
  if (chosenSource) hydrateVectorSourceFields(chosenSource, serviceUrl);

  if (serviceMeta?.copyrightText && !$('srcAttribution')?.value?.trim()) {
    $('srcAttribution').value = serviceMeta.copyrightText;
  }

  resetModalImportState();
  state.modalImport.sourceLayers = collectSourceLayerNames(serviceMeta, style, chosenSource?.id || null);
  state.modalImport.styleSourceId = chosenSource?.id || null;
  state.modalImport.styleLayers = chosenSource
    ? (style?.layers || []).filter((layer) => layer.source === chosenSource.id)
    : [];
  state.modalImport.selectedStyleLayerIds = new Set(
    state.modalImport.styleLayers.map((layer) => layer.id)
  );
  state.modalImport.styleLayerSearch = '';
  state.modalImport.styleLayerPickerOpen = false;
  state.modalImport.importStyledLayersEnabled = state.modalImport.styleLayers.length > 0;
  state.modalImport.styleOrigin = styleOrigin;

  const successParts = [];
  if (serviceMeta) successParts.push('service metadata loaded');
  if (state.modalImport.sourceLayers.length) successParts.push(`${state.modalImport.sourceLayers.length} source layers found`);
  if (state.modalImport.styleLayers.length) successParts.push(`${state.modalImport.styleLayers.length} styled layers ready to import`);

  if (successParts.length) {
    state.modalImport.status = 'ready';
    state.modalImport.message = successParts.join(', ');
  } else {
    state.modalImport.status = 'error';
    state.modalImport.message = errors[0] || 'No ArcGIS metadata or style layers could be resolved.';
  }

  if (!state.modalImport.styleLayers.length && errors.length && state.modalImport.status === 'ready') {
    state.modalImport.message += `. Style import unavailable (${errors[0]}).`;
  }

  renderArcgisDiscovery();
}

// ═══ Collect Layer Config ═════════════════════════════════════════════════════

function collectLayer(sourceId, sourceType) {
  const layerId    = $('layerId')?.value?.trim();
  const layerType  = $('layerType')?.value;
  const position   = $('layerPosition')?.value || 'top';
  const beforeId   = position === 'before' ? $('beforeLayer')?.value : null;

  if (!layerId || !layerType) return null;

  const layer = { id: layerId, type: layerType, source: sourceId };

  // source-layer for vector-like sources
  if (['vector', 'geojson'].includes(sourceType)) {
    const sl = $('layerSrcLayer')?.value?.trim();
    if (sl) layer['source-layer'] = sl;
  }

  // Build paint from form fields
  let paint = buildPaint(layerType);

  // Advanced paint JSON overrides
  const advPaintRaw = $('advPaint')?.value?.trim();
  if (advPaintRaw) {
    try { paint = { ...paint, ...JSON.parse(advPaintRaw) }; } catch { /* ignore */ }
  }
  if (Object.keys(paint).length) layer.paint = paint;

  // Layout fields
  let layout = {};
  if (layerType === 'symbol') {
    const tf = $('paintTextField')?.value?.trim();
    const ts = parseFloat($('paintTextSize')?.value) || 12;
    if (tf) layout['text-field'] = tf;
    layout['text-size'] = ts;
  }
  const advLayoutRaw = $('advLayout')?.value?.trim();
  if (advLayoutRaw) {
    try { layout = { ...layout, ...JSON.parse(advLayoutRaw) }; } catch { /* ignore */ }
  }
  if (Object.keys(layout).length) layer.layout = layout;

  return { layer, position, beforeId };
}

function importDiscoveredStyleLayers(sourceId) {
  const layers = getSelectedDiscoveredStyleLayers();
  if (!layers.length) return 0;

  let imported = 0;
  for (const originalLayer of layers) {
    const cloned = JSON.parse(JSON.stringify(originalLayer));
    cloned.id = uniqueLayerId(cloned.id);
    cloned.source = sourceId;
    state.layers.push(cloned);
    state.addedLayerIds.add(cloned.id);
    imported++;
  }
  if (imported) markLayersDirty();
  return imported;
}

function buildPaint(layerType) {
  const color = () => $('paintColor')?.value || '#0079C1';
  const range = (id, def) => { const v = parseFloat($(id)?.value); return isNaN(v) ? def : v; };
  const num   = (id, def) => { const v = parseFloat($(id)?.value); return isNaN(v) ? def : v; };

  switch (layerType) {
    case 'fill':            return { 'fill-color': color(), 'fill-opacity': range('paintOpacity', 0.8) };
    case 'line':            return { 'line-color': color(), 'line-width': num('paintWidth', 2), 'line-opacity': range('paintOpacity', 1) };
    case 'circle':          return { 'circle-color': color(), 'circle-radius': num('paintRadius', 5), 'circle-opacity': range('paintOpacity', 0.9) };
    case 'symbol':          return { 'text-color': color() };
    case 'raster':          return { 'raster-opacity': range('paintOpacity', 1) };
    case 'hillshade':       return { 'hillshade-exaggeration': range('paintExag', 0.5), 'hillshade-shadow-color': '#000000' };
    case 'fill-extrusion':  return { 'fill-extrusion-color': color(), 'fill-extrusion-height': num('paintHeight', 10), 'fill-extrusion-opacity': range('paintOpacity', 0.8) };
    case 'heatmap':         return { 'heatmap-radius': num('paintRadius', 30), 'heatmap-opacity': range('paintOpacity', 0.8) };
    default:                return {};
  }
}

// ═══ Validation ═══════════════════════════════════════════════════════════════

function validate() {
  const id   = $('srcId').value.trim();
  const type = $('srcType').value;
  const errEl = $('srcIdError');
  errEl.textContent = '';
  hide(errEl);
  hideStatus();

  if (!id) {
    errEl.textContent = 'Source ID is required.';
    show(errEl); return false;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    errEl.textContent = 'Only letters, numbers, hyphens, and underscores.';
    show(errEl); return false;
  }
  if (state.original?.sources[id] || state.addedSources[id]) {
    errEl.textContent = `A source named "${id}" already exists.`;
    show(errEl); return false;
  }

  const activeBtn = $('urlMethodToggle')?.querySelector('.radio-btn.active');
  const method = activeBtn?.dataset?.val || (type === 'vector' ? 'arcgis' : 'url');

  const needUrl = ['vector', 'raster', 'raster-dem'].includes(type);
  if (needUrl) {
    if (type === 'vector' && method === 'arcgis' && !$('arcgisSrcUrl')?.value?.trim()) {
      showStatus('Please enter a VectorTileServer URL.', 'error'); return false;
    }
    if (method === 'url' && !$('srcUrl')?.value?.trim()) {
      showStatus('Please enter a URL.', 'error'); return false;
    }
    if (method === 'tiles' && !$('srcTiles')?.value?.trim()) {
      showStatus('Please enter at least one tile URL.', 'error'); return false;
    }
  }
  if (type === 'geojson' && !$('srcUrl')?.value?.trim() && !$('srcTiles')?.value?.trim()) {
    showStatus('Please provide a GeoJSON URL or inline data.', 'error'); return false;
  }
  if (type === 'image' && !$('srcUrl')?.value?.trim()) {
    showStatus('Please provide an image URL.', 'error'); return false;
  }
  if (type === 'video' && !$('srcTiles')?.value?.trim()) {
    showStatus('Please provide at least one video URL.', 'error'); return false;
  }
  if (type === 'vector' && $('importStyledLayers')?.checked && !(state.modalImport?.styleLayers?.length)) {
    showStatus('Inspect the ArcGIS source first, then import its styled layers.', 'error'); return false;
  }
  if (type === 'vector' && $('importStyledLayers')?.checked && !getSelectedDiscoveredStyleLayers().length) {
    showStatus('Select at least one styled layer to import, or turn on "Include all".', 'error'); return false;
  }

  return true;
}

// ═══ Save Source ══════════════════════════════════════════════════════════════

function saveSource() {
  if (!validate()) return;

  const sourceId   = $('srcId').value.trim();
  const sourceType = $('srcType').value;
  const srcConfig  = collectSource();
  let layersChanged = false;

  state.addedSources[sourceId] = srcConfig;
  let importedCount = 0;

  if ($('addLayerToggle').checked) {
    const result = collectLayer(sourceId, sourceType);
    if (result) {
      const { layer, position, beforeId } = result;
      // Ensure unique layer ID
      layer.id = uniqueLayerId(layer.id);

      if (position === 'top') {
        state.layers.push(layer);
      } else if (position === 'bottom') {
        state.layers.unshift(layer);
      } else if (position === 'before' && beforeId) {
        const idx = state.layers.findIndex((l) => l.id === beforeId);
        state.layers.splice(idx !== -1 ? idx : state.layers.length, 0, layer);
      }
      state.addedLayerIds.add(layer.id);
      markLayersDirty();
      layersChanged = true;
    }
  }

  if (sourceType === 'vector' && $('importStyledLayers')?.checked) {
    importedCount = importDiscoveredStyleLayers(sourceId);
    if (importedCount) layersChanged = true;
  }

  renderSources();
  renderLayers($('layerSearch').value);
  updateJson();
  if (layersChanged) schedulePreviewRefresh();
  closeModal();
  const suffix = importedCount ? ` (${importedCount} styled layers imported)` : '';
  showStatus(`Source "${sourceId}" added successfully${suffix}.`, 'success');
  setTimeout(hideStatus, 3500);
}

// ═══ Modal ════════════════════════════════════════════════════════════════════

function openModal() {
  resetModalImportState();
  $('srcId').value = '';
  $('srcType').value = 'vector';
  hide($('srcIdError'));
  $('addLayerToggle').checked = false;
  hide($('layerFormSection'));
  refreshSrcFields();
  show($('sourceModal'));
  $('srcId').focus();
}
function closeModal() { hide($('sourceModal')); }

function refreshSrcFields() {
  resetModalImportState();
  $('srcPreTypeFields').innerHTML = getSrcPreFields($('srcType').value);
  $('srcTypeFields').innerHTML = getSrcFields($('srcType').value);
  setupUrlMethodToggle();
  setupArcgisImportControls();
  setupClusterToggle();
  refreshLayerFields();
}

function refreshLayerFields() {
  if (!$('addLayerToggle').checked) return;
  $('layerTypeFields').innerHTML = getLayerFields($('srcType').value);
  setupPositionDropdown();
  setupPaintListeners();
  setupLayerTypeChange();
}

function setupUrlMethodToggle() {
  const toggle = $('urlMethodToggle');
  if (!toggle) return;
  toggle.querySelectorAll('.radio-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyUrlMethod(btn.dataset.val);
    });
  });
  const active = toggle.querySelector('.radio-btn.active')?.dataset?.val || 'url';
  applyUrlMethod(active);
}

function setupArcgisImportControls() {
  renderArcgisDiscovery();
  $('arcgisDetectBtn')?.addEventListener('click', inspectArcgisVectorSource);
}

function setupClusterToggle() {
  const cb = $('srcCluster');
  if (!cb) return;
  cb.addEventListener('change', () => setVisible($('clusterOptions'), cb.checked));
}

function setupPositionDropdown() {
  const sel = $('layerPosition');
  const grp = $('beforeLayerGroup');
  if (!sel || !grp) return;
  sel.addEventListener('change', () => setVisible(grp, sel.value === 'before'));
}

function setupPaintListeners() {
  // Color picker ↔ text sync
  const picker = $('paintColorPicker');
  const colorText = $('paintColor');
  if (picker && colorText) {
    picker.addEventListener('input', () => { colorText.value = picker.value; });
    colorText.addEventListener('input', () => {
      if (/^#[0-9A-Fa-f]{6}$/.test(colorText.value)) picker.value = colorText.value;
    });
  }
  // Range sliders
  [['paintOpacity', 'paintOpacityVal'], ['paintExag', 'paintExagVal']].forEach(([rid, vid]) => {
    const r = $(rid), v = $(vid);
    if (r && v) r.addEventListener('input', () => { v.textContent = r.value; });
  });
}

function setupLayerTypeChange() {
  const sel = $('layerType');
  if (!sel) return;
  sel.addEventListener('change', () => {
    $('paintFields').innerHTML = getPaintFields(sel.value);
    setupPaintListeners();
  });
}

// ═══ Map Preview ══════════════════════════════════════════════════════════════

/**
 * ArcGIS VectorTileServer sources need tile URLs to be absolute.
 *
 * Two problems this fixes:
 *  1. Sources with a `url` pointing to a VectorTileServer endpoint:
 *     MapLibre fetches TileJSON from that URL, but ArcGIS TileJSON returns
 *     relative tile paths (e.g. "tile/{z}/{y}/{x}.pbf").  MapLibre's Web
 *     Worker can't resolve relative URLs → "Failed to parse URL" error.
 *     Fix: strip `url`, supply absolute `tiles` directly.
 *
 *  2. Sources that already have a `tiles` array with relative paths but no
 *     `url` field at all.  Our guard would previously skip these.
 *     Fix: derive a base URL from the style's `glyphs` or `sprite` field
 *     (both typically contain the VectorTileServer origin) and make tiles
 *     absolute.
 */
function resolveStyleForPreview(style) {
  // Extract the VectorTileServer root from any absolute URL that contains it.
  function vtsBase(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/^(https?:\/\/[^?#]*\/VectorTileServer)/i);
    return m ? m[1] : null;
  }

  // Style-level fallback: glyphs or sprite usually live on the same server.
  const styleBase = vtsBase(style.glyphs) ?? vtsBase(style.sprite) ?? null;

  const sources = {};
  for (const [id, src] of Object.entries(style.sources)) {
    if (src.type !== 'vector') {
      sources[id] = src;
      continue;
    }

    // Best available base URL for this source
    const base = vtsBase(src.url) ?? styleBase ?? '';

    let tiles;
    if (src.tiles?.length) {
      // Make any relative tile URLs absolute; leave absolute ones untouched.
      tiles = src.tiles.map((t) =>
        /^https?:\/\//.test(t) ? t
          : base ? `${base}/${t.replace(/^\//, '')}` : t
      );
    } else if (base) {
      // No tiles array – derive from the standard ArcGIS tile path pattern.
      tiles = [`${base}/tile/{z}/{y}/{x}.pbf`];
    } else {
      // Nothing to work with; leave source unchanged and hope for the best.
      sources[id] = src;
      continue;
    }

    // Remove `url` so MapLibre uses `tiles` directly and never fetches
    // TileJSON from the ArcGIS endpoint (which returns relative paths).
    const { url: _ignored, ...rest } = src;
    sources[id] = { ...rest, tiles };
  }

  return { ...style, sources };
}

async function previewMap(requestId = ++state.previewRequestId) {
  if (requestId !== state.previewRequestId) return;
  const style = buildModified();
  if (!style) return;
  $('mapHint').textContent = 'Resolving tile sources…';

  const resolved = resolveStyleForPreview(applyPreviewCamera(style, getCurrentPreviewCamera()));
  const spriteDiagnostics = await inspectSpriteAssets(resolved);
  if (requestId !== state.previewRequestId) return;
  const vectorSourceDebug = Object.fromEntries(
    Object.entries(resolved.sources || {})
      .filter(([, src]) => src?.type === 'vector')
      .map(([id, src]) => [id, { url: src.url, tiles: src.tiles }])
  );
  console.info('[Preview style assets]', {
    sprite: resolved.sprite,
    glyphs: resolved.glyphs,
    vectorSources: vectorSourceDebug,
    spriteDiagnostics,
  });

  if (spriteDiagnostics.warnings.length) {
    showStatus('Sprite diagnostics found issues. See console for details.', 'info');
    console.warn('[Sprite diagnostics]', spriteDiagnostics);
  }
  await initMap(resolved, requestId);
}

function destroyPreviewMap() {
  if (state.previewRefreshFrame) {
    cancelAnimationFrame(state.previewRefreshFrame);
    state.previewRefreshFrame = 0;
  }

  if (state.map) {
    state.map.remove();
    state.map = null;
  }

  if (state.previewView) {
    state.previewView.destroy();
    state.previewView = null;
  }

  if (state.previewStyleUrl) {
    URL.revokeObjectURL(state.previewStyleUrl);
    state.previewStyleUrl = null;
  }

  $('map').innerHTML = '';
}

function hasUnsavedPreviewChanges() {
  if (!state.original) return false;
  if (Object.keys(state.addedSources).length) return true;
  if (state.addedLayerIds.size) return true;
  if (state.layers.length !== state.original.layers.length) return true;

  return state.layers.some((layer, index) => {
    const originalLayer = state.original.layers[index];
    return !originalLayer || originalLayer.id !== layer.id;
  });
}

async function initMap(style, requestId = state.previewRequestId) {
  if (requestId !== state.previewRequestId) return;
  destroyPreviewMap();

  if (!state.itemId) {
    $('mapHint').textContent = 'Load a style item first';
    return;
  }

  if (hasUnsavedPreviewChanges()) {
    $('mapHint').textContent = 'Previewing edited style with MapLibre';
    initMapLibreMap(style, requestId);
    return;
  }

  const [ArcGISMap, MapView, Basemap, VectorTileLayer, PortalItem] = await loadArcgisModules([
    'esri/Map',
    'esri/views/MapView',
    'esri/Basemap',
    'esri/layers/VectorTileLayer',
    'esri/portal/PortalItem',
  ]);
  if (requestId !== state.previewRequestId) return;

  const vectorTileLayer = new VectorTileLayer({
    portalItem: new PortalItem({
      id: state.itemId,
    }),
  });

  const map = new ArcGISMap({
    basemap: new Basemap({
      baseLayers: [vectorTileLayer],
    }),
  });

  const view = new MapView({
    container: 'map',
    map,
    center: style.center || [0, 0],
    zoom: style.zoom ?? 2,
    rotation: style.bearing || 0,
  });

  state.previewView = view;

  vectorTileLayer.when(() => {
    $('mapHint').textContent = 'Style layer loaded';
  }).catch((err) => {
    console.warn('[ArcGIS SDK layer]', err);
    $('mapHint').textContent = 'Style layer error – see console';
  });

  view.when(() => {
    $('mapHint').textContent = 'Style loaded';
  }).catch((err) => {
    console.warn('[ArcGIS SDK view]', err);
    $('mapHint').textContent = 'Map error – see console';
  });
}

function initMapLibreMap(style, requestId = state.previewRequestId) {
  if (requestId !== state.previewRequestId) return;
  state.map = new maplibregl.Map({
    container: 'map',
    style,
    center: style.center || [0, 0],
    zoom: style.zoom ?? 2,
    bearing: style.bearing || 0,
    pitch: style.pitch || 0,
    attributionControl: false,
  });

  state.map.addControl(new maplibregl.NavigationControl(), 'top-right');
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  state.map.on('load', () => { $('mapHint').textContent = 'Edited style loaded'; });
  state.map.on('style.load', () => { $('mapHint').textContent = 'Edited style applied'; });
  state.map.on('error', (e) => {
    console.warn('[MapLibre]', e.error?.message || e);
    $('mapHint').textContent = 'Map error – see console';
  });
}

// ═══ Copy / Download ══════════════════════════════════════════════════════════

async function copyJson() {
  const style = buildModified();
  if (!style) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(style, null, 2));
    const btn = $('copyBtn');
    const orig = btn.innerHTML;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.innerHTML = orig; }, 1800);
  } catch {
    showStatus('Clipboard write failed.', 'error');
  }
}

function downloadJson() {
  const style = buildModified();
  if (!style) return;
  const blob = new Blob([JSON.stringify(style, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `style-${state.itemId}-modified.json` });
  a.click();
  URL.revokeObjectURL(url);
}

// ═══ Load Style ═══════════════════════════════════════════════════════════════

async function loadStyle() {
  const itemId = $('itemId').value.trim();
  if (!itemId) { showStatus('Please enter an ArcGIS Item ID.', 'error'); return; }

  // Reset
  state.itemId = itemId;
  state.original = null;
  state.layers = [];
  state.addedSources = {};
  state.addedLayerIds = new Set();
  state.previewRequestId++;
  state.selectedLayerIds = new Set();
  state.selectionAnchorId = null;
  state.layerElements = new Map();
  state.emptyLayerRow = null;
  state.layersDirty = true;
  destroyPreviewMap();
  if (state.sortable) { state.sortable.destroy(); state.sortable = null; }

  hideStatus();
  hide($('mainLayout'));
  hide($('emptyState'));
  show($('loadingState'));
  $('loadBtn').disabled = true;

  try {
    const style = await fetchStyle(itemId);
    state.original = style;
    state.layers   = [...style.layers];
    markLayersDirty();

    hide($('loadingState'));
    show($('mainLayout'));

    renderMeta();
    renderSources();
    renderLayers();
    updateJson();
    schedulePreviewRefresh();
  } catch (err) {
    hide($('loadingState'));
    show($('emptyState'));
    showStatus(`Error: ${err.message}`, 'error');
    console.error(err);
  } finally {
    $('loadBtn').disabled = false;
  }
}

async function fetchStyle(itemId) {
  const id = itemId.trim();
  const errors = [];

  const directAttempts = [
    { label: 'item resource style', fetcher: () => fetchStyleFromUrl(STYLE_URL(id)) },
    { label: 'item data style', fetcher: () => fetchStyleFromUrl(ITEM_DATA_URL(id)) },
  ];

  for (const attempt of directAttempts) {
    try {
      return await attempt.fetcher();
    } catch (err) {
      errors.push(`${attempt.label}: ${err.message}`);
    }
  }

  let itemInfo = null;
  try {
    itemInfo = await fetchArcgisItemInfo(id);
  } catch (err) {
    errors.push(`item info: ${err.message}`);
  }

  const fallbackUrl = buildArcgisRootStyleUrl(itemInfo?.url)
    || (typeof itemInfo?.url === 'string' && itemInfo.url.trim() ? itemInfo.url : null);

  if (fallbackUrl) {
    try {
      return await fetchStyleFromUrl(fallbackUrl);
    } catch (err) {
      errors.push(`item URL: ${err.message}`);
    }
  }

  throw new Error(errors[0] || 'Unable to resolve style from the ArcGIS item.');
}

// ═══ Event Listeners ══════════════════════════════════════════════════════════

function init() {
  resetModalImportState();
  setJsonPanelCollapsed(true);
  // Load
  $('loadBtn').addEventListener('click', loadStyle);
  $('itemId').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadStyle(); });
  $('useExample').addEventListener('click', () => {
    $('itemId').value = $('exampleId').textContent.trim();
    loadStyle();
  });

  // Modal open/close
  $('addSourceBtn').addEventListener('click', openModal);
  $('closeModalBtn').addEventListener('click', closeModal);
  $('cancelModalBtn').addEventListener('click', closeModal);
  $('modalBackdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // Source type change
  $('srcType').addEventListener('change', refreshSrcFields);

  // Add layer toggle
  $('addLayerToggle').addEventListener('change', () => {
    setVisible($('layerFormSection'), $('addLayerToggle').checked);
    if ($('addLayerToggle').checked) refreshLayerFields();
  });

  // Layer ID auto-fill when source ID changes
  $('srcId').addEventListener('input', () => {
    const layerIdEl = $('layerId');
    if (layerIdEl) layerIdEl.value = `${$('srcId').value.trim()}-layer`;
  });

  // Save source
  $('saveSourceBtn').addEventListener('click', saveSource);

  // Layer filter
  $('layerSearch').addEventListener('input', (e) => renderLayers(e.target.value));
  $('layersList').addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-layer-btn');
    if (btn) {
      const id = btn.dataset.id;
      state.layers = state.layers.filter((l) => l.id !== id);
      state.addedLayerIds.delete(id);
      state.selectedLayerIds.delete(id);
      if (state.selectionAnchorId === id) state.selectionAnchorId = null;
      markLayersDirty();
      renderLayers($('layerSearch').value);
      updateJson();
      schedulePreviewRefresh();
      return;
    }

    const item = e.target.closest('.layer-item[data-id]');
    if (!item || e.target.closest('.drag-handle')) return;

    handleLayerSelection(item.dataset.id, {
      range: e.shiftKey,
      toggle: !e.shiftKey && (e.metaKey || e.ctrlKey),
    });
  });

  // Map preview
  $('previewBtn').addEventListener('click', previewMap);

  // Copy / Download
  $('toggleJsonBtn').addEventListener('click', () => {
    $('toggleJsonBtn').blur();
    $('jsonPanel').classList.contains('json-collapsed')
      ? setJsonPanelCollapsed(false)
      : setJsonPanelCollapsed(true);
  });
  $('copyBtn').addEventListener('click', copyJson);
  $('downloadBtn').addEventListener('click', downloadJson);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
