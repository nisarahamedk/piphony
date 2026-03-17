import { createJiti } from "@mariozechner/jiti";
import { InvalidExtensionModuleError } from "./errors.js";
import type { PiphonyExtensionFactory } from "./types.js";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
  fsCache: true,
});

export function loadExtensionFactory(path: string): PiphonyExtensionFactory {
  const loaded = jiti(path) as { default?: unknown } | unknown;
  const factory = typeof loaded === "function"
    ? loaded
    : typeof (loaded as { default?: unknown }).default === "function"
      ? (loaded as { default: unknown }).default
      : undefined;
  if (typeof factory !== "function") {
    throw new InvalidExtensionModuleError(`Extension ${path} must export a default function`);
  }
  return factory as PiphonyExtensionFactory;
}
