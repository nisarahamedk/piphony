export type ExtensionTrackerProvider = "linear" | "jira" | "asana" | "local" | "unknown";
export type ExtensionPageContext = ExtensionIssuePageContext | ExtensionBoardPageContext | ExtensionUnknownPageContext;

export interface ExtensionIssuePageContext {
  provider: ExtensionTrackerProvider;
  kind: "issue";
  identifier: string;
  url: string;
}

export interface ExtensionBoardPageContext {
  provider: ExtensionTrackerProvider;
  kind: "board";
  url: string;
  boardId?: string;
  projectKey?: string;
}

export interface ExtensionUnknownPageContext {
  provider: "unknown";
  kind: "unknown";
  url: string;
}

export function detectPageContext(url: string): ExtensionPageContext {
  const parsed = new URL(url);
  const provider = detectProvider(parsed);
  if (provider === "linear") {
    return detectLinearContext(parsed);
  }
  if (provider === "jira") {
    return detectJiraContext(parsed);
  }
  if (provider === "asana") {
    return detectAsanaContext(parsed);
  }
  if (provider === "local") {
    return detectLocalContext(parsed);
  }
  return { provider: "unknown", kind: "unknown", url: parsed.toString() };
}

function detectProvider(url: URL): ExtensionTrackerProvider {
  const host = url.hostname.toLowerCase();
  if (host.includes("linear.app")) {
    return "linear";
  }
  if (host.includes("atlassian.net") || host.includes("jira")) {
    return "jira";
  }
  if (host.includes("asana.com")) {
    return "asana";
  }
  if (host.includes("localhost") || host.includes("127.0.0.1") || host.includes("piphony")) {
    return "local";
  }
  return "unknown";
}

function detectLinearContext(url: URL): ExtensionPageContext {
  const match = url.pathname.match(/\/issue\/([A-Z]+-\d+)/i);
  if (match?.[1]) {
    return { provider: "linear", kind: "issue", identifier: match[1].toUpperCase(), url: url.toString() };
  }
  const boardMatch = url.pathname.match(/\/team\/([^/]+)/i);
  return {
    provider: "linear",
    kind: "board",
    url: url.toString(),
    ...(boardMatch?.[1] === undefined ? {} : { projectKey: boardMatch[1].toUpperCase() }),
  };
}

function detectJiraContext(url: URL): ExtensionPageContext {
  const issueMatch = url.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
  if (issueMatch?.[1]) {
    return { provider: "jira", kind: "issue", identifier: issueMatch[1].toUpperCase(), url: url.toString() };
  }
  const boardMatch = url.pathname.match(/\/boards\/(\d+)/i);
  const projectMatch = url.pathname.match(/\/projects\/([^/]+)/i);
  return {
    provider: "jira",
    kind: "board",
    url: url.toString(),
    ...(boardMatch?.[1] === undefined ? {} : { boardId: boardMatch[1] }),
    ...(projectMatch?.[1] === undefined ? {} : { projectKey: projectMatch[1].toUpperCase() }),
  };
}

function detectAsanaContext(url: URL): ExtensionPageContext {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 3 && segments[0] === "0") {
    const identifier = segments[2];
    if (identifier !== undefined) {
      return {
        provider: "asana",
        kind: "issue",
        identifier,
        url: url.toString(),
      };
    }
  }
  return { provider: "asana", kind: "board", url: url.toString() };
}

function detectLocalContext(url: URL): ExtensionPageContext {
  const queryIssue = url.searchParams.get("issue");
  if (queryIssue) {
    return { provider: "local", kind: "issue", identifier: queryIssue, url: url.toString() };
  }
  const issueMatch = url.pathname.match(/\/issues\/([^/]+)/i);
  if (issueMatch?.[1]) {
    return { provider: "local", kind: "issue", identifier: issueMatch[1], url: url.toString() };
  }
  return { provider: "local", kind: "board", url: url.toString() };
}
