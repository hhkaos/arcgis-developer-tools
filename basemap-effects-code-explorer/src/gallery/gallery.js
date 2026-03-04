async function fetchThumbnailUrl(webmapId) {
  const res = await fetch(`https://www.arcgis.com/sharing/rest/content/items/${webmapId}?f=json`);
  const data = await res.json();
  return `https://www.arcgis.com/sharing/rest/content/items/${webmapId}/info/${data.thumbnail}?w=400`;
}

export function renderGallery(container, examples, onSelect) {
  const group = document.createElement("calcite-card-group");
  group.setAttribute("label", "Basemap examples");

  for (const ex of examples) {
    const card = document.createElement("calcite-card");
    card.setAttribute("label", ex.title);
    card.dataset.webmapId = ex.webmapId;

    const img = document.createElement("img");
    img.setAttribute("slot", "thumbnail");
    img.alt = ex.title;
    fetchThumbnailUrl(ex.webmapId).then((url) => { img.src = url; });

    const heading = document.createElement("span");
    heading.setAttribute("slot", "heading");
    heading.textContent = ex.title;

    card.append(img, heading);
    card.addEventListener("click", () => onSelect(ex.webmapId));
    group.append(card);
  }

  container.append(group);
}

export function setActiveCard(webmapId) {
  document.querySelectorAll("calcite-card[data-webmap-id]").forEach((c) => {
    c.selected = c.dataset.webmapId === webmapId;
  });
}
