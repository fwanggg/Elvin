/** app/api/chat/route.ts: the provider conversation, tool rounds and all. */
export function chatRouteSource(): string {
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
  'Use tools when they materially improve the answer.',
  'If your provider supports a reasoning field, keep it concise.',
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
  const tools = TOOL_DEFINITIONS;

  const conversation: WireMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(body.messages ?? []),
  ];

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.AGENT_API_KEY) headers.Authorization = \`Bearer \${process.env.AGENT_API_KEY}\`;
  if (body.threadId) headers[SESSION_HEADER] = body.threadId;

  const reasoning = { reasoning: { enabled: true } };
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
