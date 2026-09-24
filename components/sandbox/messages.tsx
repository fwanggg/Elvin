"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, EllipsisIcon, RefreshCwIcon, ThumbsDownIcon, ThumbsUpIcon, Volume2Icon } from "lucide-react";
import { MessageTiming } from "@/components/assistant-ui/elements/message-timing.aui";
import { ReasoningContent, ReasoningRoot, ReasoningText, ReasoningTrigger } from "@/components/assistant-ui/elements/reasoning";
import { StreamingText, type Segment } from "@/components/assistant-ui/elements/streaming-text";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator";
import { ToolCall } from "@/components/assistant-ui/elements/tool-call";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { chipOf, describeResult, describeStep } from "@/lib/step-labels";
import { formatSpan, formatTokens, isMeasurable, spansOf, turnStatsOf, type TurnStats, type TurnSpan } from "@/lib/turn-stats";
import { type Toggle, type ViewMode } from "@/components/sandbox/knobs";
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
  viewMode: ViewMode;
  emoji: Toggle;
  defaultOpen: boolean;
}>;

type ToolCardProps = Readonly<{
  name: string;
  args: unknown;
  result: unknown;
  defaultOpen: boolean;
  /** This call's window on the turn's timeline, when the proxy measured one. */
  span?: TurnSpan;
  /** The window the rows are laid out against. */
  totalMs: number;
  /** The longest window of the turn, which takes the accent. */
  slowestMs?: number;
}>;
type ToolCallRowProps = Readonly<{
  name: string;
  args: unknown;
  argsText: string | undefined;
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

export function UserRuntimeMessage({ emoji }: Readonly<{ emoji: Toggle }>): ReactNode {
  return (
    <MessagePrimitive.Root className={emoji === "on" ? "user-bubble emoji" : "user-bubble"}>
      {emoji === "on" && <EmojiMark role="user" />}
      <MessagePrimitive.Parts>
        {({ part }) => part.type === "text" ? part.text : null}
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  );
}

export function AssistantRuntimeMessage({ viewMode, emoji, defaultOpen }: AssistantRuntimeMessageProps): ReactNode {
  // Most agents run tools and answer without ever streaming their thinking, so
  // the line may only claim the work: "Thought for 40s" would be a claim about
  // a trace that never arrived.
  const reasoningArrived = useAuiState((state) => state.message.parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0));
  const thoughtStarted = useThoughtStarted();
  const turnStats = useTurnStats();
  const spans = turnStats?.spans ?? [];
  const totalMs = turnStats?.totalMs ?? 0;
  // One long window among several is the shape of a turn that waited on
  // something; alone, or with nothing measurable in it, marking says nothing.
  const longestMs = spans.reduce((longest, span) => Math.max(longest, span.ms), 0);
  const slowestMs = spans.length > 1 && isMeasurable(longestMs) ? longestMs : undefined;
  // Only the fallback path needs this: a provider that reports no usage leaves
  // the estimate as the only reading of how much thinking there was.
  const reasoningChars = useAuiState((state) => state.message.parts.reduce((total, part) => (part.type === "reasoning" ? total + part.text.length : total), 0));
  const running = useAuiState((state) => state.message.status?.type === "running");
  // The turn is answering while the newest part is text. A tool call that lands
  // after some text ends that, so the clock starts again rather than falling
  // silent for the rest of the turn.
  const answering = useAuiState((state) => {
    const last = state.message.parts.at(-1);
    return last?.type === "text" && last.text.trim().length > 0;
  });
  const clockRunning = running && !answering;
  const thinkingSeconds = useThinkingSeconds(clockRunning);
  const thinkingLabel = useThinkingLabel(viewMode);
  const counted = thinkingSeconds !== undefined && thinkingSeconds >= 1;
  const elapsed = clockRunning && counted ? `${thinkingSeconds}s` : undefined;
  // The line speaks into the gap before anything has arrived to draw. Once a
  // reasoning part or a call exists, User Mode's own row carries the phase and
  // Dev Mode's box and cards always do, so the line has nothing left to say; and
  // a turn that ends inside that gap hands over to the reading it took.
  const thinking = thoughtStarted
    ? null
    : !clockRunning && counted
      ? <p className="thinking-settled">{`Worked for ${thinkingSeconds}s`}</p>
      : clockRunning && thinkingLabel !== undefined
        ? <ThinkingIndicator className="thinking-indicator" label={thinkingLabel} elapsed={elapsed} />
        : null;
  // What the row says. While the turn works it names the phase — "Searching the
  // web for 4821", or the verb for a turn that is only reading; once it settles
  // the number takes over, and it claims a trace only when one actually arrived.
  const thoughtLabel = running && thinkingLabel !== undefined
    ? thinkingLabel
    : counted
      ? reasoningArrived ? `Thought for ${thinkingSeconds}s` : `Worked for ${thinkingSeconds}s`
      : reasoningArrived ? "Thought" : "Worked";
  // The middle of a turn is one group either way, but only User Mode folds all of
  // it together: there the trace and the calls open under a single row. Dev Mode
  // groups the trace alone and leaves every call its own card.
  const groupBy = useMemo(() => (viewMode === "user"
    ? groupPartByType({ reasoning: ["group-thought", "group-reasoning"], "tool-call": ["group-thought", "group-tool"] })
    : groupPartByType({ reasoning: ["group-reasoning"] })), [viewMode]);

  return (
    <MessagePrimitive.Root asChild>
      <div className={emoji === "on" ? "message-row emoji" : "message-row"}>
        {emoji === "on" && <EmojiMark role="assistant" />}
        <MessagePrimitive.Error>
          <p className="error-note"><ErrorPrimitive.Message /></p>
        </MessagePrimitive.Error>
        {/* The line belongs to User Mode. There it names the phase that comes
            first in a turn, so it opens the message and stays there: the trace,
            the tool cards and the answer all stream in below it, nothing is ever
            inserted over it, and the reading it settles into takes the place the
            live line took. The slot holds its height for as long as the turn
            runs, so the label changing state in it cannot move the conversation
            either. Dev Mode draws the agent's own shapes and leaves the phase to
            them: its reasoning box shimmers for the window the line would have
            named, and its tool cards name their calls. So the line — and the
            slot it was holding open — do not render there at all. */}
        {viewMode === "user" && thinking !== null && <div className="thinking-slot">{thinking}</div>}
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              // User Mode's middle: the trace and the calls, folded under one row
              // that names the phase — the way Claude shows a turn at work.
              case "group-thought":
                return (
                  <ThoughtGroup key={part.indices[0]} label={thoughtLabel} seconds={thinkingSeconds} running={running} defaultOpen={defaultOpen}>
                    {children}
                  </ThoughtGroup>
                );
              case "group-reasoning": {
                // The trace itself. Dev Mode draws the element as it ships — the
                // brain, the word "Reasoning", the outline it carries — with its
                // parts as children. User Mode hands the same parts to the
                // element's text renderer, so the trace reads as prose rather
                // than as a panel of steps.
                if (viewMode === "user") {
                  return <ReasoningText className="thought-trace">{children}</ReasoningText>;
                }
                const streaming = part.status.type === "running";
                // The model thinks between calls as well as before them, so this
                // row draws every window reasoning ran, not just the first.
                const reasoningSpans = spansOf(turnStats, "reasoning");
                const reasoningLabelText = reasoningLabel(turnStats, reasoningChars, reasoningSpans.reduce((sum, span) => sum + span.ms, 0));
                return (
                  <ReasoningRoot key={`${part.indices[0]}-${defaultOpen}`} className="reasoning-root" streaming={streaming} defaultOpen={defaultOpen}>
                    <Timeline spans={reasoningSpans} totalMs={totalMs} slowestMs={slowestMs} />
                    {reasoningLabelText !== undefined && <span className="row-stat">{reasoningLabelText}</span>}
                    <ReasoningTrigger className="reasoning-trigger" active={streaming} />
                    <ReasoningContent aria-busy={streaming}>
                      <ReasoningText className="reasoning-text">{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              // The calls a turn made on its way to the answer, under the trace
              // they came from. Each row is the tool-call element, so it opens
              // onto the same request and result the humanized step does.
              case "group-tool":
                return <div className="thought-tools">{children}</div>;
              case "reasoning":
                return <ReasoningPart {...part} />;
              // Every call renders inline here: the sandbox registers no tool UIs, so
              // there is nothing for the primitive's "standalone-tool-call" group key
              // to lift out of the trace — nor for a tool's `display: "standalone"`,
              // which reaches groupBy through its GroupByContext. That is the knob to
              // reach for the first time a call has to stand on its own, an approval
              // prompt say, instead of folding into the run of steps.
              case "tool-call":
                if (viewMode === "user") return <ToolCallRow key={`${part.toolCallId}-${defaultOpen}`} name={part.toolName} args={part.args} argsText={part.argsText} result={part.result} isError={part.isError} defaultOpen={defaultOpen} />;
                return <ToolCard key={`${part.toolCallId}-${defaultOpen}`} name={part.toolName} args={part.args} result={part.result} defaultOpen={defaultOpen} span={spansOf(turnStats, "tool", part.toolCallId)[0]} totalMs={totalMs} slowestMs={slowestMs} />;
              case "text":
                return <StreamingTextPart type="text" text={part.text} status={part.status} />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        {/* The turn's own ledger: how many steps it took, what it thought, and how
            long the whole stretch ran. Dev Mode's register, so User Mode, which
            writes the middle as prose, keeps it off. */}
        {viewMode === "dev" && <TurnSummary stats={turnStats} />}
        {/* The action bar unmounts itself while the message is not hovered, so
            its height is reserved here — the same reason the thinking label has
            a slot. Without it, hovering a message shifts everything below it. */}
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
 * rather than with the word "thinking". Dev Mode says none of this: its box and
 * its cards already carry the phase, so a label here would only repeat them.
 */
function useThinkingLabel(viewMode: ViewMode): string | undefined {
  const verb = useThinkingVerb();

  return useAuiState((state) => {
    if (viewMode !== "user") return undefined;
    if (state.message.status?.type !== "running") return undefined;
    // The row names the last call the turn made, not only a running one. A call
    // that has just finished is still what the turn has been doing, so its label
    // stays until the next call replaces it rather than falling back to the verb.
    const latest = state.message.parts.filter((part) => part.type === "tool-call").at(-1);
    if (latest?.type === "tool-call") {
      return describeStep(latest.toolName, latest.args, latest.result === undefined ? "running" : "complete");
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
 * Soft streaming: the same text the plain renderer shows, handed to the
 * assistant-ui element so the newest words land tinted and settle into ink.
 */
const StreamingTextPart: TextMessagePartComponent = ({ text, status }) => {
  const segments = useMemo<Segment[]>(() => [{ text }], [text]);
  const count = useMemo(() => text.split(" ").length, [text]);

  return <StreamingText className="assistant-text streaming-text" segments={segments} count={count} streaming={status.type === "running"} />;
};

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
 * Reasoning arrives as one growing string, so the newest words are the only
 * thing that moves. Splitting on whitespace re-emits the provider's own line
 * breaks, which is what lets a long trace read as steps rather than a wall.
 */
const ReasoningPart: ReasoningMessagePartComponent = ({ text }) => {
  const tokens = useMemo(() => text.split(/(\s+)/), [text]);

  return (
    <p className="reasoning-line">
      {tokens.map((token, index) => (
        token.trim().length === 0 ? token : <span className="reasoning-word" key={index}>{token}</span>
      ))}
    </p>
  );
};

function ToolCard({ name, args, result, defaultOpen, span, totalMs, slowestMs }: ToolCardProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="part-card">
      <Timeline spans={span ? [span] : []} totalMs={totalMs} slowestMs={slowestMs} />
      <button className="part-head" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>✓ Used tool <strong>{name}</strong></span>
        {span && isMeasurable(span.ms) && (
          <span className={span.ms === slowestMs ? "row-stat slow" : "row-stat"} title={`${formatSpan(span.ms)} of the turn's ${formatSpan(totalMs)}`}>
            {formatSpan(span.ms)}
          </span>
        )}
        <span className="part-chevron">{open ? "⌄" : "›"}</span>
      </button>
      {open && <div className="part-detail">{`Arguments\n${JSON.stringify(args ?? {}, null, 2)}\n\nResult\n${JSON.stringify(result ?? {}, null, 2)}`}</div>}
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
 * The turn's clock, drawn behind a row: one fill per window, placed by when it
 * started and sized by how long it ran. The longest window of the turn takes the
 * accent, so the step that dominated the wait is the one that reads red.
 */
function Timeline({ spans, totalMs, slowestMs }: Readonly<{ spans: readonly TurnSpan[]; totalMs: number; slowestMs?: number }>): ReactNode {
  // A window whose ends landed in one frame has no width to draw; it stays in
  // the data, where its tokens and its place in the order still count.
  const drawable = spans.filter((span) => isMeasurable(span.ms));
  if (drawable.length === 0 || totalMs <= 0) return null;
  return (
    <span className="timeline" aria-hidden="true">
      {drawable.map((span, index) => (
        <span
          key={index}
          className={slowestMs !== undefined && span.ms === slowestMs ? "slowest" : undefined}
          style={{ left: `${(span.startMs / totalMs) * 100}%`, width: `${(span.ms / totalMs) * 100}%` }}
        />
      ))}
    </span>
  );
}

/**
 * The turn, totalled: the steps it took, what it thought, and how long the whole
 * stretch ran. The step count is what the reader is looking at — one row for
 * reasoning however many windows it resumed in, then one row per call.
 */
function TurnSummary({ stats }: Readonly<{ stats: TurnStats | undefined }>): ReactNode {
  const spans = stats?.spans ?? [];
  if (spans.length === 0) return null;
  const calls = spans.filter((span) => span.kind === "tool").length;
  const steps = calls + (spans.some((span) => span.kind === "reasoning") ? 1 : 0);
  const tokens = stats?.usage?.reasoningTokens;
  // A turn whose parts all arrived in one frame has no measured length; the
  // steps and the count still stand, and the total is simply not claimed.
  const totalMs = stats?.totalMs ?? 0;

  return (
    <p className="turn-summary">
      <span>{steps} {steps === 1 ? "step" : "steps"}</span>
      {tokens !== undefined && <span>{formatTokens(tokens)} reasoning tok</span>}
      {isMeasurable(totalMs) && <span><strong>{formatSpan(totalMs)}</strong> total</span>}
    </p>
  );
}

/**
 * The same call, handed to assistant-ui's tool-call element: a chevron, the step
 * in plain language, its primary argument as a chip, a checkmark once it settles,
 * and the raw request and result behind the disclosure. The labels come from the
 * vocabulary the humanized steps use, so the two readings agree.
 */
function ToolCallRow({ name, args, argsText, result, isError, defaultOpen }: ToolCallRowProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const failed = isError === true || resultFailed(result);

  return (
    <ToolCall
      className="tool-call"
      label={describeStep(name, args, failed ? "failed" : "complete")}
      activeLabel={describeStep(name, args, "running")}
      query={chipOf(args)}
      request={argsText !== undefined && argsText.length > 0 ? argsText : JSON.stringify(args ?? {}, null, 2)}
      result={describeResult(result)}
      running={result === undefined}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
