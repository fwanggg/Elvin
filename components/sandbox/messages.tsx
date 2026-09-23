"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, EllipsisIcon, RefreshCwIcon, ThumbsDownIcon, ThumbsUpIcon, Volume2Icon } from "lucide-react";
import { MessageTiming } from "@/components/assistant-ui/elements/message-timing.aui";
import { ReasoningContent, ReasoningRoot, ReasoningText, ReasoningTrigger } from "@/components/assistant-ui/elements/reasoning";
import { StreamingText, type Segment } from "@/components/assistant-ui/elements/streaming-text";
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { ShimmerLabel } from "@/components/assistant-ui/elements/surfaces";
import { describeStep, type StepPhase } from "@/lib/step-labels";
import { type PartMode, type StepsMode, type Toggle } from "@/components/sandbox/knobs";
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
  toolsMode: PartMode;
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
  const answering = useAuiState((state) => state.message.parts.some((part) => part.type === "text" && part.text.trim().length > 0));
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
                if (toolsMode !== "shown") return <></>;
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
        {/* A reserved slot: the label comes and goes between rounds, and the space
            it needs must not be taken from the layout each time. It trails the
            parts, so a growing chain cannot push it away from the composer. */}
        {running && (
          <div className="thinking-slot">
            <AssistantThinking humanized={stepsShown} />
          </div>
        )}
        {responseStatus === "on" && <AssistantActionBar />}
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

function AssistantThinking({ humanized }: Readonly<{ humanized: boolean }>): ReactNode {
  const label = useThinkingLabel(humanized);
  const elapsed = useElapsedLabel(label !== undefined);

  if (label === undefined) return null;
  return <ThinkingIndicator className="thinking-indicator" label={label} elapsed={elapsed} />;
}

/**
 * Names what the turn is doing whenever nothing else on screen is moving. The
 * trace carries a shimmering trigger while it streams and the answer text
 * carries itself, so the line's real job is the gap between rounds — after a
 * tool result, where the previous rule fell silent for the rest of the turn.
 */
function useThinkingLabel(stepListShows: boolean): string | undefined {
  return useAuiState((state) => {
    if (stepListShows) return undefined;
    if (state.message.status?.type !== "running") return undefined;
    const parts = state.message.parts;
    const pending = parts.find((part) => part.type === "tool-call" && part.result === undefined);
    if (pending?.type === "tool-call") return `Running ${pending.toolName}`;
    if (parts.some((part) => part.type === "reasoning" && part.status?.type === "running")) return undefined;
    if (parts.some((part) => part.type === "text" && part.text.trim().length > 0)) return undefined;
    return "Thinking";
  });
}

function useElapsedLabel(active: boolean): string | undefined {
  const [label, setLabel] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      setLabel(undefined);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => setLabel(`${Math.round((Date.now() - start) / 1000)}s`), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return label;
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
