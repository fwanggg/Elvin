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

/** What a window was spent on. The answer is not a span: it is the turn's output. */
export type SpanKind = "reasoning" | "tool";

/**
 * One window of work, placed on the turn's own clock. The cursor walks from the
 * first activity to the last, so a turn that thinks, calls, thinks again and
 * calls again files two reasoning windows and two tool windows in order.
 */
export type TurnSpan = {
  kind: SpanKind;
  /** The call this window belongs to, for a tool span. */
  id?: string;
  /** Offset from the turn's first activity, in ms. */
  startMs: number;
  /** How long the window ran, in ms. */
  ms: number;
};

export type TurnStats = {
  spans: TurnSpan[];
  /** The window the spans are laid out against: first activity to last. */
  totalMs: number;
  usage: UsageTotals | null;
  /** True while no usage has arrived: any token figure is an estimate. */
  estimated: boolean;
};

/** The message's own bag, which the adapter fills with `{ stats }`. */
export function turnStatsOf(custom: unknown): TurnStats | undefined {
  if (!custom || typeof custom !== "object" || !("stats" in custom)) return undefined;
  const stats = custom.stats;
  if (!stats || typeof stats !== "object") return undefined;
  if (!("spans" in stats) || !("usage" in stats) || !("estimated" in stats)) return undefined;
  // Written by this app's own adapter, which builds the object as a TurnStats.
  // The membership test above is only here because `metadata.custom` is typed
  // as a `Record<string, unknown>` by the message model.
  return stats as TurnStats;
}

/** Every window of one kind, in order — the reasoning row draws all of them. */
export function spansOf(stats: TurnStats | undefined, kind: SpanKind, id?: string): TurnSpan[] {
  if (!stats) return [];
  return stats.spans.filter((span) => span.kind === kind && (id === undefined || span.id === id));
}

/** Row stats read in seconds, one decimal: "0.3s", "12.6s". */
export function formatSpan(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Whether a window is long enough to claim. One decimal of a second is what the
 * rows read at, so anything under half of that prints as "0.0s" — a reading the
 * wire never gave, whether the part arrived in one frame or the whole turn did.
 * Every place that shows a length asks this first.
 */
export function isMeasurable(ms: number): boolean {
  return ms >= 50;
}

/** Token counts read in thousands: "1,284". */
export function formatTokens(value: number): string {
  return value.toLocaleString("en-US");
}
