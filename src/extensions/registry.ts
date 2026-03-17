import {
  AmbiguousExtensionProviderError,
  DuplicateExtensionProviderError,
  MissingExtensionProviderError,
} from "./errors.js";
import type {
  EnvironmentProvider,
  LoadedPiphonyExtensions,
  TransitionHook,
  TrackerProviderDefinition,
  DiscoveredExtension,
} from "./types.js";

export class ExtensionRegistry {
  private readonly environments = new Map<string, EnvironmentProvider>();
  private readonly trackers = new Map<string, TrackerProviderDefinition>();
  private readonly preTransitionHooks: TransitionHook[] = [];
  private readonly postTransitionHooks: TransitionHook[] = [];

  registerEnvironment(provider: EnvironmentProvider): void {
    if (this.environments.has(provider.id)) {
      throw new DuplicateExtensionProviderError(`Duplicate environment provider id: ${provider.id}`);
    }
    this.environments.set(provider.id, provider);
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
    const environmentProvider = requireExactlyOneProvider(
      [...this.environments.values()],
      "environment",
    );
    const trackerProvider = requireExactlyOneProvider(
      [...this.trackers.values()],
      "tracker",
    );
    return {
      environmentProvider,
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
