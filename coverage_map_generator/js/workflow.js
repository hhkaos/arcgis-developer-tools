import {
  createInputLayerPayload,
  downloadExportGeoJson,
  fetchViewshedLayerInfo,
  getPortalUsername,
  pollExportStatus,
  pollViewshedJob,
  submitGeoJsonExport,
  submitViewshedJob,
} from "./api.js";

const STATUS = {
  PENDING: "Pending",
  SUBMITTING: "Submitting job",
  PROCESSING: "Processing",
  FETCHING_LAYER_INFO: "Fetching layer info",
  EXPORTING: "Exporting GeoJSON",
  WAITING_EXPORT: "Waiting for export",
  DOWNLOADING: "Downloading",
  DONE: "Done",
  FAILED: "Failed",
};

function dateStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${y}_${m}_${d}_${hh}_${mm}`;
}

function formatElapsed(elapsedMs) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

async function runTechnology({ technology, sourceState, titlePrefix, token, update }) {
  const dateISO = dateStamp();
  const inputLayer = createInputLayerPayload(sourceState);

  try {
    update(technology, STATUS.SUBMITTING, "");
    const jobId = await submitViewshedJob({ token, technology, inputLayer, dateISO });

    update(technology, STATUS.PROCESSING, `jobId: ${jobId}`);
    await pollViewshedJob({
      token,
      jobId,
      onPoll: (pollCount, elapsedMs) => {
        update(
          technology,
          STATUS.PROCESSING,
          `jobId: ${jobId} (poll ${pollCount}, elapsed ${formatElapsed(elapsedMs)})`,
        );
      },
    });

    update(technology, STATUS.FETCHING_LAYER_INFO, "");
    const { itemId } = await fetchViewshedLayerInfo({ token, jobId });

    update(technology, STATUS.EXPORTING, "");
    const username = await getPortalUsername(token);
    const title = `${titlePrefix}_${technology}_${dateISO}`;
    const { exportItemId, exportJobId } = await submitGeoJsonExport({
      token,
      username,
      itemId,
      title,
    });

    update(technology, STATUS.WAITING_EXPORT, `exportJobId: ${exportJobId}`);
    await pollExportStatus({ token, username, exportItemId, exportJobId });

    update(technology, STATUS.DOWNLOADING, "");
    const blob = await downloadExportGeoJson({ token, exportItemId });

    update(technology, STATUS.DONE, "");
    return {
      ok: true,
      technology,
      title,
      fileName: `${title}.geojson`,
      blob,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    update(technology, STATUS.FAILED, message);
    return {
      ok: false,
      technology,
      error: message,
    };
  }
}

export async function runCoverageWorkflow({
  technologies,
  mode,
  sourceState,
  titlePrefix,
  token,
  onStatusUpdate,
}) {
  const update = (technology, status, detail) => {
    onStatusUpdate({ technology, status, detail });
  };

  technologies.forEach((technology) => {
    update(technology, STATUS.PENDING, "");
  });

  if (mode === "sequential") {
    const results = [];
    for (const technology of technologies) {
      // Sequential mode intentionally waits for each technology to finish before starting the next.
      // eslint-disable-next-line no-await-in-loop
      const result = await runTechnology({ technology, sourceState, titlePrefix, token, update });
      results.push(result);
    }
    return results;
  }

  return Promise.all(
    technologies.map((technology) =>
      runTechnology({ technology, sourceState, titlePrefix, token, update }),
    ),
  );
}

export { STATUS };
