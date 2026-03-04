const state = { activeWebmapId: null, activeTab: "2d" };

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
}
