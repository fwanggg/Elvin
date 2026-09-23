import { DESIGN_FONTS, DESIGN_PALETTE, DESIGN_TOKENS, DESIGNS, type Design, type Theme } from "@/lib/design-tokens";

type SourceFile = {
  name: string;
  content: string;
};

type SourceConfig = {
  pattern: string;
  theme: string;
  design: Design;
  tools: string;
  reasoning: string;
  open: string;
  model: string;
  stream: string;
  capability: string;
};

type OptionalSourceChunk = string | false | null | undefined;

function joinEmittedSource(chunks: readonly OptionalSourceChunk[], separator: string): string {
  const emitted = chunks.filter((chunk): chunk is string => typeof chunk === "string");
  return emitted.join(separator);
}

const encoder = new TextEncoder();

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const config: SourceConfig = {
    pattern: safeParam(url, "pattern", ["thread", "sidebar", "modal"], "thread"),
    theme: safeParam(url, "theme", ["dark", "light"], "dark"),
    design: safeParam(url, "design", DESIGNS, "swiss"),
    tools: safeParam(url, "tools", ["shown", "hidden", "off"], "shown"),
    reasoning: safeParam(url, "reasoning", ["shown", "hidden", "off"], "shown"),
    open: safeParam(url, "open", ["collapsed", "expanded"], "collapsed"),
    model: url.searchParams.get("model")?.trim() || "acme-support-agent",
    stream: safeParam(url, "stream", ["true", "false"], "true"),
    capability: url.searchParams.get("capability")?.trim() || "",
  };
  const files = generatedFiles(config);

  if (url.searchParams.has("list")) {
    return Response.json({ files: files.map((file) => file.name) });
  }

  // Same bytes the zip carries, so the export pane cannot drift from it.
  if (url.searchParams.has("contents")) {
    return Response.json({ files });
  }

  return new Response(zip(files), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="elvin-${config.pattern}-${config.design}-${config.theme}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

function safeParam<T extends string>(url: URL, key: string, allowed: readonly T[], fallback: T): T {
  const value = url.searchParams.get(key);
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function generatedFiles(config: SourceConfig): SourceFile[] {
  return [
    {
      name: "package.json",
      content: JSON.stringify({
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { "@assistant-ui/react": "latest", next: "latest", react: "latest", "react-dom": "latest" },
        devDependencies: { typescript: "latest", "@types/node": "latest", "@types/react": "latest", "@types/react-dom": "latest" },
      }, null, 2) + "\n",
    },
    { name: "tsconfig.json", content: JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "react-jsx", incremental: true, paths: { "@/*": ["./*"] }, plugins: [{ name: "next" }] }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }, null, 2) + "\n" },
    { name: "next-env.d.ts", content: "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types/global\" />\n" },
    { name: ".env.example", content: "AGENT_BASE_URL=https://api.example.com/v1\nAGENT_API_KEY=\n" },
    { name: "elvin.config.ts", content: configSource(config) },
    {
      name: "app/layout.tsx",
      content: "import type { ReactNode } from 'react';\nimport './globals.css';\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return <html lang=\"en\" suppressHydrationWarning><body>{children}</body></html>;\n}\n",
    },
    { name: "app/globals.css", content: globalsSource(config) },
    {
      name: "app/page.tsx",
      content: "import { ElvinAssistant } from '../components/assistant/ElvinAssistant';\n\nexport default function Page() {\n  return <ElvinAssistant />;\n}\n",
    },
    { name: "app/api/chat/route.ts", content: chatRouteSource() },
    { name: "components/assistant/ElvinAssistant.tsx", content: assistantComponentSource() },
    { name: "components/assistant/reasoning-group.tsx", content: reasoningGroupSource() },
    { name: "components/assistant/tool-card.tsx", content: toolCardSource() },
  ];
}

// Code emission

function configSource(config: SourceConfig): string {
  return joinEmittedSource([
    "export const elvinConfig = {",
    "  baseURL: process.env.AGENT_BASE_URL,",
    `  model: ${JSON.stringify(config.model)},`,
    `  pattern: ${JSON.stringify(config.pattern)},`,
    `  theme: ${JSON.stringify(config.theme)},`,
    `  design: ${JSON.stringify(config.design)},`,
    `  stream: ${config.stream === "true"},`,
    `  capability: ${JSON.stringify(config.capability || null)},`,
    "  toolCalls: {",
    `    send: ${config.tools !== "off"},`,
    `    render: ${config.tools === "shown"},`,
    `    defaultOpen: ${config.open === "expanded"},`,
    "  },",
    "  reasoning: {",
    `    request: ${config.reasoning !== "off"},`,
    `    render: ${config.reasoning === "shown"},`,
    `    defaultOpen: ${config.open === "expanded"},`,
    "  },",
    "} as const;",
    "",
  ], "\n");
}

/** Base scaffold styling. Every value resolves to a token on :root below. */
const SCAFFOLD_RULES = [
  "html,body{min-height:100%;margin:0}",
  "body{background:var(--a-bg);color:var(--a-fg);font-family:var(--font-body);font-size:var(--body-size);-webkit-font-smoothing:antialiased}",
  "button,input,textarea{font:inherit;color:inherit}",
  "*{box-sizing:border-box}",
  ":focus-visible{outline:2px solid var(--a-accent);outline-offset:2px}",
  ".app{height:100vh;display:flex;flex-direction:column;overflow:hidden;padding:var(--pad-canvas);background:var(--a-bg);color:var(--a-fg)}",
  ".app-header{font-family:var(--font-heading);font-size:13px;font-weight:var(--label-weight);letter-spacing:var(--label-tracking);text-transform:var(--label-transform)}",
  ".app-header span{font-weight:400;color:var(--a-muted)}",
  ".composer{display:flex;gap:8px;align-items:flex-end;padding:var(--pad-bar);border:var(--border-width) solid var(--a-border);border-radius:var(--radius);background:var(--a-bg);box-shadow:var(--shadow)}",
  ".composer-input{flex:1;min-width:0;border:0;outline:0;resize:none;background:transparent;color:inherit;font-family:var(--font-body);font-size:var(--body-size)}",
  ".composer button{padding:6px 12px;border:var(--border-width) solid var(--a-accent);border-radius:var(--radius);background:var(--a-accent);color:var(--a-accent-fg);cursor:pointer;font-family:var(--font-heading);font-size:13px;font-weight:var(--label-weight)}",
  ".user-bubble{padding:10px 16px;border:var(--border-width) solid var(--a-border);border-radius:var(--radius-card);background:var(--a-surface)}",
  ".assistant-message{font-size:var(--body-size);line-height:1.6}",
  ".assistant-text{margin:0;white-space:pre-wrap}",
  ".assistant-error{margin:0 0 8px;color:var(--danger);font-size:13px}",
  "",
].join("\n");

// The trace mirrors what the sandbox shows: a label that shimmers while the
// model is still writing, a panel that animates open, and reasoning text whose
// newest words land one at a time instead of appearing in whole paragraphs.
const REASONING_RULES = [
  ".reasoning{margin:8px 0;border:var(--border-width) solid var(--a-border);border-radius:var(--radius-card);background:var(--a-bg);box-shadow:var(--shadow);overflow:hidden}",
  ".reasoning-trigger{display:flex;width:100%;gap:8px;align-items:center;justify-content:space-between;padding:8px 12px;border:0;background:transparent;color:inherit;cursor:pointer}",
  ".reasoning-trigger-label{font-size:13px;font-weight:var(--label-weight);letter-spacing:var(--label-tracking)}",
  ".reasoning-trigger-label[data-active]{background-image:linear-gradient(90deg,color-mix(in oklab,currentColor 35%,transparent) 40%,currentColor 50%,color-mix(in oklab,currentColor 35%,transparent) 60%);background-size:250% 100%;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:reasoning-shimmer 1.8s linear infinite}",
  "@keyframes reasoning-shimmer{from{background-position:100% 0}to{background-position:0 0}}",
  ".reasoning-content{padding:0 12px 12px;font-size:14px;line-height:1.6;opacity:.75;animation:reasoning-open .24s cubic-bezier(.23,1,.32,1) both}",
  "@keyframes reasoning-open{from{opacity:0;translate:0 -4px}}",
  ".reasoning-line{margin:0;white-space:pre-wrap}",
  ".reasoning-word{animation:reasoning-word-in .35s cubic-bezier(.23,1,.32,1) both}",
  "@keyframes reasoning-word-in{from{opacity:0}}",
  "@media (prefers-reduced-motion:reduce){.reasoning-trigger-label[data-active]{animation:none;-webkit-text-fill-color:currentColor;background-image:none}.reasoning-content,.reasoning-word{animation:none}}",
  "",
].join("\n");

const TOOL_RULES = [
  ".tool-card{margin:8px 0;border:var(--border-width) solid var(--a-border);border-radius:var(--radius-card);background:var(--a-bg);box-shadow:var(--shadow);overflow:hidden}",
  ".tool-card-trigger{display:flex;width:100%;gap:8px;align-items:center;justify-content:space-between;padding:8px 12px;border:0;background:transparent;color:inherit;cursor:pointer}",
  ".tool-card-name{font-size:13px;font-weight:var(--label-weight)}",
  ".tool-card-content{padding:0 12px 12px}",
  ".tool-card-content pre{margin:0;font-family:var(--font-mono);font-size:12px;overflow:auto}",
  "",
].join("\n");

/**
 * The scaffold has no chrome of its own, so the language lands on :root rather
 * than behind a [data-design] scope. Values come from lib/design-tokens.ts,
 * which is generated from the playground stylesheet.
 */
function globalsSource(config: SourceConfig): string {
  const theme: Theme = config.theme === "light" ? "light" : "dark";
  const tokens = { ...DESIGN_TOKENS[config.design], ...DESIGN_PALETTE[config.design][theme] };
  const root = Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(";");

  return joinEmittedSource([
    `@import url('${DESIGN_FONTS[config.design]}');\n`,
    `:root{${root}}\n`,
    SCAFFOLD_RULES,
    config.reasoning === "shown" && REASONING_RULES,
    config.tools === "shown" && TOOL_RULES,
  ], "");
}

function reasoningGroupSource(): string {
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

function toolCardSource(): string {
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

function chatRouteSource(): string {
  return `import { NextResponse } from 'next/server';
import { elvinConfig } from '../../../elvin.config';

type WireMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

type ToolCall = {
  id?: string;
  index?: number;
  name?: string;
  arguments?: unknown;
  function?: { name?: string; arguments?: string };
};

type ToolCallSummary = { id: string; name: string; arguments: string };

type ProviderCall =
  | { ok: true; response: Response }
  | { ok: false; error: string; status: number };

type ContinueAfterTools = (calls: ToolCallSummary[]) => Promise<ProviderCall>;

type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown; status: string }
  | { type: 'error'; error: string }
  | { type: 'done'; sessionId?: string };

type ToolState = {
  id: string;
  name: string;
  arguments: string;
  /** Last arguments value that parsed, so partial JSON never renders. */
  args: unknown;
  label: string;
  status: string;
};

type DeltaState = {
  text: string;
  reasoning: string;
  /** Which channel supplied the reasoning, so a mirrored copy is not appended twice. */
  reasoningSource: 'details' | 'field' | null;
  toolCalls: Map<string, ToolState>;
};

/**
 * Providers that keep conversation state server side name the header that
 * pins it. Bare OpenAI has no sessions, so the header is simply ignored.
 */
const SESSION_HEADER = 'X-Hermes-Session-Id';
const SESSION_RESPONSE_HEADER = 'x-hermes-session-id';

/**
 * Endpoints whose models reason mandatorily reject the reasoning parameter.
 * Remembered per endpoint+model so only the first turn pays for the discovery.
 */
const reasoningRejected = new Set<string>();

/**
 * A tool call ends the model's turn, so the answer only arrives once the result
 * is sent back. Bounded so a model that keeps calling tools cannot loop forever.
 */
const MAX_TOOL_ROUNDS = 3;

const SYSTEM_PROMPT = [
  'You are a helpful assistant.',
  elvinConfig.toolCalls.send ? 'Use tools when they materially improve the answer.' : 'Do not call tools; answer from the conversation only.',
  elvinConfig.reasoning.request ? 'If your provider supports a reasoning field, keep it concise.' : 'Do not include hidden reasoning fields.',
].join(' ');

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_order_status',
      description: 'Look up shipment status for a customer order.',
      parameters: {
        type: 'object',
        properties: { order_id: { type: 'string', description: 'Order number without the # prefix.' } },
        required: ['order_id'],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Tool stubs: a real app calls its own systems here.
 */
function executeTool(name: string, rawArguments: string) {
  const args: unknown = safeJson(rawArguments.length > 0 ? rawArguments : '{}');
  const orderId = args && typeof args === 'object' && 'order_id' in args && typeof args.order_id === 'string' ? args.order_id : '4821';
  if (name === 'get_order_status') {
    return {
      order_id: orderId,
      status: 'in_transit',
      carrier: 'UPS',
      eta: '2026-09-24',
      note: 'Stubbed by the Elvin scaffold.',
    };
  }
  return { error: \`No stub for tool "\${name}".\` };
}

export async function POST(request: Request) {
  const body = (await request.json()) as { messages?: WireMessage[]; threadId?: string };
  const endpoint = \`\${(elvinConfig.baseURL ?? '').replace(/\\/+$/, '')}/chat/completions\`;
  const model = elvinConfig.model;
  const tools = elvinConfig.toolCalls.send ? TOOL_DEFINITIONS : null;

  const conversation: WireMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(body.messages ?? []),
  ];

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.AGENT_API_KEY) headers.Authorization = \`Bearer \${process.env.AGENT_API_KEY}\`;
  if (body.threadId) headers[SESSION_HEADER] = body.threadId;

  const reasoning = { reasoning: { enabled: elvinConfig.reasoning.request } };
  const cacheKey = \`\${endpoint}|\${model}\`;

  const callProvider = async (turns: WireMessage[]): Promise<ProviderCall> => {
    const payload: Record<string, unknown> = {
      model,
      messages: turns,
      stream: elvinConfig.stream,
      ...(elvinConfig.capability ? { capability: elvinConfig.capability } : {}),
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    };

    const first = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(reasoningRejected.has(cacheKey) ? payload : { ...payload, ...reasoning }),
      signal: request.signal,
    });
    if (first.ok) return { ok: true, response: first };

    // Mandatory-reasoning models reject the parameter outright; drop it rather
    // than carrying a model table.
    const failureText = await first.text();
    if (/reason/i.test(failureText)) {
      reasoningRejected.add(cacheKey);
      const retry = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload), signal: request.signal });
      if (retry.ok) return { ok: true, response: retry };
      return { ok: false, error: await retry.text(), status: retry.status };
    }
    return { ok: false, error: failureText, status: first.status };
  };

  const continueAfterTools = async (calls: ToolCallSummary[]): Promise<ProviderCall> => {
    conversation.push({
      role: 'assistant',
      content: null,
      tool_calls: calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })),
    });
    for (const call of calls) {
      conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(executeTool(call.name, call.arguments)) });
    }
    return callProvider(conversation);
  };

  let call: ProviderCall;
  try {
    call = await callProvider(conversation);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Provider request failed.' }, { status: 502 });
  }

  if (!call.ok) {
    return NextResponse.json({ error: call.error }, { status: call.status });
  }

  const sessionId = call.response.headers.get(SESSION_RESPONSE_HEADER) ?? body.threadId ?? null;

  if (elvinConfig.stream) {
    return eventStream(call.response, sessionId, tools ? continueAfterTools : null);
  }

  let response = call.response;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const data = safeJson(await response.text());
    const message = firstMessage(data);
    const pending = toToolCallSummaries(message.tool_calls);
    const content = textOf(message.content);

    if (pending.length === 0 || !tools) {
      return NextResponse.json({
        content: content || 'The agent returned no text.',
        reasoning: reasoningOf(message, data),
        toolCalls: toolCallsOf(message.tool_calls),
        sessionId,
      });
    }

    const again = await continueAfterTools(pending);
    if (!again.ok) return NextResponse.json({ error: again.error }, { status: again.status });
    response = again.response;
  }

  return NextResponse.json({ error: 'The agent kept requesting tools.', sessionId }, { status: 502 });
}

function toToolCallSummaries(value: unknown): ToolCallSummary[] {
  return toolCallsOf(value).map((call) => ({ id: call.toolCallId, name: call.name, arguments: JSON.stringify(call.arguments) }));
}

/** Tool calls opened during one provider turn. */
function roundToolCalls(state: DeltaState, round: number): ToolCallSummary[] {
  const prefix = \`round-\${round}-\`;
  return [...state.toolCalls.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, call]) => ({ id: call.id, name: call.name, arguments: call.arguments }));
}

/**
 * Normalizes the provider response into one event per update, so the client
 * adapter accumulates snapshots instead of parsing provider deltas.
 */
function eventStream(initial: Response, sessionId: string | null, continueAfterTools: ContinueAfterTools | null) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(\`data: \${JSON.stringify(event)}\\n\\n\`));
      const state: DeltaState = { text: '', reasoning: '', reasoningSource: null, toolCalls: new Map() };
      const emit = () => {
        for (const event of snapshotEvents(state)) send(event);
      };

      try {
        let current = initial;
        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
          const produced = await consumeStream(current, round, state, emit);
          if (produced.length === 0 || !continueAfterTools) break;
          const next = await continueAfterTools(produced);
          if (!next.ok) {
            send({ type: 'error', error: next.error });
            break;
          }
          current = next.response;
        }
        send({ type: 'done', sessionId: sessionId ?? undefined });
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : 'Stream failed.' });
      } finally {
        controller.close();
      }
    },
    cancel() {
      void initial.body?.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Consumes one provider turn into state, emitting snapshots as it goes, and
 * returns the tool calls that turn asked for.
 */
async function consumeStream(upstream: Response, round: number, state: DeltaState, emit: () => void): Promise<ToolCallSummary[]> {
  const isEventStream = (upstream.headers.get('content-type') ?? '').includes('text/event-stream');

  if (!isEventStream) {
    const data = safeJson(await upstream.text());
    const message = firstMessage(data);
    const reasoning = reasoningOf(message, data);
    if (reasoning) {
      state.reasoning += reasoning;
      state.reasoningSource = 'field';
    }
    for (const call of toolCallsOf(message.tool_calls)) {
      state.toolCalls.set(\`round-\${round}-\${call.toolCallId}\`, {
        id: call.toolCallId,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
        args: call.arguments,
        label: '',
        status: 'completed',
      });
    }
    const content = textOf(message.content);
    if (content) state.text += content;
    emit();
    return roundToolCalls(state, round);
  }

  const reader = upstream.body?.getReader();
  if (!reader) throw new Error('The agent returned no response body.');
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\\r?\\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.length === 0) {
        eventName = '';
        continue;
      }
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;
      const chunk = line.slice(5).trim();
      if (chunk.length === 0 || chunk === '[DONE]') continue;

      const payload = safeJson(chunk);
      if (applyProviderEvent(state, eventName, payload)) {
        emit();
        continue;
      }

      const delta = firstDelta(payload);
      if (!delta) continue;
      applyDelta(state, delta, round);
      emit();
    }
  }

  // The turn is over once the stream ends, so its tool calls are settled.
  for (const [key, call] of state.toolCalls) {
    if (key.startsWith(\`round-\${round}-\`)) state.toolCalls.set(key, { ...call, status: 'completed' });
  }
  emit();
  return roundToolCalls(state, round);
}

function applyDelta(state: DeltaState, delta: Record<string, unknown>, round: number) {
  if (typeof delta.content === 'string') state.text += delta.content;

  // Providers deliver thinking as a plain field or as structured details, often
  // both at once carrying the same text.
  const detailText = reasoningFromDetails(delta.reasoning_details);
  if (detailText.length > 0) {
    state.reasoning += detailText;
    state.reasoningSource = 'details';
  } else if (state.reasoningSource !== 'details') {
    const field = typeof delta.reasoning === 'string' ? delta.reasoning : typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
    if (field.length > 0) {
      state.reasoning += field;
      state.reasoningSource = 'field';
    }
  }

  if (!Array.isArray(delta.tool_calls)) return;

  for (const rawCall of delta.tool_calls as ToolCall[]) {
    const index = rawCall.index ?? state.toolCalls.size;
    const key = \`round-\${round}-\${index}\`;
    const prior = state.toolCalls.get(key) ?? { id: rawCall.id ?? \`tool-\${index}\`, name: '', arguments: '', args: {}, label: '', status: 'running' };
    const fragment = rawCall.function?.arguments ?? (typeof rawCall.arguments === 'string' ? rawCall.arguments : '');
    const argsText = \`\${prior.arguments}\${fragment}\`;

    let args = prior.args;
    try {
      args = JSON.parse(argsText);
    } catch {
      /* mid-fragment */
    }

    state.toolCalls.set(key, {
      id: rawCall.id ?? prior.id,
      name: \`\${prior.name}\${rawCall.function?.name ?? rawCall.name ?? ''}\`,
      arguments: argsText,
      args,
      label: prior.label,
      status: prior.status,
    });
  }
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * Providers that run tools and stream thinking server side announce it as named
 * SSE events rather than OpenAI delta.tool_calls / delta.reasoning_content:
 * a tool event carrying tool, and thinking as the same shape with
 * tool: "_thinking".
 */
function applyProviderEvent(state: DeltaState, eventName: string, payload: unknown) {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  const tool = firstString(record.tool, record.tool_name, record.toolName);

  if (tool === '_thinking') {
    const thinking = firstString(record.delta, record.preview, record.label, record.text);
    if (!thinking) return false;
    state.reasoning += thinking;
    return true;
  }

  if (tool) {
    const id = firstString(record.toolCallId, record.call_id, record.id) ?? \`tool-\${state.toolCalls.size}\`;
    const key = \`event-\${id}\`;
    const prior = state.toolCalls.get(key);
    const hinted = firstString(record.status, record.state);
    state.toolCalls.set(key, {
      id,
      name: tool,
      arguments: prior?.arguments ?? '',
      args: prior?.args ?? {},
      label: firstString(record.label, record.preview, record.detail) ?? prior?.label ?? '',
      status: eventName === 'tool.failed'
        ? 'failed'
        : eventName === 'tool.completed' || hinted === 'completed' || hinted === 'done'
          ? 'completed'
          : 'running',
    });
    return true;
  }

  if (eventName === 'assistant.delta') {
    const text = firstString(record.delta, record.text);
    if (!text) return false;
    state.text += text;
    return true;
  }

  if (eventName === 'assistant.completed') {
    const text = firstString(record.content, record.text);
    if (!text) return false;
    state.text = text;
    return true;
  }

  if (eventName === 'error') {
    state.text = firstString(record.message, record.error) ?? 'The agent reported an error.';
    return true;
  }

  return false;
}

function snapshotEvents(state: DeltaState) {
  const events: StreamEvent[] = [];

  if (state.reasoning.length > 0) {
    events.push({ type: 'reasoning', text: state.reasoning });
  }

  for (const call of state.toolCalls.values()) {
    if (call.name.length === 0) continue;
    const args = call.label.length > 0 ? { label: call.label } : call.args;
    events.push({ type: 'tool-call', toolCallId: call.id, toolName: call.name, args, status: call.status });
  }

  if (state.text.length > 0) {
    events.push({ type: 'text', text: state.text });
  }

  return events;
}

function firstDelta(data: unknown) {
  const record = data as { choices?: Array<{ delta?: Record<string, unknown> }> } | null;
  return record?.choices?.[0]?.delta ?? null;
}

function safeJson(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function parseArguments(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value.length > 0 ? { raw: value } : {};
  }
}

/** Thinking arrives either as a plain field or as structured details; join the latter. */
function reasoningFromDetails(value: unknown) {
  if (!Array.isArray(value)) return '';
  let text = '';
  for (const detail of value) {
    if (typeof detail === 'string') {
      text += detail;
      continue;
    }
    if (detail && typeof detail === 'object' && 'text' in detail && typeof detail.text === 'string') {
      text += detail.text;
    }
  }
  return text;
}

function firstMessage(data: unknown): Record<string, unknown> {
  const record = data as { choices?: Array<{ message?: Record<string, unknown> }>; output?: Array<Record<string, unknown>> } | null;
  return record?.choices?.[0]?.message ?? record?.output?.[0] ?? {};
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    const value = part as { text?: unknown; content?: unknown };
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    return '';
  }).join('').trim();
}

function reasoningOf(message: Record<string, unknown>, data: unknown): string | null {
  const details = reasoningFromDetails(message.reasoning_details);
  if (details.length > 0) return details;
  const response = data as Record<string, unknown> | null;
  const value = message.reasoning_content ?? message.reasoning ?? response?.reasoning;
  return typeof value === 'string' ? value : null;
}

function toolCallsOf(value: unknown): Array<{ toolCallId: string; name: string; arguments: unknown }> {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const call = entry as ToolCall;
    const raw = call.function?.arguments ?? call.arguments ?? '{}';
    return {
      toolCallId: call.id ?? \`tool-\${index}\`,
      name: call.function?.name ?? call.name ?? 'tool_call',
      arguments: typeof raw === 'string' ? parseArguments(raw) : raw,
    };
  });
}
`;
}

function assistantComponentSource(): string {
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
import { useEffect, useMemo, useState } from "react";
import { elvinConfig } from "../../elvin.config";
import { ReasoningGroup, ReasoningText } from "./reasoning-group";
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
  return <MessagePrimitive.Root className="user-bubble" style={{ alignSelf: "flex-end", maxWidth: "80%" }}><MessagePrimitive.Parts /></MessagePrimitive.Root>;
}

function AssistantMessage() {
  const groupBy = useMemo(() => groupPartByType({ reasoning: ["group-reasoning"] }), []);
  const running = useAuiState((state) => state.message.status?.type === "running");
  const answering = useAuiState((state) => state.message.parts.some((part) => part.type === "text" && part.text.trim().length > 0));

  return (
    <MessagePrimitive.Root className="assistant-message" style={{ alignSelf: "flex-start", maxWidth: "80%" }}>
      <MessagePrimitive.Error>
        <p className="assistant-error"><ErrorPrimitive.Message /></p>
      </MessagePrimitive.Error>
      <MessagePrimitive.GroupedParts groupBy={groupBy}>
        {({ part, children }) => {
          switch (part.type) {
            case "group-reasoning":
              return elvinConfig.reasoning.render
                ? <ReasoningGroup defaultOpen={elvinConfig.reasoning.defaultOpen} streaming={part.status.type === "running" || (running && !answering)}>{children}</ReasoningGroup>
                : <></>;
            case "reasoning":
              return elvinConfig.reasoning.render ? <ReasoningText text={part.text} /> : <></>;
            case "tool-call":
              return elvinConfig.toolCalls.render
                ? part.toolUI ?? <ToolCard name={part.toolName} args={part.args} result={part.result} defaultOpen={elvinConfig.toolCalls.defaultOpen} />
                : <></>;
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

function zip(files: SourceFile[]): Uint8Array<ArrayBuffer> {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concat([...localParts, ...centralParts, end]);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function crc32(data: Uint8Array): number {
  let crc = -1;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
