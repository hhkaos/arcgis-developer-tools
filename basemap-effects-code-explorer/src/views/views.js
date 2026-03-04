export async function initViews(mapEl, sceneEl, webmap) {
  mapEl.map = webmap;
  sceneEl.map = webmap;
  await Promise.all([mapEl.viewOnReady(), sceneEl.viewOnReady()]);
}

export function switchTo3D(mapEl, sceneEl) {
  const vp = mapEl.viewpoint.clone();
  const factor = Math.cos((vp.targetGeometry.latitude * Math.PI) / 180);
  vp.scale *= factor;
  sceneEl.viewpoint = vp;
  sceneEl.classList.add("view--active");
  mapEl.classList.remove("view--active");
}

export function switchTo2D(mapEl, sceneEl) {
  const vp = sceneEl.viewpoint.clone();
  const factor = Math.cos((vp.targetGeometry.latitude * Math.PI) / 180);
  vp.scale /= factor;
  mapEl.viewpoint = vp;
  mapEl.classList.add("view--active");
  sceneEl.classList.remove("view--active");
}
