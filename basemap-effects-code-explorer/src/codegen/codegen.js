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

function layerToLines(layer, mode) {
  const className = LAYER_TYPE_TO_CLASS[layer.type] ?? "TileLayer";
  const lines = [];
  const itemUrl = layer.portalItem?.id
    ? ` — https://www.arcgis.com/home/item.html?id=${layer.portalItem.id}`
    : "";
  lines.push(`  // ${layer.title ?? layer.id}${itemUrl}`);
  lines.push(`  new ${className}({`);

  if (layer.url) {
    lines.push(`    url: ${JSON.stringify(layer.url)},`);
  } else if (layer.portalItem?.id) {
    lines.push(`    portalItem: { id: ${JSON.stringify(layer.portalItem.id)} },`);
  }

  if (layer.blendMode && layer.blendMode !== "normal") {
    if (mode === "3d" && !BLEND_MODE_SUPPORTED_3D_TYPES.has(layer.type)) {
      lines.push(`    // blendMode: "${layer.blendMode}" — not supported for ${className} in SceneView — omitted`);
    } else {
      lines.push(`    blendMode: "${layer.blendMode}",`);
    }
  }

  if (layer.opacity !== undefined && layer.opacity !== 1) {
    lines.push(`    opacity: ${layer.opacity},`);
  }

  if (layer.effect) {
    if (mode === "3d") {
      lines.push(`    // effect: ${serializeEffect(layer.effect)} — not supported in SceneView — omitted`);
    } else if (typeof layer.effect === "string") {
      lines.push(`    effect: ${JSON.stringify(layer.effect)},`);
    } else if (isScaleDependent(layer.effect)) {
      lines.push(`    effect: [`);
      for (const e of layer.effect) {
        lines.push(`      { scale: ${e.scale}, value: ${JSON.stringify(e.value)} },`);
      }
      lines.push(`    ],`);
    } else if (Array.isArray(layer.effect)) {
      lines.push(`    effect: ${JSON.stringify(layer.effect.map(effectObjectToCSS).join(" "))},`);
    }
  }

  if (layer.featureEffect && mode === "3d") {
    lines.push(`    // featureEffect — not supported in SceneView — omitted`);
  }

  if (mode === "2d") {
    if (layer.minScale) lines.push(`    minScale: ${layer.minScale},`);
    if (layer.maxScale) lines.push(`    maxScale: ${layer.maxScale},`);
  } else if (layer.minScale || layer.maxScale) {
    lines.push(`    // Visible range (minScale/maxScale) not applicable in SceneView.`);
    if (layer.minScale) {
      lines.push(`    // minScale: ${layer.minScale} ≈ ${scaleToAltitude(layer.minScale)} m altitude (rough equatorial estimate)`);
    }
    if (layer.maxScale) {
      lines.push(`    // maxScale: ${layer.maxScale} ≈ ${scaleToAltitude(layer.maxScale)} m altitude (rough equatorial estimate)`);
    }
  }

  lines.push(`  }),`);
  return lines;
}

export function generateSnippet(baseLayers, referenceLayers, mode) {
  const allLayers = [...baseLayers, ...referenceLayers];
  const usedClasses = new Set(
    allLayers.map((l) => LAYER_TYPE_TO_CLASS[l.type] ?? "TileLayer"),
  );

  const importLines = [
    ...Array.from(usedClasses).map(
      (cls) => `import ${cls} from "${CLASS_TO_MODULE[cls] ?? `@arcgis/core/layers/${cls}.js`}";`,
    ),
    `import Basemap from "@arcgis/core/Basemap.js";`,
  ];

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

  lines.push("", `const basemap = new Basemap(${basemapArgs});`, "// map.basemap = basemap;");

  return lines.join("\n");
}
