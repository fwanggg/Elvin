#!/usr/bin/env node
/**
 * Local OpenAI-compatible gateway for the testbed.
 *
 *   OPENROUTER_API_KEY=... node scripts/local-openai-proxy.mjs --port 4024
 *   DEEPSEEK_API_KEY=...   node scripts/local-openai-proxy.mjs --upstream deepseek
 *
 * Points Elvin at a localhost base URL (`http://127.0.0.1:4024/v1`) while the
 * upstream key stays in this process: the browser session holds no credentials.
 *
 * What it does beyond forwarding:
 *   - `/v1/models` puts the default model first, because the testbed adopts the
 *     first entry when its model field is still empty.
 *   - `/v1/capabilities` answers the probe the testbed runs after connecting.
 *   - `capability` is dropped from the chat payload: it is Elvin's own
 *     negotiation field, not part of the OpenAI wire contract.
 *   - Responses are piped untouched, so SSE deltas (`content`, `reasoning`,
 *     `reasoning_content`, `tool_calls`) reach the testbed exactly as sent.
 *
 * Binds to loopback only — it holds a key and must not be reachable from the
 * network. Nothing here is imported by the app; it is a dev tool.
 */
import { createServer } from "node:http";

const UPSTREAMS = {
  openrouter: {
    label: "OpenRouter",
    keyEnv: "OPENROUTER_API_KEY",
    base: "https://openrouter.ai/api/v1",
    model: "nex-agi/nex-n2.5-mini:free",
    reasoning: true,
    headers: { "HTTP-Referer": "http://localhost:4024", "X-Title": "Elvin testbed" },
  },
  deepseek: {
    label: "DeepSeek",
    keyEnv: "DEEPSEEK_API_KEY",
    base: "https://api.deepseek.com",
    /* `/models` lists deepseek-flash and deepseek-v4-pro; the default has to be
       one the picker can show, or the testbed would adopt an invisible id. */
    model: "deepseek-flash",
    reasoning: false,
  },
};

function parseArgs(argv) {
  const options = { port: 4024, upstream: "openrouter", model: "", reasoning: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--port") options.port = Number(argv[++index]);
    else if (flag === "--upstream") options.upstream = argv[++index];
    else if (flag === "--model") options.model = argv[++index];
    else if (flag === "--reasoning") options.reasoning = argv[++index] !== "off";
    else if (flag === "--help") { console.log("usage: node scripts/local-openai-proxy.mjs [--port 4024] [--upstream openrouter|deepseek] [--model id] [--reasoning on|off]"); process.exit(0); }
    else { console.error(`unknown flag ${flag}`); process.exit(2); }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const upstream = UPSTREAMS[options.upstream];
if (!upstream) {
  console.error(`unknown upstream "${options.upstream}" — expected one of ${Object.keys(UPSTREAMS).join(", ")}`);
  process.exit(2);
}

const key = process.env[upstream.keyEnv];
if (!key) {
  console.error(`${upstream.keyEnv} is not set — the gateway needs it to reach ${upstream.label}`);
  process.exit(2);
}

const defaultModel = options.model || upstream.model;
const reasoning = options.reasoning ?? upstream.reasoning;
const upstreamHeaders = { Authorization: `Bearer ${key}`, ...(upstream.headers ?? {}) };

function log(...parts) {
  console.log(new Date().toISOString().slice(11, 19), ...parts);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Paths come in with and without the /v1 prefix; both are the gateway's. */
function routeOf(pathname) {
  const path = pathname.replace(/^\/v1(?=\/|$)/, "");
  if (path === "/models") return "models";
  if (path === "/capabilities") return "capabilities";
  if (path === "/chat/completions") return "chat";
  if (path === "/health") return "health";
  return "unknown";
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

async function serveModels(response) {
  const upstreamResponse = await fetch(`${upstream.base}/models`, { headers: upstreamHeaders });
  if (!upstreamResponse.ok) {
    sendJson(response, upstreamResponse.status, { error: `${upstream.label} /models failed: ${(await upstreamResponse.text()).slice(0, 300)}` });
    return;
  }
  const data = await upstreamResponse.json();
  const models = (data.data ?? [])
    .map((item) => (typeof item === "string" ? item : item?.id))
    .filter((id) => typeof id === "string" && id.length > 0);

  // The testbed adopts the first model when its own field is empty, so the
  // default travels first and the rest keep the provider's order.
  const ordered = models.includes(defaultModel) ? [defaultModel, ...models.filter((id) => id !== defaultModel)] : models;
  log("GET /v1/models →", ordered.length, "models, first:", ordered[0]);
  sendJson(response, 200, { object: "list", data: ordered.map((id) => ({ id, object: "model", owned_by: options.upstream })) });
}

function serveCapabilities(response) {
  sendJson(response, 200, { features: { chat_completions: true, streaming: true, tools: true, reasoning } });
}

async function serveChat(request, response, rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    sendJson(response, 400, { error: "The gateway expects a JSON body." });
    return;
  }

  // `capability` is Elvin's field, not OpenAI's.
  const dropped = "capability" in payload ? ["capability"] : [];
  delete payload.capability;
  if (!payload.model) payload.model = defaultModel;

  const abort = new AbortController();
  request.on("close", () => abort.abort());
  const tools = Array.isArray(payload.tools) ? payload.tools.length : 0;
  // The session header is the testbed's own; it pins conversation state on
  // stateful providers, so a new thread should show a new value here.
  const session = request.headers["x-hermes-session-id"] ?? "none";
  log(`POST /v1/chat/completions → ${payload.model} (stream=${Boolean(payload.stream)}, session=${session}, messages=${payload.messages?.length ?? 0}, tools=${tools}, reasoning=${JSON.stringify(payload.reasoning ?? null)}, dropped=${dropped.join(",") || "none"})`);

  const started = Date.now();
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(`${upstream.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...upstreamHeaders },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });
  } catch (error) {
    if (abort.signal.aborted) return;
    log("upstream error:", error.message);
    sendJson(response, 502, { error: `${upstream.label} was unreachable: ${error.message}` });
    return;
  }

  const headers = {
    "Content-Type": upstreamResponse.headers.get("content-type") ?? "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  };
  if (!upstreamResponse.ok) {
    const text = await upstreamResponse.text();
    log("upstream replied", upstreamResponse.status, text.slice(0, 120));
    // Relay the provider's status and reason verbatim. The testbed reads
    // `.error.message`, so an `{error: "…"}` body has to be reshaped or the
    // failure reaches the UI as a bare status code.
    const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();
    const message = typeof parsed?.error === "string" ? parsed.error : parsed?.error?.message ?? parsed?.message;
    sendJson(response, upstreamResponse.status, message ? { error: { message } } : parsed ?? { error: { message: text.slice(0, 600) } });
    return;
  }

  response.writeHead(200, headers);
  if (!upstreamResponse.body) {
    response.end();
    return;
  }
  let bytes = 0;
  const reader = upstreamResponse.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    response.write(Buffer.from(value));
  }
  response.end();
  log("streamed", bytes, "bytes in", Date.now() - started + "ms");
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const route = routeOf(url.pathname);

  if (request.method === "OPTIONS") {
    response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
    response.end();
    return;
  }
  if (request.method === "GET" && route === "models") { void serveModels(response).catch((error) => sendJson(response, 502, { error: error.message })); return; }
  if (request.method === "GET" && route === "capabilities") { serveCapabilities(response); return; }
  if (request.method === "GET" && route === "health") { sendJson(response, 200, { ok: true, upstream: options.upstream, label: upstream.label, defaultModel, reasoning, keyPresent: true }); return; }
  if (request.method === "POST" && route === "chat") {
    void readBody(request).then((body) => serveChat(request, response, body)).catch((error) => sendJson(response, 500, { error: error.message }));
    return;
  }
  sendJson(response, 404, { error: `The gateway has no route for ${request.method} ${url.pathname}` });
});

server.listen(options.port, "127.0.0.1", () => {
  log(`${upstream.label} gateway on http://127.0.0.1:${options.port}/v1 — base URL for Elvin; default model ${defaultModel}; key from ${upstream.keyEnv} (not logged)`);
});
