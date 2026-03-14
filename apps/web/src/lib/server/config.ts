import { resolveRepoPaths, type RepoPaths } from "@piphony/config/repo-paths";

export interface WebServerPaths extends RepoPaths {}

export function resolveWebServerPaths(env: NodeJS.ProcessEnv = process.env): WebServerPaths {
  const repoRoot = env.PIPHONY_REPO_ROOT?.trim();
  return resolveRepoPaths(repoRoot === undefined || repoRoot === "" ? process.cwd() : repoRoot);
}
