import { BLEND_MODE_SUPPORTED_3D_TYPES } from "../layers/layers.js";

const LAYER_TYPE_TO_CLASS = {
  "tile": "TileLayer",
  "vector-tile": "VectorTileLayer",
  "imagery-tile": "ImageryTileLayer",
  "web-tile": "WebTileLayer",
  "open-street-map": "OpenStreetMapLayer",
  "wmts": "WMTSLayer",
  "wcs": "WCSLayer",
  "group": "GroupLayer",
  // Operational layer types
  "feature": "FeatureLayer",
  "map-image": "MapImageLayer",
  "imagery": "ImageryLayer",
  "geojson": "GeoJSONLayer",
  "csv": "CSVLayer",
  "kml": "KMLLayer",
  "wfs": "WFSLayer",
  "wms": "WMSLayer",
  "stream": "StreamLayer",
  "ogc-feature": "OGCFeatureLayer",
};

const CLASS_TO_MODULE = {
  TileLayer: "@arcgis/core/layers/TileLayer.js",
  VectorTileLayer: "@arcgis/core/layers/VectorTileLayer.js",
  ImageryTileLayer: "@arcgis/core/layers/ImageryTileLayer.js",
  WebTileLayer: "@arcgis/core/layers/WebTileLayer.js",
  OpenStreetMapLayer: "@arcgis/core/layers/OpenStreetMapLayer.js",
  WMTSLayer: "@arcgis/core/layers/WMTSLayer.js",
  WCSLayer: "@arcgis/core/layers/WCSLayer.js",
  GroupLayer: "@arcgis/core/layers/GroupLayer.js",
  FeatureLayer: "@arcgis/core/layers/FeatureLayer.js",
  MapImageLayer: "@arcgis/core/layers/MapImageLayer.js",
  ImageryLayer: "@arcgis/core/layers/ImageryLayer.js",
  GeoJSONLayer: "@arcgis/core/layers/GeoJSONLayer.js",
  CSVLayer: "@arcgis/core/layers/CSVLayer.js",
  KMLLayer: "@arcgis/core/layers/KMLLayer.js",
  WFSLayer: "@arcgis/core/layers/WFSLayer.js",
  WMSLayer: "@arcgis/core/layers/WMSLayer.js",
  StreamLayer: "@arcgis/core/layers/StreamLayer.js",
  OGCFeatureLayer: "@arcgis/core/layers/OGCFeatureLayer.js",
};

function effectObjectToCSS(e) {
  switch (e.type) {
    case "bloom":
      return `bloom(${e.strength}, ${e.radius}, ${e.threshold})`;
    case "drop-shadow": {
      const [r, g, b, a] = Array.isArray(e.color) ? e.color : [0, 0, 0, 255];
      return `drop-shadow(${e.xOffset} ${e.yOffset} ${e.blurRadius} rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)}))`;
    }
    case "hue-rotate": {
      const v = e.value ?? e.amount ?? 0;
      return `hue-rotate(${typeof v === "number" ? `${v}deg` : v})`;
    }
    case "blur": {
      const v = e.value ?? 0;
      return `blur(${typeof v === "number" ? `${v}px` : v})`;
    }
    default:
      // brightness, contrast, grayscale, invert, opacity, saturate, sepia
      return `${e.type}(${e.value ?? e.amount ?? 1})`;
  }
}

function isScaleDependent(effect) {
  return Array.isArray(effect) && effect.length > 0 && "scale" in effect[0];
}

export function serializeEffect(effect) {
  if (!effect) return null;
  if (typeof effect === "string") return JSON.stringify(effect);
  if (Array.isArray(effect)) {
    if (isScaleDependent(effect)) return "[…scale-dependent effects…]";
    return JSON.stringify(effect.map(effectObjectToCSS).join(" "));
  }
  return JSON.stringify(String(effect));
}

export function scaleToAltitude(scale) {
  return Math.round((scale / 1000) * 180);
}

function layerToLines(layer, mode, indent = "  ") {
  const p = `${indent}  `; // property indent
  const className = LAYER_TYPE_TO_CLASS[layer.type] ?? "TileLayer";
  const lines = [];
  const itemUrl = layer.portalItem?.id
    ? ` — https://www.arcgis.com/home/item.html?id=${layer.portalItem.id}`
    : "";
  lines.push(`${indent}// ${layer.title ?? layer.id}${itemUrl}`);
  lines.push(`${indent}new ${className}({`);

  if (layer.url) {
    lines.push(`${p}url: ${JSON.stringify(layer.url)},`);
  } else if (layer.portalItem?.id) {
    lines.push(`${p}portalItem: { id: ${JSON.stringify(layer.portalItem.id)} },`);
  }

  if (layer.blendMode && layer.blendMode !== "normal") {
    if (mode === "3d" && !BLEND_MODE_SUPPORTED_3D_TYPES.has(layer.type)) {
      lines.push(`${p}// blendMode: "${layer.blendMode}" — not supported for ${className} in SceneView — omitted`);
    } else {
      lines.push(`${p}blendMode: "${layer.blendMode}",`);
    }
  }

  if (layer.opacity !== undefined && layer.opacity !== 1) {
    lines.push(`${p}opacity: ${layer.opacity},`);
  }

  if (layer.effect) {
    if (mode === "3d") {
      lines.push(`${p}// effect: ${serializeEffect(layer.effect)} — not supported in SceneView — omitted`);
    } else if (typeof layer.effect === "string") {
      lines.push(`${p}effect: ${JSON.stringify(layer.effect)},`);
    } else if (isScaleDependent(layer.effect)) {
      lines.push(`${p}effect: [`);
      for (const e of layer.effect) {
        lines.push(`${p}  { scale: ${e.scale}, value: ${JSON.stringify(e.value)} },`);
      }
      lines.push(`${p}],`);
    } else if (Array.isArray(layer.effect)) {
      lines.push(`${p}effect: ${JSON.stringify(layer.effect.map(effectObjectToCSS).join(" "))},`);
    }
  }

  if (layer.featureEffect && mode === "3d") {
    lines.push(`${p}// featureEffect — not supported in SceneView — omitted`);
  }

  if (mode === "2d") {
    if (layer.minScale) lines.push(`${p}minScale: ${layer.minScale},`);
    if (layer.maxScale) lines.push(`${p}maxScale: ${layer.maxScale},`);
  } else if (layer.minScale || layer.maxScale) {
    lines.push(`${p}// Visible range (minScale/maxScale) not applicable in SceneView.`);
    if (layer.minScale) {
      lines.push(`${p}// minScale: ${layer.minScale} ≈ ${scaleToAltitude(layer.minScale)} m altitude (rough equatorial estimate)`);
    }
    if (layer.maxScale) {
      lines.push(`${p}// maxScale: ${layer.maxScale} ≈ ${scaleToAltitude(layer.maxScale)} m altitude (rough equatorial estimate)`);
    }
  }

  if (layer.type === "group" && layer.layers?.length > 0) {
    lines.push(`${p}layers: [`);
    for (const child of layer.layers.toArray()) {
      lines.push(...layerToLines(child, mode, `${p}  `));
    }
    lines.push(`${p}],`);
  }

  lines.push(`${indent}}),`);
  return lines;
}

function flattenAllLayers(layers) {
  const result = [];
  for (const l of layers) {
    result.push(l);
    if (l.type === "group" && l.layers?.length > 0) {
      result.push(...flattenAllLayers(l.layers.toArray()));
    }
  }
  return result;
}

export function generateSnippet(baseLayers, referenceLayers, operationalLayers, mode, background) {
  const usedClasses = new Set(
    flattenAllLayers([...baseLayers, ...referenceLayers, ...operationalLayers])
      .map((l) => LAYER_TYPE_TO_CLASS[l.type] ?? "TileLayer"),
  );

  const importLines = [
    ...Array.from(usedClasses).map(
      (cls) => `import ${cls} from "${CLASS_TO_MODULE[cls] ?? `@arcgis/core/layers/${cls}.js`}";`,
    ),
    `import Basemap from "@arcgis/core/Basemap.js";`,
  ];

  if (background?.color && mode === "2d") {
    importLines.push(`import ColorBackground from "@arcgis/core/webdoc/support/ColorBackground.js";`);
  }

  const lines = [
    ...importLines,
    "",
    "const baseLayers = [",
    ...baseLayers.flatMap((layer) => layerToLines(layer, mode)),
    "];",
  ];

  if (referenceLayers.length > 0) {
    lines.push(
      "",
      "const referenceLayers = [",
      ...referenceLayers.flatMap((layer) => layerToLines(layer, mode)),
      "];",
    );
  }

  const basemapArgs = referenceLayers.length > 0
    ? "{ baseLayers, referenceLayers }"
    : "{ baseLayers }";

  lines.push("", `const basemap = new Basemap(${basemapArgs});`);

  if (operationalLayers.length > 0) {
    lines.push(
      "",
      "// Operational layers",
      "const operationalLayers = [",
      ...operationalLayers.flatMap((layer) => layerToLines(layer, mode)),
      "];",
      "",
      "// map.basemap = basemap;",
      "// map.layers.addMany(operationalLayers);",
    );
  } else {
    lines.push("// map.basemap = basemap;");
  }

  if (background?.color) {
    const { r, g, b, a } = background.color;
    if (mode === "2d") {
      const colorArr = [Math.round(r), Math.round(g), Math.round(b), a];
      lines.push(`view.background = new ColorBackground({ color: ${JSON.stringify(colorArr)} });`);
    } else {
      const colorArr = [Math.round(r), Math.round(g), Math.round(b)];
      lines.push(`view.ground.surfaceColor = ${JSON.stringify(colorArr)};`);
    }
  }

  return lines.join("\n");
}

export function generateWebMapIdSnippet(itemId) {
  return [
    `import WebMap from "@arcgis/core/WebMap.js";`,
    `import MapView from "@arcgis/core/views/MapView.js";`,
    "",
    "const map = new WebMap({",
    `  portalItem: { id: ${JSON.stringify(itemId)} },`,
    "});",
    "",
    'const view = new MapView({ container: "viewDiv", map });',
  ].join("\n");
}

export function generateWebSceneIdSnippet(itemId) {
  return [
    `import WebScene from "@arcgis/core/WebScene.js";`,
    `import SceneView from "@arcgis/core/views/SceneView.js";`,
    "",
    "const map = new WebScene({",
    `  portalItem: { id: ${JSON.stringify(itemId)} },`,
    "});",
    "",
    'const view = new SceneView({ container: "viewDiv", map });',
  ].join("\n");
}
