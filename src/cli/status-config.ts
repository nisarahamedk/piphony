import { resolveRepoPaths, type RepoPaths } from "../config/repo-paths.js";

export interface StatusCliConfig extends RepoPaths {
  runId?: string;
  latest: boolean;
}

export function parseStatusCliConfig(args: string[], repoRoot = process.cwd()): StatusCliConfig {
  const runId = readFlagValue(args, "--run-id");
  const runsRootDirOverride = readFlagValue(args, "--runs-root-dir");
  const paths = resolveRepoPaths(repoRoot);
  return {
    ...paths,
    ...(runsRootDirOverride === undefined ? {} : { runsRootDir: runsRootDirOverride }),
    ...(runId === undefined ? {} : { runId }),
    latest: args.includes("--latest") || runId === undefined,
  };
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex === -1) {
    return undefined;
  }
  const value = args[flagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
