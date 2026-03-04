const CACHE_KEY = "arcgis-basemaps-cache";
const CACHE_VERSION = 1;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { version: CACHE_VERSION, items: {} };
    const parsed = JSON.parse(raw);
    if (parsed.version !== CACHE_VERSION) return { version: CACHE_VERSION, items: {} };
    return parsed;
  } catch {
    return { version: CACHE_VERSION, items: {} };
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable — continue without caching
  }
}

export function getCachedItem(itemId) {
  const cache = loadCache();
  const entry = cache.items[itemId];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) return null;
  return entry;
}

export function setCachedItem(itemId, data) {
  const cache = loadCache();
  cache.items[itemId] = { ...data, cachedAt: Date.now() };
  saveCache(cache);
}

export function invalidateCachedItem(itemId) {
  const cache = loadCache();
  delete cache.items[itemId];
  saveCache(cache);
}

export function invalidateAllCache() {
  localStorage.removeItem(CACHE_KEY);
}

/**
 * Returns the age of the oldest cached item, or null if cache is empty.
 */
export function getCacheAge() {
  const cache = loadCache();
  const timestamps = Object.values(cache.items).map((e) => e.cachedAt);
  if (timestamps.length === 0) return null;
  const oldest = Math.min(...timestamps);
  return Date.now() - oldest;
}
