import { SIGNAL_PROFILES } from "./config.js";
import { initAuth, signIn, signOut, getToken, getCurrentCredential } from "./auth.js";
import { runCoverageWorkflow, STATUS } from "./workflow.js";
import {
  addCoverageGeoJson,
  addManualCoverageGeoJson,
  getLegendEntries,
  initMap,
  toggleLayerVisibility,
} from "./map.js";

const els = {
  signInBtn: document.getElementById("signInBtn"),
  signOutBtn: document.getElementById("signOutBtn"),
  userInfo: document.getElementById("userInfo"),
  username: document.getElementById("username"),
  userAvatar: document.getElementById("userAvatar"),
  banner: document.getElementById("banner"),

  inputSection: document.getElementById("inputSection"),
  progressSection: document.getElementById("progressSection"),
  mapSection: document.getElementById("mapSection"),

  techGrid: document.getElementById("technologyGrid"),
  sourceError: document.getElementById("sourceError"),
  techError: document.getElementById("techError"),
  generateBtn: document.getElementById("generateBtn"),
  titlePrefix: document.getElementById("titlePrefix"),

  publicUrl: document.getElementById("publicUrl"),
  publicFilter: document.getElementById("publicFilter"),
  publicCountMeta: document.getElementById("publicCountMeta"),
  privateUrl: document.getElementById("privateUrl"),
  privateToken: document.getElementById("privateToken"),
  privateFilter: document.getElementById("privateFilter"),
  privateCountMeta: document.getElementById("privateCountMeta"),

  sourcePublic: document.getElementById("sourcePublic"),
  sourcePrivate: document.getElementById("sourcePrivate"),
  sourceUpload: document.getElementById("sourceUpload"),
  geojsonFile: document.getElementById("geojsonFile"),
  dropZone: document.getElementById("dropZone"),
  uploadMeta: document.getElementById("uploadMeta"),

  progressRows: document.getElementById("progressRows"),
  coverageMapFile: document.getElementById("coverageMapFile"),
  uploadCoverageBtn: document.getElementById("uploadCoverageBtn"),
  dissolveBtn: document.getElementById("dissolveBtn"),
  downloadAllBtn: document.getElementById("downloadAllBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),

  legend: document.getElementById("legend"),
  legendToggle: document.getElementById("legendToggle"),
  legendContent: document.getElementById("legendContent"),
};

const state = {
  signedIn: false,
  username: "",
  sourceType: "public",
  uploadFeatureCollection: null,
  progress: new Map(),
  downloads: new Map(),
  layerGeoJson: new Map(),
};

let countFetchTimer = null;
let countFetchController = null;

const sourcePanels = {
  public: els.sourcePublic,
  private: els.sourcePrivate,
  upload: els.sourceUpload,
};

function showBanner(message) {
  els.banner.textContent = message;
  els.banner.classList.remove("hidden");
}

function clearBanner() {
  els.banner.classList.add("hidden");
  els.banner.textContent = "";
}

function setAuthUi(signedIn, username = "") {
  state.signedIn = signedIn;
  state.username = username;

  els.signInBtn.classList.toggle("hidden", signedIn);
  els.userInfo.classList.toggle("hidden", !signedIn);
  els.inputSection.classList.toggle("hidden", !signedIn);
  els.mapSection.classList.toggle("hidden", !signedIn);

  if (signedIn) {
    els.username.textContent = username;
    els.userAvatar.textContent = (username?.[0] || "U").toUpperCase();
  }

  updateGenerateEnabled();
}

function titleForTech(tech) {
  return SIGNAL_PROFILES[tech]?.label || tech;
}

function renderTechnologyChoices() {
  const entries = Object.entries(SIGNAL_PROFILES);
  els.techGrid.innerHTML = entries
    .map(([tech, profile]) => {
      return `<label><input type="checkbox" value="${tech}" /> ${profile.label} - max ${profile.maximumDistance} mi</label>`;
    })
    .join("");
}

function currentTechnologies() {
  return [...els.techGrid.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value);
}

function currentMode() {
  return document.querySelector('input[name="processingMode"]:checked')?.value || "parallel";
}

function currentSourceType() {
  return document.querySelector('input[name="sourceType"]:checked')?.value || "public";
}

function showSourcePanel(type) {
  Object.entries(sourcePanels).forEach(([key, panel]) => {
    panel.classList.toggle("hidden", key !== type);
  });
  state.sourceType = type;
}

function showFieldError(element, message) {
  if (!message) {
    element.classList.add("hidden");
    element.textContent = "";
    return;
  }

  element.classList.remove("hidden");
  element.textContent = message;
}

function sanitizeTitlePrefix(value) {
  return (value || "coverage").trim().replace(/[^a-zA-Z0-9_-]+/g, "_") || "coverage";
}

function validateSource() {
  if (state.sourceType === "public") {
    if (!els.publicUrl.value.trim()) {
      return "Public feature layer URL is required.";
    }
  }

  if (state.sourceType === "private") {
    if (!els.privateUrl.value.trim()) return "Private feature layer URL is required.";
    if (!els.privateToken.value.trim()) return "Service token is required for private layer.";
  }

  if (state.sourceType === "upload" && !state.uploadFeatureCollection) {
    return "GeoJSON upload is required.";
  }

  return "";
}

function getCountTargetBySourceType(sourceType) {
  if (sourceType === "public") {
    return {
      url: els.publicUrl.value.trim(),
      where: els.publicFilter.value.trim() || "1=1",
      token: "",
      target: els.publicCountMeta,
    };
  }

  if (sourceType === "private") {
    return {
      url: els.privateUrl.value.trim(),
      where: els.privateFilter.value.trim() || "1=1",
      token: els.privateToken.value.trim(),
      target: els.privateCountMeta,
    };
  }

  return null;
}

function setCountText(target, text) {
  if (!target) return;
  target.textContent = text;
}

function normalizeLayerQueryUrl(layerUrl) {
  const url = String(layerUrl || "").trim();
  if (!url) return "";
  return url.endsWith("/query") ? url : `${url.replace(/\/+$/, "")}/query`;
}

async function fetchFeatureCount({ url, where, token, signal }) {
  const queryUrl = normalizeLayerQueryUrl(url);
  if (!queryUrl) throw new Error("Layer URL is required.");

  const params = new URLSearchParams({
    f: "json",
    where,
    returnCountOnly: "true",
  });
  if (token) params.set("token", token);

  const response = await fetch(`${queryUrl}?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data?.error) {
    const message = data.error.message || "Count query failed";
    const details = Array.isArray(data.error.details) ? data.error.details.join(" ") : "";
    throw new Error(`${message}${details ? ` ${details}` : ""}`.trim());
  }
  if (typeof data.count !== "number") {
    throw new Error("Count not returned by service.");
  }
  return data.count;
}

function scheduleFeatureCountUpdate() {
  const currentSource = currentSourceType();
  if (currentSource === "upload") return;

  const context = getCountTargetBySourceType(currentSource);
  if (!context?.target) return;

  if (!context.url) {
    setCountText(context.target, "Matching features: -");
    return;
  }

  if (currentSource === "private" && !context.token) {
    setCountText(context.target, "Matching features: provide service token");
    return;
  }

  setCountText(context.target, "Matching features: checking...");

  clearTimeout(countFetchTimer);
  countFetchTimer = setTimeout(async () => {
    if (countFetchController) {
      countFetchController.abort();
    }
    countFetchController = new AbortController();

    try {
      const count = await fetchFeatureCount({
        url: context.url,
        where: context.where,
        token: context.token,
        signal: countFetchController.signal,
      });
      setCountText(context.target, `Matching features: ${count.toLocaleString()}`);
    } catch (error) {
      if (error?.name === "AbortError") return;
      setCountText(context.target, `Matching features: unavailable (${error.message || "error"})`);
    }
  }, 400);
}

function validateForm() {
  const sourceError = validateSource();
  const noTech = currentTechnologies().length === 0;

  showFieldError(els.sourceError, sourceError);
  showFieldError(els.techError, noTech ? "Select at least one technology." : "");

  return !sourceError && !noTech;
}

function updateGenerateEnabled() {
  if (!state.signedIn) {
    els.generateBtn.disabled = true;
    return;
  }

  const sourceReady = !validateSource();
  const hasTech = currentTechnologies().length > 0;
  els.generateBtn.disabled = !(sourceReady && hasTech);
}

function resetProgressTable(technologies) {
  state.progress.clear();
  els.progressRows.innerHTML = "";
  technologies.forEach((technology) => {
    const row = document.createElement("tr");
    row.dataset.tech = technology;
    row.className = "progress-row";

    const color = SIGNAL_PROFILES[technology].color;
    row.style.borderLeftColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)`;

    row.innerHTML = `
      <td>${titleForTech(technology)}</td>
      <td>${STATUS.PENDING}</td>
      <td>-</td>
    `;
    els.progressRows.appendChild(row);
    state.progress.set(technology, { status: STATUS.PENDING, detail: "" });
  });
}

function updateProgressRow({ technology, status, detail }) {
  state.progress.set(technology, { status, detail });

  const row = els.progressRows.querySelector(`tr[data-tech="${technology}"]`);
  if (!row) return;

  const statusCell = row.children[1];
  const detailCell = row.children[2];

  statusCell.textContent = status;
  if (status === STATUS.DONE && state.downloads.has(technology)) {
    const button = document.createElement("button");
    button.className = "btn btn-secondary";
    button.textContent = "Download";
    button.addEventListener("click", () => {
      const item = state.downloads.get(technology);
      downloadBlob(item.blob, item.fileName);
    });
    detailCell.innerHTML = "";
    detailCell.appendChild(button);
  } else {
    detailCell.textContent = detail || "-";
  }
}

function downloadBlob(blob, fileName) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function updateDissolveEnabled() {
  els.dissolveBtn.disabled = state.layerGeoJson.size === 0;
}

function toBaseName(fileName, fallback = "coverage") {
  return (fileName || fallback).replace(/\.(geojson|json)$/i, "");
}

async function downloadAll() {
  const entries = [...state.downloads.values()];
  if (!entries.length) return;

  if (typeof JSZip === "undefined") {
    showBanner("Download All requires JSZip CDN. Check internet access.");
    return;
  }

  const zip = new JSZip();
  for (const item of entries) {
    zip.file(item.fileName, item.blob);
  }

  const content = await zip.generateAsync({ type: "blob" });
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
  downloadBlob(content, `coverage_exports_${date}.zip`);
}

function buildSourceState() {
  if (state.sourceType === "public") {
    return {
      type: "public",
      url: els.publicUrl.value,
      filter: els.publicFilter.value,
    };
  }

  if (state.sourceType === "private") {
    return {
      type: "private",
      url: els.privateUrl.value,
      serviceToken: els.privateToken.value,
      filter: els.privateFilter.value,
    };
  }

  return {
    type: "upload",
    featureCollection: state.uploadFeatureCollection,
  };
}

function inferFieldType(value) {
  if (typeof value === "number") return Number.isInteger(value) ? "esriFieldTypeInteger" : "esriFieldTypeDouble";
  if (typeof value === "boolean") return "esriFieldTypeSmallInteger";
  if (value && !Number.isNaN(Date.parse(value))) return "esriFieldTypeDate";
  return "esriFieldTypeString";
}

function geoJsonToArcgisFeatureCollection(fc) {
  const sampleProps = fc.features[0]?.properties || {};
  const propertyFieldNames = Object.keys(sampleProps).filter((key) => key.toUpperCase() !== "OBJECTID");
  const fields = [
    { name: "OBJECTID", alias: "OBJECTID", type: "esriFieldTypeOID" },
    ...propertyFieldNames.map((key) => ({
      name: key,
      alias: key,
      type: inferFieldType(sampleProps[key]),
    })),
  ];

  const features = fc.features.map((feature, index) => {
    const [x, y] = feature.geometry.coordinates;
    const attrs = { ...(feature.properties || {}) };
    delete attrs.OBJECTID;
    attrs.OBJECTID = index + 1;
    return {
      geometry: { x, y, spatialReference: { wkid: 4326 } },
      attributes: attrs,
    };
  });

  return {
    layerDefinition: {
      geometryType: "esriGeometryPoint",
      objectIdField: "OBJECTID",
      fields,
    },
    featureSet: {
      geometryType: "esriGeometryPoint",
      features,
    },
  };
}

async function handleGeoJsonText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Unable to parse JSON file.");
  }

  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("GeoJSON must be a FeatureCollection.");
  }

  if (!data.features.length) {
    throw new Error("GeoJSON FeatureCollection must include at least one Point feature.");
  }

  const invalid = data.features.find(
    (feature) => feature?.type !== "Feature" || feature?.geometry?.type !== "Point" || !Array.isArray(feature?.geometry?.coordinates),
  );

  if (invalid) {
    throw new Error("GeoJSON must contain only Point features.");
  }

  state.uploadFeatureCollection = geoJsonToArcgisFeatureCollection(data);
  els.uploadMeta.textContent = `${data.features.length} point feature(s) loaded.`;
}

async function handleGeoJsonFile(file) {
  const text = await file.text();
  await handleGeoJsonText(text);
}

function validateCoverageGeoJsonText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Uploaded coverage file is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Uploaded coverage file is not a valid GeoJSON object.");
  }

  const allowedTypes = new Set([
    "FeatureCollection",
    "Feature",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
    "LineString",
    "MultiLineString",
    "Point",
    "MultiPoint",
  ]);

  if (!allowedTypes.has(parsed.type)) {
    throw new Error("Uploaded coverage file must be valid GeoJSON.");
  }

  if (parsed.type === "FeatureCollection" && (!Array.isArray(parsed.features) || parsed.features.length === 0)) {
    throw new Error("Uploaded coverage FeatureCollection is empty.");
  }

  return parsed;
}

async function handleCoverageMapUpload(file) {
  const text = await file.text();
  const parsed = validateCoverageGeoJsonText(text);
  const blob = new Blob([JSON.stringify(parsed)], { type: "application/geo+json" });
  const baseName = file.name.replace(/\.(geojson|json)$/i, "") || "Uploaded Coverage";

  els.mapSection.classList.remove("hidden");
  const layerKey = await addManualCoverageGeoJson({
    blob,
    fileName: file.name,
    label: baseName,
  });
  state.layerGeoJson.set(layerKey, { geojson: parsed, fileName: file.name });
  updateDissolveEnabled();
  renderLegend();
}

function asFeatureCollection(geojson) {
  if (!geojson || typeof geojson !== "object") return null;
  if (geojson.type === "FeatureCollection") return geojson;
  if (geojson.type === "Feature") return { type: "FeatureCollection", features: [geojson] };
  if (geojson.type && geojson.coordinates) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: geojson }],
    };
  }
  return null;
}

function getPolygonFeaturesFromLoadedLayers() {
  const polygonFeatures = [];
  for (const layerData of state.layerGeoJson.values()) {
    const fc = asFeatureCollection(layerData.geojson);
    if (!fc) continue;
    for (const feature of fc.features || []) {
      const type = feature?.geometry?.type;
      if (type === "Polygon" || type === "MultiPolygon") {
        polygonFeatures.push(feature);
      }
    }
  }
  return polygonFeatures;
}

function buildDissolvedFileName() {
  const names = [...state.layerGeoJson.values()].map((layerData) => toBaseName(layerData.fileName));
  if (names.length === 0) return "coverage_dissolved.geojson";
  if (names.length === 1) return `${names[0]}_dissolved.geojson`;
  return `${names[0]}_plus_${names.length - 1}_more_dissolved.geojson`;
}

async function ensureTurfLoaded() {
  if (window.turf) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Failed to load Turf."));
    document.head.appendChild(script);
  });
}

async function dissolveAndDownload() {
  clearBanner();
  const polygonFeatures = getPolygonFeaturesFromLoadedLayers();
  if (!polygonFeatures.length) {
    showBanner("No polygon coverage features available to dissolve.");
    return;
  }

  await ensureTurfLoaded();
  const inputCollection = {
    type: "FeatureCollection",
    features: polygonFeatures,
  };

  let dissolved;
  try {
    dissolved = window.turf.union(inputCollection);
  } catch {
    dissolved = null;
  }

  if (!dissolved) {
    showBanner("Unable to dissolve these features.");
    return;
  }

  const output = {
    type: "FeatureCollection",
    features: [dissolved],
  };
  const json = JSON.stringify(output, null, 2);
  const blob = new Blob([json], { type: "application/geo+json" });
  downloadBlob(blob, buildDissolvedFileName());
}

function renderLegend() {
  const entries = getLegendEntries();
  els.legendContent.innerHTML = "";

  entries.forEach((entry) => {
    const wrapper = document.createElement("div");
    wrapper.className = "legend-item";

    const left = document.createElement("div");
    left.className = "legend-left";

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = entry.colorCss;

    const label = document.createElement("span");
    label.textContent = entry.label;

    const toggle = document.createElement("button");
    toggle.className = "btn btn-secondary";
    toggle.textContent = entry.visible ? "Eye" : "Hide";
    toggle.addEventListener("click", () => {
      const visible = toggleLayerVisibility(entry.layerKey);
      toggle.textContent = visible ? "Eye" : "Hide";
    });

    left.append(swatch, label);
    wrapper.append(left, toggle);
    els.legendContent.appendChild(wrapper);
  });
}

async function startGeneration() {
  clearBanner();
  if (!validateForm()) {
    updateGenerateEnabled();
    return;
  }

  const token = await getToken();
  const selectedTech = currentTechnologies();
  const mode = currentMode();
  const sourceState = buildSourceState();
  const titlePrefix = sanitizeTitlePrefix(els.titlePrefix.value);

  state.downloads.clear();
  els.downloadAllBtn.disabled = true;

  els.progressSection.classList.remove("hidden");
  els.mapSection.classList.remove("hidden");

  resetProgressTable(selectedTech);

  const results = await runCoverageWorkflow({
    technologies: selectedTech,
    mode,
    sourceState,
    titlePrefix,
    token,
    onStatusUpdate: ({ technology, status, detail }) => {
      updateProgressRow({ technology, status, detail });
    },
  });

  for (const result of results) {
    if (!result.ok) continue;
    state.downloads.set(result.technology, result);
    const layerKey = await addCoverageGeoJson({
      technology: result.technology,
      blob: result.blob,
      fileName: result.fileName,
    });
    const geojsonText = await result.blob.text();
    state.layerGeoJson.set(layerKey, { geojson: JSON.parse(geojsonText), fileName: result.fileName });
    updateProgressRow({ technology: result.technology, status: STATUS.DONE, detail: "" });
    renderLegend();
  }

  els.downloadAllBtn.disabled = state.downloads.size === 0;
  updateDissolveEnabled();
}

function wireEvents() {
  els.signInBtn.addEventListener("click", async () => {
    clearBanner();
    try {
      const credential = await signIn();
      const username = credential?.userId || "ArcGIS User";
      setAuthUi(true, username);
    } catch {
      showBanner("Sign-in failed. Check your Client ID and redirect URI.");
    }
  });

  els.signOutBtn.addEventListener("click", () => {
    signOut();
    state.uploadFeatureCollection = null;
    state.layerGeoJson.clear();
    updateDissolveEnabled();
    setAuthUi(false, "");
    els.progressSection.classList.add("hidden");
    els.mapSection.classList.add("hidden");
  });

  document.querySelectorAll('input[name="sourceType"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      state.uploadFeatureCollection = state.sourceType === "upload" ? state.uploadFeatureCollection : null;
      showSourcePanel(currentSourceType());
      showFieldError(els.sourceError, "");
      scheduleFeatureCountUpdate();
      updateGenerateEnabled();
    });
  });

  document.querySelectorAll('input[name="processingMode"]').forEach((radio) => {
    radio.addEventListener("change", updateGenerateEnabled);
  });

  els.techGrid.addEventListener("change", () => {
    showFieldError(els.techError, "");
    updateGenerateEnabled();
  });

  [
    els.publicUrl,
    els.publicFilter,
    els.privateUrl,
    els.privateToken,
    els.privateFilter,
    els.titlePrefix,
  ].forEach((input) =>
    input.addEventListener("input", () => {
      scheduleFeatureCountUpdate();
      updateGenerateEnabled();
    }),
  );

  els.geojsonFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await handleGeoJsonFile(file);
      showFieldError(els.sourceError, "");
      updateGenerateEnabled();
    } catch (error) {
      state.uploadFeatureCollection = null;
      showFieldError(els.sourceError, error.message);
      updateGenerateEnabled();
    }
  });

  els.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropZone.classList.add("dragging");
  });

  els.dropZone.addEventListener("dragleave", () => {
    els.dropZone.classList.remove("dragging");
  });

  els.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("dragging");

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    try {
      await handleGeoJsonFile(file);
      showFieldError(els.sourceError, "");
      updateGenerateEnabled();
    } catch (error) {
      state.uploadFeatureCollection = null;
      showFieldError(els.sourceError, error.message);
      updateGenerateEnabled();
    }
  });

  els.generateBtn.addEventListener("click", async () => {
    els.generateBtn.disabled = true;
    try {
      await startGeneration();
    } catch (error) {
      showBanner(error.message || "Generation failed.");
    } finally {
      updateGenerateEnabled();
    }
  });

  els.downloadAllBtn.addEventListener("click", downloadAll);
  els.dissolveBtn.addEventListener("click", dissolveAndDownload);

  els.uploadCoverageBtn.addEventListener("click", () => {
    els.coverageMapFile.click();
  });

  els.coverageMapFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    clearBanner();
    try {
      await handleCoverageMapUpload(file);
    } catch (error) {
      showBanner(error.message || "Failed to upload coverage GeoJSON.");
    } finally {
      els.coverageMapFile.value = "";
    }
  });

  els.legendToggle.addEventListener("click", () => {
    els.legend.classList.toggle("collapsed");
  });

  els.fullscreenBtn.addEventListener("click", () => {
    els.mapSection.classList.toggle("fullscreen");
    window.dispatchEvent(new Event("resize"));
  });

  document.querySelectorAll(".collapse-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      btn.textContent = expanded ? "Expand" : "Collapse";
      target.classList.toggle("hidden", expanded);
    });
  });
}

async function loadJsZip() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load JSZip"));
    document.head.appendChild(script);
  });
}

async function init() {
  renderTechnologyChoices();
  showSourcePanel("public");
  scheduleFeatureCountUpdate();
  updateDissolveEnabled();
  wireEvents();

  await initMap("viewDiv");
  try {
    await loadJsZip();
  } catch {
    showBanner("JSZip failed to load; Download All will not be available.");
  }

  try {
    const credential = await initAuth();
    if (credential) {
      const user = await getCurrentCredential();
      setAuthUi(true, user?.userId || "ArcGIS User");
    } else {
      setAuthUi(false, "");
    }
  } catch {
    showBanner("Sign-in failed. Check your Client ID and redirect URI.");
    setAuthUi(false, "");
  }
}

init();
