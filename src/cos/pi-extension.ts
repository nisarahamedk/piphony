import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { ChiefOfStaffServices } from "./types.js";
import { createChiefOfStaffTools } from "./tools.js";

export function createChiefOfStaffExtension(services: ChiefOfStaffServices): ExtensionFactory {
  return async (pi: ExtensionAPI) => {
    for (const tool of createChiefOfStaffTools(services)) {
      pi.registerTool(tool);
    }
  };
}
