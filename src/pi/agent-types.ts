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

export interface AgentTypeOverride {
  name: string;
  description?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  systemPromptAppend?: string;
}

interface AgentTypeFileShape {
  agents: AgentTypeOverride[];
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
  chief_of_staff: {
    name: "chief_of_staff",
    description: "Chief of Staff agent for Piphony extension-first observability, planning, and steering.",
    model: "Minimax-M2.5",
    thinkingLevel: "off",
    tools: [],
    systemPromptAppend: [
      "## Piphony Agent Type: chief_of_staff",
      "- You are the user's chief of staff for tracker-driven software execution.",
      "- Prefer Piphony tools over speculation whenever the user asks about current state or asks you to take an action.",
      "- On issue pages, use piphony_get_issue_context before answering concrete status questions.",
      "- On board/overview pages, use piphony_get_board_overview before answering what needs attention.",
      "- Use piphony_list_active_runs and piphony_get_run_detail for observability when needed.",
      "- Use piphony_steer_run, piphony_follow_up_run, piphony_request_run_summary, piphony_abort_run, or piphony_retry_issue for active-run control instead of describing hypothetical actions.",
      "- Use piphony_create_issue when the user asks you to plan work, create follow-ups, or break work into tickets.",
      "- Summarize active work clearly and concisely after using the relevant tools.",
    ].join("\n"),
  },
};

export async function loadAgentTypes(cwd: string): Promise<Record<string, AgentTypeDefinition>> {
  const configPath = resolve(join(cwd, ".piphony", "agent-types.json"));
  if (!existsSync(configPath)) {
    return BUILTIN_AGENT_TYPES;
  }
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as AgentTypeFileShape;
  const resolved: Record<string, AgentTypeDefinition> = { ...BUILTIN_AGENT_TYPES };

  for (const override of parsed.agents) {
    const base = resolved[override.name];
    if (base === undefined) {
      resolved[override.name] = materializeNewAgentType(override);
      continue;
    }
    resolved[override.name] = {
      ...base,
      ...override,
      tools: override.tools === undefined ? base.tools : [...override.tools],
    };
  }

  return resolved;
}

function materializeNewAgentType(override: AgentTypeOverride): AgentTypeDefinition {
  if (override.model === undefined || override.thinkingLevel === undefined || override.tools === undefined) {
    throw new Error(
      `Custom agent type '${override.name}' must define model, thinkingLevel, and tools when it does not extend a built-in agent type`,
    );
  }
  return {
    name: override.name,
    ...(override.description === undefined ? {} : { description: override.description }),
    model: override.model,
    thinkingLevel: override.thinkingLevel,
    tools: [...override.tools],
    ...(override.systemPromptAppend === undefined ? {} : { systemPromptAppend: override.systemPromptAppend }),
  };
}

export function createAgentModelOverrides(model: string): AgentTypeOverride[] {
  return Object.values(BUILTIN_AGENT_TYPES).map((agent) => ({
    name: agent.name,
    model,
  }));
}

export async function resolveAgentType(cwd: string, name = "implementation"): Promise<AgentTypeDefinition> {
  const all = await loadAgentTypes(cwd);
  const resolved = all[name];
  if (resolved === undefined) {
    throw new Error(`Unknown agent type: ${name}`);
  }
  return resolved;
}
