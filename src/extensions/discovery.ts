import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DiscoveredExtension, ExtensionScope } from "./types.js";

const LOCAL_EXTENSIONS_DIR = ".piphony/extensions";
const USER_EXTENSIONS_DIR = ".piphony/extensions";

export function discoverExtensions(projectRoot: string): DiscoveredExtension[] {
  return [
    ...discoverExtensionBucket(resolve(projectRoot, LOCAL_EXTENSIONS_DIR), "project"),
    ...discoverExtensionBucket(resolve(homedir(), USER_EXTENSIONS_DIR), "user"),
  ];
}

export function resolveProjectExtensionsDir(projectRoot: string): string {
  return resolve(projectRoot, LOCAL_EXTENSIONS_DIR);
}

export function resolveUserExtensionsDir(): string {
  return resolve(homedir(), USER_EXTENSIONS_DIR);
}

function discoverExtensionBucket(root: string, scope: ExtensionScope): DiscoveredExtension[] {
  if (!existsSync(root)) {
    return [];
  }
  const entries = readdirSync(root).sort((left, right) => left.localeCompare(right));
  const discovered: DiscoveredExtension[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isFile() && fullPath.endsWith(".ts")) {
      discovered.push({ path: fullPath, scope });
      continue;
    }
    if (stat.isDirectory()) {
      const indexPath = join(fullPath, "index.ts");
      if (existsSync(indexPath)) {
        discovered.push({ path: indexPath, scope });
      }
    }
  }
  return discovered;
}
