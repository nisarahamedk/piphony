import {
  AmbiguousExtensionProviderError,
  DuplicateExtensionProviderError,
  MissingExtensionProviderError,
} from "./errors.js";
import type {
  LoadedPiphonyExtensions,
  RuntimePlatformProvider,
  TransitionHook,
  TrackerProviderDefinition,
  DiscoveredExtension,
} from "./types.js";

export class ExtensionRegistry {
  private readonly runtimePlatforms = new Map<string, RuntimePlatformProvider>();
  private readonly trackers = new Map<string, TrackerProviderDefinition>();
  private readonly preTransitionHooks: TransitionHook[] = [];
  private readonly postTransitionHooks: TransitionHook[] = [];

  registerRuntimePlatform(provider: RuntimePlatformProvider): void {
    if (this.runtimePlatforms.has(provider.id)) {
      throw new DuplicateExtensionProviderError(`Duplicate runtime platform provider id: ${provider.id}`);
    }
    this.runtimePlatforms.set(provider.id, provider);
  }

  registerTracker(provider: TrackerProviderDefinition): void {
    if (this.trackers.has(provider.id)) {
      throw new DuplicateExtensionProviderError(`Duplicate tracker provider id: ${provider.id}`);
    }
    this.trackers.set(provider.id, provider);
  }

  registerPreTransitionHook(hook: TransitionHook): void {
    this.preTransitionHooks.push(hook);
  }

  registerPostTransitionHook(hook: TransitionHook): void {
    this.postTransitionHooks.push(hook);
  }

  finalize(discoveredExtensions: readonly DiscoveredExtension[]): LoadedPiphonyExtensions {
    // Must have exactly one RuntimePlatformProvider
    const runtimePlatformProvider = requireExactlyOneProvider(
      [...this.runtimePlatforms.values()],
      "runtime platform",
    );

    const trackerProvider = requireExactlyOneProvider(
      [...this.trackers.values()],
      "tracker",
    );

    return {
      runtimePlatformProvider,
      trackerProvider,
      preTransitionHooks: [...this.preTransitionHooks],
      postTransitionHooks: [...this.postTransitionHooks],
      discoveredExtensions: [...discoveredExtensions],
    };
  }
}

function requireExactlyOneProvider<T extends { id: string }>(providers: readonly T[], label: string): T {
  if (providers.length === 0) {
    throw new MissingExtensionProviderError(`No ${label} provider registered by loaded extensions`);
  }
  if (providers.length > 1) {
    throw new AmbiguousExtensionProviderError(
      `Expected exactly one ${label} provider, got ${providers.map((provider) => provider.id).join(", ")}`,
    );
  }
  return providers[0]!;
}

export function createExtensionRegistry(): ExtensionRegistry {
  return new ExtensionRegistry();
}
