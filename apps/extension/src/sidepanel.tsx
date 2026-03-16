import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { createRoot } from "react-dom/client";
import { errorMessage } from "@piphony/core/errors";
import { ChiefOfStaffPanel } from "./shell.js";
import type { ExtensionPageContext } from "./context.js";
import type { TrackerPageContext } from "../../../src/cos/types.js";
import "./styles.css";

const DEFAULT_COS_ENDPOINT = "http://127.0.0.1:6521/api/rivet";
const COS_ENDPOINT_STORAGE_KEY = "piphony.cosEndpoint";
const COS_USER_KEY_STORAGE_KEY = "piphony.cosUserKey";

interface StoredConnectionConfig {
  endpoint: string;
  userKeyValue: string;
}

function SidePanelApp() {
  const [pageContext, setPageContext] = useState<ExtensionPageContext | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [endpointDraft, setEndpointDraft] = useState("");
  const [userKeyValue, setUserKeyValue] = useState<string | null>(null);
  const [isSavingEndpoint, setIsSavingEndpoint] = useState(false);
  const serializedContextRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const config = await loadStoredConnectionConfig();
      if (disposed) {
        return;
      }
      setEndpoint(config.endpoint);
      setEndpointDraft(config.endpoint);
      setUserKeyValue(config.userKeyValue);
      let initial: { context?: ExtensionPageContext | null } | undefined;
      try {
        initial = await chrome.runtime.sendMessage({ type: "get_panel_context" });
      } catch (error) {
        console.error("extension_get_panel_context_failed", { message: errorMessage(error) });
        initial = { context: null };
      }
      setPageContextIfChanged(initial?.context ?? null, setPageContext, serializedContextRef);
    })();

    const listener = (message: unknown) => {
      const payload = message as { type?: string; context?: ExtensionPageContext | null };
      if (payload.type === "panel_context_updated") {
        setPageContextIfChanged(payload.context ?? null, setPageContext, serializedContextRef);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    const interval = window.setInterval(() => {
      void chrome.runtime.sendMessage({ type: "get_panel_context" })
        .then((payload: { context?: ExtensionPageContext | null }) => {
          setPageContextIfChanged(payload?.context ?? null, setPageContext, serializedContextRef);
        })
        .catch((error) => {
          console.error("extension_poll_panel_context_failed", { message: errorMessage(error) });
        });
    }, 2000);
    return () => {
      disposed = true;
      chrome.runtime.onMessage.removeListener(listener);
      window.clearInterval(interval);
    };
  }, []);

  const userKey = useMemo<string[] | null>(() => {
    return userKeyValue === null ? null : ["user", userKeyValue];
  }, [userKeyValue]);

  const trackerContext = useMemo<TrackerPageContext | null>(() => {
    if (pageContext === null || pageContext.provider === "unknown") {
      return null;
    }
    if (pageContext.kind === "issue") {
      return {
        kind: "issue",
        provider: pageContext.provider,
        identifier: pageContext.identifier,
        url: pageContext.url,
      };
    }
    return {
      kind: "board",
      provider: pageContext.provider,
      url: pageContext.url,
      ...(pageContext.boardId === undefined ? {} : { boardId: pageContext.boardId }),
      ...(pageContext.projectKey === undefined ? {} : { projectKey: pageContext.projectKey }),
    };
  }, [pageContext]);

  const saveEndpoint = async () => {
    if (userKeyValue === null) {
      return;
    }
    setIsSavingEndpoint(true);
    try {
      const normalizedEndpoint = normalizeEndpointInput(endpointDraft);
      await persistConnectionConfig({ endpoint: normalizedEndpoint, userKeyValue });
      setEndpoint(normalizedEndpoint);
      setEndpointDraft(normalizedEndpoint);
    } catch (error) {
      console.error("extension_save_endpoint_failed", { message: errorMessage(error), endpointDraft });
    } finally {
      setIsSavingEndpoint(false);
    }
  };

  if (endpoint === null || userKey === null) {
    return (
      <div className="extension-panel" data-testid="extension-panel">
        <div className="extension-empty-state">Connecting extension runtime…</div>
      </div>
    );
  }

  return (
    <ChiefOfStaffPanel
      endpoint={endpoint}
      endpointDraft={endpointDraft}
      isSavingEndpoint={isSavingEndpoint}
      onEndpointDraftChange={setEndpointDraft}
      onEndpointSave={() => {
        void saveEndpoint();
      }}
      userKey={userKey}
      pageContext={trackerContext}
    />
  );
}

async function loadStoredConnectionConfig(): Promise<StoredConnectionConfig> {
  try {
    const stored = await chrome.storage.local.get([COS_ENDPOINT_STORAGE_KEY, COS_USER_KEY_STORAGE_KEY]);
    const endpoint = typeof stored[COS_ENDPOINT_STORAGE_KEY] === "string" && stored[COS_ENDPOINT_STORAGE_KEY].trim() !== ""
      ? stored[COS_ENDPOINT_STORAGE_KEY].trim()
      : DEFAULT_COS_ENDPOINT;
    const userKeyValue = typeof stored[COS_USER_KEY_STORAGE_KEY] === "string" && stored[COS_USER_KEY_STORAGE_KEY].trim() !== ""
      ? stored[COS_USER_KEY_STORAGE_KEY].trim()
      : `local-${crypto.randomUUID()}`;
    await persistConnectionConfig({ endpoint, userKeyValue });
    return { endpoint, userKeyValue };
  } catch (error) {
    console.error("extension_load_connection_config_failed", { message: errorMessage(error) });
    return {
      endpoint: DEFAULT_COS_ENDPOINT,
      userKeyValue: `local-${crypto.randomUUID()}`,
    };
  }
}

async function persistConnectionConfig(config: StoredConnectionConfig): Promise<void> {
  await chrome.storage.local.set({
    [COS_ENDPOINT_STORAGE_KEY]: config.endpoint,
    [COS_USER_KEY_STORAGE_KEY]: config.userKeyValue,
  });
}

function normalizeEndpointInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("Piphony endpoint is required");
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Piphony endpoint must use http or https");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function setPageContextIfChanged(
  next: ExtensionPageContext | null,
  setPageContext: (value: ExtensionPageContext | null) => void,
  serializedContextRef: MutableRefObject<string | null>,
): void {
  const serialized = JSON.stringify(next);
  if (serializedContextRef.current === serialized) {
    return;
  }
  serializedContextRef.current = serialized;
  setPageContext(next);
}

const rootElement = document.getElementById("app");
if (rootElement === null) {
  throw new Error("Extension side panel root not found");
}

createRoot(rootElement).render(<SidePanelApp />);
