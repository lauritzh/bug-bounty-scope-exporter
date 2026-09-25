import { getAdapter } from "./platforms/registry.js";

const defaultTitle = "Bug Bounty Scope Exporter";

async function updateIndicator(tabId, url) {
  const supported = typeof url === "string" && Boolean(getAdapter(url));

  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: "#7f1d1d", tabId }),
    chrome.action.setBadgeText({ text: supported ? "!" : "", tabId }),
    chrome.action.setTitle({
      title: supported ? `${defaultTitle} — supported program page` : defaultTitle,
      tabId,
    }),
  ]);
}

function scheduleIndicatorUpdate(tabId, url) {
  void updateIndicator(tabId, url).catch(() => {
    // The tab may have closed before Chrome applied the per-tab badge update.
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    scheduleIndicatorUpdate(tabId, "");
  }
  if (changeInfo.url || changeInfo.status === "complete") {
    scheduleIndicatorUpdate(tabId, changeInfo.url || tab.url || "");
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId)
    .then((tab) => updateIndicator(tabId, tab.url || ""))
    .catch(() => {
      // The tab may have closed while the activation event was being handled.
    });
});

void chrome.tabs.query({}).then((tabs) => {
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      scheduleIndicatorUpdate(tab.id, tab.url || "");
    }
  }
});
