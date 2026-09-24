import type { Design } from "@/lib/design-tokens";

/**
 * Types and helpers shared by the emitted scaffold sources.
 *
 * Each module in this directory returns the literal contents of one file in the
 * downloaded scaffold. They are strings on purpose: the scaffold cannot import
 * from Elvin, so its sources have to be emitted rather than reused.
 */
export type SourceFile = {
  name: string;
  content: string;
};

export type SourceConfig = {
  pattern: string;
  theme: string;
  design: Design;
  emoji: string;
  tools: string;
  reasoning: string;
  open: string;
  model: string;
  stream: string;
  capability: string;
};

export type OptionalSourceChunk = string | false | null | undefined;

export function joinEmittedSource(chunks: readonly OptionalSourceChunk[], separator: string): string {
  const emitted = chunks.filter((chunk): chunk is string => typeof chunk === "string");
  return emitted.join(separator);
}
