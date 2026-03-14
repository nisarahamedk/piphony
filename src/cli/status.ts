#!/usr/bin/env node
import { inspectLatestRun, inspectRun } from "../index.js";
import { parseStatusCliConfig } from "./status-config.js";

const config = parseStatusCliConfig(process.argv.slice(2));
const inspection = config.latest
  ? await inspectLatestRun(config.runsRootDir)
  : await inspectRun(config.runsRootDir, config.runId!);

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
