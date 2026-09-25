"use client";

import { useMemo } from "react";
import { useAuiState } from "@assistant-ui/react";
import { outputKey, spanKey, turnStatsOf, type TurnStats } from "@/lib/turn-stats";

/** One step of a run, ready to draw: what it was, and its window on the clock. */
export type RunStep = {
  key: string;
  /**
   * Which drawing in the panel it is. A wait is the odd one: not a step measured on the
   * wire but the ground between two of them, derived by the panel, and it answers to no card
   * in the thread.
   */
  role: "reasoning" | "call" | "output" | "wait";
  label: string;
  ms: number;
  /** Where the window sat on the turn's clock, for drawing it on the run's span. */
  startMs: number;
  /** What the provider said this window's thinking cost, where it said anything. */
  tokens?: number;
  /** How many characters the window's words took, for counting them when it did not. */
  chars?: number;
};

/**
 * One turn of the thread: what was asked, what the turn cost, and how it was
 * spent.
 */
export type Run = {
  /** 1 for the first turn. The chat's own label and the panel count the same way. */
  index: number;
  prompt: string;
  /** The user message the turn starts at, for scrolling back to it. */
  anchor: string;
  /** The turn's wall clock, as the message's timing badge measures it. */
  ms?: number;
  stats?: TurnStats;
  /** The thinking, calls, and visible output in the order they happened. */
  steps: RunStep[];
};

function promptOf(message: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ")
    .trim();
}

function stepsOf(run: number, stats: TurnStats | undefined, names: Record<string, string>, runMs: number | undefined): RunStep[] {
  if (!stats) return [];
  const steps: RunStep[] = stats.spans.map((span) => ({
    key: spanKey(run, span),
    role: span.kind === "reasoning" ? "reasoning" : "call",
    label: span.kind === "reasoning" ? "reasoning" : names[span.id ?? ""] ?? span.id ?? "call",
    ms: span.ms,
    startMs: span.startMs,
    ...(span.tokens !== undefined ? { tokens: span.tokens } : {}),
    ...(span.textFrom !== undefined && span.textTo !== undefined ? { chars: span.textTo - span.textFrom } : {}),
  }));
  if (stats.answerMs !== undefined) {
    const leadMs = stats.leadMs ?? 0;
    const e2eMs = runMs ?? leadMs + stats.totalMs + stats.answerMs;
    steps.push({
      key: outputKey(run),
      role: "output",
      label: "output",
      ms: stats.answerMs,
      startMs: Math.max(0, e2eMs - stats.answerMs - leadMs),
      ...(stats.usage?.completionTokens !== undefined ? { tokens: stats.usage.completionTokens } : {}),
    });
  }
  return steps;
}

/**
 * The thread's turns, in order: a user message and the answer that follows it,
 * which is where that turn's stats and timing live.
 *
 * Read off the thread rather than carried here. Every assistant message already
 * holds the record its own rows drew from, so this is a second reader of the same
 * record, not a second copy of it — which is also why the panel needs no wiring
 * of its own and picks up a turn the moment its stats land.
 */
export function useRuns(): Run[] {
  const messages = useAuiState((state) => state.thread.messages);

  return useMemo(() => {
    const runs: Run[] = [];

    messages.forEach((message, position) => {
      if (message.role !== "user") return;
      const answer = messages[position + 1];

      let stats: TurnStats | undefined;
      let ms: number | undefined;
      const names: Record<string, string> = {};

      if (answer?.role === "assistant") {
        stats = turnStatsOf(answer.metadata?.custom);
        ms = answer.metadata?.timing?.totalStreamTime;
        for (const part of answer.content) {
          if (part.type === "tool-call") names[part.toolCallId] = part.toolName;
        }
      }

      runs.push({
        index: runs.length + 1,
        prompt: promptOf(message),
        anchor: message.id,
        ...(ms !== undefined ? { ms } : {}),
        ...(stats ? { stats } : {}),
        steps: stepsOf(runs.length + 1, stats, names, ms),
      });
    });

    return runs;
  }, [messages]);
}
