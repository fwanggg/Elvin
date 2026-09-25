"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, EllipsisIcon, RefreshCwIcon, ThumbsDownIcon, ThumbsUpIcon, Volume2Icon } from "lucide-react";
import { MessageTiming } from "@/components/assistant-ui/elements/message-timing.aui";
import { ReasoningContent, ReasoningRoot, ReasoningText, ReasoningTrigger } from "@/components/assistant-ui/elements/reasoning";
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator";
import { ToolCall } from "@/components/assistant-ui/elements/tool-call";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { chipOf, describeResult, describeStep } from "@/lib/step-labels";
import { pointed, useStepLink } from "@/components/sandbox/step-link";
import { MessageAttachment } from "@/components/sandbox/attachments";
import { MIN_READING_MS, formatRunIndex, formatSpan, formatTokens, isMeasurable, isStandout, outputKey, spanKey, spanKeys, spansOf, turnStatsOf, type TurnStats, type TurnSpan } from "@/lib/turn-stats";
import { type Toggle } from "@/components/sandbox/knobs";
import {
  AuiIf,
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  useAuiState,
  type ReasoningMessagePartComponent,
  type TextMessagePartComponent,
} from "@assistant-ui/react";

/** The sandbox's part renderers: what a turn looks like as it streams. */

type AssistantRuntimeMessageProps = Readonly<{
  emoji: Toggle;
  defaultOpen: boolean;
}>;

type UserRuntimeMessageProps = Readonly<{
  emoji: Toggle;
  activeRun: number | null;
}>;

type ToolCardProps = Readonly<{
  name: string;
  args: unknown;
  /** The provider's own rendering of the call, when it sent one. Not an argument list. */
  label?: string;
  result: unknown;
  defaultOpen: boolean;
  /** This call's window on the turn's timeline, when the proxy measured one. */
  span?: TurnSpan;
  /** The turn this call belongs to: part of the address the panel's rows carry. */
  run: number | undefined;
  /** The window the rows are laid out against. */
  totalMs: number;
  /** The longest call, whose window takes the accent; absent when there is no
   *  call long enough to stand out. */
  slowestCallMs?: number;
}>;
type ToolCallRowProps = Readonly<{
  name: string;
  args: unknown;
  argsText: string | undefined;
  label?: string;
  result: unknown;
  isError?: boolean;
  defaultOpen: boolean;
}>;

/**
 * Turn markers, drawn with Google's animated Noto Emoji rather than LobeChat's
 * Fluent artwork — different art, same idea: an HD asset that moves. Image
 * assets are Apache-2.0 (fonts OFL), and each entry keeps the plain character so
 * the marker still reads as text if the asset cannot load.
 */
const EMOJI_MARKS = {
  assistant: { char: "🫧", codePoint: "1fae7" },
  user: { char: "👋", codePoint: "1f44b" },
} as const;

type EmojiRole = keyof typeof EMOJI_MARKS;

/** The animated set is served as WebP, so no Lottie player is needed. */
function notoAnimatedUrl(codePoint: string): string {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${codePoint}/512.webp`;
}

/** One turn marker: the animated asset, falling back to the plain glyph. */
function EmojiMark({ role }: Readonly<{ role: EmojiRole }>): ReactNode {
  const [plain, setPlain] = useState(false);
  const mark = EMOJI_MARKS[role];

  if (plain) return <span className="message-emoji" aria-hidden="true">{mark.char}</span>;
  return (
    <img
      className="message-emoji"
      src={notoAnimatedUrl(mark.codePoint)}
      alt=""
      aria-hidden="true"
      width={22}
      height={22}
      onError={() => setPlain(true)}
    />
  );
}

/** User Mode is the product surface: the reader sees the prompt, not the debug run id. */
export function UserModeUserMessage({ emoji }: UserRuntimeMessageProps): ReactNode {
  return (
    <MessagePrimitive.Root className={emoji === "on" ? "user-bubble emoji" : "user-bubble"}>
      {emoji === "on" && <EmojiMark role="user" />}
      <MessagePrimitive.Parts>
        {({ part }) => part.type === "text" ? part.text : null}
      </MessagePrimitive.Parts>
      <MessagePrimitive.Attachments>
        {() => <MessageAttachment />}
      </MessagePrimitive.Attachments>
    </MessagePrimitive.Root>
  );
}

/**
 * Dev Mode owns run navigation. Its user message carries the run anchor the stats
 * rail scrolls to and the label that mirrors the active run row.
 */
export function DevModeUserMessage({ emoji, activeRun }: UserRuntimeMessageProps): ReactNode {
  const run = useRunIndex();

  return (
    <div className="run-turn" data-run={run}>
      {run !== undefined && (
        <span className={run === activeRun ? "run-label active" : "run-label"}>{`Run ${formatRunIndex(run)}`}</span>
      )}
      <MessagePrimitive.Root className={emoji === "on" ? "user-bubble emoji" : "user-bubble"}>
        {emoji === "on" && <EmojiMark role="user" />}
        <MessagePrimitive.Parts>
          {({ part }) => part.type === "text" ? part.text : null}
        </MessagePrimitive.Parts>
        <MessagePrimitive.Attachments>
          {() => <MessageAttachment />}
        </MessagePrimitive.Attachments>
      </MessagePrimitive.Root>
    </div>
  );
}

/** User Mode renders the turn as product UX: one thought row, prose trace, tool rows, answer. */
export function UserModeAssistantMessage({ emoji, defaultOpen }: AssistantRuntimeMessageProps): ReactNode {
  const reasoningArrived = useAuiState((state) => state.message.parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0));
  const thoughtStarted = useThoughtStarted();
  const running = useAuiState((state) => state.message.status?.type === "running");
  const answering = useAuiState((state) => {
    const last = state.message.parts.at(-1);
    return last?.type === "text" && last.text.trim().length > 0;
  });
  const clockRunning = running && !answering;
  const thinkingSeconds = useThinkingSeconds(clockRunning);
  const thinkingLabel = useThinkingLabel();
  const counted = thinkingSeconds !== undefined && thinkingSeconds >= 1;
  const elapsed = clockRunning && counted ? `${thinkingSeconds}s` : undefined;
  const thinking = thoughtStarted
    ? null
    : !clockRunning && counted
      ? <p className="thinking-settled">{`Worked for ${thinkingSeconds}s`}</p>
      : clockRunning
        ? <ThinkingIndicator className="thinking-indicator" label={thinkingLabel} elapsed={elapsed} />
        : null;
  const thoughtLabel = running
    ? thinkingLabel
    : counted
      ? reasoningArrived ? `Thought for ${thinkingSeconds}s` : `Worked for ${thinkingSeconds}s`
      : reasoningArrived ? "Thought" : "Worked";
  const groupBy = useMemo(() => groupPartByType({ reasoning: ["group-thought", "group-reasoning"], "tool-call": ["group-thought", "group-tool"] }), []);

  return (
    <MessagePrimitive.Root asChild>
      <div className={emoji === "on" ? "message-row emoji" : "message-row"}>
        {emoji === "on" && <EmojiMark role="assistant" />}
        <MessagePrimitive.Error>
          <p className="error-note"><ErrorPrimitive.Message /></p>
        </MessagePrimitive.Error>
        {thinking !== null && <div className="thinking-slot">{thinking}</div>}
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-thought":
                return (
                  <ThoughtGroup key={part.indices[0]} label={thoughtLabel} seconds={thinkingSeconds} running={running} defaultOpen={defaultOpen}>
                    {children}
                  </ThoughtGroup>
                );
              case "group-reasoning":
                return <ReasoningText className="thought-trace">{children}</ReasoningText>;
              case "group-tool":
                return <div className="thought-tools">{children}</div>;
              case "reasoning":
                return <ReasoningPart {...part} />;
              case "tool-call":
                return <ToolCallRow key={`${part.toolCallId}-${defaultOpen}`} name={part.toolName} args={part.args} argsText={part.argsText} label={callLabel(part)} result={part.result} isError={part.isError} defaultOpen={defaultOpen} />;
              case "text":
                return <AnswerText />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <div className="action-slot"><AssistantActionBar /></div>
      </div>
    </MessagePrimitive.Root>
  );
}

/** Dev Mode renders telemetry surfaces: raw trace cards, tool cards, output keys, response register. */
export function DevModeAssistantMessage({ emoji, defaultOpen }: AssistantRuntimeMessageProps): ReactNode {
  const turnStats = useTurnStats();
  const runIndex = useRunIndex();
  const link = useStepLink();
  const spans = turnStats?.spans ?? [];
  const totalMs = turnStats?.totalMs ?? 0;
  const callSpans = spans.filter((span) => span.kind === "tool");
  const longestCallMs = callSpans.reduce((longest, span) => Math.max(longest, span.ms), 0);
  const slowestCallMs = callSpans.length > 1 && isMeasurable(longestCallMs) ? longestCallMs : undefined;
  const reasoningChars = useAuiState((state) => state.message.parts.reduce((total, part) => (part.type === "reasoning" ? total + part.text.length : total), 0));
  const running = useAuiState((state) => state.message.status?.type === "running");
  const groupBy = useMemo(() => groupPartByType({ reasoning: ["group-reasoning"] }), []);

  return (
    <MessagePrimitive.Root asChild>
      <div className={emoji === "on" ? "message-row emoji" : "message-row"}>
        {emoji === "on" && <EmojiMark role="assistant" />}
        <MessagePrimitive.Error>
          <p className="error-note"><ErrorPrimitive.Message /></p>
        </MessagePrimitive.Error>
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-reasoning": {
                const streaming = running;
                const reasoningSpans = spansOf(turnStats, "reasoning");
                const reasoningKeys = spanKeys(runIndex, reasoningSpans);
                const reasoningLabelText = reasoningLabel(turnStats, reasoningChars, reasoningSpans.reduce((sum, span) => sum + span.ms, 0));
                return (
                  <ReasoningRoot key={`${part.indices[0]}-${defaultOpen}`} className={pointed("reasoning-root", reasoningKeys, link)} data-steps={reasoningKeys.length > 0 ? reasoningKeys : undefined} streaming={streaming} defaultOpen={defaultOpen}>
                    {reasoningLabelText !== undefined && <span className="row-stat">{reasoningLabelText}</span>}
                    <ReasoningTrigger className="reasoning-trigger" active={streaming} />
                    <ReasoningContent aria-busy={streaming}>
                      <ReasoningText className="reasoning-text">{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "reasoning":
                return <ReasoningPart {...part} />;
              case "tool-call":
                return <ToolCard key={`${part.toolCallId}-${defaultOpen}`} name={part.toolName} args={part.args} label={callLabel(part)} result={part.result} defaultOpen={defaultOpen} run={runIndex} span={spansOf(turnStats, "tool", part.toolCallId)[0]} totalMs={totalMs} slowestCallMs={slowestCallMs} />;
              case "text":
                return <AnswerText run={runIndex} />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <ResponseRow stats={turnStats} />
        <div className="action-slot"><AssistantActionBar /></div>
      </div>
    </MessagePrimitive.Root>
  );
}

type ThoughtGroupProps = Readonly<{
  label: string;
  seconds: number | undefined;
  running: boolean;
  defaultOpen: boolean;
  children: ReactNode;
}>;

/**
 * User Mode's middle, drawn the way Claude draws one: a single row naming what
 * the turn is doing — a verb, the running count, a chevron — that opens onto the
 * reasoning and the calls beneath it. The row is the thinking indicator the
 * sandbox already uses, so its dot, its shimmer and its count behave here exactly
 * as they do anywhere else; the disclosure is the primitive the vendored elements
 * are built on; and what opens inside is those elements themselves.
 */
function ThoughtGroup({ label, seconds, running, defaultOpen, children }: ThoughtGroupProps): ReactNode {
  const [initialOpen] = useState(defaultOpen);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  // The row rests where the sidebar puts it. A turn in flight does not open it:
  // what it is doing is on the row itself, and the reader opens it when they want
  // the detail — which is also the only thing that keeps it open afterwards.
  const open = userOpen ?? initialOpen;
  const counted = seconds !== undefined && seconds >= 1;

  return (
    <Collapsible className="thought-group" open={open} onOpenChange={setUserOpen}>
      <CollapsibleTrigger className="thought-trigger">
        <ThinkingIndicator label={label} active={running} elapsed={running && counted ? `${seconds}s` : undefined} />
        <span aria-hidden className="thought-chevron">{open ? "⌄" : "›"}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="thought-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Our adapter does not set `isError`, so an error-shaped result counts too. */

function resultFailed(result: unknown): boolean {
  return result !== null && typeof result === "object" && "error" in (result as Record<string, unknown>);
}

/**
 * The provider's own rendering of a call — the URL a browsing call is navigating, the pattern a
 * search is looking for. Only some providers send it, it is not an argument list, and a call can
 * have one while quoting no arguments at all, so it is read defensively and shown under its own
 * heading rather than standing in for the arguments.
 */
function callLabel(part: unknown): string | undefined {
  const label = (part as { label?: unknown }).label;
  return typeof label === "string" && label.length > 0 ? label : undefined;
}

/** Whether the provider quoted any arguments for this call, in either the object or string spelling. */
function hasArguments(args: unknown): boolean {
  if (args === null || args === undefined) return false;
  if (typeof args === "string") return args.length > 0 && args !== "{}";
  if (typeof args === "object") return Object.keys(args as Record<string, unknown>).length > 0;
  return true;
}

/** Claude names the work with a verb, so a turn that is only reading gets one. */
const THINKING_VERBS = ["Pondering", "Figuring", "Mulling", "Considering", "Working through"] as const;

/**
 * One verb per turn. The label changes as the turn moves through its phases, so
 * a phrase drawn fresh on every render would read as a glitch rather than as a
 * status; this one is chosen once, when the message first renders, and kept.
 */
function useThinkingVerb(): string {
  const chosen = useRef<string | null>(null);
  if (chosen.current === null) {
    chosen.current = THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)];
  }
  return chosen.current;
}

/**
 * What the turn is doing, in the words a person would use for it. A call that is
 * still running is named by its own verb form — "Searching the web for 4821" —
 * and the rest of the time the turn is thinking, which is named with a verb
 * rather than with the word "thinking".
 */
function useThinkingLabel(): string {
  const verb = useThinkingVerb();

  return useAuiState((state) => {
    if (state.message.status?.type !== "running") return verb;
    // The row names the last call the turn made, not only a running one. A call
    // that has just finished is still what the turn has been doing, so its label
    // stays until the next call replaces it rather than falling back to the verb.
    const latest = state.message.parts.filter((part) => part.type === "tool-call").at(-1);
    if (latest?.type === "tool-call") {
      // A provider's label describes the call better than arguments can when it quoted none: the
      // row reads "Navigating for “https://amazon…”" instead of naming the tool and stopping.
      const label = callLabel(latest);
      return describeStep(latest.toolName, label !== undefined ? { label } : latest.args, latest.result === undefined ? "running" : "complete");
    }
    return verb;
  });
}

/**
 * Whether the turn has anything to draw yet. The line speaks only into the gap
 * before the first reasoning part or call arrives; after that the row owns the
 * phase, and the line and its slot stand down.
 */
function useThoughtStarted(): boolean {
  return useAuiState((state) => state.message.parts.some((part) => part.type === "reasoning" || part.type === "tool-call"));
}
/**
 * What the proxy measured for this turn's parts, read off the message rather
 * than handed down: every renderer of that message then sees the same numbers.
 */
function useTurnStats(): TurnStats | undefined {
  return useAuiState((state) => turnStatsOf(state.message.metadata?.custom));
}

/**
 * Which turn this message opens, counted over the user messages — the same count
 * the runs panel lists.
 */
function useRunIndex(): number | undefined {
  return useAuiState((state) => {
    const position = state.thread.messages.findIndex((message) => message.id === state.message.id);
    if (position < 0) return undefined;
    return state.thread.messages.slice(0, position + 1).filter((message) => message.role === "user").length;
  });
}

/**
 * One clock per turn, not one per silence. A turn that reasons, calls a tool,
 * thinks again and then answers spends its whole time thinking, so the count
 * keeps climbing across the gaps and through the trace instead of restarting at
 * every one of them — the number on screen while the turn runs is the same one
 * left behind when it ends. It pauses for as long as the turn is writing its
 * answer, starts again if more work follows, and keeps its last reading rather
 * than resetting to nothing.
 */
function useThinkingSeconds(active: boolean): number | undefined {
  const [seconds, setSeconds] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    setSeconds(0);
    const id = window.setInterval(() => setSeconds(Math.round((Date.now() - start) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [active]);

  return seconds;
}

/**
 * The answer, parsed as markdown, with Dev Mode's output key on the box around it: `data-steps`
 * is how the panel finds the drawing again, and it has to sit on an element this component
 * owns — the renderer's own container is not ours to address.
 */
function AnswerText({ run }: Readonly<{ run?: number | undefined }>): ReactNode {
  const link = useStepLink();
  const key = run === undefined ? undefined : outputKey(run);

  return (
    <div className={key === undefined ? "markdown" : pointed("markdown", key, link)} data-steps={key}>
      <MarkdownText />
    </div>
  );
}

/**
 * The assistant-ui action bar: copy, rate, speak, regenerate, the more menu, and
 * the timing badge whose tooltip carries the stream's own telemetry.
 */
function AssistantActionBar(): ReactNode {
  return (
    <ActionBarPrimitive.Root className="action-bar" hideWhenRunning autohide="not-last">
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy" className="action-icon">
          <AuiIf condition={(state) => state.message.isCopied}><CheckIcon /></AuiIf>
          <AuiIf condition={(state) => !state.message.isCopied}><CopyIcon /></AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.FeedbackPositive asChild>
        <TooltipIconButton tooltip="Good response" className="action-icon"><ThumbsUpIcon /></TooltipIconButton>
      </ActionBarPrimitive.FeedbackPositive>
      <ActionBarPrimitive.FeedbackNegative asChild>
        <TooltipIconButton tooltip="Bad response" className="action-icon"><ThumbsDownIcon /></TooltipIconButton>
      </ActionBarPrimitive.FeedbackNegative>
      <ActionBarPrimitive.Speak asChild>
        <TooltipIconButton tooltip="Read aloud" className="action-icon"><Volume2Icon /></TooltipIconButton>
      </ActionBarPrimitive.Speak>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Regenerate" className="action-icon"><RefreshCwIcon /></TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton tooltip="More actions" className="action-icon"><EllipsisIcon /></TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content className="action-menu" side="bottom" align="start">
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="action-menu-item"><DownloadIcon />Export as Markdown</ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
      <MessageTiming className="action-timing" side="bottom" />
    </ActionBarPrimitive.Root>
  );
}


/**
 * Thinking arrives as one growing string, so the newest words are the only thing
 * that moves — and, on this wire, as one part for the whole turn however many
 * windows it ran in. The windows are therefore drawn from the trace's own
 * coordinates: every stretch the proxy filed with a window carries that window's
 * key, which is what lets a row in the panel point at the exact thinking it
 * measured. Words no window claims stay unmarked rather than being quietly
 * attached to one they did not belong to.
 *
 * Splitting on whitespace re-emits the provider's own line breaks, which is what
 * lets a long trace read as steps rather than a wall.
 */
const ReasoningPart: ReasoningMessagePartComponent = ({ text }) => {
  const turnStats = useTurnStats();
  const runIndex = useRunIndex();
  const link = useStepLink();

  const windows = useMemo(() => {
    const found: { key?: string; text: string }[] = [];
    let cursor = 0;
    for (const span of spansOf(turnStats, "reasoning")) {
      const from = span.textFrom ?? cursor;
      const to = span.textTo ?? from;
      if (from > cursor) found.push({ text: text.slice(cursor, from) });
      if (to > from) found.push({ key: spanKey(runIndex, span), text: text.slice(from, to) });
      cursor = Math.max(cursor, to);
    }
    if (cursor < text.length) found.push({ text: text.slice(cursor) });
    return found;
  }, [text, turnStats, runIndex]);

  return (
    <p className="reasoning-line">
      {windows.map((window, index) => (
        <span key={index} className={pointed("reasoning-window", window.key ?? "", link)} data-steps={window.key}>
          {window.text.split(/(\s+)/).map((token, position) => (
            token.trim().length === 0 ? token : <span className="reasoning-word" key={position}>{token}</span>
          ))}
        </span>
      ))}
    </p>
  );
};

function ToolCard({ name, args, label, result, defaultOpen, run, span, totalMs, slowestCallMs }: ToolCardProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const link = useStepLink();
  // A call with no result has not settled, and the check and the duration belong to a call that
  // is over: a provider that names a call before running it would otherwise be shown as finished
  // the moment it was asked for. This is the signal the User Mode rows already read, so both
  // readings of one turn agree about which calls are still out.
  const running = result === undefined;
  const slow = !running && span !== undefined && slowestCallMs !== undefined && isStandout(span.ms, slowestCallMs);
  const keys = span !== undefined ? spanKey(run, span) : "";
  // One decimal is what these readings measure to, so a window under it is said as 0.1s rather
  // than left blank — the panel beside the chat floors the same figure the same way, because a
  // card with no duration beside all the ones that have one reads as a call that failed.
  const lasted = span !== undefined ? Math.max(span.ms, MIN_READING_MS) : undefined;
  // What the provider says the call is for, what it was called with, and what came back. A call
  // whose arguments nobody quoted says so: an empty object reads as an empty call, and that
  // distinction is the whole reason this line exists.
  const detail = [
    ...(label !== undefined ? [`Request\n${label}`] : []),
    `Arguments\n${hasArguments(args) ? JSON.stringify(args, null, 2) : "none quoted"}`,
    `Result\n${running ? "not returned yet" : JSON.stringify(result, null, 2)}`,
  ].join("\n\n");

  return (
    <div className={pointed("part-card", keys, link)} data-steps={keys.length > 0 ? keys : undefined}>
      <button className="part-head" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {running
          ? <span className="part-running">Running tool <strong>{name}</strong></span>
          : <span>✓ Used tool <strong>{name}</strong></span>}
        {!running && lasted !== undefined && (
          <span className={slow ? "row-stat slow" : "row-stat"} title={`${formatSpan(lasted)} of the ${formatSpan(totalMs)} the turn spent working`}>
            {formatSpan(lasted)}
          </span>
        )}
        <span className="part-chevron">{open ? "⌄" : "›"}</span>
      </button>
      {open && <div className="part-detail">{detail}</div>}
    </div>
  );
}

/**
 * The reasoning row's numbers: how much it thought, and how long it spent doing
 * it across every window it ran in. Without a provider split there is no thinking
 * count — the completion total covers the answer as well — so the count falls
 * back to a characters-over-four estimate and says so.
 */
function reasoningLabel(stats: TurnStats | undefined, chars: number, ms: number): string | undefined {
  const measured = stats?.usage?.reasoningTokens;
  const estimated = measured === undefined && chars > 0 ? Math.ceil(chars / 4) : undefined;
  const tokens = measured ?? estimated;
  if (tokens === undefined) return isMeasurable(ms) ? formatSpan(ms) : undefined;
  // With nothing measurable the count still stands on its own: a length under
  // the resolution would print as "0.0s", which the wire never gave.
  const time = isMeasurable(ms) ? ` · ${formatSpan(ms)}` : "";
  return `${estimated !== undefined ? "≈" : ""}${formatTokens(tokens)} tok${time}${estimated !== undefined ? " est." : ""}`;
}

/**
 * The answer's own line: what the writing cost and how long it took. The answer
 * is the turn's output rather than a step of it, so it closes the message instead
 * of joining the rows — and it is the same figure the runs panel reports.
 */
function ResponseRow({ stats }: Readonly<{ stats: TurnStats | undefined }>): ReactNode {
  const ms = stats?.answerMs;
  const tokens = stats?.usage?.completionTokens;
  if (tokens === undefined && !isMeasurable(ms ?? 0)) return null;

  return (
    <p className="response-row">
      <span>{tokens !== undefined ? `Response · ${formatTokens(tokens)} tok` : "Response"}</span>
      {isMeasurable(ms ?? 0) && <span className="response-ms">{formatSpan(ms ?? 0)}</span>}
    </p>
  );
}

/**
 * The same call, handed to assistant-ui's tool-call element: a chevron, the step
 * in plain language, its primary argument as a chip, a checkmark once it settles,
 * and the raw request and result behind the disclosure. The labels come from the
 * vocabulary the humanized steps use, so the two readings agree.
 */
function ToolCallRow({ name, args, argsText, label, result, isError, defaultOpen }: ToolCallRowProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const failed = isError === true || resultFailed(result);
  // A call that quoted no arguments is still described by what the provider said it is for: when
  // the label is the only thing naming the work, the sentence and its chip read from it.
  const described = label !== undefined && !hasArguments(args) ? { label } : args;

  return (
    <ToolCall
      className="tool-call"
      label={describeStep(name, described, failed ? "failed" : "complete")}
      activeLabel={describeStep(name, described, "running")}
      query={chipOf(described)}
      request={label ?? (argsText !== undefined && argsText.length > 0 ? argsText : JSON.stringify(args ?? {}, null, 2))}
      result={describeResult(result)}
      running={result === undefined}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
