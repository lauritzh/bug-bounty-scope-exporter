import { exportScope } from "./lib/exporters.js";
import { getAdapter } from "./platforms/registry.js";

const elements = {
  platform: document.querySelector("#platform"),
  program: document.querySelector("#program"),
  preview: document.querySelector("#preview"),
  status: document.querySelector("#status"),
  copy: document.querySelector("#copy"),
  save: document.querySelector("#save"),
  formatButtons: Array.from(document.querySelectorAll("[data-format]")),
};

const state = {
  adapter: null,
  scope: null,
  format: "markdown",
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function setActionsEnabled(enabled) {
  elements.copy.disabled = !enabled;
  elements.save.disabled = !enabled;
}

function currentText() {
  if (!state.scope || !state.adapter) return "";
  return exportScope(state.scope, state.format, { platformLabel: state.adapter.label });
}

function updatePreview() {
  elements.preview.value = currentText();
}

function setFormat(format) {
  state.format = format;
  for (const button of elements.formatButtons) {
    const selected = button.dataset.format === format;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  updatePreview();
}

function safeFilename(scope, format) {
  const source = scope.program.handle || scope.program.name || "program";
  const basename = source
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100) || "program";
  return `${basename}-scope.${format === "json" ? "json" : "md"}`;
}

async function copyCurrentExport() {
  const value = currentText();
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
    setStatus("Copied to clipboard.");
  } catch {
    elements.preview.focus();
    elements.preview.select();
    const copied = document.execCommand("copy");
    setStatus(copied ? "Copied to clipboard." : "Could not copy the preview.", !copied);
  }
}

async function saveCurrentExport() {
  const value = currentText();
  if (!value || !state.scope) return;

  const mimeType = state.format === "json" ? "application/json" : "text/markdown";
  const objectUrl = URL.createObjectURL(new Blob([value], { type: `${mimeType};charset=utf-8` }));
  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename: safeFilename(state.scope, state.format),
      saveAs: true,
    });
    setStatus("Save started.");
  } catch {
    setStatus("Could not start the download.", true);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function initialize() {
  setActionsEnabled(false);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("Open a supported bug bounty program page and try again.");
  }

  const adapter = getAdapter(tab.url);
  if (!adapter) {
    throw new Error("Open a supported bug bounty program page and try again.");
  }

  state.adapter = adapter;
  elements.platform.textContent = adapter.label;
  setStatus("Extracting program scope…");

  const scope = await adapter.extract({ tabId: tab.id, url: tab.url });
  state.scope = scope;
  elements.program.textContent = scope.program.name || scope.program.handle;
  updatePreview();
  setActionsEnabled(true);

  const assetCount = scope.inScope.length + scope.outOfScope.length;
  setStatus(`Ready — ${assetCount} scope ${assetCount === 1 ? "asset" : "assets"}.`);
}

for (const button of elements.formatButtons) {
  button.addEventListener("click", () => setFormat(button.dataset.format));
}
elements.copy.addEventListener("click", copyCurrentExport);
elements.save.addEventListener("click", saveCurrentExport);

initialize().catch((error) => {
  elements.preview.value = "";
  elements.preview.placeholder = "Scope could not be loaded.";
  elements.program.textContent = "";
  setActionsEnabled(false);
  setStatus(error instanceof Error ? error.message : "Could not load the program scope.", true);
});
