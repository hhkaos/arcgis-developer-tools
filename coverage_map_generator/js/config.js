export const CLIENT_ID = "vKxSME9AoYueJ5iW";

export const PORTAL_URL = "https://www.arcgis.com";
export const VIEWSHED_SUBMIT_URL =
  "https://analysis3.arcgis.com/arcgis/rest/services/tasks/GPServer/CreateViewshed/submitJob";
export const VIEWSHED_JOB_BASE =
  "https://analysis3.arcgis.com/arcgis/rest/services/tasks/GPServer/CreateViewshed/jobs";

export const SIGNAL_PROFILES = {
  "2G_GSM": {
    observerHeight: 100,
    observerHeightUnits: "Feet",
    targetHeight: 5,
    targetHeightUnits: "Feet",
    maximumDistance: 12,
    maxDistanceUnits: "Miles",
    color: [108, 117, 125, 0.35],
    label: "2G GSM",
  },
  "3G_UMTS": {
    observerHeight: 100,
    observerHeightUnits: "Feet",
    targetHeight: 5,
    targetHeightUnits: "Feet",
    maximumDistance: 8,
    maxDistanceUnits: "Miles",
    color: [40, 167, 69, 0.35],
    label: "3G UMTS",
  },
  "4G_LTE": {
    observerHeight: 100,
    observerHeightUnits: "Feet",
    targetHeight: 5,
    targetHeightUnits: "Feet",
    maximumDistance: 10,
    maxDistanceUnits: "Miles",
    color: [255, 140, 0, 0.35],
    label: "4G LTE",
  },
  "5G_NR_sub6": {
    observerHeight: 100,
    observerHeightUnits: "Feet",
    targetHeight: 5,
    targetHeightUnits: "Feet",
    maximumDistance: 3,
    maxDistanceUnits: "Miles",
    color: [111, 66, 193, 0.35],
    label: "5G NR sub-6",
  },
  "5G_NR_mmWave": {
    observerHeight: 100,
    observerHeightUnits: "Feet",
    targetHeight: 5,
    targetHeightUnits: "Feet",
    maximumDistance: 0.6,
    maxDistanceUnits: "Miles",
    color: [220, 53, 69, 0.35],
    label: "5G NR mmWave",
  },
};

export const JOB_POLL_INTERVAL_MS = 5000;
export const JOB_TIMEOUT_MS = 10 * 60 * 1000;
export const EXPORT_POLL_INTERVAL_MS = 3000;
export const NETWORK_RETRY_LIMIT = 3;
