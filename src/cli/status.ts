#!/usr/bin/env node
import { inspectLatestRun, inspectRun } from "../index.js";
import { runsRootDir } from "../smoke/_common.js";

const args = process.argv.slice(2);
const runIdFlagIndex = args.indexOf("--run-id");
const runId = runIdFlagIndex === -1 ? undefined : args[runIdFlagIndex + 1];
const latest = args.includes("--latest") || runId === undefined;
const inspection = latest ? await inspectLatestRun(runsRootDir) : await inspectRun(runsRootDir, runId!);

if (inspection === undefined) {
  console.log("No runs found.");
  process.exit(0);
}

console.log(JSON.stringify({
  runId: inspection.runId,
  status: inspection.status.status,
  workItemId: inspection.status.workItemId,
  eventCount: inspection.events.length,
  transcriptBytes: inspection.transcript?.length ?? 0,
  summary: inspection.summary,
}, null, 2));
