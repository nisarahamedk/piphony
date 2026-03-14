import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { assertValidWorkItemTransition, canTransitionWorkItem, parseCanonicalState } from "../src/core/work-item-transitions.js";
import { createLocalTrackerAdapter } from "../src/tracker/local/adapter.js";
import { resetTrackerState } from "../src/tracker/local/harness.js";

describe("work item transition rules", () => {
  test("parses canonical states and rejects invalid values", () => {
    expect(parseCanonicalState("todo")).toBe("todo");
    expect(() => parseCanonicalState("wat")).toThrow("Invalid state: wat");
  });

  test("exposes a canonical transition policy", () => {
    expect(canTransitionWorkItem("backlog", "todo")).toBe(true);
    expect(canTransitionWorkItem("backlog", "done")).toBe(false);
    expect(() => assertValidWorkItemTransition("todo", "done")).toThrow("Invalid work item transition: todo -> done");
  });

  test("tracker adapter enforces transition rules instead of mutating state blindly", async () => {
    const trackerDir = await mkdtemp(join(tmpdir(), "piphony-transition-rules-"));
    await resetTrackerState({ trackerDir });
    const adapter = createLocalTrackerAdapter(trackerDir);
    const issue = await adapter.store.createIssue({ identifier: "LOCAL-T9", title: "Transition policy", state: "todo" });

    await expect(adapter.applyMutation(issue.identifier, { type: "transition", state: "done" })).rejects.toThrow(
      "Invalid work item transition: todo -> done",
    );
  });
});
