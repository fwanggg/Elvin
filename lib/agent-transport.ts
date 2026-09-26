/**
 * How a turn reaches the provider: this browser makes the call.
 *
 * There is one transport, and it is the page's own. The engine runs here, so the agent is called
 * from here too — the realm the reader is in, which is the only realm that can answer for an agent
 * on their machine or their network. A server-side hop through Elvin's own route used to sit in the
 * middle of that call; it could not serve the case that needed it most (a server asking for
 * `127.0.0.1` asks itself, and a private address means nothing outside its own network) and it put a
 * second machine in the path of every other case.
 *
 * What is left is the call itself (`directEvents`), the check the connect screen makes before a turn
 * (`directProbe`), and the reading of a failure the browser will not explain.
 */

import { demoAnswer, startTurn, type IncomingMessage, type StreamEvent } from "@/lib/provider-engine";

/** One turn, as the adapter has always sent it: the same fields, made here instead of by a route. */
export type TransportTurn = {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  messages: IncomingMessage[];
  /** What the endpoint said it was when it was checked (`owned_by`), when it said anything. */
  owner?: string;
  capability?: string;
  threadId?: string;
  signal?: AbortSignal;
};

/** What a connection check answers with. */
export type ProbeResult = {
  ok: boolean;
  model?: string;
  models?: string[];
  capabilities?: string[];
  owner?: string;
  error?: string;
};

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const MODELS_PATH = "/models";
const CAPABILITIES_PATH = "/capabilities";

/**
 * The address space Chrome sorts an endpoint into, under Chrome's own names: `loopback` for this
 * machine, `local` for the network it sits on, and null for anywhere a reader's browser can already
 * reach.
 *
 * It decides one thing: what the request claims about itself, which is what makes Chrome ask the
 * reader for Local Network Access instead of refusing outright. Chrome checks that claim against the
 * address it resolved and refuses a mismatch — calling a `127.0.0.1` target `local` is a failure, not
 * a permission request — so the two names have to agree. It never decides whether a turn is allowed.
 */
function addressSpaceOf(url: string): "loopback" | "local" | null {
  const host = hostOf(url);
  if (host === null) return null;
  if (host === "localhost" || host === "::1" || host.startsWith("127.")) return "loopback";
  return isLocalHost(host) ? "local" : null;
}

/** Whether the endpoint is one only this machine, or its own network, could answer for. */
export function isLocalEndpoint(url: string): boolean {
  return addressSpaceOf(url) !== null;
}

/**
 * One turn, made here: the browser calls the agent, cross-origin and all.
 *
 * The engine words an unreachable endpoint as a server would, because that is where it used to be
 * called from; here the browser is the caller, so a call that never got out is reported in the
 * browser's own terms (see `explainFailure`). A provider that answered and refused keeps its own
 * message, which is not a failure of the network.
 */
export async function* directEvents(turn: TransportTurn): AsyncGenerator<StreamEvent, void, void> {
  const startedAt = Date.now();
  if (turn.baseUrl.trim().length === 0) {
    yield* demoEvents(turn.messages, startedAt);
    return;
  }

  const failure: { caught?: unknown } = {};
  const started = await startTurn(
    {
      baseUrl: turn.baseUrl,
      apiKey: turn.apiKey,
      model: turn.model,
      messages: turn.messages,
      owner: turn.owner,
      capability: turn.capability,
      threadId: turn.threadId,
      stream: true,
    },
    { fetchImpl: realmFetch(turn.baseUrl, failure), signal: turn.signal },
  );

  if (!started.ok) {
    // A turn the reader stopped is a cancellation rather than a turn that failed: nothing is
    // written into the transcript for it.
    if (turn.signal?.aborted) throw failure.caught ?? new DOMException("The turn was cancelled.", "AbortError");
    yield {
      type: "error",
      error: failure.caught === undefined ? started.error : await explainFailure(turn.baseUrl, failure.caught),
    };
    return;
  }

  yield* started.events;
}

/**
 * The connect screen's check: this realm asks the endpoint what it is. The models list says which
 * model to send and what the endpoint calls itself — the one fact a harness needs before it is
 * spoken to — and the capabilities list is a courtesy the endpoint is allowed not to have.
 */
export async function directProbe(request: { baseUrl: string; apiKey?: string; model?: string }): Promise<ProbeResult> {
  const baseUrl = request.baseUrl.trim().replace(/\/+$/, "");
  const listed = await getProvider(endpointFor(baseUrl, MODELS_PATH, [CHAT_COMPLETIONS_PATH]), request.apiKey);
  if (!listed.ok) return { ok: false, error: listed.error };

  const { models, owner } = readModels(listed.body);
  const offered = await getProvider(endpointFor(baseUrl, CAPABILITIES_PATH, [MODELS_PATH, CHAT_COMPLETIONS_PATH]), request.apiKey);

  return {
    ok: true,
    model: request.model || models[0],
    models,
    // An endpoint that publishes no capabilities is still connected: the turn never reads them.
    capabilities: offered.ok ? readCapabilities(offered.body) : [],
    ...(owner !== undefined ? { owner } : {}),
  };
}

/**
 * The demo turn: what the sandbox shows with no agent named. The order id is read out of the
 * question so the stub looks like it answered something, which is the point of the state.
 */
function* demoEvents(messages: IncomingMessage[], startedAt: number): Generator<StreamEvent, void, void> {
  const prompt = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const words = typeof prompt === "string" ? prompt : "";
  const orderId = words.match(/#?(\d{3,})/)?.[1] ?? "4821";

  yield {
    type: "reasoning",
    text: "Classify the request, check whether a tool can answer it, then respond with the shortest useful status update.",
  };
  yield {
    type: "tool-call",
    toolCallId: "demo-call-1",
    toolName: "get_order_status",
    args: { order_id: orderId },
    status: "completed",
  };
  yield { type: "text", text: demoAnswer(words) };
  yield { type: "stats", stats: { spans: [], totalMs: Date.now() - startedAt, usage: null, estimated: true } };
  yield { type: "done" };
}

/** This realm's `fetch`, saying out loud which address space the endpoint is in. */
function realmFetch(baseUrl: string, failure: { caught?: unknown }): typeof fetch {
  const space = addressSpaceOf(baseUrl);
  return (input, init) =>
    fetch(input, space ? ({ ...init, targetAddressSpace: space } as RequestInit) : init).catch((error: unknown) => {
      failure.caught = error;
      throw error;
    });
}

/**
 * What a failed call means, read from the only thing a blocked fetch leaves readable: whether a
 * request that does not need its answer gets out at all.
 *
 * A cross-origin fetch that fails tells JavaScript nothing — CORS, a refused permission and a dead
 * host arrive identically as "Failed to fetch" — so the cause is inferred from a second call whose
 * answer is never read: that one needs no CORS grant, only the browser's permission to make it. If
 * it lands, the endpoint is reachable and the refusal was about reading the reply; if it does not,
 * the request never left.
 */
async function explainFailure(baseUrl: string, error: unknown): Promise<string> {
  const host = hostOf(baseUrl) ?? baseUrl;
  const page = typeof location === "undefined" ? null : location;

  if (page?.protocol === "https:" && baseUrl.trim().toLowerCase().startsWith("http://") && !isLocalEndpoint(baseUrl)) {
    return `The page is HTTPS and ${host} is HTTP, which browsers block as mixed content. Serve the agent over HTTPS, or open Elvin over HTTP.`;
  }

  if (await reachableWithoutReading(baseUrl)) {
    return `${host} answered, but the browser would not let this page read the reply: the endpoint must send Access-Control-Allow-Origin for ${page?.origin ?? "this origin"}, and allow this client's headers on its preflight — Content-Type, Authorization when a key is set, and X-Session-Id.`;
  }

  if (isLocalEndpoint(baseUrl) && page?.protocol === "https:") {
    return `The browser refused before sending anything: ${host} is on a private address and this page is public, which needs Local Network Access permission for ${page.origin}. Allow it, or open Elvin from that network.`;
  }

  return `${host} could not be reached from this browser (${messageOf(error)}). The browser reports CORS, permission and network failures identically — its console names the one it was.`;
}

/** Whether a request gets out at all, asked in the one mode whose answer is never read. */
async function reachableWithoutReading(baseUrl: string): Promise<boolean> {
  try {
    await fetch(endpointFor(baseUrl.trim().replace(/\/+$/, ""), MODELS_PATH, [CHAT_COMPLETIONS_PATH]), {
      mode: "no-cors",
      cache: "no-store",
    });
    return true;
  } catch {
    return false;
  }
}

/** What a probe got: the body, or the sentence the reader is shown. */
type ProbeAnswer = { ok: true; body: unknown } | { ok: false; error: string };

/**
 * One GET on the connection check, with the failure already worded for the reader: the endpoint's
 * own words when it answered that it would not, and the reading above when the call never landed.
 */
async function getProvider(endpoint: string, apiKey?: string): Promise<ProbeAnswer> {
  const key = apiKey?.trim();
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: key ? { Authorization: `Bearer ${key}` } : {}, cache: "no-store" });
  } catch (error) {
    return { ok: false, error: await explainFailure(endpoint, error) };
  }

  const text = await response.text();
  if (!response.ok) return { ok: false, error: providerError(text, response.status) };
  return { ok: true, body: safeJson(text) };
}

/**
 * Where a path hangs off a base URL: a URL that already spells one of the paths is rewritten rather
 * than appended to, so one pasted with `/chat/completions` on the end still answers.
 */
function endpointFor(baseUrl: string, targetPath: string, sourcePaths: string[] = []): string {
  if (baseUrl.endsWith(targetPath)) return baseUrl;

  for (const sourcePath of sourcePaths) {
    if (baseUrl.endsWith(sourcePath)) {
      return `${baseUrl.slice(0, -sourcePath.length)}${targetPath}`;
    }
  }

  return `${baseUrl}${targetPath}`;
}

/** What `/models` lists, and the one field a provider uses to say what it is. */
function readModels(body: unknown): { models: string[]; owner?: string } {
  const entries = (body as { data?: Array<{ id?: string; owned_by?: string } | string> } | null)?.data ?? [];
  const models = entries.map((item) => (typeof item === "string" ? item : item.id)).filter((item): item is string => Boolean(item));
  const owner = entries.map((item) => (typeof item === "string" ? undefined : item.owned_by)).find((item) => typeof item === "string");
  return { models, ...(owner !== undefined ? { owner } : {}) };
}

/** What `/capabilities` offers, under any of the spellings a provider may use for the list. */
function readCapabilities(body: unknown): string[] {
  if (Array.isArray(body)) {
    return body
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "id" in item && typeof item.id === "string") return item.id;
        if (item && typeof item === "object" && "name" in item && typeof item.name === "string") return item.name;
        return "";
      })
      .filter(Boolean);
  }
  if (!body || typeof body !== "object") return [];

  const record = body as { features?: unknown; capabilities?: unknown };
  const features = record.features ?? record.capabilities;
  if (features && typeof features === "object" && !Array.isArray(features)) {
    return Object.entries(features)
      .filter(([, enabled]) => enabled === true)
      .map(([name]) => name);
  }

  return Object.keys(body);
}

/** An endpoint's refusal, in its own words wherever it gave any. */
function providerError(text: string, status: number): string {
  const data = safeJson(text) as { error?: { message?: string }; message?: string };
  return data.error?.message ?? data.message ?? `Provider returned HTTP ${status}.`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The host an endpoint names, or null when it names none. An address written without a scheme —
 * `127.0.0.1:8731/v1`, which a browser reads as a scheme and no host — is read with one.
 */
function hostOf(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  for (const candidate of [trimmed, `http://${trimmed}`]) {
    try {
      const parsed = new URL(candidate);
      if (parsed.hostname.length > 0) return parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    } catch {
      // Not an address as written; the next spelling is the browser's own.
    }
  }

  return null;
}

function isLocalHost(host: string): boolean {
  if (host === "localhost" || host === "::1") return true;
  if (host.endsWith(".local")) return true;
  return isPrivateAddress(host);
}

/** An IPv4 literal no network outside this one can answer for. */
function isPrivateAddress(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;

  const [first, second] = octets;
  if (first === 127 || first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return first === 192 && second === 168;
}
