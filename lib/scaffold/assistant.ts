/** The assistant components: the app shell, the reasoning group and the tool card. */
export function assistantComponentSource(): string {
  return `"use client";

import {
  AuiIf,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  groupPartByType,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunResult,
  type ThreadMessage,
} from "@assistant-ui/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { elvinConfig } from "../../elvin.config";
import { ReasoningGroup, ReasoningText } from "./reasoning-group";
import { describeStep } from "./step-label";
import { ToolCallRow } from "./tool-call-row";
import { ToolCard } from "./tool-card";

type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue };

type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: { readonly [key: string]: JsonValue };
  argsText: string;
  result: unknown;
};

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown; status?: string }
  | { type: "error"; error: string }
  | { type: "done" };

const THREAD_STORAGE_KEY = "elvin.threadId";

/** Turn markers, drawn with Google's animated Noto Emoji. */
const EMOJI_MARKS = {
  assistant: { char: "🫧", codePoint: "1fae7" },
  user: { char: "👋", codePoint: "1f44b" },
} as const;

/**
 * The provider keeps the conversation but cannot list sessions, so the client
 * owns the id. Persisted so a reload continues the same thread.
 */
function storedThreadId() {
  const existing = window.localStorage.getItem(THREAD_STORAGE_KEY);
  if (existing) return existing;
  const id = \`elvin-\${crypto.randomUUID().slice(0, 8)}\`;
  window.localStorage.setItem(THREAD_STORAGE_KEY, id);
  return id;
}

export function ElvinAssistant() {
  // One conversation, one server-side session: the runtime's thread id when it
  // has one, otherwise the id this browser stored for the thread.
  const [threadId, setThreadId] = useState("");

  useEffect(() => {
    setThreadId(storedThreadId());
  }, []);
  const adapter = useMemo<ChatModelAdapter>(() => ({
    async *run({ messages, abortSignal, unstable_threadId }) {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: unstable_threadId ?? threadId, messages: messages.map((message) => ({ role: message.role, content: readableMessageContent(message) })) }),
        signal: abortSignal,
      });

      if (!(response.headers.get("Content-Type") ?? "").includes("text/event-stream")) {
        const data = await response.json() as { content?: string; reasoning?: string | null; toolCalls?: Array<{ toolCallId?: string; name: string; arguments?: unknown; result?: unknown }>; error?: string };
        yield { content: assembleContent({ text: data.error ?? data.content ?? "The agent returned no text.", reasoning: data.reasoning ?? "", toolCalls: collectToolCalls(data.toolCalls) }) };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("The agent returned no response body.");
      const decoder = new TextDecoder();
      const toolCalls = new Map<string, ToolCallPart>();
      let buffer = "";
      let text = "";
      let reasoning = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const chunk = line.slice(5).trim();
          if (chunk.length === 0) continue;

          const event = JSON.parse(chunk) as StreamEvent;
          if (event.type === "text") text = event.text;
          else if (event.type === "reasoning") reasoning = event.text;
          else if (event.type === "error") text = event.error;
          else if (event.type === "tool-call") {
            const args = toArgsObject(event.args);
            toolCalls.set(event.toolCallId, {
              type: "tool-call",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args,
              argsText: JSON.stringify(args),
              result: event.status && !isRunningStatus(event.status) ? { status: event.status } : undefined,
            });
          }

          yield { content: assembleContent({ text, reasoning, toolCalls }) };
        }
      }

      if (text.length === 0 && reasoning.length === 0 && toolCalls.size === 0) {
        yield { content: [{ type: "text" as const, text: "The agent streamed nothing Elvin could render. Check the provider's response shape." }] };
      }
    },
  }), [threadId]);
  const runtime = useLocalRuntime(adapter);
  return (
    <main className="app" data-pattern={elvinConfig.pattern} data-theme={elvinConfig.theme}>
      <AssistantRuntimeProvider runtime={runtime}>
        <section style={{ width: "100%", maxWidth: elvinConfig.pattern === "thread" ? 760 : 420, margin: "0 auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <header className="app-header"><strong>Assistant</strong><span> · {elvinConfig.model}</span></header>
          <ThreadPrimitive.Root style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <ThreadPrimitive.Viewport style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              <ThreadPrimitive.Messages>
                {({ message }) => message.role === "user" ? <UserMessage /> : <AssistantMessage />}
              </ThreadPrimitive.Messages>
            </ThreadPrimitive.Viewport>
            {/* Its own row, outside the scroller: the thread scrolls above the
                composer rather than passing behind it. */}
            <ThreadPrimitive.ViewportFooter style={{ flex: "none", paddingTop: 12, background: "var(--a-bg)" }}>
              <ComposerPrimitive.Root className="composer">
                <ComposerPrimitive.Input className="composer-input" placeholder="Send a message…" rows={1} />
                <AuiIf condition={(state) => !state.thread.isRunning}>
                  <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
                </AuiIf>
                <AuiIf condition={(state) => state.thread.isRunning}>
                  <ComposerPrimitive.Cancel>Stop</ComposerPrimitive.Cancel>
                </AuiIf>
              </ComposerPrimitive.Root>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Root>
        </section>
      </AssistantRuntimeProvider>
    </main>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className={elvinConfig.emoji ? "user-bubble emoji" : "user-bubble"} style={{ alignSelf: "flex-end", maxWidth: "80%" }}>
      <EmojiMark role="user" />
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

/** Turn marker: an animated Noto emoji, falling back to the plain glyph. */
function EmojiMark({ role }: { role: keyof typeof EMOJI_MARKS }) {
  const [plain, setPlain] = useState(false);
  const mark = EMOJI_MARKS[role];
  if (!elvinConfig.emoji) return null;
  if (plain) return <span className="message-emoji" aria-hidden="true">{mark.char}</span>;
  return (
    <img
      className="message-emoji"
      src={\`https://fonts.gstatic.com/s/e/notoemoji/latest/\${mark.codePoint}/512.webp\`}
      alt=""
      aria-hidden="true"
      width={22}
      height={22}
      onError={() => setPlain(true)}
    />
  );
}

/** One tool call in plain language: no arguments, no payload. */
function StepLine({ name, args, result }: { name: string; args: unknown; result: unknown }) {
  const running = useAuiState((state) => state.message.status?.type === "running");
  const failed = result !== null && typeof result === "object" && "error" in (result as Record<string, unknown>);
  const phase = failed ? "failed" : running && result === undefined ? "running" : "complete";

  return (
    <p className="step" data-phase={phase}>
      <span className="step-mark" aria-hidden="true" />
      <span>{describeStep(name, args, phase)}</span>
    </p>
  );
}

/** The work in flight, or a count of it once the turn settles. */
function StepList({ defaultOpen, children }: { defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const summary = useAuiState((state) => {
    const calls = state.message.parts.filter((part) => part.type === "tool-call");
    if (state.message.status?.type === "running") {
      const pending = calls.find((part) => part.result === undefined);
      return pending?.type === "tool-call" ? describeStep(pending.toolName, pending.args, "running") : "Thinking";
    }
    if (calls.length === 0) return "Thought";
    return calls.length === 1 ? "1 step" : \`\${calls.length} steps\`;
  });

  return (
    <div className="steps">
      <button className="steps-head" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{summary}</span>
        <span aria-hidden="true">{open ? "⌄" : "›"}</span>
      </button>
      {open && <div className="steps-body">{children}</div>}
    </div>
  );
}

function AssistantMessage() {
  // Humanized steps put reasoning and tool calls in one group, so the middle of
  // the turn reads as plain language instead of a stack of disclosures.
  const humanized = elvinConfig.steps === "humanized" && elvinConfig.toolCalls.render;
  const groupBy = useMemo(() => groupPartByType(humanized
    ? { reasoning: ["group-steps", "group-reasoning"], "tool-call": ["group-steps", "group-tool"] }
    : { reasoning: ["group-reasoning"] }), [humanized]);
  const running = useAuiState((state) => state.message.status?.type === "running");
  const answering = useAuiState((state) => state.message.parts.some((part) => part.type === "text" && part.text.trim().length > 0));

  return (
    <MessagePrimitive.Root className={elvinConfig.emoji ? "assistant-message emoji-row" : "assistant-message"} style={{ alignSelf: "flex-start", maxWidth: "80%" }}>
      <EmojiMark role="assistant" />
      <MessagePrimitive.Error>
        <p className="assistant-error"><ErrorPrimitive.Message /></p>
      </MessagePrimitive.Error>
      <MessagePrimitive.GroupedParts groupBy={groupBy}>
        {({ part, children }) => {
          switch (part.type) {
            case "group-steps":
              return <StepList defaultOpen={elvinConfig.reasoning.defaultOpen}>{children}</StepList>;
            case "group-reasoning":
              if (humanized) return <div className="steps-reasoning">{children}</div>;
              return elvinConfig.reasoning.render
                ? <ReasoningGroup defaultOpen={elvinConfig.reasoning.defaultOpen} streaming={part.status.type === "running" || (running && !answering)}>{children}</ReasoningGroup>
                : <></>;
            case "group-tool":
              return <div className="steps-list">{children}</div>;
            case "reasoning":
              return elvinConfig.reasoning.render ? <ReasoningText text={part.text} /> : <></>;
            case "tool-call":
              if (!elvinConfig.toolCalls.render) return <></>;
              if (elvinConfig.toolCalls.style === "humanized") return <ToolCallRow name={part.toolName} args={part.args} result={part.result} defaultOpen={elvinConfig.toolCalls.defaultOpen} />;
              if (humanized) return <StepLine name={part.toolName} args={part.args} result={part.result} />;
              return part.toolUI ?? <ToolCard name={part.toolName} args={part.args} result={part.result} defaultOpen={elvinConfig.toolCalls.defaultOpen} />;
            case "text":
              return <p className="assistant-text">{part.text}</p>;
            default:
              return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
    </MessagePrimitive.Root>
  );
}

function collectToolCalls(value: Array<{ toolCallId?: string; name: string; arguments?: unknown; result?: unknown }> | undefined) {
  const map = new Map<string, ToolCallPart>();
  for (const [index, tool] of (value ?? []).entries()) {
    const args = toArgsObject(tool.arguments);
    const toolCallId = tool.toolCallId ?? \`tool-\${index}\`;
    map.set(toolCallId, { type: "tool-call", toolCallId, toolName: tool.name, args, argsText: JSON.stringify(args), result: tool.result });
  }
  return map;
}

function assembleContent({ text, reasoning, toolCalls }: { text: string; reasoning: string; toolCalls: Map<string, ToolCallPart> }): Array<NonNullable<ChatModelRunResult["content"]>[number]> {
  return [
    ...(reasoning.length > 0 ? [{ type: "reasoning" as const, text: reasoning }] : []),
    ...toolCalls.values(),
    ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
  ];
}

function isRunningStatus(status: string) {
  const value = status.toLowerCase();
  return value === "running" || value === "pending" || value === "in_progress" || value === "started";
}

function toArgsObject(value: unknown): { readonly [key: string]: JsonValue } {
  if (value && typeof value === "object" && !Array.isArray(value)) return JSON.parse(JSON.stringify(value)) as { readonly [key: string]: JsonValue };
  return { value: value === undefined ? null : String(value) };
}

function readableMessageContent(message: ThreadMessage) {
  return message.content.map((part) => {
    if (part.type === "text" || part.type === "reasoning") return part.text;
    if (part.type === "tool-call") return \`[tool:\${part.toolName}] \${JSON.stringify(part.result ?? part.args)}\`;
    return "";
  }).filter(Boolean).join("\\n");
}
`;
}

// Zip assembly

/** components/assistant/reasoning-group.tsx */
export function reasoningGroupSource(): string {
  return `"use client";

import { useMemo, useState, type PropsWithChildren } from "react";

/**
 * Open while the model is still working, then settle to the configured default.
 * A manual toggle sticks, so reading the trace never fights the stream.
 */
export function ReasoningGroup({ defaultOpen, streaming, children }: PropsWithChildren<{ defaultOpen: boolean; streaming: boolean }>) {
  const [initialOpen] = useState(defaultOpen);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (streaming || initialOpen);

  return (
    <div className="reasoning">
      <button className="reasoning-trigger" type="button" aria-expanded={open} onClick={() => setUserOpen(!open)}>
        <span className="reasoning-trigger-label" data-active={streaming || undefined}>Reasoning</span>
        <span aria-hidden>{open ? "⌄" : "›"}</span>
      </button>
      {open && <div className="reasoning-content">{children}</div>}
    </div>
  );
}

/**
 * The trace arrives as one growing string, so the newest words are the only
 * thing that moves. Splitting on whitespace re-emits the provider's own line
 * breaks, which is what lets a long trace read as steps rather than a wall.
 */
export function ReasoningText({ text }: { text: string }) {
  const tokens = useMemo(() => text.split(/(\\s+)/), [text]);

  return (
    <p className="reasoning-line">
      {tokens.map((token, index) => (
        token.trim().length === 0 ? token : <span className="reasoning-word" key={index}>{token}</span>
      ))}
    </p>
  );
}
`;
}

/** components/assistant/tool-card.tsx */
export function toolCardSource(): string {
  return `"use client";

import { useState } from "react";

export function ToolCard({ name, args, result, defaultOpen }: { name: string; args: unknown; result: unknown; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="tool-card">
      <button className="tool-card-trigger" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="tool-card-name">Used tool {name}</span>
        <span aria-hidden>{open ? "⌄" : "›"}</span>
      </button>
      {open && (
        <div className="tool-card-content">
          <pre>{JSON.stringify({ args, result }, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
`;
}

export function toolCallRowSource(): string {
  return `"use client";

import { useState } from "react";
import { describeResult, describeStep, objectOf } from "./step-label";

/**
 * One tool call, drawn the way assistant-ui's tool-call element draws it: the
 * step in plain language with its primary argument as a chip, and the raw
 * request and result behind the disclosure. Elvin's own copy of that element is
 * Tailwind-based; this one is plain CSS, like the rest of the scaffold.
 */
export function ToolCallRow({ name, args, result, defaultOpen }: { name: string; args: unknown; result: unknown; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const running = result === undefined;
  const failed = result !== null && typeof result === "object" && "error" in (result as Record<string, unknown>);

  return (
    <div className="tool-call">
      <button className="tool-call-trigger" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="tool-call-chevron" aria-hidden="true">{open ? "⌄" : "›"}</span>
        <span className="tool-call-label" data-active={running || undefined}>{running ? describeStep(name, args, "running") : describeStep(name, args, failed ? "failed" : "complete")}</span>
        <span className="tool-call-chip">{objectOf(args) ?? name}</span>
        {!running && <span className="tool-call-check" aria-hidden="true">✓</span>}
      </button>
      {open && (
        <div className="tool-call-panel">
          <p className="tool-call-field">Request</p>
          <p className="tool-call-request">{JSON.stringify(args ?? {}, null, 2)}</p>
          <div className="tool-call-divider" />
          <p className="tool-call-field">Result</p>
          <p className="tool-call-result">{describeResult(result)}</p>
        </div>
      )}
    </div>
  );
}
`;
}
