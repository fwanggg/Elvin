import { joinEmittedSource, type SourceConfig } from "./shared";

/** elvin.config.ts, the file that records every knob the playground set. */
export function configSource(config: SourceConfig): string {
  return joinEmittedSource([
    "export const elvinConfig = {",
    "  baseURL: process.env.AGENT_BASE_URL,",
    `  model: ${JSON.stringify(config.model)},`,
    `  pattern: ${JSON.stringify(config.pattern)} as "thread" | "sidebar" | "modal",`,
    `  theme: ${JSON.stringify(config.theme)},`,
    `  design: ${JSON.stringify(config.design)},`,
    `  emoji: ${config.emoji === "on"},`,
    `  stream: ${config.stream === "true"},`,
    `  capability: ${JSON.stringify(config.capability || null)},`,
    `  view: ${JSON.stringify(config.view === "user" ? "user" : "dev")} as "dev" | "user",`,
    "  toolCalls: {",
    `    defaultOpen: ${config.open === "expanded"},`,
    "  },",
    "  reasoning: {",
    `    defaultOpen: ${config.open === "expanded"},`,
    "  },",
    "} as const;",
    "",
  ], "\n");
}

/** Base scaffold styling. Every value resolves to a token on :root below. */
