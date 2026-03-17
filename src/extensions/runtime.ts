import { discoverExtensions, resolveProjectExtensionsDir, resolveUserExtensionsDir } from "./discovery.js";
import { createExtensionApi } from "./api.js";
import { ExtensionLoadError, MissingExtensionProviderError } from "./errors.js";
import { loadExtensionFactory } from "./loader.js";
import { createExtensionRegistry } from "./registry.js";
import type { LoadedPiphonyExtensions } from "./types.js";

export function isProjectOnboarded(projectRoot: string): boolean {
  const discovered = discoverExtensions(projectRoot);
  // Project is onboarded if it has either project-local or user-global extensions
  return discovered.length > 0;
}

export function loadProjectExtensions(projectRoot: string): LoadedPiphonyExtensions {
  const discoveredExtensions = discoverExtensions(projectRoot);
  if (discoveredExtensions.length === 0) {
    throw new MissingExtensionProviderError(
      `No extensions found for project ${projectRoot}. Expected project-local extensions under ${resolveProjectExtensionsDir(projectRoot)} or user-global extensions under ${resolveUserExtensionsDir()}`,
    );
  }

  const registry = createExtensionRegistry();
  const api = createExtensionApi(registry);
  for (const discovered of discoveredExtensions) {
    try {
      const factory = loadExtensionFactory(discovered.path);
      const maybePromise = factory(api);
      if (maybePromise instanceof Promise) {
        throw new ExtensionLoadError(`Extension ${discovered.path} returned a Promise. Piphony extensions must register synchronously.`);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new ExtensionLoadError(`Failed loading extension ${discovered.path}: ${error.message}`, { cause: error });
      }
      throw error;
    }
  }

  return registry.finalize(discoveredExtensions);
}
