import { detectPageContext } from "./context.js";
import { reportExtensionError } from "./runtime-utils.js";

let lastSerializedContext = "";

function reportContext() {
  const context = detectPageContext(window.location.href);
  document.documentElement.dataset.piphonyExtensionId = chrome.runtime.id;
  document.documentElement.dataset.piphonyExtensionProvider = context.provider;
  document.documentElement.dataset.piphonyExtensionKind = context.kind;
  const serialized = JSON.stringify(context);
  if (serialized === lastSerializedContext) {
    return;
  }
  lastSerializedContext = serialized;
  void chrome.runtime.sendMessage({ type: "page_context", context }).catch((error) => {
    reportExtensionError("extension_page_context_report_failed", error, { provider: context.provider, kind: context.kind });
  });
}

function patchHistory(method: "pushState" | "replaceState") {
  const original = history[method];
  history[method] = function patched(this: History, ...args: Parameters<History[typeof method]>) {
    const result = original.apply(this, args);
    queueMicrotask(reportContext);
    return result;
  } as History[typeof method];
}

patchHistory("pushState");
patchHistory("replaceState");
window.addEventListener("popstate", reportContext);
window.addEventListener("hashchange", reportContext);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    reportContext();
  }
});

reportContext();
setInterval(reportContext, 2_000);
