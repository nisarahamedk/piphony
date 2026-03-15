import { resolveRepoPaths, type RepoPaths } from "@piphony/config/repo-paths";

export interface WebServerPaths extends RepoPaths {}

export function resolveWebServerPaths(env: NodeJS.ProcessEnv = process.env): WebServerPaths {
  const projectRoot = env.PIPHONY_PROJECT_ROOT?.trim() || env.PIPHONY_REPO_ROOT?.trim();
  return resolveRepoPaths(projectRoot === undefined || projectRoot === "" ? process.cwd() : projectRoot);
}
