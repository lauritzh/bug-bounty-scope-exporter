import { exportScope } from "./lib/exporters.js";
import { attachCapture, buildCapture } from "./lib/provenance.js";
import { getAdapter } from "./platforms/registry.js";

const elements = {
  platform: document.querySelector("#platform"),
  program: document.querySelector("#program"),
  freshness: document.querySelector("#freshness"),
  preview: document.querySelector("#preview"),
  snapshot: document.querySelector("#snapshot"),
  status: document.querySelector("#status"),
  copy: document.querySelector("#copy"),
  save: document.querySelector("#save"),
  formatButtons: Array.from(document.querySelectorAll("[data-format]")),
};

const state = {
  adapter: null,
  scope: null,
  format: "markdown",
  snapshot: true,
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function shortDate(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function setFreshness(capture) {
  const parts = [];
  if (capture?.fingerprint?.coverage?.complete === false) parts.push("partial snapshot");
  const platformChange = shortDate(capture?.platformUpdatedAt?.latest);
  if (platformChange) parts.push(`platform last changed ${platformChange}`);
  if (capture?.fingerprint?.overall) {
    parts.push(`fingerprint ${capture.fingerprint.overall.slice(0, 12)}`);
  }
  elements.freshness.textContent = parts.join(" · ");
  elements.freshness.title = capture?.fingerprint?.overall
    ? `Content fingerprint (${capture.fingerprint.algorithm}): ${capture.fingerprint.overall}`
    : "";
}

function setActionsEnabled(enabled) {
  elements.copy.disabled = !enabled;
  elements.save.disabled = !enabled;
}

function currentText() {
  if (!state.scope || !state.adapter) return "";
  return exportScope(state.scope, state.format, {
    platformLabel: state.adapter.label,
    snapshot: state.snapshot,
  });
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
  // JSON carries the capture block as data, so there is no section to drop.
  elements.snapshot.disabled = format === "json";
  elements.snapshot.title = format === "json"
    ? "JSON exports always include the capture block."
    : "Include the Snapshot section with retrieval details and content fingerprints.";
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

  const extracted = await adapter.extract({ tabId: tab.id, url: tab.url });
  const capture = await buildCapture(extracted, { sourceUrl: tab.url });
  const scope = attachCapture(extracted, capture);
  state.scope = scope;
  elements.program.textContent = scope.program.name || scope.program.handle;
  setFreshness(capture);
  updatePreview();
  setActionsEnabled(true);

  const assetCount = scope.inScope.length + scope.outOfScope.length;
  setStatus(`Ready — ${assetCount} scope ${assetCount === 1 ? "asset" : "assets"}.`);
}

for (const button of elements.formatButtons) {
  button.addEventListener("click", () => setFormat(button.dataset.format));
}
elements.snapshot.addEventListener("change", () => {
  state.snapshot = elements.snapshot.checked;
  updatePreview();
});
elements.copy.addEventListener("click", copyCurrentExport);
elements.save.addEventListener("click", saveCurrentExport);

setFormat(state.format);

initialize().catch((error) => {
  elements.preview.value = "";
  elements.preview.placeholder = "Scope could not be loaded.";
  elements.program.textContent = "";
  elements.freshness.textContent = "";
  setActionsEnabled(false);
  setStatus(error instanceof Error ? error.message : "Could not load the program scope.", true);
});
