import { detectPageContext, type ExtensionPageContext } from "./context.js";
import { reportExtensionError } from "./runtime-utils.js";

const contextByTabId = new Map<number, ExtensionPageContext>();
let lastSupportedTabId: number | null = null;

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "page_context") {
    const tabId = sender.tab?.id;
    const context = message.context as ExtensionPageContext | undefined;
    if (tabId !== undefined && context !== undefined) {
      contextByTabId.set(tabId, context);
      if (context.provider !== "unknown") {
        lastSupportedTabId = tabId;
        void chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
      }
      void broadcastContextUpdate(tabId, context);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "get_panel_context") {
    void (async () => {
      const context = await resolvePanelContext();
      sendResponse(context);
    })();
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  contextByTabId.delete(tabId);
  if (lastSupportedTabId === tabId) {
    lastSupportedTabId = null;
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const context = tab === undefined ? contextByTabId.get(tabId) : resolveContextFromTab(tab);
  if (context !== undefined && context !== null && context.provider !== "unknown") {
    contextByTabId.set(tabId, context);
    lastSupportedTabId = tabId;
    try {
      await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
    } catch (error) {
      reportExtensionError("extension_side_panel_set_options_failed", error, { tabId });
    }
  }
});

async function resolvePanelContext(): Promise<{ tabId?: number; context: ExtensionPageContext | null }> {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const activeTab = tabs.find((tab) => tab.active);
  if (activeTab?.id !== undefined) {
    const activeContext = resolveContextFromTab(activeTab) ?? contextByTabId.get(activeTab.id);
    if (activeContext !== null && activeContext !== undefined && activeContext.provider !== "unknown") {
      contextByTabId.set(activeTab.id, activeContext);
      lastSupportedTabId = activeTab.id;
      return { tabId: activeTab.id, context: activeContext };
    }
  }

  const supportedTabs = tabs
    .map((tab) => ({ tab, context: resolveContextFromTab(tab) }))
    .filter((entry): entry is { tab: chrome.tabs.Tab; context: ExtensionPageContext } => entry.context !== null && entry.context.provider !== "unknown");

  const preferredTab = supportedTabs.find((entry) => entry.context.kind === "issue") ?? supportedTabs.at(0);
  if (preferredTab?.tab.id !== undefined) {
    contextByTabId.set(preferredTab.tab.id, preferredTab.context);
    lastSupportedTabId = preferredTab.tab.id;
    return { tabId: preferredTab.tab.id, context: preferredTab.context };
  }

  if (lastSupportedTabId !== null) {
    const fallbackTab = await chrome.tabs.get(lastSupportedTabId).catch(() => undefined);
    const fallbackContext = fallbackTab === undefined ? contextByTabId.get(lastSupportedTabId) : resolveContextFromTab(fallbackTab);
    if (fallbackContext !== null && fallbackContext !== undefined && fallbackContext.provider !== "unknown") {
      contextByTabId.set(lastSupportedTabId, fallbackContext);
      return { tabId: lastSupportedTabId, context: fallbackContext };
    }
  }
  return { context: null };
}

function resolveContextFromTab(tab: chrome.tabs.Tab): ExtensionPageContext | null {
  if (typeof tab.url !== "string" || tab.url.trim() === "") {
    return null;
  }
  return detectPageContext(tab.url);
}

async function broadcastContextUpdate(tabId: number, context: ExtensionPageContext): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "panel_context_updated", tabId, context });
  } catch (error) {
    reportExtensionError("extension_panel_context_broadcast_failed", error, { tabId, provider: context.provider, kind: context.kind });
  }
}
