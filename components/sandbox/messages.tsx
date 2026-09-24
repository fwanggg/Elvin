"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, EllipsisIcon, RefreshCwIcon, ThumbsDownIcon, ThumbsUpIcon, Volume2Icon } from "lucide-react";
import { MessageTiming } from "@/components/assistant-ui/elements/message-timing.aui";
import { ReasoningContent, ReasoningRoot, ReasoningText, ReasoningTrigger } from "@/components/assistant-ui/elements/reasoning";
import { StreamingText, type Segment } from "@/components/assistant-ui/elements/streaming-text";
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator";
import { ToolCall } from "@/components/assistant-ui/elements/tool-call";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { ShimmerLabel } from "@/components/assistant-ui/elements/surfaces";
import { chipOf, describeResult, describeStep, type StepPhase } from "@/lib/step-labels";
import { type PartMode, type StepsMode, type Toggle, type ToolsMode } from "@/components/sandbox/knobs";
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
  toolsMode: ToolsMode;
  reasoningMode: PartMode;
  stepsMode: StepsMode;
  emoji: Toggle;
  defaultOpen: boolean;
  softStream: Toggle;
  responseStatus: Toggle;
}>;

type DisclosureProps = Readonly<{
  defaultOpen: boolean;
  children: ReactNode;
}>;

type ToolCardProps = Readonly<{
  name: string;
  args: unknown;
  result: unknown;
  defaultOpen: boolean;
}>;
type ToolCallRowProps = Readonly<{
  name: string;
  args: unknown;
  argsText: string | undefined;
  result: unknown;
  isError?: boolean;
  defaultOpen: boolean;
}>;

type StepLineProps = Readonly<{
  name: string;
  args: unknown;
  result: unknown;
  isError?: boolean;
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

export function AssistantRuntimeMessage({ toolsMode, reasoningMode, stepsMode, emoji, defaultOpen, softStream, responseStatus }: AssistantRuntimeMessageProps): ReactNode {
  const humanized = stepsMode === "humanized";
  const stepsShown = humanized && toolsMode === "shown";
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
  const thinkingLabel = useThinkingLabel(stepsShown);
  const elapsed = clockRunning && thinkingSeconds !== undefined && thinkingSeconds >= 1 ? `${thinkingSeconds}s` : undefined;
  // The reading the clock took, put in the place the live line took: once the
  // clock stops, the two swap in place rather than one leaving and the other
  // arriving somewhere else. Humanized mode shows its own step summary instead.
  const reading = !humanized && !clockRunning && thinkingSeconds !== undefined && thinkingSeconds >= 1;
  const thinking = reading
    ? <p className="thinking-settled">Thought for {thinkingSeconds}s</p>
    : clockRunning && thinkingLabel !== undefined
      ? <ThinkingIndicator className="thinking-indicator" label={thinkingLabel} elapsed={elapsed} />
      : null;
  // Humanized mode puts reasoning and tool calls in one group, so the middle of
  // the turn collapses into a single block of plain-language steps.
  const groupBy = useMemo(() => groupPartByType({
    ...(reasoningMode === "shown" ? { reasoning: humanized ? ["group-steps", "group-reasoning"] : ["group-reasoning"] } : {}),
    ...(stepsShown ? { "tool-call": ["group-steps", "group-tool"] } : {}),
  }), [humanized, reasoningMode, stepsShown]);

  return (
    <MessagePrimitive.Root asChild>
      <div className={emoji === "on" ? "message-row emoji" : "message-row"}>
        {emoji === "on" && <EmojiMark role="assistant" />}
        <MessagePrimitive.Error>
          <p className="error-note"><ErrorPrimitive.Message /></p>
        </MessagePrimitive.Error>
        {/* The line names the phase that comes first in a turn, so it opens the
            message and stays there: the trace, the tool cards and the answer all
            stream in below it, nothing is ever inserted over it, and the reading
            it settles into takes the place the live line took. The slot holds its
            height for as long as the turn runs, so the label changing state in it
            cannot move the conversation either. */}
        {(thinking !== null || (running && !humanized)) && <div className="thinking-slot">{thinking}</div>}
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-steps":
                return <StepList key={`steps-${part.indices[0]}-${defaultOpen}`} defaultOpen={defaultOpen}>{children}</StepList>;
              case "group-reasoning": {
                if (humanized) return <div className="steps-reasoning" key={`reasoning-${part.indices[0]}`}>{children}</div>;
                // The element holds itself open as a live, bottom-pinned preview
                // while the trace streams — its trigger shimmers for exactly that
                // window — then settles to the state the sidebar asks for.
                const streaming = part.status.type === "running" || (running && !answering);
                return (
                  <ReasoningRoot key={`${part.indices[0]}-${defaultOpen}`} className="reasoning-root" streaming={streaming} defaultOpen={defaultOpen}>
                    <ReasoningTrigger className="reasoning-trigger" active={streaming} />
                    <ReasoningContent aria-busy={streaming}>
                      <ReasoningText className="reasoning-text">{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "group-tool":
                return <div className="steps-list" key={`tools-${part.indices[0]}`}>{children}</div>;
              case "reasoning":
                return reasoningMode === "shown" ? <ReasoningPart {...part} /> : <></>;
              case "tool-call":
                if (toolsMode === "off") return <></>;
                if (toolsMode === "humanized") return <ToolCallRow key={`${part.toolCallId}-${defaultOpen}`} name={part.toolName} args={part.args} argsText={part.argsText} result={part.result} isError={part.isError} defaultOpen={defaultOpen} />;
                return humanized
                  ? <StepLine key={part.toolCallId} name={part.toolName} args={part.args} result={part.result} isError={part.isError} />
                  : <ToolCard key={`${part.toolCallId}-${defaultOpen}`} name={part.toolName} args={part.args} result={part.result} defaultOpen={defaultOpen} />;
              case "text":
                return softStream === "on"
                  ? <StreamingTextPart type="text" text={part.text} status={part.status} />
                  : <div className="assistant-text">{part.text}</div>;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        {/* The action bar unmounts itself while the message is not hovered, so
            its height is reserved here — the same reason the thinking label has
            a slot. Without it, hovering a message shifts everything below it. */}
        {responseStatus === "on" && <div className="action-slot"><AssistantActionBar /></div>}
      </div>
    </MessagePrimitive.Root>
  );
}

/**
 * The disciplined middle of a turn: one quiet line naming the work in flight,
 * opening onto the steps themselves when asked for.
 */
function StepList({ defaultOpen, children }: DisclosureProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const summary = useStepsSummary();
  const running = useAuiState((state) => state.message.status?.type === "running");

  return (
    <div className="steps">
      <button className="steps-head" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {/* Keyed on the text, so every change replays the shimmer the way
            the element's own trigger does rather than hard-swapping. */}
        <ShimmerLabel key={summary} active={running} className="steps-summary">{summary}</ShimmerLabel>
        <span aria-hidden="true" style={{ marginLeft: "auto" }}>{open ? "⌄" : "›"}</span>
      </button>
      {open && <div className="steps-body">{children}</div>}
    </div>
  );
}

/** Our adapter does not set `isError`, so an error-shaped result counts too. */
function resultFailed(result: unknown): boolean {
  return result !== null && typeof result === "object" && "error" in (result as Record<string, unknown>);
}

/** One tool call in plain language: no arguments, no payload. */
function StepLine({ name, args, result, isError }: StepLineProps): ReactNode {
  const running = useAuiState((state) => state.message.status?.type === "running");
  const failed = isError === true || resultFailed(result);
  const phase: StepPhase = failed ? "failed" : running && result === undefined ? "running" : "complete";

  return (
    <p className="step" data-phase={phase}>
      <span className="step-mark" aria-hidden="true" />
      <span>{describeStep(name, args, phase)}</span>
    </p>
  );
}

/** The work in flight, or a count of it once the turn settles. */
function useStepsSummary(): string {
  return useAuiState((state) => {
    const calls = state.message.parts.filter((part) => part.type === "tool-call");

    if (state.message.status?.type === "running") {
      const pending = calls.find((part) => part.result === undefined);
      return pending?.type === "tool-call" ? describeStep(pending.toolName, pending.args, "running") : "Thinking";
    }
    if (calls.length === 0) return "Thought";
    return calls.length === 1 ? "1 step" : `${calls.length} steps`;
  });
}

/**
 * Names what the turn is doing from the moment it starts, and keeps naming it:
 * the line is not a gap filler, so a running trace does not silence it and the
 * callers decide when it hands over to the reading it leaves behind.
 */
function useThinkingLabel(stepListShows: boolean): string | undefined {
  return useAuiState((state) => {
    if (stepListShows) return undefined;
    if (state.message.status?.type !== "running") return undefined;
    const parts = state.message.parts;
    const pending = parts.find((part) => part.type === "tool-call" && part.result === undefined);
    if (pending?.type === "tool-call") return `Running ${pending.toolName}`;
    return "Thinking";
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

function ToolCard({ name, args, result, defaultOpen }: ToolCardProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="part-card">
      <button className="part-head" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span>✓ Used tool <strong>{name}</strong></span><span style={{ marginLeft: "auto" }}>{open ? "⌄" : "›"}</span></button>
      {open && <div className="part-detail">{`Arguments\n${JSON.stringify(args ?? {}, null, 2)}\n\nResult\n${JSON.stringify(result ?? {}, null, 2)}`}</div>}
    </div>
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
