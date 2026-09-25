"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const longestStepMs = run.steps.reduce((longest, step) => Math.max(longest, step.ms), 0);

  return (
    <section className="run-detail">
      <h6 className="run-panel-title">
        <span>{`Run ${formatRunIndex(run.index)} timing`}</span>
        {run.ms !== undefined && <span className="run-detail-ms">{formatSpan(run.ms)}</span>}
      </h6>
      <dl className="run-facts">
        <div>
          <dt>Tool calls</dt>
          <dd>{calls.length}</dd>
        </div>
        <div>
          <dt>Reasoning</dt>
          <dd>{isMeasurable(reasoningMs) ? formatSpan(reasoningMs) : "—"}</dd>
        </div>
        <div>
          <dt>Tok reason / out</dt>
          <dd>
            {usage?.reasoningTokens !== undefined ? formatTokenCount(usage.reasoningTokens) : "—"}
            {run.stats?.estimated ? " est." : ""}
            {" / "}
            {usage !== null ? formatTokenCount(usage.completionTokens) : "—"}
          </dd>
        </div>
      </dl>
      {run.steps.length > 0 && (
        <ol className="run-steps">
          {run.steps.map((step) => {
            // Only calls are ever marked: a turn that spends itself thinking is the
            // ordinary case, and reasoning reads in the same ink as the rows above it.
            const slow = step.role === "call" && isStandout(step.ms, longestCallMs) && calls.length > 1;
            const isChosen = step.key === chosen;
            return (
              <li key={step.key}>
                {/* The row is a way into the card it measures: hovered it is
                    marked, clicked it is opened and pointed at. */}
                <button
                  type="button"
                  className={`step-row${slow ? " slow" : ""}${isChosen ? " selected" : ""}`}
                  data-step={step.key}
                  aria-pressed={isChosen}
                  onClick={() => onChoose(step.key)}
                  onPointerEnter={() => lightStep(step.key)}
                  onPointerLeave={() => lightStep(null)}
                >
                  <span className="step-name">{step.label}</span>
                  <span className="step-tokens">{stepTokens(step)}</span>
                  <span className="step-bar" aria-hidden="true">
                    <span style={{ width: `${pct(step.ms, longestStepMs)}%` }} />
                  </span>
                  <span className="step-ms">{isMeasurable(step.ms) ? formatSpan(step.ms) : ""}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * What a thinking window cost, as its own row reads it: the count the provider gave
 * for the response it ran in, or — where the provider keeps thinking inside the
 * answer's count — the window's own words read as tokens, said as the estimate they
 * are. Calls read nothing: a call's cost is in the answer the round returned.
 */
function stepTokens(step: RunStep): string {
  if (step.tokens !== undefined) return `${formatTokenCount(step.tokens)} tok`;
  if (step.chars === undefined || step.chars === 0) return "";
  return `≈${formatTokenCount(Math.ceil(step.chars / 4))} tok`;
}

/** A width against the longest of its row: the bars are read relatively. */
function pct(value: number, longest: number): number {
  if (longest <= 0) return 0;
  return Math.min(100, (value / longest) * 100);
}
