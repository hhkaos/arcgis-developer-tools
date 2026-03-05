import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import "highlight.js/styles/github-dark.css";
import { generateSnippet, generateWebMapIdSnippet } from "../codegen/codegen.js";

hljs.registerLanguage("javascript", javascript);

const codeModalEl = document.getElementById("code-modal");
const codeOutputEl = document.getElementById("code-output");
const copyBtnEl = document.getElementById("copy-btn");
const codeModalCloseEl = document.getElementById("code-modal-close");
const codeTabBarEl = document.getElementById("code-tab-bar");
const codeTabEls = codeTabBarEl.querySelectorAll(".code-tab");

let activeCodeTab = "by-id";
let cachedSnippets = null; // { byId: string, manual: string } | null

function setCodeContent(snippet) {
  codeOutputEl.textContent = snippet;
  codeOutputEl.removeAttribute("data-highlighted");
  hljs.highlightElement(codeOutputEl);
}

function showTab(tab) {
  activeCodeTab = tab;
  codeTabEls.forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  setCodeContent(tab === "by-id" ? cachedSnippets.byId : cachedSnippets.manual);
}

export function renderCodeModal(webmap, mode) {
  if (!webmap?.basemap?.baseLayers) {
    setCodeContent("// No webmap loaded yet.");
    codeTabBarEl.hidden = true;
    return;
  }

  const baseLayers = webmap.basemap.baseLayers.toArray();
  const referenceLayers = webmap.basemap.referenceLayers?.toArray() ?? [];
  const operationalLayers = webmap.layers?.toArray() ?? [];

  if (baseLayers.length === 0 && referenceLayers.length === 0) {
    setCodeContent("// No basemap layers found.");
    codeTabBarEl.hidden = true;
    return;
  }

  const manualSnippet = generateSnippet(baseLayers, referenceLayers, operationalLayers, mode);
  const itemId = mode === "2d" ? webmap.portalItem?.id : null;

  if (itemId) {
    cachedSnippets = { byId: generateWebMapIdSnippet(itemId), manual: manualSnippet };
    codeTabBarEl.hidden = false;
    showTab(activeCodeTab);
  } else {
    cachedSnippets = null;
    codeTabBarEl.hidden = true;
    setCodeContent(manualSnippet);
  }
}

export function openCodeModal(webmap, mode) {
  renderCodeModal(webmap, mode);
  codeModalEl.open = true;
}

export function wireCodeModalControls() {
  copyBtnEl.addEventListener("click", () => {
    navigator.clipboard.writeText(codeOutputEl.textContent);
  });

  codeModalCloseEl.addEventListener("click", () => {
    codeModalEl.open = false;
  });

  codeTabEls.forEach((el) => {
    el.addEventListener("click", () => showTab(el.dataset.tab));
  });
}
