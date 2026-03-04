import ArcGISMap from "https://js.arcgis.com/4.31/@arcgis/core/Map.js";
import MapView from "https://js.arcgis.com/4.31/@arcgis/core/views/MapView.js";
import GeoJSONLayer from "https://js.arcgis.com/4.31/@arcgis/core/layers/GeoJSONLayer.js";
import { SIGNAL_PROFILES } from "./config.js";

let map;
let view;

const layerRegistry = new Map();
const allLayerViews = [];
let manualLayerCounter = 0;
const manualLayerColors = [
  [14, 116, 144, 0.35],
  [194, 65, 12, 0.35],
  [21, 128, 61, 0.35],
  [30, 64, 175, 0.35],
  [124, 45, 18, 0.35],
];

function colorToCss(colorArray) {
  const [r, g, b, a] = colorArray;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function colorToOutline(colorArray) {
  const [r, g, b] = colorArray;
  return [Math.max(0, r - 25), Math.max(0, g - 25), Math.max(0, b - 25), 0.95];
}

export async function initMap(containerId) {
  map = new ArcGISMap({ basemap: "gray-vector" });
  view = new MapView({
    container: containerId,
    map,
    center: [-98.5795, 39.8283],
    zoom: 4,
  });

  await view.when();
}

export async function addCoverageGeoJson({ technology, blob, fileName }) {
  const profile = SIGNAL_PROFILES[technology];
  const layerKey = technology;
  const label = profile.label;
  const color = profile.color;
  const url = URL.createObjectURL(blob);

  const layer = new GeoJSONLayer({
    url,
    title: label,
    renderer: {
      type: "simple",
      symbol: {
        type: "simple-fill",
        color,
        outline: {
          color: colorToOutline(color),
          width: 1,
        },
      },
    },
  });

  map.add(layer);
  await layer.when();

  layerRegistry.set(layerKey, {
    layer,
    url,
    fileName,
    label,
    colorCss: colorToCss(color),
  });
  allLayerViews.push(layer);

  await zoomToAllLayers();
  return layerKey;
}

export async function addManualCoverageGeoJson({ blob, fileName, label }) {
  const color = manualLayerColors[manualLayerCounter % manualLayerColors.length];
  manualLayerCounter += 1;
  const layerKey = `manual_${manualLayerCounter}`;
  const layerLabel = label || fileName || `Uploaded Coverage ${manualLayerCounter}`;
  const url = URL.createObjectURL(blob);

  const layer = new GeoJSONLayer({
    url,
    title: layerLabel,
    renderer: {
      type: "simple",
      symbol: {
        type: "simple-fill",
        color,
        outline: {
          color: colorToOutline(color),
          width: 1,
        },
      },
    },
  });

  map.add(layer);
  await layer.when();

  layerRegistry.set(layerKey, {
    layer,
    url,
    fileName: fileName || `${layerLabel}.geojson`,
    label: layerLabel,
    colorCss: colorToCss(color),
  });
  allLayerViews.push(layer);

  await zoomToAllLayers();
  return layerKey;
}

async function zoomToAllLayers() {
  if (!allLayerViews.length) return;
  const extents = await Promise.all(
    allLayerViews.map(async (layer) => {
      const query = layer.createQuery();
      query.returnGeometry = true;
      query.outFields = ["*"];
      const result = await layer.queryExtent(query);
      return result.extent;
    }),
  );

  const valid = extents.filter(Boolean);
  if (!valid.length) return;

  const union = valid.reduce((acc, extent) => (acc ? acc.union(extent) : extent.clone()), null);
  if (union) {
    await view.goTo(union.expand(1.2), { duration: 600 });
  }
}

export function toggleLayerVisibility(layerKey) {
  const record = layerRegistry.get(layerKey);
  if (!record) return null;
  record.layer.visible = !record.layer.visible;
  return record.layer.visible;
}

export function getLegendEntries() {
  return [...layerRegistry.entries()].map(([layerKey, record]) => ({
    layerKey,
    label: record.label,
    colorCss: record.colorCss,
    visible: record.layer.visible,
  }));
}

export function destroyMapResources() {
  for (const [, record] of layerRegistry.entries()) {
    URL.revokeObjectURL(record.url);
  }
}
