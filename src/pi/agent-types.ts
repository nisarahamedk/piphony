import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentTypeDefinition {
  name: string;
  description?: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  tools: string[];
  systemPromptAppend?: string;
}

interface AgentTypeFileShape {
  agents: AgentTypeDefinition[];
}

const BUILTIN_AGENT_TYPES: Record<string, AgentTypeDefinition> = {
  implementation: {
    name: "implementation",
    description: "Default implementation agent for local smoke and end-to-end validation.",
    model: "Minimax-M2.5",
    thinkingLevel: "off",
    tools: ["read", "bash", "grep", "find", "ls"],
    systemPromptAppend: [
      "## Piphony Agent Type: implementation",
      "- Be concise and deterministic.",
      "- Use provided tracker tools when asked to mutate tracker state.",
      "- Use github_cli instead of bash for control-plane git/GitHub housekeeping when it is available.",
      "- For github_cli, set driver='git' or driver='gh' and pass only the remaining arguments in args.",
      "- Use bash for concrete runtime code edits, validation, and repository work inside the target environment.",
      "- Summarize only what you actually observed or changed.",
    ].join("\n"),
  },
  review: {
    name: "review",
    model: "Minimax-M2.5",
    thinkingLevel: "off",
    tools: ["read"],
    systemPromptAppend: "## Piphony Agent Type: review\n- Review changes and findings concisely.",
  },
  qa: {
    name: "qa",
    model: "Minimax-M2.5",
    thinkingLevel: "off",
    tools: ["read", "bash"],
    systemPromptAppend: "## Piphony Agent Type: qa\n- Focus on validation and reproduction steps.",
  },
  merge: {
    name: "merge",
    model: "Minimax-M2.5",
    thinkingLevel: "off",
    tools: ["read"],
    systemPromptAppend: "## Piphony Agent Type: merge\n- Focus on merge readiness and handoff clarity.",
  },
};

export async function loadAgentTypes(cwd: string): Promise<Record<string, AgentTypeDefinition>> {
  const configPath = resolve(join(cwd, ".piphony", "agent-types.json"));
  if (!existsSync(configPath)) {
    return BUILTIN_AGENT_TYPES;
  }
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as AgentTypeFileShape;
  const userTypes = Object.fromEntries(parsed.agents.map((agent) => [agent.name, agent]));
  return { ...BUILTIN_AGENT_TYPES, ...userTypes };
}

export async function resolveAgentType(cwd: string, name = "implementation"): Promise<AgentTypeDefinition> {
  const all = await loadAgentTypes(cwd);
  const resolved = all[name];
  if (resolved === undefined) {
    throw new Error(`Unknown agent type: ${name}`);
  }
  return resolved;
}
