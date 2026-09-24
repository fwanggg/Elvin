"use client";

import { useEffect, type ReactNode } from "react";
import { formatRunIndex, formatSpan, formatTokenCount, isMeasurable, isStandout } from "@/lib/turn-stats";
import type { Run } from "./runs";

/**
 * Lighting a step's card. The card's markup lives in the chat, so the panel asks
 * the document for what answers to the key rather than being handed a node: the
 * attribute is the whole contract between the two surfaces, and a step with no
 * card beside it — a run in a pattern that draws no chat — lights nothing.
 */
function lightStep(key: string | null): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-steps]")) {
    const linked = key !== null && (element.dataset.steps ?? "").split(" ").includes(key);
    element.classList.toggle("is-linked", linked);
    // A mark off the viewport would be invisible, so the chat gives up the least
    // it can: `nearest` moves nothing that is already in sight.
    if (linked) element.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
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

/** One run taken apart: its headline, its facts, then its steps. */
function RunDetail({ run }: Readonly<{ run: Run }>): ReactNode {
  // The row under the pointer is gone when the panel turns to another run, and no
  // pointerleave arrives for a node that unmounted, so the mark it left behind is
  // cleared here.
  useEffect(() => () => lightStep(null), [run.index]);

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
            return (
              <li
                key={step.key}
                className={slow ? "run-step slow" : "run-step"}
                data-step={step.key}
                onPointerEnter={() => lightStep(step.key)}
                onPointerLeave={() => lightStep(null)}
              >
                <span className="step-name">{step.label}</span>
                <span className="step-bar" aria-hidden="true">
                  <span style={{ width: `${pct(step.ms, longestStepMs)}%` }} />
                </span>
                <span className="step-ms">{isMeasurable(step.ms) ? formatSpan(step.ms) : ""}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** A width against the longest of its row: the bars are read relatively. */
function pct(value: number, longest: number): number {
  if (longest <= 0) return 0;
  return Math.min(100, (value / longest) * 100);
}
