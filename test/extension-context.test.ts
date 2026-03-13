import { describe, expect, test } from "vitest";
import { detectPageContext } from "../apps/extension/src/context.js";

describe("extension page context detection", () => {
  test("detects Linear issue and board contexts", () => {
    expect(detectPageContext("https://linear.app/acme/issue/LIN-123/fix-login")).toEqual({
      provider: "linear",
      kind: "issue",
      identifier: "LIN-123",
      url: "https://linear.app/acme/issue/LIN-123/fix-login",
    });

    expect(detectPageContext("https://linear.app/acme/team/ENG/all")).toEqual({
      provider: "linear",
      kind: "board",
      projectKey: "ENG",
      url: "https://linear.app/acme/team/ENG/all",
    });
  });

  test("detects Jira issue and board contexts", () => {
    expect(detectPageContext("https://acme.atlassian.net/browse/PROJ-456")).toEqual({
      provider: "jira",
      kind: "issue",
      identifier: "PROJ-456",
      url: "https://acme.atlassian.net/browse/PROJ-456",
    });

    expect(detectPageContext("https://acme.atlassian.net/jira/software/projects/PROJ/boards/17")).toEqual({
      provider: "jira",
      kind: "board",
      boardId: "17",
      projectKey: "PROJ",
      url: "https://acme.atlassian.net/jira/software/projects/PROJ/boards/17",
    });
  });

  test("detects Asana and local contexts", () => {
    expect(detectPageContext("https://app.asana.com/0/1200001/1200002")).toEqual({
      provider: "asana",
      kind: "issue",
      identifier: "1200002",
      url: "https://app.asana.com/0/1200001/1200002",
    });

    expect(detectPageContext("http://localhost:3333/issues/LOCAL-900")).toEqual({
      provider: "local",
      kind: "issue",
      identifier: "LOCAL-900",
      url: "http://localhost:3333/issues/LOCAL-900",
    });

    expect(detectPageContext("http://localhost:3333/dashboard")).toEqual({
      provider: "local",
      kind: "board",
      url: "http://localhost:3333/dashboard",
    });
  });
});
