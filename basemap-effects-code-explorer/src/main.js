import "@esri/calcite-components/main.css";
import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-navigation";
import "@esri/calcite-components/components/calcite-navigation-logo";
import "@esri/calcite-components/components/calcite-segmented-control";
import "@esri/calcite-components/components/calcite-segmented-control-item";
import "@esri/calcite-components/components/calcite-shell-panel";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-card";
import "@esri/calcite-components/components/calcite-card-group";
import "@esri/calcite-components/components/calcite-notice";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-link";
import "@esri/calcite-components/components/calcite-dialog";
import "@esri/calcite-components/components/calcite-input-text";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-search";
import "./gallery/gallery.css";
import WebMap from "@arcgis/core/WebMap.js";
import { switchTo2D, switchTo3D } from "./views/views.js";
import { renderGallery, setActiveCard } from "./gallery/gallery.js";
import { setState } from "./state/state.js";
import { readBasemapLayers, detectSceneViewLimitations, hasEffects, warnIfOperationalLayers, extractItemId } from "./layers/layers.js";
import { openCodeModal, renderCodeModal, wireCodeModalControls } from "./ui/ui.js";
import "./ui/ui.css";
import examples from "../curated-examples.json";

const mapEl = document.getElementById("mapView");
const sceneEl = document.getElementById("sceneView");
const viewToggle = document.getElementById("view-toggle");
const galleryEl = document.getElementById("gallery-container");
const sceneLimitationsNotice = document.getElementById("scene-limitations-notice");
const sceneLimitationsMessage = document.getElementById("scene-limitations-message");
const sceneLimitationsModal = document.getElementById("scene-limitations-modal");
const sceneLimitationsLearnMore = document.getElementById("scene-limitations-learn-more");
const codeModalEl = document.getElementById("code-modal");
const navSearchEl = document.getElementById("nav-search");
const webmapIdInputEl = document.getElementById("webmap-id-input");
const loadByIdBtnEl = document.getElementById("load-by-id-btn");
const loadNoticeEl = document.getElementById("load-notice");
const loadNoticeMessageEl = document.getElementById("load-notice-message");
const defaultExtentBtn2DEl = document.getElementById("default-extent-btn-2d");
const defaultExtentBtn3DEl = document.getElementById("default-extent-btn-3d");
const showCodeBtn2DEl = document.getElementById("show-code-btn-2d");
const showCodeBtn3DEl = document.getElementById("show-code-btn-3d");
const splitLayoutEl = document.getElementById("split-layout");
const mapSideEl = document.getElementById("map-side");
const resizeHandleEl = document.getElementById("resize-handle");
const mapSideCloseEl = document.getElementById("map-side-close");
const mapSideTitleEl = document.getElementById("map-side-title");

let activeTab = "2d";
let activeWebmap = null;
let defaultExtentTarget = null;

viewToggle.disabled = true;

const PANEL_WIDTH_KEY = "basemap-explorer-map-panel-width";

function openMapPanel() {
  if (mapSideEl.hidden) {
    const layoutWidth = splitLayoutEl.getBoundingClientRect().width;
    if (layoutWidth > 0) {
      const saved = localStorage.getItem(PANEL_WIDTH_KEY);
      const targetWidth = saved
        ? Math.min(Math.max(Number(saved), layoutWidth * 0.2), layoutWidth * 0.8)
        : Math.round(layoutWidth * 0.75);
      mapSideEl.style.flex = `0 0 ${targetWidth}px`;
    }
    mapSideEl.hidden = false;
    resizeHandleEl.hidden = false;
  }
}

function closeMapPanel() {
  mapSideEl.hidden = true;
  resizeHandleEl.hidden = true;
}

mapSideCloseEl.addEventListener("click", closeMapPanel);

let isResizing = false;
resizeHandleEl.addEventListener("pointerdown", (e) => {
  isResizing = true;
  resizeHandleEl.setPointerCapture(e.pointerId);
  resizeHandleEl.classList.add("is-resizing");
});
resizeHandleEl.addEventListener("pointermove", (e) => {
  if (!isResizing) return;
  const rect = splitLayoutEl.getBoundingClientRect();
  const newWidth = rect.right - e.clientX;
  const min = rect.width * 0.2;
  const max = rect.width * 0.8;
  mapSideEl.style.flex = `0 0 ${Math.min(Math.max(newWidth, min), max)}px`;
});
resizeHandleEl.addEventListener("pointerup", () => {
  isResizing = false;
  resizeHandleEl.classList.remove("is-resizing");
  localStorage.setItem(PANEL_WIDTH_KEY, String(mapSideEl.getBoundingClientRect().width));
});

sceneLimitationsLearnMore.addEventListener("click", (e) => {
  e.preventDefault();
  sceneLimitationsModal.open = true;
});

document.getElementById("scene-limitations-modal-close").addEventListener("click", () => {
  sceneLimitationsModal.open = false;
});

function showSceneLimitations({ layersWithEffect, layersWithFeatureEffect, layersWithUnsupportedBlendMode }) {
  const items = [];

  for (const { title, effectNames } of layersWithEffect) {
    const plural = effectNames.length > 1 ? "effects" : "effect";
    items.push(`"${title}": ${effectNames.join(", ")} ${plural} not rendered in 3D`);
  }
  for (const { title } of layersWithFeatureEffect) {
    items.push(`"${title}": feature effect not rendered in 3D`);
  }
  for (const { title, blendMode } of layersWithUnsupportedBlendMode) {
    items.push(`"${title}": blend mode (${blendMode}) not supported in 3D`);
  }

  if (items.length === 0) {
    sceneLimitationsNotice.open = false;
    return;
  }

  sceneLimitationsMessage.innerHTML = "";
  for (const item of items) {
    const div = document.createElement("div");
    div.textContent = item;
    sceneLimitationsMessage.appendChild(div);
  }
  sceneLimitationsNotice.open = true;
}

function hideSceneLimitations() {
  sceneLimitationsNotice.open = false;
}

const BANNER_KIND = { error: "danger", warning: "warning", info: "info" };

function showBanner(message, type) {
  loadNoticeEl.kind = BANNER_KIND[type] ?? "info";
  loadNoticeMessageEl.textContent = message;
  loadNoticeEl.open = true;
}

function hideBanner() {
  loadNoticeEl.open = false;
}

function resetToDefaultExtent(mode) {
  if (!defaultExtentTarget) return;

  const view = mode === "3d" ? sceneEl.view : mapEl.view;
  if (!view) return;

  view.goTo(defaultExtentTarget.clone(), { animate: false }).catch(() => {});
}

function updateViewLinks(itemId) {
  const mapViewerUrl = `https://www.arcgis.com/apps/mapviewer/index.html?webmap=${itemId}`;
  const itemDetailsUrl = `https://www.arcgis.com/home/item.html?id=${itemId}`;
  const multiscaleUrl = `https://www.rauljimenez.info/arcgis-developer-tools/webmap-multiview-explorer/?itemid=${itemId}`;
  document.getElementById("multiscale-link-2d").href = multiscaleUrl;
  document.getElementById("multiscale-link-3d").href = multiscaleUrl;
  document.getElementById("map-viewer-link-2d").href = mapViewerUrl;
  document.getElementById("map-viewer-link-3d").href = mapViewerUrl;
  document.getElementById("item-details-link-2d").href = itemDetailsUrl;
  document.getElementById("item-details-link-3d").href = itemDetailsUrl;
}

defaultExtentBtn2DEl.addEventListener("click", () => resetToDefaultExtent("2d"));
defaultExtentBtn3DEl.addEventListener("click", () => resetToDefaultExtent("3d"));

viewToggle.addEventListener("calciteSegmentedControlChange", (e) => {
  const tab = e.target.value;
  if (tab === activeTab) return;
  activeTab = tab;
  setState({ activeTab: tab });
  if (tab === "3d") {
    if (activeWebmap) {
      showSceneLimitations(detectSceneViewLimitations(readBasemapLayers(activeWebmap)));
    }
    navSearchEl.referenceElement = sceneEl;
    switchTo3D(mapEl, sceneEl);
  } else {
    hideSceneLimitations();
    navSearchEl.referenceElement = mapEl;
    switchTo2D(mapEl, sceneEl);
  }

  if (codeModalEl.open) {
    renderCodeModal(activeWebmap, activeTab);
  }
});

showCodeBtn2DEl.addEventListener("click", () => openCodeModal(activeWebmap, activeTab));
showCodeBtn3DEl.addEventListener("click", () => openCodeModal(activeWebmap, activeTab));

async function loadWebmap(rawInput) {
  const id = extractItemId(String(rawInput));
  if (!id) {
    showBanner("Invalid item ID or URL.", "error");
    return;
  }

  openMapPanel();
  viewToggle.disabled = true;
  hideBanner();

  const savedCamera = activeTab === "3d" ? sceneEl.view?.camera : null;
  const savedViewpoint = activeTab === "2d" ? mapEl.viewpoint?.clone() : null;

  const webmap = new WebMap({ portalItem: { id }, ground: "world-elevation" });

  try {
    await webmap.load();
  } catch {
    showBanner("Webmap not found or not accessible.", "error");
    viewToggle.disabled = false;
    return;
  }

  if (webmap.portalItem.type !== "Web Map") {
    showBanner("This item is not a Web Map.", "error");
    viewToggle.disabled = false;
    return;
  }

  mapSideTitleEl.textContent = `${webmap.portalItem.title} preview`;

  const savedWebmapTarget = webmap.initialViewProperties?.viewpoint?.targetGeometry?.clone() ?? null;

  mapEl.map = webmap;
  sceneEl.map = webmap;
  await Promise.all([mapEl.viewOnReady(), sceneEl.viewOnReady()]);

  defaultExtentTarget = savedWebmapTarget ?? mapEl.view?.extent?.clone() ?? null;

  activeWebmap = webmap;

  if (activeTab === "3d") {
    showSceneLimitations(detectSceneViewLimitations(readBasemapLayers(webmap)));
  } else {
    hideSceneLimitations();
  }

  if (activeTab === "3d" && savedCamera) {
    sceneEl.view.goTo(savedCamera, { animate: false });
  } else if (activeTab === "2d" && savedViewpoint) {
    mapEl.viewpoint = savedViewpoint;
  }

  updateViewLinks(id);
  setState({ activeWebmapId: id });
  setActiveCard(id);
  if (codeModalEl.open) {
    renderCodeModal(activeWebmap, activeTab);
  }

  const baseLayers = [
    ...webmap.basemap.baseLayers.toArray(),
    ...(webmap.basemap.referenceLayers?.toArray() ?? []),
  ];
  if (!hasEffects(baseLayers)) {
    showBanner("This webmap has no effects applied to basemap layers.", "info");
  }

  viewToggle.disabled = false;
}

async function init() {
  wireCodeModalControls();
  renderGallery(galleryEl, examples, loadWebmap);

  loadByIdBtnEl.addEventListener("click", () => loadWebmap(webmapIdInputEl.value));
  webmapIdInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadWebmap(webmapIdInputEl.value);
  });
}

init();
