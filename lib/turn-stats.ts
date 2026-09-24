/**
 * The stats vocabulary the sandbox shares: what the provider proxy measures on
 * the wire for one turn, and how a renderer reads it back off a message.
 *
 * Kept in `lib` with the other shared vocabulary so the shell that writes the
 * numbers and the elements that read them cannot drift apart — and so a vendored
 * element can read a flag without importing from the sandbox that renders it.
 */

export type UsageTotals = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Present only where the provider splits thinking out of the completion count. */
  reasoningTokens?: number;
};

export type ToolTiming = {
  /** From the round's start to the moment the model named the call. */
  modelMs: number;
  /** From the call to the first delta of the round that followed it. */
  roundTripMs?: number;
};

export type TurnStats = {
  /** Wall clock of the reasoning window, in ms. */
  reasoningMs?: number;
  /** Wall clock of the answer window, in ms. */
  answerMs?: number;
  /** Keyed by tool call id, so a card can find its own call's clock. */
  tools: Record<string, ToolTiming>;
  usage: UsageTotals | null;
  /** True while no usage has arrived: any token figure is an estimate. */
  estimated: boolean;
};

/** The message's own bag, which the adapter fills with `{ stats }`. */
export function turnStatsOf(custom: unknown): TurnStats | undefined {
  if (!custom || typeof custom !== "object" || !("stats" in custom)) return undefined;
  const stats = custom.stats;
  if (!stats || typeof stats !== "object") return undefined;
  if (!("tools" in stats) || !("usage" in stats) || !("estimated" in stats)) return undefined;
  // Written by this app's own adapter, which builds the object as a TurnStats.
  // The membership test above is only here because `metadata.custom` is typed
  // as a `Record<string, unknown>` by the message model.
  return stats as TurnStats;
}

/** Sub-second figures stay in milliseconds; past that, one decimal of a second. */
export function formatMs(value: number): string {
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}
