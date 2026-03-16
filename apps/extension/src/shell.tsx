import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@piphony/core/errors";
import type { TrackerPageContext } from "../../../src/cos/types.js";
import {
  attachChiefOfStaffListeners,
  type ConnectionState,
  disposeChiefOfStaffConnection,
  ensureChiefOfStaffConnection,
  type ExtensionMessage,
  syncChiefOfStaffHandle,
} from "./chief-of-staff-connection";

export interface ChiefOfStaffPanelProps {
  endpoint: string;
  endpointDraft: string;
  isSavingEndpoint: boolean;
  onEndpointDraftChange: (value: string) => void;
  onEndpointSave: () => void;
  userKey: string[];
  pageContext: TrackerPageContext | null;
}

export function ChiefOfStaffPanel(props: ChiefOfStaffPanelProps) {
  const connectionRef = useRef<ConnectionState | null>(null);
  const [messages, setMessages] = useState<ExtensionMessage[]>([]);
  const [status, setStatus] = useState<string>("connecting");
  const [input, setInput] = useState("");
  const [isReady, setIsReady] = useState(false);

  const refreshPrompt = useMemo(() => {
    if (props.pageContext === null) {
      return "Summarize the current supported tracker context.";
    }
    return props.pageContext.kind === "issue"
      ? "What is happening on this ticket right now? Be concrete."
      : "What needs my attention right now across this board?";
  }, [props.pageContext]);

  const planPrompt = useMemo(() => {
    if (props.pageContext === null) {
      return "Create one concrete follow-up ticket from the current tracker context if possible.";
    }
    return props.pageContext.kind === "issue"
      ? `Break issue ${props.pageContext.identifier} into follow-up tickets and create exactly one backlog follow-up ticket titled 'CoS planned follow-up for ${props.pageContext.identifier}'.`
      : "Use the board overview to create exactly one backlog follow-up ticket titled 'CoS planned board follow-up'.";
  }, [props.pageContext]);

  useEffect(() => {
    let disposed = false;
    let intervalId: number | undefined;
    setMessages([]);
    setStatus("connecting");
    setIsReady(false);

    const connectAndSync = async () => {
      try {
        const connection = await ensureChiefOfStaffConnection(props.endpoint, props.userKey, connectionRef);
        if (disposed) {
          return;
        }
        attachChiefOfStaffListeners(connection, setMessages, setStatus);
        if (!disposed) {
          setIsReady(true);
        }
        await syncChiefOfStaffHandle(connection, setMessages, setStatus);
      } catch (error) {
        if (!disposed) {
          setStatus(`error: ${errorMessage(error)}`);
        }
      }
    };

    void connectAndSync();
    intervalId = window.setInterval(() => {
      void connectAndSync();
    }, 1500);

    return () => {
      disposed = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [props.endpoint, props.userKey]);

  useEffect(() => {
    void (async () => {
      if (props.pageContext === null) {
        return;
      }
      try {
        const connection = await ensureChiefOfStaffConnection(props.endpoint, props.userKey, connectionRef);
        await connection.handle.setPageContext(props.pageContext);
      } catch (error) {
        setStatus(`error: ${errorMessage(error)}`);
      }
    })();
  }, [props.endpoint, props.pageContext, props.userKey]);

  useEffect(() => {
    return () => {
      void disposeChiefOfStaffConnection(connectionRef.current);
      connectionRef.current = null;
    };
  }, []);

  const sendPrompt = async (text: string) => {
    try {
      const connection = await ensureChiefOfStaffConnection(props.endpoint, props.userKey, connectionRef);
      attachChiefOfStaffListeners(connection, setMessages, setStatus);
      if (props.pageContext !== null) {
        await connection.handle.setPageContext(props.pageContext);
      }
      await connection.handle.send("prompt", { text });
    } catch (error) {
      setStatus(`error: ${errorMessage(error)}`);
    }
  };

  return (
    <div className="extension-panel" data-testid="extension-panel">
      <div className="extension-panel-header">
        <strong>Chief of Staff</strong>
        <span data-testid="extension-status">{status}</span>
      </div>
      <div className="extension-panel-meta" data-testid="extension-context-kind">
        {props.pageContext === null
          ? "Unsupported page"
          : props.pageContext.kind === "issue"
            ? `Issue: ${props.pageContext.provider}/${props.pageContext.identifier}`
            : `Board: ${props.pageContext.provider}`}
      </div>
      <div className="extension-connection-settings">
        <label className="extension-settings-label" htmlFor="extension-endpoint-input">Piphony endpoint</label>
        <div className="extension-connection-row">
          <input
            id="extension-endpoint-input"
            type="url"
            value={props.endpointDraft}
            onChange={(event) => props.onEndpointDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                props.onEndpointSave();
              }
            }}
            placeholder="http://127.0.0.1:6521/api/rivet"
            data-testid="extension-endpoint-input"
          />
          <button
            type="button"
            className="ghost-button"
            onClick={props.onEndpointSave}
            disabled={props.isSavingEndpoint || props.endpointDraft.trim() === ""}
            data-testid="extension-endpoint-save"
          >
            {props.isSavingEndpoint ? "Connecting…" : "Connect"}
          </button>
        </div>
        <div className="extension-panel-meta" data-testid="extension-endpoint-current">Connected endpoint: {props.endpoint}</div>
      </div>
      <div className="extension-panel-actions">
        <button type="button" className="ghost-button" onClick={() => void sendPrompt(refreshPrompt)} data-testid="extension-refresh" disabled={!isReady}>
          Refresh
        </button>
        <button type="button" className="ghost-button" onClick={() => void sendPrompt(planPrompt)} data-testid="extension-plan" disabled={!isReady}>
          Plan
        </button>
      </div>
      {props.pageContext === null ? (
        <div className="extension-empty-state" data-testid="extension-empty-state">
          Open a supported tracker issue or board page to use Chief of Staff.
        </div>
      ) : null}
      <div className="extension-panel-messages" data-testid="extension-messages">
        {messages.map((message) => (
          <div key={message.id} className={`extension-message extension-message-${message.role}`} data-testid={`extension-message-${message.role}`}>
            <strong>{message.sender}</strong>
            <span>{message.content}</span>
          </div>
        ))}
      </div>
      <div className="extension-panel-compose">
        <textarea
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder="Ask Chief of Staff..."
          data-testid="extension-input"
          disabled={!isReady}
        />
        <button
          type="button"
          className="ghost-button"
          data-testid="extension-send"
          disabled={!isReady}
          onClick={() => {
            const next = input.trim();
            if (next === "") {
              return;
            }
            void sendPrompt(next);
            setInput("");
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
