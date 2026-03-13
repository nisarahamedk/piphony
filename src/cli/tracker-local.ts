#!/usr/bin/env node
import { resolve } from "node:path";
import { isCanonicalState } from "../core/utils.js";
import { createLocalTrackerAdapter } from "../tracker/local/adapter.js";
import { defaultTrackerDir, resetTrackerState } from "../tracker/local/harness.js";

function getFlag(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

function requireValue(value: string | undefined, message: string): string {
  if (value === undefined || value === "") {
    throw new Error(message);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const trackerDir = resolve(requireValue(getFlag(args, "--tracker-dir", defaultTrackerDir()), "tracker dir required"));
  const adapter = createLocalTrackerAdapter(trackerDir);
  await adapter.store.ensure();

  switch (command) {
    case "create": {
      const identifier = requireValue(getFlag(args, "--identifier"), "--identifier is required");
      const title = requireValue(getFlag(args, "--title"), "--title is required");
      const description = getFlag(args, "--description");
      const rawState = getFlag(args, "--state", "backlog") ?? "backlog";
      if (!isCanonicalState(rawState)) throw new Error(`Invalid state: ${rawState}`);
      const issue = await adapter.store.createIssue(
        description === undefined
          ? { identifier, title, state: rawState, labels: [] }
          : { identifier, title, description, state: rawState, labels: [] },
      );
      console.log(JSON.stringify(issue, null, 2));
      return;
    }
    case "move": {
      const issue = requireValue(args[1], "Issue identifier required");
      const state = requireValue(args[2], "Target state required");
      if (!isCanonicalState(state)) throw new Error(`Invalid state: ${state}`);
      console.log(JSON.stringify(await adapter.applyMutation(issue, { type: "transition", state }), null, 2));
      return;
    }
    case "comment": {
      const issue = requireValue(args[1], "Issue identifier required");
      const body = requireValue(args.slice(2).join(" "), "Comment body required");
      console.log(JSON.stringify(await adapter.appendComment(issue, { body, author: "cli" }), null, 2));
      return;
    }
    case "attach-artifact": {
      const issue = requireValue(args[1], "Issue identifier required");
      const path = resolve(requireValue(args[2], "Artifact path required"));
      const name = requireValue(getFlag(args, "--name", path.split("/").at(-1) ?? "artifact"), "Artifact name required");
      console.log(JSON.stringify(await adapter.attachArtifact(issue, { name, path }), null, 2));
      return;
    }
    case "inspect": {
      const issue = requireValue(args[1], "Issue identifier required");
      console.log(JSON.stringify(await adapter.inspectIssue(issue), null, 2));
      return;
    }
    case "dump": {
      console.log(JSON.stringify(await adapter.dumpState(), null, 2));
      return;
    }
    case "list-candidates": {
      console.log(JSON.stringify(await adapter.fetchCandidateWorkItems(), null, 2));
      return;
    }
    case "reset": {
      const seedPath = getFlag(args, "--seed");
      const state = seedPath === undefined
        ? await resetTrackerState({ trackerDir })
        : await resetTrackerState({ trackerDir, seedPath: resolve(seedPath) });
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    default:
      console.log(`Unknown command: ${command ?? "<none>"}`);
      console.log("Commands: create, move, comment, attach-artifact, inspect, dump, list-candidates, reset");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
