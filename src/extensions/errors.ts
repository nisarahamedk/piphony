export class ExtensionRuntimeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ExtensionDiscoveryError extends ExtensionRuntimeError {}
export class ExtensionLoadError extends ExtensionRuntimeError {}
export class DuplicateExtensionProviderError extends ExtensionRuntimeError {}
export class MissingExtensionProviderError extends ExtensionRuntimeError {}
export class AmbiguousExtensionProviderError extends ExtensionRuntimeError {}
export class InvalidExtensionModuleError extends ExtensionRuntimeError {}
