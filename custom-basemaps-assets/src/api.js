import { getCachedItem, setCachedItem, invalidateCachedItem } from "./cache.js";

const REST_BASE = "https://www.arcgis.com/sharing/rest/content/items";
const THUMBNAIL_BASE = "https://www.arcgis.com/sharing/rest/content/items";

export function getThumbnailUrl(itemId, thumbnail) {
  if (!thumbnail) return null;
  return `${THUMBNAIL_BASE}/${itemId}/info/${thumbnail}`;
}

export function getMapViewerUrl(itemId, type) {
  const base = "https://www.arcgis.com/apps/mapviewer/index.html";
  const params = new URLSearchParams({ embedded: "1", locale: "en-us" });

  if (type === "Web Map") {
    params.set("webmap", itemId);
  } else if (type === "Web Scene") {
    params.set("webscene", itemId);
  } else {
    params.set("layers", itemId);
  }

  return `${base}?${params}`;
}

export function getItemPageUrl(itemId) {
  return `https://www.arcgis.com/home/item.html?id=${itemId}`;
}

/**
 * Fetch item metadata from ArcGIS REST API with localStorage caching.
 * Pass force=true to bypass cache.
 */
export async function fetchItemMetadata(itemId, { force = false } = {}) {
  if (!force) {
    const cached = getCachedItem(itemId);
    if (cached) return cached;
  } else {
    invalidateCachedItem(itemId);
  }

  const url = `${REST_BASE}/${itemId}?f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");

  const metadata = {
    itemId,
    title: data.title || "",
    snippet: data.snippet || "",
    description: data.description || "",
    type: data.type || "",
    typeKeywords: data.typeKeywords || [],
    thumbnail: data.thumbnail || null,
    thumbnailUrl: getThumbnailUrl(itemId, data.thumbnail),
    tags: data.tags || [],
  };

  setCachedItem(itemId, metadata);
  return metadata;
}

/**
 * Fetch multiple items concurrently, respecting cache.
 * Returns a map of itemId → metadata (or Error instance on failure).
 */
export async function fetchAllMetadata(itemIds, { force = false } = {}, onProgress) {
  const results = {};
  let done = 0;

  await Promise.all(
    itemIds.map(async (id) => {
      try {
        results[id] = await fetchItemMetadata(id, { force });
      } catch (err) {
        results[id] = err;
      } finally {
        done++;
        onProgress?.(done, itemIds.length);
      }
    })
  );

  return results;
}
