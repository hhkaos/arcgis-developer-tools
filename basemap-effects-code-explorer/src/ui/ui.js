import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import "highlight.js/styles/github-dark.css";
import { generateSnippet } from "../codegen/codegen.js";

hljs.registerLanguage("javascript", javascript);

const codeModalEl = document.getElementById("code-modal");
const codeOutputEl = document.getElementById("code-output");
const copyBtnEl = document.getElementById("copy-btn");
const codeModalCloseEl = document.getElementById("code-modal-close");

function setCodeContent(snippet) {
  codeOutputEl.textContent = snippet;
  codeOutputEl.removeAttribute("data-highlighted");
  hljs.highlightElement(codeOutputEl);
}

export function renderCodeModal(webmap, mode) {
  if (!webmap?.basemap?.baseLayers) {
    setCodeContent("// No webmap loaded yet.");
    return;
  }
  const baseLayers = webmap.basemap.baseLayers.toArray();
  const referenceLayers = webmap.basemap.referenceLayers?.toArray() ?? [];
  if (baseLayers.length === 0 && referenceLayers.length === 0) {
    setCodeContent("// No basemap layers found.");
    return;
  }
  setCodeContent(generateSnippet(baseLayers, referenceLayers, mode));
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
}
