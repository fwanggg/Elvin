"use client";

import { BrainIcon, ChevronRightIcon, HammerIcon, MessageSquareTextIcon, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefCallback } from "react";
import { formatRunIndex, formatSpan, formatTokenCount, isMeasurable, isStandout } from "@/lib/turn-stats";
import { marked, useStepLink } from "./step-link";
import type { Run, RunStep } from "./runs";

/**
 * The thread's telemetry, in its own plane beside the chat.
 *
 * Runs at the top, each with what it cost; under them the selected run taken apart —
 * its span, its facts, and one row per step. The span is the run's own clock with every
 * window on it, and the rows are those windows said as readings, so this panel is where
 * the shape of a turn belongs and the chat can stay a transcript. A row, a window on
 * the span and a card in the thread are one step: see `step-link`.
 */
export function RunPanel({ runs, active, onSelect }: Readonly<{ runs: readonly Run[]; active: number | null; onSelect: (index: number) => void }>): ReactNode {
  const run = runs.find((entry) => entry.index === active) ?? runs.at(-1);
  const longestRunMs = runs.reduce((longest, entry) => Math.max(longest, entry.ms ?? 0), 0);

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
      {run && <RunDetail run={run} />}
    </aside>
  );
}

/** One run taken apart: its shape on the run's own span, its facts, then its steps. */
function RunDetail({ run }: Readonly<{ run: Run }>): ReactNode {
  const link = useStepLink();
  const usage = run.stats?.usage ?? null;
  const calls = run.steps.filter((step) => step.role === "call");
  const longestCallMs = calls.reduce((longest, step) => Math.max(longest, step.ms), 0);
  const reasoningMs = run.steps.reduce((sum, step) => sum + (step.role === "reasoning" ? step.ms : 0), 0);
  // The run end to end: the turn as its own badge measures it, from request to last
  // token. Every measured drawing — work windows and the visible output — is laid onto
  // that one clock at the offset it sat at.
  const leadMs = run.stats?.leadMs ?? 0;
  const e2eMs = run.ms ?? leadMs + (run.stats?.totalMs ?? 0) + (run.stats?.answerMs ?? 0);

  // What no row claims: the request in flight — the wait before the first word and the
  // gaps between measured windows. The visible answer is now its own output row, so it no
  // longer lives in this remainder.
  const inFlightMs = Math.max(0, e2eMs - run.steps.reduce((sum, step) => sum + step.ms, 0));

  const total = useWalked(e2eMs, asSpan);
  const asked = useWalked(usage?.promptTokens, asCompact);
  const answered = useWalked(usage?.completionTokens, asCompact);
  const callCount = useWalked(calls.length, asWhole);
  const inFlight = useWalked(isMeasurable(inFlightMs) ? inFlightMs : undefined, asSpan);

  return (
    <section className="run-detail">
      <h6 className="run-panel-title">{`Run ${formatRunIndex(run.index)} timing`}</h6>
      {run.steps.length > 0 && (
        <>
          {/* The run's whole span, and inside it every window where it sat. The ground
              the windows do not cover is the request in flight, drawn hatched here and
              named under the span — hovering or choosing a window says which step it
              measures, the same as its row below. */}
          <div className="run-e2e">
            {run.steps.map((step, index) => {
              const spot = place(leadMs + step.startMs, step.ms, e2eMs);
              return (
                <button
                  key={step.key}
                  type="button"
                  className={marked(step.role === "call" && isStandout(step.ms, longestCallMs) && calls.length > 1 ? "e2e-span slow" : "e2e-span", step.key, link)}
                  data-span={step.key}
                  data-role={step.role}
                  aria-pressed={link.chosen === step.key}
                  aria-label={`Select ${step.label}`}
                  onClick={() => link.choose(step.key)}
                  onPointerEnter={() => link.mark(step.key)}
                  onPointerLeave={link.leave}
                  style={{ insetInlineStart: `${spot.start}%`, inlineSize: `${spot.size}%`, animationDelay: `${index * 45}ms` }}
                />
              );
            })}
          </div>
          <p className="run-e2e-key">
            <span className="run-e2e-swatch" aria-hidden="true" />
            <span>In flight</span>
            <span className="run-e2e-key-ms" ref={inFlight} />
          </p>
        </>
      )}
      <dl className="run-facts">
        <div>
          <dt>Tool calls</dt>
          <dd ref={callCount} />
        </div>
        <div>
          <dt>Total dur</dt>
          <dd ref={total} />
        </div>
        <div>
          <dt>Token in</dt>
          <dd>{usage === null ? "—" : <span ref={asked} />}</dd>
        </div>
        <div>
          <dt>Token out</dt>
          <dd>{usage === null ? "—" : <span ref={answered} />}</dd>
        </div>
      </dl>
      {run.steps.length > 0 && (
        <ol className="run-steps">
          {run.steps.map((step) => (
            <StepRow key={step.key} step={step} slow={step.role === "call" && isStandout(step.ms, longestCallMs) && calls.length > 1} />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * One step: what it was, what its thinking cost, and how long it ran. Both figures walk
 * to their values as the panel opens on a run, so the row reads as a reading being taken
 * rather than as numbers that were always there. Hovering it — here, on its window of
 * the span, or on the card it came from — marks all three.
 */
function StepRow({ step, slow }: Readonly<{ step: RunStep; slow: boolean }>): ReactNode {
  const link = useStepLink();
  // Thinking is counted by the provider where the provider splits it out, and by the
  // window's own words where it does not — the mark says which of the two a figure is.
  const estimated = step.tokens === undefined && step.chars !== undefined && step.chars > 0;
  const counted = step.tokens ?? (estimated ? Math.ceil((step.chars ?? 0) / 4) : undefined);
  const tokens = useWalked(counted, asTokens);
  const lasted = useWalked(isMeasurable(step.ms) ? step.ms : undefined, asSpan);

  return (
    <li>
      {/* The row is a way into the card it measures: marked when the pointer is on it —
          from either surface — and held when it is the chosen one. */}
      <button
        type="button"
        className={marked(`step-row${slow ? " slow" : ""}`, step.key, link)}
        data-step={step.key}
        aria-pressed={link.chosen === step.key}
        onClick={() => link.choose(step.key)}
        onPointerEnter={() => link.mark(step.key)}
        onPointerLeave={link.leave}
      >
        <span className="step-name"><StepIcon role={step.role} />{stepLabel(step)}</span>
        <span className="step-tokens">
          {estimated && <span aria-hidden="true">≈</span>}
          <span ref={tokens} />
        </span>
        <span className="step-ms" ref={lasted} />
      </button>
    </li>
  );
}

function StepIcon({ role }: Readonly<{ role: RunStep["role"] }>): ReactNode {
  const Icon: LucideIcon = role === "reasoning" ? BrainIcon : role === "call" ? HammerIcon : MessageSquareTextIcon;
  return (
    <>
      <ChevronRightIcon className="step-chevron" aria-hidden="true" />
      <Icon className="step-role-icon" aria-hidden="true" />
    </>
  );
}

function stepLabel(step: RunStep): string {
  return step.role === "call" ? `${step.label} (tool)` : step.label;
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
