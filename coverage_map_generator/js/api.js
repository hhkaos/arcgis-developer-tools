import {
  EXPORT_POLL_INTERVAL_MS,
  JOB_POLL_INTERVAL_MS,
  NETWORK_RETRY_LIMIT,
  PORTAL_URL,
  SIGNAL_PROFILES,
  VIEWSHED_JOB_BASE,
  VIEWSHED_SUBMIT_URL,
} from "./config.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseErrorResponse(response) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }

  const message = parsed?.error?.message || parsed?.message || bodyText || `HTTP ${response.status}`;
  const detail = Array.isArray(parsed?.error?.details) ? parsed.error.details.join(" ") : "";
  return detail ? `${message} ${detail}`.trim() : message;
}

async function requestJson(url, options = {}, retries = NETWORK_RETRY_LIMIT) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const message = await parseErrorResponse(response);
        throw new Error(message);
      }

      const data = await response.json();
      if (data?.error) {
        const detail = Array.isArray(data.error.details) ? data.error.details.join(" ") : "";
        throw new Error(`${data.error.message}${detail ? ` ${detail}` : ""}`.trim());
      }
      return data;
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      attempt += 1;
      await sleep(700 * attempt);
    }
  }
}

export function createInputLayerPayload(sourceState) {
  if (sourceState.type === "public") {
    const payload = { url: sourceState.url.trim() };
    if (sourceState.filter?.trim()) payload.filter = sourceState.filter.trim();
    return payload;
  }

  if (sourceState.type === "private") {
    const payload = {
      url: sourceState.url.trim(),
      serviceToken: sourceState.serviceToken.trim(),
    };
    if (sourceState.filter?.trim()) payload.filter = sourceState.filter.trim();
    return payload;
  }

  return sourceState.featureCollection;
}

function normalizeDateForTitle(dateISO) {
  return String(dateISO).replace(/-/g, "_");
}

function technologyToken(technology) {
  const map = {
    "2G_GSM": "2g",
    "3G_UMTS": "3g",
    "4G_LTE": "4g",
    "5G_NR_sub6": "5g_sub6",
    "5G_NR_mmWave": "5g_mmwave",
  };
  return map[technology] || String(technology).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function featureServiceRoot(layerUrl) {
  const withoutQuery = String(layerUrl).split("?")[0];
  const match = withoutQuery.match(/^(.*\/FeatureServer)(?:\/\d+)?$/i);
  return match ? match[1] : withoutQuery;
}

const serviceItemIdCache = new Map();

async function resolveServiceItemId({ url, serviceToken }) {
  const root = featureServiceRoot(url);
  const cacheKey = `${root}|${serviceToken || ""}`;
  if (serviceItemIdCache.has(cacheKey)) return serviceItemIdCache.get(cacheKey);

  const params = new URLSearchParams({ f: "json" });
  if (serviceToken) params.set("token", serviceToken);
  const data = await requestJson(`${root}?${params.toString()}`);
  const itemId = data?.serviceItemId || data?.itemId;

  if (itemId) {
    serviceItemIdCache.set(cacheKey, itemId);
  }
  return itemId || null;
}

export async function submitViewshedJob({ token, technology, inputLayer, dateISO }) {
  const profile = SIGNAL_PROFILES[technology];
  const safeDate = normalizeDateForTitle(dateISO);
  const coverageName = `coverage_${technologyToken(technology)}_${safeDate}`;
  const effectiveInputLayer = { ...inputLayer };

  if (effectiveInputLayer.url && !effectiveInputLayer.itemId) {
    const resolvedItemId = await resolveServiceItemId({
      url: effectiveInputLayer.url,
      serviceToken: effectiveInputLayer.serviceToken,
    });
    if (resolvedItemId) {
      effectiveInputLayer.itemId = resolvedItemId;
    }
  }

  const params = new URLSearchParams({
    f: "json",
    token,
    inputLayer: JSON.stringify(effectiveInputLayer),
    observerHeight: String(profile.observerHeight),
    observerHeightUnits: profile.observerHeightUnits,
    targetHeight: String(profile.targetHeight),
    targetHeightUnits: profile.targetHeightUnits,
    maximumDistance: String(profile.maximumDistance),
    maxDistanceUnits: profile.maxDistanceUnits,
    outputName: JSON.stringify({
      serviceProperties: { name: coverageName },
      itemProperties: {
        title: coverageName,
        description: "Output generated from running the Create Viewshed analysis tool.",
        snippet: "Output generated from Create Viewshed",
        folderId: "",
      },
    }),
    context: JSON.stringify({ outSR: { latestWkid: 4326 } }),
  });

  const data = await requestJson(VIEWSHED_SUBMIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: params.toString(),
  });
  if (!data.jobId) {
    throw new Error("Viewshed submit response did not include jobId");
  }
  return data.jobId;
}

export async function pollViewshedJob({ token, jobId, onPoll }) {
  const start = Date.now();
  let pollCount = 0;

  while (true) {
    pollCount += 1;
    const params = new URLSearchParams({ f: "json", token });
    const job = await requestJson(`${VIEWSHED_JOB_BASE}/${jobId}?${params.toString()}`);
    const elapsedMs = Date.now() - start;
    onPoll?.(pollCount, elapsedMs, job);

    const status = job.jobStatus;
    if (status === "esriJobSucceeded") return job;
    if (status === "esriJobFailed" || status === "esriJobCancelled") {
      throw new Error(job.messages?.map((x) => x.description).filter(Boolean).join(" ") || `Job ended with status ${status}`);
    }

    await sleep(JOB_POLL_INTERVAL_MS);
  }
}

export async function fetchViewshedLayerInfo({ token, jobId }) {
  const params = new URLSearchParams({ returnType: "data", f: "json", token });
  const result = await requestJson(
    `${VIEWSHED_JOB_BASE}/${jobId}/results/viewshedLayer?${params.toString()}`,
  );

  const itemId = result?.value?.itemId;
  const url = result?.value?.url;
  if (!itemId || !url) {
    throw new Error("Viewshed result did not include itemId and url");
  }

  return { itemId, url };
}

let cachedUsername = null;

export async function getPortalUsername(token) {
  if (cachedUsername) return cachedUsername;

  const params = new URLSearchParams({ f: "json", token });
  const data = await requestJson(`${PORTAL_URL}/sharing/rest/portals/self?${params.toString()}`);
  const username = data?.user?.username;

  if (!username) {
    throw new Error("Unable to resolve ArcGIS username from portal profile");
  }

  cachedUsername = username;
  return username;
}

export async function submitGeoJsonExport({ token, username, itemId, title }) {
  const params = new URLSearchParams({
    f: "json",
    itemId,
    title,
    exportFormat: "GeoJson",
    token,
  });

  const data = await requestJson(`${PORTAL_URL}/sharing/rest/content/users/${encodeURIComponent(username)}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: params.toString(),
  });

  const exportItemId = data.exportItemId || data.itemId;
  const exportJobId = data.jobId;

  if (!exportItemId || !exportJobId) {
    throw new Error("Export response did not include export item ID and job ID");
  }

  return {
    exportItemId,
    exportJobId,
  };
}

export async function pollExportStatus({ token, username, exportItemId, exportJobId }) {
  while (true) {
    const params = new URLSearchParams({
      f: "json",
      jobId: exportJobId,
      jobType: "export",
      token,
    });

    const data = await requestJson(
      `${PORTAL_URL}/sharing/rest/content/users/${encodeURIComponent(username)}/items/${encodeURIComponent(
        exportItemId,
      )}/status?${params.toString()}`,
    );

    const status = (data.status || "").toLowerCase();
    if (status === "completed") return;
    if (["failed", "failure", "cancelled"].includes(status)) {
      throw new Error(`Export failed with status ${data.status}`);
    }

    await sleep(EXPORT_POLL_INTERVAL_MS);
  }
}

export async function downloadExportGeoJson({ token, exportItemId }) {
  const params = new URLSearchParams({ token });
  const response = await fetch(
    `${PORTAL_URL}/sharing/rest/content/items/${encodeURIComponent(exportItemId)}/data?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error(`GeoJSON download failed with HTTP ${response.status}`);
  }

  return response.blob();
}
