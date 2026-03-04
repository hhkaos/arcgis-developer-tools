// Layer types where blend mode IS supported in SceneView (3D).
// Primarily tile-based layers. Other types (e.g. feature, graphics) are not supported.
export const BLEND_MODE_SUPPORTED_3D_TYPES = new Set([
  "base-tile",
  "imagery-tile",
  "open-street-map",
  "tile",
  "vector-tile",
  "wcs",
  "web-tile",
  "wmts",
  "group",
]);

export function readBasemapLayers(webmap) {
  return webmap.allLayers.toArray();
}

export function hasEffects(layers) {
  return layers.some(
    (l) =>
      (l.blendMode && l.blendMode !== "normal") ||
      l.effect ||
      (l.opacity !== undefined && l.opacity !== 1),
  );
}

export function warnIfOperationalLayers(webmap) {
  return webmap.layers.length > 0;
}

export function extractItemId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[0-9a-f]{32}$/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const id = url.searchParams.get("id");
    if (id && /^[0-9a-f]{32}$/i.test(id)) return id;
  } catch {
    // not a URL
  }
  return null;
}

function cssNamesFromString(str) {
  return (str.match(/([a-z-]+)\s*\(/g) || []).map((m) => m.replace(/\s*\($/, "").trim());
}

function getEffectTypeNames(effect) {
  if (Array.isArray(effect)) {
    // Scale-dependent effects: [{ scale, value }, ...] — extract names from first entry's CSS string
    if (effect.length > 0 && "scale" in effect[0]) {
      return cssNamesFromString(effect[0].value ?? "");
    }
    // Type-based effect objects: [{ type, ... }]
    return effect.map((e) => e.type).filter(Boolean);
  }
  // Plain CSS filter string, e.g. "bloom(...) hue-rotate(...)"
  return cssNamesFromString(effect);
}

/**
 * Detects layer properties that won't render correctly in SceneView (3D).
 * Does NOT modify any layer — SceneView's native behaviour (silently ignoring
 * unsupported properties) is the correct degradation path.
 *
 * Rules from ArcGIS Maps SDK 5.0:
 * - layer.effect: unsupported in 3D for ALL layer types (CSS-like filters)
 * - layer.featureEffect: unsupported in 3D
 * - layer.blendMode: supported only for tile-based layers; other types not supported
 * - layer.opacity: supported (but OIT makes it look different — no warning needed)
 *
 * @returns {{
 *   layersWithEffect: Array<{ title: string, effectNames: string[] }>,
 *   layersWithFeatureEffect: Array<{ title: string }>,
 *   layersWithUnsupportedBlendMode: Array<{ title: string, blendMode: string }>
 * }}
 */
export function detectSceneViewLimitations(layers) {
  const layersWithEffect = [];
  const layersWithFeatureEffect = [];
  const layersWithUnsupportedBlendMode = [];

  for (const layer of layers) {
    const title = layer.title ?? layer.id;

    // layer.effect — CSS-like filters — unsupported in 3D for all layer types
    if (layer.effect) {
      const effectNames = getEffectTypeNames(layer.effect);
      if (effectNames.length > 0) {
        layersWithEffect.push({ title, effectNames });
      }
    }

    // FeatureEffect — unsupported in 3D
    if (layer.featureEffect) {
      layersWithFeatureEffect.push({ title });
    }

    // Blend mode — unsupported in 3D for non-tile layer types
    if (
      layer.blendMode &&
      layer.blendMode !== "normal" &&
      !BLEND_MODE_SUPPORTED_3D_TYPES.has(layer.type)
    ) {
      layersWithUnsupportedBlendMode.push({ title, blendMode: layer.blendMode });
    }
  }

  return { layersWithEffect, layersWithFeatureEffect, layersWithUnsupportedBlendMode };
}
