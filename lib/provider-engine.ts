/**
 * The conversation engine: one provider turn, its tool rounds, and the normalized events a
 * surface renders — with no HTTP framework and no runtime of its own.
 *
 * Everything here runs on globals (`fetch`, `Response`, `TextDecoder`, `AbortSignal`), so the
 * same code serves the route that answers the browser today and a connector that talks to a
 * provider from inside the browser tomorrow: the caller injects its own `fetch` where the
 * platform's would not do. The route beside it keeps only what is its own — parsing the request
 * body, the demo answer, and how the turn is framed on the wire.
 */

import { unreachableProviderError } from "@/lib/provider-errors";
import type { SpanKind, TurnSpan, TurnStats, UsageTotals } from "@/lib/turn-stats";

/** A part of a user message as the OpenAI wire spells it. */
export type WirePart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type IncomingMessage = {
  role: "user" | "assistant" | "system";
  /** Parts when the turn carried a picture; one string otherwise, as it always was. */
  content: string | WirePart[];
};

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown; label?: string; status: string }
  | { type: "stats"; stats: TurnStats }
  | { type: "error"; error: string }
  | { type: "done"; sessionId?: string };

export type TurnRequest = {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  messages: IncomingMessage[];
  /** What the endpoint said it was when it was checked (`owned_by`), when it said anything. */
  owner?: string;
  capability?: string;
  threadId?: string;
  stream?: boolean;
};

export type TurnOptions = { fetchImpl?: typeof fetch; signal?: AbortSignal };

export type StartedTurn =
  | { ok: true; sessionId: string | null; events: AsyncGenerator<StreamEvent, void, void> }
  | { ok: false; error: string; status: number };

type OpenAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | WirePart[] | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

type ToolCallSummary = {
  id: string;
  name: string;
  arguments: string;
};

type ProviderCall =
  | { ok: true; response: Response }
  | { ok: false; error: string; status: number };

type ContinueAfterTools = (calls: ToolCallSummary[]) => Promise<ProviderCall>;
type ProviderCaller = (turns: OpenAIMessage[]) => Promise<ProviderCall>;

/** The turn's provider connection, opened once and shared by both paths. */
type OpenedTurn =
  | { ok: true; response: Response; sessionId: string | null; continueAfterTools: ContinueAfterTools }
  | { ok: false; error: string; status: number };

type NormalizedToolCall = {
  toolCallId: string;
  name: string;
  arguments: unknown;
  result: { status: string };
};
type ProviderTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: { order_id: { type: "string"; description: string } };
      required: string[];
      additionalProperties: boolean;
    };
  };
};

/**
 * A tool call ends the model's turn, so the answer only arrives once the result
 * is sent back. Bounded so a model that keeps calling tools cannot loop forever.
 */
const MAX_TOOL_ROUNDS = 3;

/** What a translator is given beside the frame itself. */
type Translation = { at: number; round: number };

/**
 * A provider's dialect, as a function over one frame. Each translator is asked in turn and the
 * first one that recognises the frame wins; a frame nobody recognises is ignored without breaking
 * the turn. A translator mutates the turn's state and says whether the frame was its own.
 */
type Translator = {
  name: string;
  translate: (state: DeltaState, eventName: string, payload: unknown, context: Translation) => boolean;
};

/**
 * The translators, in the order they are asked.
 *
 * **`default` must always be the last one in this array.** It is the fallback: the OpenAI-shaped
 * envelope (`choices[].delta`) that every compatible server speaks, which is also the shape a
 * dialect most easily resembles by accident. Keeping it last means a named dialect — Hermes' tool
 * event, a `_thinking` record — is always reached first and can never be shadowed by the fallback.
 * A new dialect goes above `default`, never below it.
 */
const TRANSLATORS: readonly Translator[] = [
  {
    name: "hermes",
    translate: (state, eventName, payload, context) => applyProviderEvent(state, eventName, payload, context.at),
  },
  {
    name: "default",
    translate: (state, _eventName, payload, context) => {
      const delta = firstDelta(payload);
      if (delta === null) return false;
      applyDelta(state, delta, context.round);
      return true;
    },
  },
];

type ToolCall = {
  id?: string;
  type?: string;
  index?: number;
  name?: string;
  arguments?: unknown;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ToolState = {
  id: string;
  name: string;
  arguments: string;
  /** Last arguments value that parsed, so partial JSON never renders. */
  args: unknown;
  /**
   * The provider's own rendering of what the call is for — the URL it is navigating, the
   * pattern it is searching. It is not an argument list, and a provider that reports no
   * arguments at all may still report this.
   */
  label: string;
  status: string;
  /**
   * When the provider said the call started and when it finished, where it says so. The pair is
   * the call's own window; a provider that only names a call leaves these unset, and its window
   * is measured around the naming instead.
   */
  startedAt?: number;
  endedAt?: number;
};

/** The thinking window still growing. Only thinking is ever left open — a call is
 *  filed the moment it is named — so this is what a window means while it runs. */
type OpenSpan = { startedAt: number; lastAt: number; textFrom: number; textTo: number };

type DeltaState = {
  text: string;
  reasoning: string;
  /** Which channel supplied the reasoning, so a mirrored copy is not appended twice. */
  reasoningSource: "details" | "field" | null;
  toolCalls: Map<string, ToolState>;
  /** When the round being consumed began, which the timeline uses as the floor for a
   *  window that has nothing before it. */
  roundStartedAt: number;
  /** When the turn itself began, which no round overwrites: the wait before the first
   *  window is measured back to here, so a turn that runs tools cannot have its own
   *  start moved out from under it. */
  turnStartedAt: number;
  spans: TurnSpan[];
  /** Epoch of the turn's first activity: the timeline's zero. */
  startedAt: number | null;
  /** Where the next window starts — the end of the one before it. */
  cursorAt: number | null;
  /** How long the answer's words were arriving, summed over every run of them: the writing
   *  itself, which is not the span between its first word and its last. */
  answerMs: number;
  /** When the last word landed, while a run of them is still open. Cleared when the turn does
   *  anything else, so the ground between two runs is not counted as writing. */
  answerLastAt: number | null;
  /** The window still open, if any. */
  openSpan: OpenSpan | null;
  /** The thinking window each round filed, so that round's own count can be handed
   *  to it: thinking is reported per response, and a response files one window. */
  reasoningWindow: Map<number, TurnSpan>;
  /** What each round reported for its thinking, for the window that was already
   *  filed by the time the number arrived. */
  roundTokens: Map<number, number>;
  /** Provider usage reported per response round. Latest wins because some
   *  streaming providers repeat cumulative usage before the final chunk. */
  roundUsage: Map<number, UsageTotals>;
  /** Call keys already on the timeline, so a fragment cannot file a second span. */
  spanned: Set<string>;
  usage: UsageTotals | null;
};

/**
 * The session a conversation is carried in, and only for an endpoint that said it keeps one.
 *
 * Hermes named the header first, so a Hermes endpoint is asked in its own spelling and no other
 * endpoint is asked at all. An endpoint that keeps no sessions ignores the header, and beside a
 * browser — where a request whose preflight does not allow every header it carries is refused — an
 * endpoint whose CORS does not list it refuses the whole turn for it. Elvin carries the conversation
 * itself, so a turn without the header is still the whole conversation.
 *
 * The reply is read under either spelling, since an endpoint answers in the one it was asked in.
 */
const SESSION_RESPONSE_HEADER = "x-session-id";
const HERMES_SESSION_HEADER = "X-Hermes-Session-Id";
const HERMES_RESPONSE_HEADER = "x-hermes-session-id";
/** The owner a provider declares in `/models` when the provider is Hermes. */
const HERMES_OWNER = "hermes";

/**
 * Endpoints whose models reason mandatorily reject the reasoning parameter.
 * Remembered per endpoint+model so only the first turn pays for the discovery.
 */
const reasoningRejected = new Set<string>();
/**
 * Endpoints that reject the OpenAI `stream_options` field outright. Same rule as
 * reasoning — remember the refusal per endpoint+model rather than carry a table
 * of who supports it — and estimate the tokens instead.
 */
const usageRejected = new Set<string>();

/** What a refusal looks like in a provider's own error text. */
const REFUSAL: Record<"reasoning" | "usage", RegExp> = {
  reasoning: /reason/i,
  usage: /stream_options|include_usage/i,
};

/**
 * Runs one turn (tool rounds and all) and yields Elvin's normalized events: one snapshot per
 * update the provider made, ending in `done` with the session the conversation was carried in.
 *
 * The provider's first response is awaited here, so a turn that cannot be started at all is a
 * refusal the caller answers with its own status rather than a stream that has to fail.
 */
export async function startTurn(request: TurnRequest, options: TurnOptions = {}): Promise<StartedTurn> {
  const turn = await openTurn(request, options);
  if (!turn.ok) return { ok: false, error: turn.error, status: turn.status };
  return { ok: true, sessionId: turn.sessionId, events: eventStream(turn.response, turn.sessionId, turn.continueAfterTools) };
}

/**
 * Opens the turn's provider connection and hands back what either path needs from it: the first
 * response, the session it was carried in, and the continuation its tool rounds run on.
 */
async function openTurn(request: TurnRequest, options: TurnOptions): Promise<OpenedTurn> {
  const endpoint = chatCompletionsEndpoint(request.baseUrl);
  const model = request.model?.trim() || "gpt-4o-mini";
  const tools: ProviderTool[] = [sampleOrderTool()];
  const conversation = buildConversation(request.messages);
  const callProvider = createProviderCaller({
    body: request,
    endpoint,
    headers: providerHeaders(request),
    model,
    signal: options.signal,
    fetchImpl: options.fetchImpl ?? fetch,
    tools,
  });
  const continueAfterTools = createToolContinuation(conversation, callProvider);

  let call: ProviderCall;
  try {
    call = await callProvider(conversation);
  } catch (error) {
    return { ok: false, error: unreachableProviderError(endpoint, error), status: 502 };
  }

  if (!call.ok) return { ok: false, error: call.error, status: call.status };

  return { ok: true, response: call.response, sessionId: sessionIdOf(call.response, request.threadId), continueAfterTools };
}

function buildConversation(messages: IncomingMessage[]): OpenAIMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are being tested inside Elvin, an agent UX playground.",
        "Use tools when they materially improve the answer.",
        "If your provider supports a reasoning field, keep it concise.",
      ].join(" "),
    },
    ...messages.map((message) => ({
      role: message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }) satisfies OpenAIMessage),
  ];
}

function providerHeaders(body: TurnRequest): Record<string, string> {
  const session = body.threadId?.trim();
  return {
    "Content-Type": "application/json",
    ...(body.apiKey?.trim() ? { Authorization: `Bearer ${body.apiKey.trim()}` } : {}),
    ...(session && isHermes(body.owner) ? { [HERMES_SESSION_HEADER]: session } : {}),
  };
}

/** Whether the endpoint said, when it was checked, that it is Hermes. */
function isHermes(owner: string | undefined): boolean {
  return owner?.trim().toLowerCase() === HERMES_OWNER;
}

function createProviderCaller(options: {
  body: TurnRequest;
  endpoint: string;
  headers: Record<string, string>;
  model: string;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
  tools: ProviderTool[];
}): ProviderCaller {
  const cacheKey = `${options.endpoint}|${options.model}`;

  return async function callProvider(turns: OpenAIMessage[]): Promise<ProviderCall> {
    const payload: Record<string, unknown> = {
      model: options.model,
      messages: turns,
      temperature: 0.2,
      stream: Boolean(options.body.stream),
      ...(options.body.capability ? { capability: options.body.capability } : {}),
      ...(options.tools ? { tools: options.tools, tool_choice: "auto" } : {}),
    };

    // Both extras are asked for by what the wire allows rather than by model
    // name, and each refusal is remembered: reasoning because mandatory models
    // 400 on it, usage because not every endpoint knows `stream_options`.
    const include = {
      reasoning: !reasoningRejected.has(cacheKey),
      usage: Boolean(options.body.stream) && !usageRejected.has(cacheKey),
    };

    let attempt = await fetchProvider(options, payload, include);
    if (attempt.ok) return { ok: true, response: attempt };

    let failureText = await attempt.text();
    let failureStatus = attempt.status;
    for (const extra of ["reasoning", "usage"] as const) {
      if (!include[extra] || !REFUSAL[extra].test(failureText)) continue;
      if (extra === "reasoning") reasoningRejected.add(cacheKey);
      else usageRejected.add(cacheKey);
      include[extra] = false;
      attempt = await fetchProvider(options, payload, include);
      if (attempt.ok) return { ok: true, response: attempt };
      failureText = await attempt.text();
      failureStatus = attempt.status;
    }
    return { ok: false, error: providerError(safeJson(failureText), failureStatus), status: failureStatus };
  };
}

function fetchProvider(
  options: {
    endpoint: string;
    headers: Record<string, string>;
    signal?: AbortSignal;
    fetchImpl: typeof fetch;
  },
  payload: Record<string, unknown>,
  include: { reasoning: boolean; usage: boolean },
) {
  return options.fetchImpl(options.endpoint, {
    method: "POST",
    headers: options.headers,
    body: JSON.stringify({
      ...payload,
      ...(include.reasoning ? { reasoning: { enabled: true } } : {}),
      // Without this the provider reports no usage at all: its own accounting
      // arrives in a final chunk that carries no choices.
      ...(include.usage ? { stream_options: { include_usage: true } } : {}),
    }),
    signal: options.signal,
  });
}

function createToolContinuation(conversation: OpenAIMessage[], callProvider: ProviderCaller): ContinueAfterTools {
  return async function continueAfterTools(calls: ToolCallSummary[]): Promise<ProviderCall> {
    appendAssistantToolCalls(conversation, calls);
    appendToolResults(conversation, calls);
    return callProvider(conversation);
  };
}

function appendAssistantToolCalls(conversation: OpenAIMessage[], calls: ToolCallSummary[]) {
  conversation.push({
    role: "assistant",
    content: null,
    tool_calls: calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
  });
}

function appendToolResults(conversation: OpenAIMessage[], calls: ToolCallSummary[]) {
  for (const call of calls) {
    conversation.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(executeTool(call.name, call.arguments)),
    });
  }
}

/**
 * The session the provider actually used — its own when it ignores our header, and under either
 * spelling, since a Hermes endpoint answers with the header it was asked in.
 */
function sessionIdOf(response: Response, requested?: string) {
  return response.headers.get(SESSION_RESPONSE_HEADER) ?? response.headers.get(HERMES_RESPONSE_HEADER) ?? requested?.trim() ?? null;
}

/**
 * Tool stubs: a real app calls its own systems here. The workspace has one tool,
 * and the point of the testbed is the round trip rather than the payload.
 */
function executeTool(name: string, rawArguments: string) {
  const args: unknown = safeJson(rawArguments.length > 0 ? rawArguments : "{}");
  const orderId = args && typeof args === "object" && "order_id" in args && typeof args.order_id === "string" ? args.order_id : "4821";
  if (name === "get_order_status") {
    return {
      order_id: orderId,
      status: "in_transit",
      carrier: "UPS",
      eta: "2026-09-24",
      note: "Stubbed by the Elvin testbed.",
    };
  }
  return { error: `The testbed has no stub for "${name}".` };
}

function toToolCallSummaries(value: unknown): ToolCallSummary[] {
  return normalizeToolCalls(value).map((call) => ({
    id: call.toolCallId,
    name: call.name,
    arguments: JSON.stringify(call.arguments),
  }));
}

/** Tool calls opened during one provider turn. */
function roundToolCalls(state: DeltaState, round: number): ToolCallSummary[] {
  const prefix = `round-${round}-`;
  return [...state.toolCalls.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, call]) => ({ id: call.id, name: call.name, arguments: call.arguments }));
}

function toolStateFromNormalizedCall(call: NormalizedToolCall, status: ToolState["status"]): ToolState {
  return {
    id: call.toolCallId,
    name: call.name,
    arguments: JSON.stringify(call.arguments),
    args: call.arguments,
    label: "",
    status,
  };
}

/**
 * Consumes one provider turn into `state`, emitting snapshots as it goes, and
 * returns the tool calls that turn asked for.
 */
async function consumeStream(upstream: Response, round: number, state: DeltaState, emit: () => Promise<void>): Promise<ToolCallSummary[]> {
  state.roundStartedAt = Date.now();
  const isEventStream = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");

  if (!isEventStream) {
    const data = safeJson(await upstream.text());
    const choice = firstChoiceMessage(data);
    const before = snapshotOf(state);
    const reasoning = reasoningContent(choice, data);
    if (reasoning) {
      state.reasoning += reasoning;
      state.reasoningSource = "field";
    }
    for (const call of normalizeToolCalls(choice.tool_calls)) {
      state.toolCalls.set(`round-${round}-${call.toolCallId}`, toolStateFromNormalizedCall(call, "completed"));
    }
    const content = textContent(choice);
    if (content) state.text += content;
    recordUsage(state, data, round);
    stamp(state, before, round);
    await emit();
    return roundToolCalls(state, round);
  }

  const reader = upstream.body?.getReader();
  if (!reader) throw new Error("Provider returned no stream body.");
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  /** Which dialect each frame arrived in, for the log below. */
  const claims = new Map<string, number>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.length === 0) {
        eventName = "";
        continue;
      }
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const chunk = line.slice(5).trim();
      if (chunk.length === 0 || chunk === "[DONE]") continue;

      const payload = safeJson(chunk);
      const usedUsage = recordUsage(state, payload, round);
      const before = snapshotOf(state);
      const context: Translation = { at: Date.now(), round };
      let changed = false;
      for (const translator of TRANSLATORS) {
        if (!translator.translate(state, eventName, payload, context)) continue;
        changed = true;
        claims.set(translator.name, (claims.get(translator.name) ?? 0) + 1);
        break;
      }
      if (changed) stamp(state, before, round);
      // A usage-only chunk draws nothing, but it is the one frame carrying the
      // provider's own token counts, so it is forwarded rather than dropped.
      if (changed || usedUsage) await emit();
    }
  }

  // Which dialect the frames of this turn arrived in. A turn that used two translators is a fact
  // worth being able to read rather than infer.
  console.log(`[chat] frames claimed by ${[...claims].map(([name, count]) => `${name}×${count}`).join(", ") || "nothing"}`);
  // The turn is over once the stream ends, so its tool calls are settled.
  for (const [key, call] of state.toolCalls) {
    if (key.startsWith(`round-${round}-`)) state.toolCalls.set(key, { ...call, status: "completed" });
  }
  // This round's stream is over, so a run it left open ended with its own last
  // delta. The next round opens a new one, which is what gives the reasoning row
  // more than one bar.
  closeSpan(state, state.openSpan?.lastAt ?? Date.now(), round);
  await emit();
  return roundToolCalls(state, round);
}

/**
 * The turn's events, handed over one at a time. The turn pushes each snapshot the moment it has
 * read the frame that made it and then waits for the reader to take it, so the reader's own work
 * — framing the event, writing it — falls between the provider's bytes rather than beside them:
 * a reader that stops asking stops the provider from being drained into memory, and the turn's
 * clocks keep measuring the run the way they did when producer and reader were the same loop.
 */
function eventQueue() {
  const queue: StreamEvent[] = [];
  let waiting: (() => void) | null = null;
  let delivered: (() => void) | null = null;
  let pushed = 0;
  let taken = 0;
  let closed = false;

  const settle = () => {
    if (taken < pushed || delivered === null) return;
    const resolve = delivered;
    delivered = null;
    resolve();
  };

  return {
    push(event: StreamEvent) {
      if (closed) return;
      queue.push(event);
      pushed += 1;
      waiting?.();
      waiting = null;
    },
    /** Resolves once every event pushed so far has been taken by whoever is reading. */
    delivered(): Promise<void> {
      if (taken >= pushed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        delivered = resolve;
        settle();
      });
    },
    close() {
      closed = true;
      waiting?.();
      waiting = null;
      // Nobody is taking anything else, so a turn parked for a reader that has gone away lets go
      // of it rather than staying parked: it finishes its round and its reader's `finally` runs.
      delivered?.();
      delivered = null;
    },
    async shift(): Promise<StreamEvent | null> {
      while (queue.length === 0 && !closed) {
        await new Promise<void>((resolve) => {
          waiting = resolve;
        });
      }
      const event = queue.shift() ?? null;
      if (event !== null) {
        taken += 1;
        settle();
      }
      return event;
    },
  };
}

/**
 * Normalizes any provider response into one event per update, so the client
 * adapter only has to accumulate snapshots instead of parsing provider deltas.
 */
async function* eventStream(
  upstream: Response,
  sessionId: string | null,
  continueAfterTools: ContinueAfterTools,
): AsyncGenerator<StreamEvent, void, void> {
  const queue = eventQueue();
  const turnStartedAt = Date.now();
  const state: DeltaState = {
    text: "",
    reasoning: "",
    reasoningSource: null,
    toolCalls: new Map(),
    roundStartedAt: turnStartedAt,
    turnStartedAt,
    spans: [],
    startedAt: null,
    cursorAt: null,
    answerMs: 0,
    answerLastAt: null,
    openSpan: null,
    reasoningWindow: new Map(),
    roundTokens: new Map(),
    roundUsage: new Map(),
    spanned: new Set(),
    usage: null,
  };
  const emit = async () => {
    for (const event of snapshotEvents(state)) queue.push(event);
    // The turn waits for the reader to take these before it reads on, so the work the reading
    // side does — framing and writing each frame — lands between the provider's bytes rather than
    // running beside them. That is both the backpressure a reader is owed and the only way the
    // turn's own clocks keep measuring what they measured when producer and reader were one loop.
    await queue.delivered();
  };

  const running = (async () => {
    try {
      let current = upstream;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const produced = await consumeStream(current, round, state, emit);
        if (produced.length === 0 || !continueAfterTools) break;

        const next = await continueAfterTools(produced);
        if (!next.ok) {
          queue.push({ type: "error", error: next.error });
          break;
        }
        current = next.response;
      }
      queue.push({ type: "done", sessionId: sessionId ?? undefined });
    } catch (error) {
      queue.push({ type: "error", error: error instanceof Error ? error.message : "Stream failed." });
    } finally {
      queue.close();
    }
  })();

  let drained = false;
  try {
    for (;;) {
      const event = await queue.shift();
      if (event === null) break;
      yield event;
    }
    await running;
    drained = true;
  } finally {
    // A consumer that stopped pulling — the browser went away, the response was aborted — stops
    // the provider's side of the turn too, rather than leaving it writing into nothing.
    if (!drained) {
      queue.close();
      void upstream.body?.cancel();
    }
  }
}

function applyDelta(state: DeltaState, delta: Record<string, unknown>, round: number) {
  if (typeof delta.content === "string") state.text += delta.content;

  // Providers deliver thinking as a plain field or as structured details, often
  // both at once carrying the same text. Track the channel in use so the
  // mirrored copy is not counted twice.
  const detailText = reasoningFromDetails(delta.reasoning_details);
  if (detailText.length > 0) {
    state.reasoning += detailText;
    state.reasoningSource = "details";
  } else if (state.reasoningSource !== "details") {
    const field = reasoningField(delta);
    if (field.length > 0) {
      state.reasoning += field;
      state.reasoningSource = "field";
    }
  }

  if (!Array.isArray(delta.tool_calls)) return;

  for (const rawCall of delta.tool_calls as ToolCall[]) {
    const index = rawCall.index ?? state.toolCalls.size;
    const key = `round-${round}-${index}`;
    const prior = state.toolCalls.get(key) ?? emptyToolState(rawCall, index);
    state.toolCalls.set(key, applyToolCallDelta(prior, rawCall));
  }
}

function reasoningField(delta: Record<string, unknown>): string {
  if (typeof delta.reasoning === "string") {
    return delta.reasoning;
  }
  if (typeof delta.reasoning_content === "string") {
    return delta.reasoning_content;
  }
  return "";
}

function emptyToolState(rawCall: ToolCall, index: number): ToolState {
  return {
    id: rawCall.id ?? `tool-${index}`,
    name: "",
    arguments: "",
    args: {},
    label: "",
    status: "running",
  };
}

function applyToolCallDelta(prior: ToolState, rawCall: ToolCall): ToolState {
  const fragment = rawCall.function?.arguments ?? (typeof rawCall.arguments === "string" ? rawCall.arguments : "");
  const argsText = `${prior.arguments}${fragment}`;

  // Hold the last value that parsed, so a half-streamed JSON fragment never
  // becomes the tool's displayed arguments.
  let args = prior.args;
  try {
    args = JSON.parse(argsText);
  } catch {
    /* mid-fragment */
  }

  return {
    id: rawCall.id ?? prior.id,
    name: `${prior.name}${rawCall.function?.name ?? rawCall.name ?? ""}`,
    arguments: argsText,
    args,
    label: prior.label,
    status: prior.status,
  };
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * Providers that run tools and stream thinking server side announce it as named
 * SSE events rather than OpenAI `delta.tool_calls` / `delta.reasoning_content`:
 * a tool event carrying `tool`, and thinking as the same shape with
 * `tool: "_thinking"`.
 */
function applyProviderEvent(state: DeltaState, eventName: string, payload: unknown, at: number) {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const tool = firstString(record.tool, record.tool_name, record.toolName);

  if (tool === "_thinking") {
    const thinking = firstString(record.delta, record.preview, record.label, record.text);
    if (!thinking) return false;
    state.reasoning += thinking;
    return true;
  }

  if (tool) {
    const id = firstString(record.toolCallId, record.call_id, record.id) ?? `tool-${state.toolCalls.size}`;
    const key = `event-${id}`;
    const prior = state.toolCalls.get(key);
    const hinted = firstString(record.status, record.state);
    const status = providerToolStatus(eventName, hinted);
    // The event may quote the call as an object or as the JSON string OpenAI uses, and both are
    // read: a card that cannot show what a call was called with has nothing to show at all, and
    // the provider's label for the step is no substitute for it.
    const carried = record.args ?? record.arguments ?? prior?.args;
    const args = typeof carried === "string" ? safeJson(carried.length > 0 ? carried : "{}") : carried ?? {};
    // A provider that says when a call starts and when it finishes has timed the call itself, and
    // that pair is the window it gets: measuring around the moment the call was named instead
    // reports the model's writing time whenever the provider runs the tool on its own side.
    const startedAt = prior?.startedAt ?? (status === "running" ? at : undefined);
    const endedAt = prior?.endedAt ?? (status === "running" ? undefined : at);
    state.toolCalls.set(key, {
      id,
      name: tool,
      arguments: typeof record.arguments === "string" ? record.arguments : prior?.arguments ?? "",
      args,
      label: firstString(record.label, record.preview, record.detail) ?? prior?.label ?? "",
      status,
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(endedAt !== undefined ? { endedAt } : {}),
    });
    if (startedAt !== undefined && endedAt !== undefined && prior?.endedAt === undefined) {
      pushSpan(state, { kind: "tool", id, startedAt, endedAt });
    }
    return true;
  }

  if (eventName === "assistant.delta") {
    const text = firstString(record.delta, record.text);
    if (!text) return false;
    state.text += text;
    return true;
  }

  if (eventName === "assistant.completed") {
    const text = firstString(record.content, record.text);
    if (!text) return false;
    state.text = text;
    return true;
  }

  if (eventName === "error") {
    state.text = firstString(record.message, record.error) ?? "The agent reported an error.";
    return true;
  }

  return false;
}

function providerToolStatus(eventName: string, hinted?: string): ToolState["status"] {
  if (eventName === "tool.failed") return "failed";
  if (eventName === "tool.completed" || hinted === "completed" || hinted === "done") return "completed";
  return "running";
}

function toolCallEvent(call: ToolState): StreamEvent {
  return {
    type: "tool-call",
    toolCallId: call.id,
    toolName: call.name,
    args: call.args,
    ...(call.label.length > 0 ? { label: call.label } : {}),
    status: call.status,
  };
}

function snapshotEvents(state: DeltaState): StreamEvent[] {
  const events: StreamEvent[] = [];
  if (state.reasoning.length > 0) {
    events.push({ type: "reasoning", text: state.reasoning });
  }
  for (const call of state.toolCalls.values()) {
    if (call.name.length === 0) continue;
    events.push(toolCallEvent(call));
  }
  if (state.text.length > 0) {
    events.push({ type: "text", text: state.text });
  }
  // The clocks ride every snapshot: a part's window is only known once it has
  // closed, so the last frame of a turn carries the finished numbers.
  events.push({ type: "stats", stats: turnStats(state) });
  return events;
}

function snapshotOf(state: DeltaState) {
  return { reasoning: state.reasoning.length, text: state.text.length, calls: state.toolCalls.size };
}

/**
 * Files what the wire just did onto the turn's timeline. Comparing sizes instead
 * of reading every provider shape keeps this in one place: the OpenAI delta path,
 * the named-event path and the one-shot response all end up here.
 *
 * Windows tile the work instead of overlapping it — a reasoning run ends where
 * its own last delta landed, and the call that follows is measured from there —
 * so a turn that thinks, calls, thinks again and calls again files four windows
 * in order. That is what lets the reasoning row draw more than one bar.
 */
function stamp(state: DeltaState, before: { reasoning: number; text: number; calls: number }, round: number) {
  const now = Date.now();
  const grewReasoning = state.reasoning.length > before.reasoning;
  const grewText = state.text.length > before.text;
  const grewCalls = state.toolCalls.size > before.calls;
  if (!grewReasoning && !grewText && !grewCalls) return;
  if (grewText) {
    // The answer is the turn's output rather than a window of work: it closes
    // the run before it, moves the cursor past itself, and is measured on its
    // own so a surface can say how long the writing took. Measured per run of
    // words, like every other window here: a turn that speaks, works, then
    // speaks again was not writing during the work.
    closeSpan(state, state.openSpan?.lastAt ?? now, round);
    state.cursorAt = now;
    if (state.answerLastAt !== null) state.answerMs += now - state.answerLastAt;
    state.answerLastAt = now;
  }
  // A run of words ends wherever the turn does something else.
  if (grewReasoning || grewCalls) state.answerLastAt = null;

  if (grewReasoning) {
    if (state.openSpan === null) {
      // `before` is the trace as it stood before this delta, so the window opens
      // where the words it is about to file begin.
      state.openSpan = { startedAt: now, lastAt: now, textFrom: before.reasoning, textTo: state.reasoning.length };
    } else {
      state.openSpan.lastAt = now;
      state.openSpan.textTo = state.reasoning.length;
    }
  }

  if (!grewCalls) return;
  for (const [key, call] of state.toolCalls) {
    if (state.spanned.has(key)) continue;
    state.spanned.add(key);
    // Whatever ran before the call ended where it last spoke, whoever is timing the call: a call
    // interrupts thinking, so the run is closed here either way.
    closeSpan(state, state.openSpan?.lastAt ?? now, round);
    // A call the provider times itself has its own window already, filed from the start and the
    // end it reported, so this stretch — which ends where the call was named — is not the call's
    // and is not filed for it. Filed by both, the panel drew the call twice and the card read the
    // naming time with the call's real window sitting behind it.
    if (call.startedAt !== undefined) continue;
    pushSpan(state, { kind: "tool", id: call.id, startedAt: state.cursorAt ?? state.roundStartedAt, endedAt: now });
    state.cursorAt = now;
  }
}

/** Files the open window, ending it at `at`, and moves the cursor there. */
function closeSpan(state: DeltaState, at: number, round: number) {
  const open = state.openSpan;
  if (!open) return;
  state.reasoningWindow.set(round, pushSpan(state, {
    kind: "reasoning",
    startedAt: open.startedAt,
    endedAt: at,
    textFrom: open.textFrom,
    textTo: open.textTo,
  }));
  state.cursorAt = at;
  state.openSpan = null;
  attachReasoningTokens(state, round);
}

/**
 * Hands a round's reported thinking count to the window that round filed. The
 * provider reports thinking per response rather than per window, so whichever of
 * the two arrives second does the handing over.
 */
function attachReasoningTokens(state: DeltaState, round: number): void {
  const tokens = state.roundTokens.get(round);
  const window = state.reasoningWindow.get(round);
  if (tokens === undefined || window === undefined) return;
  window.tokens = tokens;
}

function pushSpan(state: DeltaState, span: { kind: SpanKind; id?: string; startedAt: number; endedAt: number; textFrom?: number; textTo?: number }): TurnSpan {
  if (state.startedAt === null) state.startedAt = span.startedAt;
  // Every window is filed, including one whose two ends landed in the same
  // millisecond: dropping those here would make the count depend on the clock,
  // and a row that cannot claim a length simply draws no bar. See `Timeline`.
  const filed: TurnSpan = {
    kind: span.kind,
    ...(span.id !== undefined ? { id: span.id } : {}),
    // Where the window's words sit in the trace, for the windows that have words
    // to place: a card drawing the whole trace can then point at the stretch a
    // row measured rather than the two having to guess at each other.
    ...(span.textFrom !== undefined ? { textFrom: span.textFrom } : {}),
    ...(span.textTo !== undefined ? { textTo: span.textTo } : {}),
    startMs: Math.max(0, span.startedAt - state.startedAt),
    ms: Math.max(0, span.endedAt - span.startedAt),
  };
  state.spans.push(filed);
  return filed;
}

function turnStats(state: DeltaState): TurnStats {
  // The window the rows are laid out against is the work the turn did, so it
  // ends where the last row ends. The answer is the turn's output rather than
  // another window, and it is measured the way every other window here is: the
  // time its words were arriving, summed over each run of them. An agentic turn
  // speaks, works, then speaks again, so the span between its first word and its
  // last is the whole run — which is what made the output row claim the tool
  // rounds inside it. The stretches no row claims — a tool running, the provider
  // thinking before its next token — stay gaps inside this window, which is why
  // the bars still do not add up to it.
  const answerMs = state.answerMs > 0 ? state.answerMs : undefined;
  return {
    // Copied rather than handed over: an event outlives the moment it was made — a caller may
    // serialize it whenever it pulls it — and the turn keeps filing windows into this array, and
    // fills a window's token count in after the round it belongs to reports it.
    spans: state.spans.map((span) => ({ ...span })),
    ...(answerMs !== undefined ? { answerMs } : {}),
    totalMs: state.spans.reduce((end, span) => Math.max(end, span.startMs + span.ms), 0),
    // The turn's own clock starts when the request did; the windows' clock starts at
    // the first thing the provider said. A surface that draws the run end to end
    // needs both, so the difference is filed rather than left to be guessed.
    ...(state.startedAt !== null ? { leadMs: Math.max(0, state.startedAt - state.turnStartedAt) } : {}),
    usage: state.usage,
    estimated: state.usage === null,
  };
}

/**
 * The provider's own accounting, which OpenAI-compatible endpoints only send
 * when `stream_options.include_usage` was asked for; one entry per provider call,
 * so a tool round trip reports its own. Field names differ by vendor, and only
 * some split thinking out of the completion count.
 */
function usageOf(payload: unknown): UsageTotals | null {

  if (!payload || typeof payload !== "object" || !("usage" in payload)) return null;
  const usage = payload.usage;
  if (!usage || typeof usage !== "object") return null;

  const prompt = numberOr("prompt_tokens" in usage ? usage.prompt_tokens : undefined) ?? numberOr("input_tokens" in usage ? usage.input_tokens : undefined);
  const completion = numberOr("completion_tokens" in usage ? usage.completion_tokens : undefined) ?? numberOr("output_tokens" in usage ? usage.output_tokens : undefined);
  const total = numberOr("total_tokens" in usage ? usage.total_tokens : undefined) ?? (prompt !== undefined && completion !== undefined ? prompt + completion : undefined);
  if (prompt === undefined && completion === undefined && total === undefined) return null;

  const details = "completion_tokens_details" in usage ? usage.completion_tokens_details : "output_tokens_details" in usage ? usage.output_tokens_details : undefined;
  const reasoningTokens = details && typeof details === "object" && "reasoning_tokens" in details ? numberOr(details.reasoning_tokens) : undefined;
  // Prompt caching arrives in three shapes in the wild: OpenAI nests the hit under
  // prompt_tokens_details, DeepSeek names it outright, and some shims pass Anthropic's
  // cache read through. Whichever it is, it is the part of the input the provider did not
  // have to read again.
  const promptDetails = "prompt_tokens_details" in usage ? usage.prompt_tokens_details : "input_tokens_details" in usage ? usage.input_tokens_details : undefined;
  const cachedTokens =
    (promptDetails && typeof promptDetails === "object" && "cached_tokens" in promptDetails ? numberOr(promptDetails.cached_tokens) : undefined) ??
    numberOr("prompt_cache_hit_tokens" in usage ? usage.prompt_cache_hit_tokens : undefined) ??
    numberOr("cache_read_input_tokens" in usage ? usage.cache_read_input_tokens : undefined);
  return {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0,
    totalTokens: total ?? 0,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    cachedTokens: cachedTokens ?? null,
  };
}

function recordUsage(state: DeltaState, payload: unknown, round: number): boolean {
  const usage = usageOf(payload);
  if (!usage) return false;
  state.roundUsage.set(round, usage);
  state.usage = [...state.roundUsage.values()].reduce<UsageTotals | null>((total, item) => (total ? addUsage(total, item) : item), null);
  // Kept per round as well as in the turn's total: a thinking window is what the
  // count belongs to, and the window may already have been filed.
  if (usage.reasoningTokens !== undefined) state.roundTokens.set(round, usage.reasoningTokens);
  attachReasoningTokens(state, round);
  return true;
}

function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  const reasoning = a.reasoningTokens !== undefined || b.reasoningTokens !== undefined ? (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0) : undefined;
  const cached = [a.cachedTokens, b.cachedTokens].reduce<number | null>((sum, value) => (typeof value === "number" ? (sum ?? 0) + value : sum), null);
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
    cachedTokens: cached,
  };
}

function numberOr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function chatCompletionsEndpoint(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function sampleOrderTool(): ProviderTool {
  return {
    type: "function",
    function: {
      name: "get_order_status",
      description: "Look up shipment status for a customer order.",
      parameters: {
        type: "object",
        properties: { order_id: { type: "string", description: "Order number without the # prefix." } },
        required: ["order_id"],
        additionalProperties: false,
      },
    },
  };
}

function firstChoiceMessage(data: unknown) {
  const record = data as { choices?: Array<{ message?: Record<string, unknown> }>; output?: Array<Record<string, unknown>> } | null;
  const message = record?.choices?.[0]?.message;
  if (message) return message;
  return record?.output?.[0] ?? {};
}

function textContent(message: Record<string, unknown>) {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content.map((part) => {
    const value = part as { text?: string; type?: string; content?: string };
    return value.text ?? value.content ?? "";
  }).join("").trim();
}

/** Thinking arrives either as a plain field or as structured details; join the latter. */
function reasoningFromDetails(value: unknown) {
  if (!Array.isArray(value)) return "";
  let text = "";
  for (const detail of value) {
    if (typeof detail === "string") {
      text += detail;
      continue;
    }
    if (detail && typeof detail === "object" && "text" in detail && typeof detail.text === "string") {
      text += detail.text;
    }
  }
  return text;
}

function reasoningContent(message: Record<string, unknown>, data: unknown) {
  const details = reasoningFromDetails(message.reasoning_details);
  if (details.length > 0) return details;
  const response = data as Record<string, unknown> | null;
  const direct = message.reasoning_content ?? message.reasoning ?? response?.reasoning;
  if (typeof direct === "string") return direct;
  return null;
}

function normalizeToolCalls(value: unknown): NormalizedToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.map((toolCall: ToolCall, index) => {
    const raw = toolCall.function?.arguments ?? toolCall.arguments ?? {};
    const args = typeof raw === "string" ? parseArguments(raw) : raw;
    return {
      toolCallId: toolCall.id ?? `tool-${index}`,
      name: toolCall.function?.name ?? toolCall.name ?? "tool_call",
      arguments: args,
      result: { status: "requested_by_agent" },
    };
  });
}

function toolOnlyFallback(value: unknown) {
  const calls = normalizeToolCalls(value);
  if (calls.length === 0) return "The agent returned an empty response.";
  return `The agent requested ${calls.length} tool call${calls.length === 1 ? "" : "s"}.`;
}

function providerError(data: unknown, status: number) {
  const record = data as { error?: { message?: string }; message?: string; raw?: string } | null;
  return record?.error?.message ?? record?.message ?? record?.raw ?? `Provider returned HTTP ${status}.`;
}

export function demoAnswer(prompt: string) {
  const orderId = prompt.match(/#?(\d{3,})/)?.[1] ?? "4821";
  return `Order #${orderId} is in transit with UPS. It was held at the Memphis hub, so the new delivery estimate is Thursday, September 24. Want me to send you the tracking link?`;
}
