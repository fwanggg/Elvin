"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, EllipsisIcon, RefreshCwIcon, ThumbsDownIcon, ThumbsUpIcon, Volume2Icon } from "lucide-react";
import { MessageTiming } from "@/components/assistant-ui/elements/message-timing.aui";
import { ReasoningPanel, type ReasoningStep } from "@/components/assistant-ui/elements/reasoning-panel";
import { StreamingText, type Segment } from "@/components/assistant-ui/elements/streaming-text";
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator";
import { ToolCall } from "@/components/assistant-ui/elements/tool-call";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { chipOf, describeResult, describeStep } from "@/lib/step-labels";
import { type PartMode, type Toggle, type ToolsMode } from "@/components/sandbox/knobs";
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
  emoji: Toggle;
  defaultOpen: boolean;
  softStream: Toggle;
  responseStatus: Toggle;
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

export function AssistantRuntimeMessage({ toolsMode, reasoningMode, emoji, defaultOpen, softStream, responseStatus }: AssistantRuntimeMessageProps): ReactNode {
  const reasoningShown = reasoningMode === "shown";
  // Most agents run tools and answer without ever streaming their thinking, so
  // the line may only claim the work: "Thought for 40s" would be a claim about
  // a trace that never arrived.
  const reasoningArrived = useAuiState((state) => state.message.parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0));
  const running = useAuiState((state) => state.message.status?.type === "running");
  // The turn is answering while the newest part is text. A tool call that lands
  // after some text ends that, so the clock starts again rather than falling
  // silent for the rest of the turn.
  const answering = useAuiState((state) => {
    const last = state.message.parts.at(-1);
    return last?.type === "text" && last.text.trim().length > 0;
  });
  const clockRunning = running && !answering;
  const thinkingSeconds = useThinkingSeconds(clockRunning && reasoningShown);
  const thinkingLabel = useThinkingLabel(reasoningShown);
  // The badge stands down with the label, and for the same reason: while a trace
  // is on screen the panel's trigger is already carrying the clock, and two 8s
  // side by side say nothing the one of them does not. What the line keeps is the
  // fact the panel cannot state — which tool the turn is waiting on.
  const elapsed = clockRunning && !reasoningArrived && thinkingSeconds !== undefined && thinkingSeconds >= 1 ? `${thinkingSeconds}s` : undefined;
  // The reading the clock took, put in the place the live line took: once the
  // clock stops, the two swap in place rather than one leaving and the other
  // arriving somewhere else. It is for the turn the panel cannot speak for,
  // though — a trace that arrived rests on its own label inside the panel — so
  // the line only ever hands over to "Worked for …".
  const reading = reasoningShown && !reasoningArrived && !clockRunning && thinkingSeconds !== undefined && thinkingSeconds >= 1;
  const thinking = reading
    ? <p className="thinking-settled">{`Worked for ${thinkingSeconds}s`}</p>
    : clockRunning && thinkingLabel !== undefined
      ? <ThinkingIndicator className="thinking-indicator" label={thinkingLabel} elapsed={elapsed} />
      : null;
  // The trace is one group however it runs, so a turn that reasons either side of
  // a tool call still reads as a single disclosure.
  const groupBy = useMemo(() => groupPartByType(
    reasoningMode === "shown" ? { reasoning: ["group-reasoning"] } : {},
  ), [reasoningMode]);

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
        {(thinking !== null || (running && reasoningShown)) && <div className="thinking-slot">{thinking}</div>}
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part }) => {
            switch (part.type) {
              case "group-reasoning":
                // The panel element draws the whole disclosure: its trigger is
                // the live line, a shimmering "Thinking" carrying the running
                // clock, settling onto the reading the clock took, and the trace
                // opens underneath it as a step list. Its parts are read inside
                // rather than rendered as children — the panel is props-driven.
                return (
                  <ReasoningSteps
                    key={`${part.indices[0]}-${defaultOpen}`}
                    indices={part.indices}
                    streaming={part.status.type === "running"}
                    defaultOpen={defaultOpen}
                    seconds={thinkingSeconds}
                  />
                );
              case "reasoning":
                return reasoningMode === "shown" ? <ReasoningPart {...part} /> : <></>;
              // Every call renders inline here: the sandbox registers no tool UIs, so
              // there is nothing for the primitive's "standalone-tool-call" group key
              // to lift out of the trace — nor for a tool's `display: "standalone"`,
              // which reaches groupBy through its GroupByContext. That is the knob to
              // reach for the first time a call has to stand on its own, an approval
              // prompt say, instead of folding into the run of steps.
              case "tool-call":
                if (toolsMode === "off") return <></>;
                if (toolsMode === "humanized") return <ToolCallRow key={`${part.toolCallId}-${defaultOpen}`} name={part.toolName} args={part.args} argsText={part.argsText} result={part.result} isError={part.isError} defaultOpen={defaultOpen} />;
                return <ToolCard key={`${part.toolCallId}-${defaultOpen}`} name={part.toolName} args={part.args} result={part.result} defaultOpen={defaultOpen} />;
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

type ReasoningStepsProps = {
  indices: readonly number[];
  streaming: boolean;
  defaultOpen: boolean;
  /** The turn clock's reading, so the trigger can rest on the number it took. */
  seconds: number | undefined;
};

/**
 * The reasoning panel, fed from the message's own parts. The element is
 * props-driven, so the trace is read here instead of rendered as children: one
 * step for the group, since a provider in this testbed streams its thinking as a
 * single growing string, titled the way the element's docs fall back when no
 * summary is shipped. While the turn runs the trigger shimmers with the live
 * clock; once it settles it rests on the reading, so the number on screen during
 * the turn is the one left behind after it.
 */
function ReasoningSteps({ indices, streaming, defaultOpen, seconds }: ReasoningStepsProps): ReactNode {
  const trace = useAuiState((state) => {
    const part = state.message.parts[indices[0]];
    return part?.type === "reasoning" ? part.text : "";
  });
  const summary = useAuiState((state) => {
    const part = state.message.parts[indices[0]];
    return part?.type === "reasoning" ? part.unstable_summary ?? "" : "";
  });
  const steps = useMemo<ReasoningStep[]>(
    () => (trace.trim().length > 0 ? [{ title: summary || "Thinking", body: trace }] : []),
    [summary, trace],
  );
  const [initialOpen] = useState(defaultOpen);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (streaming || initialOpen);
  const counted = seconds !== undefined && seconds >= 1;

  return (
    <ReasoningPanel
      className="reasoning-panel"
      steps={steps}
      visibleSteps={steps.length}
      streaming={streaming}
      open={open}
      onOpenChange={setUserOpen}
      restingLabel={counted ? `Thought for ${seconds}s` : "Thought"}
      elapsed={streaming && counted ? `${seconds}s` : undefined}
    />
  );
}

/** Our adapter does not set `isError`, so an error-shaped result counts too. */

function resultFailed(result: unknown): boolean {
  return result !== null && typeof result === "object" && "error" in (result as Record<string, unknown>);
}

/**
 * Names what the turn is doing from the moment it starts, and keeps naming it:
 * the line is not a gap filler, so a tool still running keeps it on screen even
 * once a trace has arrived. The trace is the reasoning panel's own trigger,
 * though, so the line leaves that window to it rather than saying "Thinking"
 * twice, and the callers decide when it hands over to the reading it leaves
 * behind. It belongs to the reasoning group's knob, too: the trace hidden, the
 * line that stands for it goes with it, and so does the slot.
 */
function useThinkingLabel(reasoningShown: boolean): string | undefined {
  return useAuiState((state) => {
    if (!reasoningShown) return undefined;
    if (state.message.status?.type !== "running") return undefined;
    const parts = state.message.parts;
    const pending = parts.find((part) => part.type === "tool-call" && part.result === undefined);
    if (pending?.type === "tool-call") return `Running ${pending.toolName}`;
    // The panel's trigger carries this window: it shimmers for exactly as long
    // as the trace is running, so the line leaves the phase to it.
    if (parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0)) return undefined;
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
