async function fetchThumbnailUrl(webmapId) {
  const res = await fetch(`https://www.arcgis.com/sharing/rest/content/items/${webmapId}?f=json`);
  const data = await res.json();
  return `https://www.arcgis.com/sharing/rest/content/items/${webmapId}/info/${data.thumbnail}?w=400`;
}

function flattenLayers(layers) {
  const result = [];
  for (const l of (layers ?? [])) {
    result.push(l);
    if (l.layers) result.push(...flattenLayers(l.layers));
  }
  return result;
}

function extractEffectNames(effect) {
  if (!effect || typeof effect !== "string") return [];
  return (effect.match(/([a-z-]+)\s*\(/g) ?? []).map((m) => m.replace(/\s*\($/, "").trim());
}

async function fetchWebmapFeatures(webmapId) {
  try {
    const res = await fetch(`https://www.arcgis.com/sharing/rest/content/items/${webmapId}/data?f=json`);
    const data = await res.json();

    const allBaseLayers = flattenLayers([
      ...(data.baseMap?.baseMapLayers ?? []),
      ...(data.baseMap?.referenceLayers ?? []),
    ]);

    const effectNames = new Set();
    const blendModes = new Set();
    let hasGroupLayers = false;

    for (const layer of allBaseLayers) {
      if (layer.effect) {
        for (const name of extractEffectNames(layer.effect)) effectNames.add(name);
      }
      if (layer.blendMode && layer.blendMode !== "normal") blendModes.add(layer.blendMode);
      if (layer.layerType === "GroupLayer") hasGroupLayers = true;
    }

    const hasOperationalLayers = (data.operationalLayers?.length ?? 0) > 0;

    return {
      effectNames: [...effectNames],
      blendModes: [...blendModes],
      hasGroupLayers,
      hasOperationalLayers,
    };
  } catch {
    return { effectNames: [], blendModes: [], hasGroupLayers: false, hasOperationalLayers: false };
  }
}

// Effects: sparkle / star burst
const ICON_EFFECTS = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M10 1l.85 2.15L13 4l-2.15.85L10 7l-.85-2.15L7 4l2.15-.85L10 1zM4.5 7l.6 1.4L6.5 9l-1.4.6L4.5 11l-.6-1.4L2.5 9l1.4-.6L4.5 7zM8 10.5l.45 1.05L9.5 12l-1.05.45L8 13.5l-.45-1.05L6.5 12l1.05-.45L8 10.5z"/></svg>`;

// Blending: two overlapping circles
const ICON_BLEND = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="8" r="4" fill-opacity="0.8"/><circle cx="10.5" cy="8" r="4" fill-opacity="0.8"/></svg>`;

// Supplemental layers: three stacked bars
const ICON_LAYERS = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="2" width="14" height="3" rx="1"/><rect x="1" y="6.5" width="14" height="3" rx="1"/><rect x="1" y="11" width="14" height="3" rx="1"/></svg>`;

function makeChip(iconSvg, tooltip) {
  const chip = document.createElement("span");
  chip.className = "feature-chip";
  chip.dataset.tooltip = tooltip;
  chip.innerHTML = iconSvg;
  return chip;
}

export function renderGallery(container, examples, onSelect) {
  const grid = document.createElement("div");
  grid.id = "gallery-grid";

  for (const ex of examples) {
    const card = document.createElement("calcite-card");
    card.setAttribute("label", ex.title);
    card.dataset.webmapId = ex.webmapId;

    const thumbWrapper = document.createElement("div");
    thumbWrapper.setAttribute("slot", "thumbnail");
    thumbWrapper.className = "thumb-wrapper";

    const img = document.createElement("img");
    img.alt = ex.title;
    fetchThumbnailUrl(ex.webmapId).then((url) => { img.src = url; });

    const chipBar = document.createElement("div");
    chipBar.className = "chip-bar";

    fetchWebmapFeatures(ex.webmapId).then(({ effectNames, blendModes, hasGroupLayers, hasOperationalLayers }) => {
      if (effectNames.length > 0) {
        chipBar.append(makeChip(ICON_EFFECTS, `Effects: ${effectNames.join(", ")}`));
      }
      if (blendModes.length > 0) {
        chipBar.append(makeChip(ICON_BLEND, `Blending: ${blendModes.join(", ")}`));
      }
      if (hasGroupLayers || hasOperationalLayers) {
        const parts = [];
        if (hasGroupLayers) parts.push("group layers");
        if (hasOperationalLayers) parts.push("operational layers");
        chipBar.append(makeChip(ICON_LAYERS, `Supplemental: ${parts.join(", ")}`));
      }
    });

    thumbWrapper.append(img, chipBar);

    const heading = document.createElement("span");
    heading.setAttribute("slot", "heading");
    heading.textContent = ex.title;

    card.append(thumbWrapper, heading);
    card.addEventListener("click", () => onSelect(ex.webmapId));
    grid.append(card);
  }

  container.append(grid);
}

export function setActiveCard(webmapId) {
  document.querySelectorAll("calcite-card[data-webmap-id]").forEach((c) => {
    c.selected = c.dataset.webmapId === webmapId;
  });
}
