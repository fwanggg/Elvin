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
  /**
   * Where this window's words sit in the message's thinking trace, in characters.
   * Thinking arrives as one string, so a card that draws all of it needs these to
   * point at the stretch a single row measured instead of guessing at it. Only
   * thinking windows have them.
   */
  textFrom?: number;
  textTo?: number;
  /**
   * What the provider said this window's thinking cost, where it reported that at
   * all: endpoints split thinking out of the answer per response, not per window,
   * and a response files at most one thinking window. Absent means unknown, which
   * a surface reads from the window's own words instead.
   */
  tokens?: number;
};

export type TurnStats = {
  spans: TurnSpan[];
  /** The answer's own window: first token to last. Not a span — it is the output. */
  answerMs?: number;
  /**
   * The work window the spans are laid out against: where the first window opens
   * to where the last one closes. The answer that follows is not part of it —
   * that generation is the message badge's number, not a row's.
   */
  totalMs: number;
  /**
   * How long the turn had been running when its first window opened: the wait before
   * its first token, which the message badge's clock counts and the windows' offsets
   * do not. A surface drawing the run end to end adds it, so the windows sit where
   * they sat on the turn rather than a token early.
   */
  leadMs?: number;
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

/**
 * The key a window answers to on both surfaces: the panel's row for it, and the
 * card in the chat that made it. The run is part of the address because every
 * turn's clock starts where its own first activity was, so a thinking window in
 * the next turn would otherwise answer to the same key as one in this. Within a
 * run a call carries its own id, and a thinking window has none and answers to
 * where it sits on the clock. That is the whole contract between the two readers
 * — neither is told about the other, and the record is all they share.
 */
export function spanKey(run: number | undefined, span: TurnSpan): string {
  return `${run ?? 0}-${span.kind}-${span.id ?? span.startMs}`;
}

/** Those keys as one card carries them: what the panel's hover puts to the document. */
export function spanKeys(run: number | undefined, spans: readonly TurnSpan[]): string {
  return spans.map((span) => spanKey(run, span)).join(" ");
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

/** The same count where the room is narrow: "412", "1.5k". */
export function formatTokenCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

/** Run indices read the way both surfaces label them: "01", "02". */
export function formatRunIndex(index: number): string {
  return String(index).padStart(2, "0");
}

/**
 * Whether a window stands out among others of its kind. Within a tenth of the
 * longest, two windows are the same length at the resolution either surface
 * prints, so a tie is drawn as a tie instead of whichever one the clock happened
 * to favour.
 */
export function isStandout(ms: number, longestMs: number): boolean {
  return isMeasurable(ms) && ms >= longestMs * 0.9;
}
