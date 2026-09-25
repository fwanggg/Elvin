"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefCallback } from "react";
import { formatRunIndex, formatSpan, formatTokenCount, isMeasurable, isStandout } from "@/lib/turn-stats";
import type { Run, RunStep } from "./runs";

/** Every card in the chat that answers to a step, in the order they are drawn. */
function cardsFor(key: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-steps]")].filter((card) => (card.dataset.steps ?? "").split(" ").includes(key));
}

/**
 * The exact thing a step names. A card is only ever the outermost answer to a key:
 * a window of thinking is drawn inside its card as its own block of the trace, and
 * that block is what a row about thinking means. A card that has not been opened
 * draws no trace yet, so there the card is all there is to point at — as it is for
 * a call, which has nothing inside it to point at instead.
 */
function exactFor(key: string): HTMLElement | undefined {
  return cardsFor(key).at(-1);
}

/**
 * Lighting a step's card. The card's markup lives in the chat, so the panel asks
 * the document for what answers to the key rather than being handed a node: the
 * attribute is the whole contract between the two surfaces, and a step with no
 * card beside it — a run in a pattern that draws no chat — lights nothing.
 */
function lightStep(key: string | null): void {
  const exact = key === null ? undefined : exactFor(key);
  for (const card of document.querySelectorAll<HTMLElement>("[data-steps]")) {
    const linked = card === exact;
    card.classList.toggle("is-linked", linked);
    // A mark off the viewport would be invisible, so the chat gives up the least
    // it can: `nearest` moves nothing that is already in sight.
    if (linked) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  // The run's own span carries the same step: a row and the stretch of the run it
  // measured are one thing said twice, so the pointer says it on both.
  for (const mark of document.querySelectorAll<HTMLElement>("[data-span]")) {
    mark.classList.toggle("is-linked", key !== null && mark.dataset.span === key);
  }
}

/**
 * Taking the mark off what the row before this one named, and closing the card it
 * opened — unless the row now chosen is another window of the same card. Then the
 * card stays open: it is one trace, and its two rows are two stretches of it, so
 * closing it to open it again would blink away the block being pointed at.
 */
function closeStep(key: string, keeping: string | null): void {
  const kept = keeping === null ? [] : cardsFor(keeping);
  for (const part of cardsFor(key)) {
    part.classList.remove("is-pointed");
    if (!kept.includes(part)) part.querySelector<HTMLElement>('[aria-expanded="true"]')?.click();
  }
  for (const mark of document.querySelectorAll<HTMLElement>("[data-span]")) {
    if (mark.dataset.span === key) mark.classList.remove("is-pointed");
  }
}

/**
 * How long a card takes to open. The pointer waits it out: the box grows while the
 * trace opens, so a scroll taken during the animation lands where the content will
 * no longer be.
 */
function openMs(card: HTMLElement): number {
  const declared = getComputedStyle(card).getPropertyValue("--animation-duration").trim();
  const value = Number.parseFloat(declared);
  if (!Number.isFinite(value) || value <= 0) return 260;
  return (declared.endsWith("ms") ? value : value * 1000) + 60;
}

/**
 * Opening a step. A row asks where that step happened, so choosing it opens the
 * card that made it, marks it, and points at the exact part of it: a call's card is
 * one call, so the card is the whole answer, while a window of thinking is one
 * stretch of a trace its card draws in full — that stretch answers to the same key,
 * so it is marked along with the card and scrolled to in the card's place.
 */
function openStep(key: string): void {
  const card = cardsFor(key)[0];
  if (card === undefined) return;
  for (const marked of document.querySelectorAll<HTMLElement>(".is-pointed")) marked.classList.remove("is-pointed");
  for (const mark of document.querySelectorAll<HTMLElement>("[data-span]")) {
    mark.classList.toggle("is-pointed", mark.dataset.span === key);
  }
  // A card that is already open has nothing to wait for.
  const closed = card.querySelector<HTMLElement>('[aria-expanded="false"]');
  closed?.click();
  setTimeout(() => {
    // Only the exact block takes the band: on a card drawing a whole trace, a band
    // around the card would say no more than the row already does, and would claim
    // the windows beside the one that was asked for.
    const exact = exactFor(key) ?? card;
    for (const part of cardsFor(key)) part.classList.toggle("is-pointed", part === exact);
    exact.scrollIntoView({ block: exact === card ? "nearest" : "center", behavior: "smooth" });
  }, closed ? openMs(card) : 0);
}

/**
 * The thread's telemetry, in its own plane beside the chat.
 *
 * Runs at the top, each with what it cost; under them the selected run taken
 * apart — its headline, its facts, and one row per step with a bar drawn from
 * that step's window. The bars are the same clock the chat's rows read: this panel
 * is where the shape of a turn belongs, so the chat can stay a transcript.
 */
export function RunPanel({ runs, active, onSelect }: Readonly<{ runs: readonly Run[]; active: number | null; onSelect: (index: number) => void }>): ReactNode {
  const run = runs.find((entry) => entry.index === active) ?? runs.at(-1);
  const longestRunMs = runs.reduce((longest, entry) => Math.max(longest, entry.ms ?? 0), 0);
  // One row at a time: the row a reader has opened is held until they open another
  // or close it, and what is chosen belongs to the run that lists it — so a panel
  // turned to another run is showing no choice rather than a row's key without its
  // row. The choice is kept, so coming back to that run comes back to it.
  const [chosen, setChosen] = useState<string | null>(null);
  const chosenKey = chosen !== null && run?.steps.some((step) => step.key === chosen) === true ? chosen : null;

  return (
    <aside className="run-panel" aria-label="Runs">
      <h6 className="run-panel-title">Runs</h6>
      <ol className="run-list">
        {runs.map((entry) => (
          <li key={entry.index}>
            <button
              type="button"
              className={entry.index === run?.index ? "run-row active" : "run-row"}
              aria-current={entry.index === run?.index}
              onClick={() => onSelect(entry.index)}
            >
              <span className="run-index">{formatRunIndex(entry.index)}</span>
              <span className="run-prompt">{entry.prompt.length > 0 ? entry.prompt : "Untitled turn"}</span>
              {entry.ms !== undefined && <span className="run-ms">{formatSpan(entry.ms)}</span>}
            </button>
            {entry.ms !== undefined && (
              <span className="run-bar" aria-hidden="true">
                <span className={isStandout(entry.ms, longestRunMs) ? "slow" : undefined} style={{ width: `${pct(entry.ms, longestRunMs)}%` }} />
              </span>
            )}
          </li>
        ))}
      </ol>
      {run && <RunDetail run={run} chosen={chosenKey} onChoose={(key) => setChosen((current) => (current === key ? null : key))} />}
    </aside>
  );
}

/** One run taken apart: its headline, its facts, then its steps. */
function RunDetail({ run, chosen, onChoose }: Readonly<{ run: Run; chosen: string | null; onChoose: (key: string) => void }>): ReactNode {
  // The row under the pointer is gone when the panel turns to another run, and no
  // pointerleave arrives for a node that unmounted, so the mark it left behind is
  // cleared here.
  useEffect(() => () => lightStep(null), [run.index]);
  // The chosen row owns the chat from here: choosing one opens its card and points
  // at the exact part of it, choosing another closes the first, and choosing the
  // same one closes it again. The disclosure belongs to the card rather than to any
  // state of ours, so it is opened and closed by asking the card itself.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const previous = opened.current;
    opened.current = chosen;
    if (previous !== null && previous !== chosen) closeStep(previous, chosen);
    if (chosen !== null) openStep(chosen);
  }, [chosen, run.index]);

  const usage = run.stats?.usage ?? null;
  const calls = run.steps.filter((step) => step.role === "call");
  const longestCallMs = calls.reduce((longest, step) => Math.max(longest, step.ms), 0);
  const reasoningMs = run.steps.reduce((sum, step) => sum + (step.role === "reasoning" ? step.ms : 0), 0);
  // The run end to end: the turn as its own badge measures it, from the request to
  // the last token, with the wait for that first token and the answer it wrote
  // inside it. Every window is drawn on that one clock at the offset it sat at, so
  // the shape here is the record's own rather than a second telling of it — which is
  // also why this figure and the run's own total are the same number.
  const leadMs = run.stats?.leadMs ?? 0;
  const e2eMs = run.ms ?? leadMs + (run.stats?.totalMs ?? 0);

  const total = useWalked(e2eMs, asSpan);
  const duration = useWalked(isMeasurable(reasoningMs) ? reasoningMs : undefined, asSpan);
  const asked = useWalked(usage?.promptTokens, asCompact);
  const answered = useWalked(usage?.completionTokens, asCompact);
  const callCount = useWalked(calls.length, asWhole);

  return (
    <section className="run-detail">
      <h6 className="run-panel-title">{`Run ${formatRunIndex(run.index)} timing`}</h6>
      {run.steps.length > 0 && (
        <div className="run-e2e" aria-hidden="true">
          {run.steps.map((step, index) => {
            const spot = place(leadMs + step.startMs, step.ms, e2eMs);
            return (
              <span
                key={step.key}
                className={step.role === "call" && isStandout(step.ms, longestCallMs) && calls.length > 1 ? "e2e-span slow" : "e2e-span"}
                data-span={step.key}
                data-role={step.role}
                style={{ insetInlineStart: `${spot.start}%`, inlineSize: `${spot.size}%`, animationDelay: `${index * 45}ms` }}
              />
            );
          })}
        </div>
      )}
      <dl className="run-facts">
        <div>
          <dt>Tool calls</dt>
          <dd ref={callCount} />
        </div>
        <div>
          <dt>Reasoning</dt>
          <dd>{isMeasurable(reasoningMs) ? <span ref={duration} /> : "—"}</dd>
        </div>
        <div>
          <dt>Tok In / Out</dt>
          <dd>{usage === null ? "—" : <><span ref={asked} />{" / "}<span ref={answered} /></>}</dd>
        </div>
        <div>
          <dt>Run Total Time</dt>
          <dd ref={total} />
        </div>
      </dl>
      {run.steps.length > 0 && (
        <ol className="run-steps">
          {run.steps.map((step) => (
            <StepRow key={step.key} step={step} chosen={step.key === chosen} slow={step.role === "call" && isStandout(step.ms, longestCallMs) && calls.length > 1} onChoose={onChoose} />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * One step: what it was, what its thinking cost, and how long it ran. Both figures
 * walk to their values as the panel opens on a run, so the row reads as a reading
 * being taken rather than as numbers that were always there.
 */
function StepRow({ step, chosen, slow, onChoose }: Readonly<{ step: RunStep; chosen: boolean; slow: boolean; onChoose: (key: string) => void }>): ReactNode {
  // Thinking is counted by the provider where the provider splits it out, and by the
  // window's own words where it does not — the mark says which of the two a figure is.
  const estimated = step.tokens === undefined && step.chars !== undefined && step.chars > 0;
  const counted = step.tokens ?? (estimated ? Math.ceil((step.chars ?? 0) / 4) : undefined);
  const tokens = useWalked(counted, asTokens);
  const lasted = useWalked(isMeasurable(step.ms) ? step.ms : undefined, asSpan);

  return (
    <li>
      {/* The row is a way into the card it measures: hovered it is marked, chosen it
          is opened and pointed at. */}
      <button
        type="button"
        className={`step-row${slow ? " slow" : ""}${chosen ? " selected" : ""}`}
        data-step={step.key}
        aria-pressed={chosen}
        onClick={() => onChoose(step.key)}
        onPointerEnter={() => lightStep(step.key)}
        onPointerLeave={() => lightStep(null)}
      >
        <span className="step-name">{step.label}</span>
        <span className="step-tokens">
          {estimated && <span aria-hidden="true">≈</span>}
          <span ref={tokens} />
        </span>
        <span className="step-ms" ref={lasted} />
      </button>
    </li>
  );
}

/** Every figure the panel walks is written the same way, wherever it walks. */
const asWhole = (value: number): string => String(Math.round(value));
const asSpan = (value: number): string => formatSpan(value);
const asTokens = (value: number): string => `${formatTokenCount(Math.round(value))} tok`;
const asCompact = (value: number): string => formatTokenCount(Math.round(value));

/** How long a figure takes to walk to its value. */
const WALK_MS = 320;

/**
 * A figure that walks to its value rather than being replaced by it. Every reading
 * here arrives either a delta at a time or all at once when a run is chosen, and the
 * walk suits both: the panel reads as a clock being read rather than as numbers
 * being swapped. Written straight to the node, because a dozen rows walking together
 * have no business re-rendering the tree once a frame — and skipped, straight to the
 * value, when motion is reduced.
 */
function useWalked(value: number | undefined, format: (value: number) => string): RefCallback<HTMLSpanElement> {
  const node = useRef<HTMLSpanElement | null>(null);
  const shown = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    const element = node.current;
    if (element === null) return;
    if (value === undefined) {
      cancelAnimationFrame(frame.current);
      element.textContent = "";
      return;
    }
    const from = shown.current;
    // Nothing to walk from, and nothing to walk through: a hidden tab has no frames
    // to walk on, and a reader who asked for less motion did not ask for a count-up.
    if (from === value || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown.current = value;
      element.textContent = format(value);
      return;
    }
    const finish = () => {
      cancelAnimationFrame(frame.current);
      shown.current = value;
      element.textContent = format(value);
    };
    const started = performance.now();
    const step = (now: number) => {
      const walked = Math.min(1, (now - started) / WALK_MS);
      // The curve the panel's own spans move on, so figures and bars settle together.
      shown.current = from + (value - from) * (1 - (1 - walked) ** 3);
      element.textContent = format(shown.current);
      if (walked < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        finish();
      }
    };
    frame.current = requestAnimationFrame(step);
    // A reading left half-walked would be a reading that never arrived, so the walk
    // also has a deadline that does not depend on frames coming.
    const deadline = setTimeout(finish, WALK_MS + 120);
    return () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(deadline);
    };
  }, [value, format]);

  return useCallback((element: HTMLSpanElement | null) => {
    node.current = element;
  }, []);
}

/** Where a window sat on the run's own span, as percentages of it. */
function place(startMs: number, ms: number, e2eMs: number): { start: number; size: number } {
  if (e2eMs <= 0) return { start: 0, size: 0 };
  const start = Math.min(100, Math.max(0, (startMs / e2eMs) * 100));
  return { start, size: Math.min(100 - start, Math.max(0, (ms / e2eMs) * 100)) };
}

/** A width against the longest of its row: the bars are read relatively. */
function pct(value: number, longest: number): number {
  if (longest <= 0) return 0;
  return Math.min(100, (value / longest) * 100);
}
