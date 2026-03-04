/* ─────────────────────────────────────────────────────────────────────────────
   ArcGIS Vector Style Editor – Application Logic
   ───────────────────────────────────────────────────────────────────────────── */

'use strict';

// ═══ Constants ════════════════════════════════════════════════════════════════

const STYLE_URL = (id) =>
  `https://www.arcgis.com/sharing/rest/content/items/${id}/resources/styles/root.json?f=pjson`;

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
  sortable:     null,
  layerElements:new Map(),
  layersDirty:  true,
  emptyLayerRow:null,
  jsonFrame:    0,
};

// ═══ DOM helpers ══════════════════════════════════════════════════════════════

const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');
const setVisible = (el, v) => v ? show(el) : hide(el);

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
    styleOrigin: null,
  };
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

function appendQuery(url, key, value) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${res.statusText}`);
  return res.json();
}

async function fetchArcgisServiceInfo(serviceUrl) {
  const data = await fetchJson(appendQuery(serviceUrl, 'f', 'pjson'));
  if (data?.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
  return data;
}

async function fetchStyleFromUrl(styleUrl) {
  const data = await fetchJson(styleUrl);
  if (data?.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
  if (!data?.version || !Array.isArray(data.layers)) {
    throw new Error('Response is not a valid Mapbox GL style.');
  }
  return data;
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
}

// ═══ Render: Layers ═══════════════════════════════════════════════════════════

function createLayerMarkup(layer) {
  const isAdded = state.addedLayerIds.has(layer.id);
  const color = TYPE_COLOR[layer.type] || '#94a3b8';
  return `
    <div class="layer-item${isAdded ? ' layer-added' : ''}" data-id="${esc(layer.id)}">
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
    onEnd: syncLayerOrder,
  });

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
  const list = $('layersList');
  const q = filter.trim().toLowerCase();
  $('layerCount').textContent = state.layers.length;

  if (state.layersDirty || state.layerElements.size !== state.layers.length) {
    rebuildLayersList();
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

function syncLayerOrder() {
  const items = $('layersList').querySelectorAll('.layer-item[data-id]');
  const orderedIds = Array.from(items).map((el) => el.dataset.id);
  const orderedIdSet = new Set(orderedIds);
  const map = new Map(state.layers.map((l) => [l.id, l]));

  const reordered = [];
  for (const id of orderedIds) if (map.has(id)) reordered.push(map.get(id));
  // Preserve hidden (filtered-out) layers at their relative positions
  for (const l of state.layers) if (!orderedIdSet.has(l.id)) reordered.push(l);

  state.layers = reordered;
  updateJson();
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
        ${tileUrlInput()}
        <div class="field-hint" style="margin:0 0 10px">
          For ArcGIS VectorTileServer URLs, use the full service endpoint (e.g. <code>…/VectorTileServer</code>).
        </div>
        <div class="arcgis-assist" id="arcgisAssistSection">
          <div class="arcgis-assist-header">
            <div>
              <div class="arcgis-assist-title">ArcGIS source import</div>
              <div class="field-hint" style="margin-top:2px">Inspect a VectorTileServer, style item ID, or style URL to discover source layers and reuse the source style.</div>
            </div>
            <button type="button" class="btn btn-sm btn-outline" id="arcgisDetectBtn">Inspect</button>
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
          <div id="arcgisDiscovery" class="arcgis-discovery hidden"></div>
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
  const method = activeBtn?.dataset?.val || 'url';

  switch (type) {
    case 'vector': {
      if (method === 'url') { const u = v('srcUrl'); if (u) config.url = u; }
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

  const styleLayers = info.styleLayers.length
    ? info.styleLayers.map((layer) => `<span class="mini-chip">${esc(layer.id)}</span>`).join('')
    : '<span class="field-hint">No importable style layers were found.</span>';

  const canImport = info.status === 'ready' && info.styleLayers.length > 0;

  box.innerHTML = `
    <div class="arcgis-discovery-status ${info.status === 'error' ? 'arcgis-status-error' : 'arcgis-status-ready'}">
      ${esc(info.message)}
    </div>
    <div class="arcgis-discovery-grid">
      <div>
        <div class="mini-label">Source layers</div>
        <div class="mini-chip-list">${sourceLayers}</div>
      </div>
      <div>
        <div class="mini-label">Style layers${info.styleOrigin ? ` · ${esc(info.styleOrigin)}` : ''}</div>
        <div class="mini-chip-list">${styleLayers}</div>
      </div>
    </div>
    <label class="toggle-row${canImport ? '' : ' toggle-disabled'}">
      <div class="toggle-switch">
        <input type="checkbox" id="importStyledLayers" ${canImport ? '' : 'disabled'} ${canImport ? 'checked' : ''} />
        <span class="toggle-track"></span>
      </div>
      <span class="toggle-label-text">Import all matching styled layers for this source</span>
    </label>
  `;

  show(box);
}

function applyUrlMethod(method) {
  const toggle = $('urlMethodToggle');
  if (!toggle) return;
  const isUrl = method !== 'tiles';

  toggle.querySelectorAll('.radio-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.val === (isUrl ? 'url' : 'tiles'));
  });

  setVisible($('srcUrlGroup'), isUrl);
  setVisible($('srcTilesGroup'), !isUrl);
}

function hydrateVectorSourceFields(sourceCandidate, preferredServiceUrl = null) {
  if (!sourceCandidate) return;

  const { src } = sourceCandidate;
  const srcUrl = $('srcUrl');
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
    applyUrlMethod('url');
    if (srcUrl) srcUrl.value = preferredServiceUrl || src.url;
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

  const serviceUrl = normalizeArcgisServiceUrl($('srcUrl')?.value);
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
      fetcher: () => fetchStyleFromUrl(appendQuery(`${serviceUrl}/resources/styles/root.json`, 'f', 'pjson')),
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
  const layers = state.modalImport?.styleLayers || [];
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
  const method = activeBtn?.dataset?.val || 'url';

  const needUrl = ['vector', 'raster', 'raster-dem'].includes(type);
  if (needUrl) {
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

  return true;
}

// ═══ Save Source ══════════════════════════════════════════════════════════════

function saveSource() {
  if (!validate()) return;

  const sourceId   = $('srcId').value.trim();
  const sourceType = $('srcType').value;
  const srcConfig  = collectSource();

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
    }
  }

  if (sourceType === 'vector' && $('importStyledLayers')?.checked) {
    importedCount = importDiscoveredStyleLayers(sourceId);
  }

  renderSources();
  renderLayers($('layerSearch').value);
  updateJson();
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

async function previewMap() {
  const style = buildModified();
  if (!style) return;
  $('mapHint').textContent = 'Resolving tile sources…';

  const resolved = resolveStyleForPreview(style);

  if (state.map) {
    try {
      state.map.setStyle(resolved);
    } catch {
      state.map.remove();
      state.map = null;
      initMap(resolved);
    }
    return;
  }
  initMap(resolved);
}

function initMap(style) {
  state.map = new maplibregl.Map({
    container: 'map',
    style,
    center:  style.center  || [0, 0],
    zoom:    style.zoom    || 2,
    bearing: style.bearing || 0,
    pitch:   style.pitch   || 0,
    attributionControl: false,
  });
  state.map.addControl(new maplibregl.NavigationControl(), 'top-right');
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  state.map.on('load',  () => { $('mapHint').textContent = 'Style loaded'; });
  state.map.on('style.load', () => { $('mapHint').textContent = 'Style applied'; });
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
  state.layerElements = new Map();
  state.emptyLayerRow = null;
  state.layersDirty = true;
  if (state.map) { state.map.remove(); state.map = null; }
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
  const res = await fetch(STYLE_URL(itemId.trim()));
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${res.statusText}`);
  const data = await res.json();
  if (data.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
  if (!data.version || !data.layers) throw new Error('Response is not a valid Mapbox GL style.');
  return data;
}

// ═══ Event Listeners ══════════════════════════════════════════════════════════

function init() {
  resetModalImportState();
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
    if (!btn) return;

    const id = btn.dataset.id;
    state.layers = state.layers.filter((l) => l.id !== id);
    state.addedLayerIds.delete(id);
    markLayersDirty();
    renderLayers($('layerSearch').value);
    updateJson();
  });

  // Map preview
  $('previewBtn').addEventListener('click', previewMap);

  // Copy / Download
  $('copyBtn').addEventListener('click', copyJson);
  $('downloadBtn').addEventListener('click', downloadJson);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
