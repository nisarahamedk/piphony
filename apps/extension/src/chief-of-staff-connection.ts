import type { Dispatch, RefObject, SetStateAction } from "react";
import { createClient } from "rivetkit/client";
import { attemptCleanup } from "@piphony/core/cleanup";
import { errorMessage } from "@piphony/core/errors";
import type { ChiefOfStaffStatus } from "../../../src/cos/actor.js";

export interface ExtensionMessage {
  id: string;
  role: string;
  sender: string;
  content: string;
}

export interface ConnectionState {
  endpoint: string;
  userKeyValue: string;
  handle: any;
  conn: any;
  listenersAttached: boolean;
}

export async function ensureChiefOfStaffConnection(
  endpoint: string,
  userKey: string[],
  ref: RefObject<ConnectionState | null>,
): Promise<ConnectionState> {
  const userKeyValue = userKey.join("/");
  const existing = ref.current;
  if (existing !== null && existing.endpoint === endpoint && existing.userKeyValue === userKeyValue) {
    return existing;
  }
  if (existing !== null) {
    await disposeChiefOfStaffConnection(existing);
    ref.current = null;
  }
  const client = createClient<any>({ endpoint }) as any;
  const handle = client.chiefOfStaff.getOrCreate(userKey);
  const conn = handle.connect();
  const next: ConnectionState = {
    endpoint,
    userKeyValue,
    handle,
    conn,
    listenersAttached: false,
  };
  ref.current = next;
  return next;
}

export async function syncChiefOfStaffHandle(
  connection: ConnectionState,
  setMessages: Dispatch<SetStateAction<ExtensionMessage[]>>,
  setStatus: Dispatch<SetStateAction<string>>,
): Promise<void> {
  const [history, currentStatus] = await Promise.all([
    connection.handle.getHistory(),
    connection.handle.getStatus(),
  ]);
  if (Array.isArray(history)) {
    setMessages((current) => mergeMessageLists(current, normalizeMessages(history)));
  }
  setStatus(formatChiefOfStaffStatus(currentStatus));
}

export function attachChiefOfStaffListeners(
  connection: ConnectionState,
  setMessages: Dispatch<SetStateAction<ExtensionMessage[]>>,
  setStatus: Dispatch<SetStateAction<string>>,
): void {
  if (connection.listenersAttached) {
    return;
  }
  connection.listenersAttached = true;
  connection.conn.on("messageAdded", (message: ExtensionMessage) => {
    setMessages((current) => upsertMessage(current, message));
  });
  connection.conn.on("response", (event: { messageId: string; content: string }) => {
    setMessages((current) => updateMessageContent(current, event.messageId, event.content));
  });
  connection.conn.on("status", (next: ChiefOfStaffStatus) => {
    setStatus(formatChiefOfStaffStatus(next));
  });
}

export function formatChiefOfStaffStatus(status: ChiefOfStaffStatus | null | undefined): string {
  if (status === null || status === undefined || typeof status.state !== "string") {
    return "connecting";
  }
  if (status.state === "retrying") {
    if (typeof status.message === "string" && status.message.trim() !== "") {
      return status.message;
    }
    if (typeof status.retryAt === "number") {
      return `retrying until ${new Date(status.retryAt).toLocaleTimeString()}`;
    }
  }
  if (status.state === "error" && typeof status.message === "string" && status.message.trim() !== "") {
    return status.message;
  }
  if (status.state === "error" && typeof status.error === "string" && status.error.trim() !== "") {
    return `error: ${status.error}`;
  }
  return status.state;
}

export async function disposeChiefOfStaffConnection(connection: ConnectionState | null): Promise<void> {
  if (connection === null) {
    return;
  }
  await attemptCleanup(
    "chief_of_staff_connection.dispose",
    async () => {
      await connection.conn?.dispose?.();
    },
    (failure) => {
      console.error("chief_of_staff_connection_cleanup_failed", { ...failure, endpoint: connection.endpoint, message: errorMessage(failure.message) });
    },
    connection.endpoint,
  );
}

export function normalizeMessages(messages: ExtensionMessage[]): ExtensionMessage[] {
  return messages.reduce<ExtensionMessage[]>((current, message) => upsertMessage(current, message), []);
}

export function mergeMessageLists(current: ExtensionMessage[], incoming: ExtensionMessage[]): ExtensionMessage[] {
  return incoming.reduce<ExtensionMessage[]>((next, message) => upsertMessage(next, message), current);
}

export function upsertMessage(current: ExtensionMessage[], incoming: ExtensionMessage): ExtensionMessage[] {
  const index = current.findIndex((message) => message.id === incoming.id);
  if (index === -1) {
    return [...current, incoming];
  }
  const next = [...current];
  const existing = next[index]!;
  next[index] = {
    id: incoming.id,
    role: incoming.role,
    sender: incoming.sender,
    content: incoming.content === "" ? existing.content : incoming.content,
  };
  return next;
}

export function updateMessageContent(current: ExtensionMessage[], messageId: string, content: string): ExtensionMessage[] {
  const index = current.findIndex((message) => message.id === messageId);
  if (index === -1) {
    return current;
  }
  const next = [...current];
  const existing = next[index]!;
  next[index] = { ...existing, content };
  return next;
}
