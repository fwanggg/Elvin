#!/usr/bin/env node
/**
 * Behavioural fingerprint for the Elvin testbed.
 *
 * Refactoring must not change observable behaviour, so capture a baseline
 * before touching code and diff against it afterwards. Everything here is
 * deterministic: a local mock provider with fixed ids and canned text, so a
 * diff means the code changed, never that a model was in a different mood.
 *
 *   node scripts/verify-behavior.mjs            # write the baseline
 *   node scripts/verify-behavior.mjs --compare  # diff against it, exit 1 on change
 *
 * Requires the app running (default http://localhost:3000).
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
const APP = process.env.APP_URL ?? "http://localhost:3000";
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 4020);
const BASELINE = path.resolve("reports/behavior-baseline.json");
const compare = process.argv.includes("--compare");

const TOOL_CALL_ID = "call_fixed_1";
const SESSION_ID = "mock-session-fixed";

/** Canned provider turns, chosen by a keyword in the user message. */
const SCENARIOS = {
  plain: { reasoning: "Short thought.", text: "Plain answer." },
  tools: { toolName: "get_order_status", toolArguments: '{"order_id":"4821"}', text: "Answer after the tool." },
  thought: { reasoning: "Step one. Step two.", text: "Reasoned answer." },
  both: { reasoning: "Considering the tool.", toolName: "get_order_status", toolArguments: '{"order_id":"4821"}', text: "Answer after thinking and the tool." },
};

function scenarioFor(prompt) {
  if (prompt.includes("both")) return SCENARIOS.both;
  if (prompt.includes("tool")) return SCENARIOS.tools;
  if (prompt.includes("thought")) return SCENARIOS.thought;
  return SCENARIOS.plain;
}

function mockServer() {
  return createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const send = (payload, type = "application/json") => {
        response.writeHead(200, { "Content-Type": type, "x-hermes-session-id": SESSION_ID });
        response.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      };

      if (request.url === "/v1/models") return send({ data: [{ id: "mock-model" }] });
      if (request.url === "/v1/capabilities") return send({ features: { chat_completions: true, tool_progress_events: true } });
      if (request.url !== "/v1/chat/completions") {
        response.writeHead(404, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "not found" }));
      }

      const payload = JSON.parse(body || "{}");
      const turnsSoFar = payload.messages.filter((m) => m.role !== "system").length;
      const lastRole = payload.messages[payload.messages.length - 1]?.role;
      const settings = scenarioFor(payload.messages.map((m) => m.content ?? "").join(" "));
      const toolResultSeen = payload.messages.some((m) => m.role === "tool");

      // Turn 2 answers; turn 1 asks for the tool when the scenario has one.
      const asksForTool = Boolean(settings.toolName) && !toolResultSeen && turnsSoFar === 1;
      const wantsReasoning = Boolean(payload.reasoning?.enabled);

      if (!payload.stream) {
        return send({ choices: [{ message: asksForTool
          ? { role: "assistant", content: null, tool_calls: [{ id: TOOL_CALL_ID, type: "function", function: { name: settings.toolName, arguments: settings.toolArguments } }] }
          : { role: "assistant", content: settings.text, ...(wantsReasoning && settings.reasoning ? { reasoning: settings.reasoning } : {}) },
          finish_reason: asksForTool ? "tool_calls" : "stop" }] });
      }

      response.writeHead(200, { "Content-Type": "text/event-stream", "x-hermes-session-id": SESSION_ID });
      const emit = (event, data) => response.write((event ? `event: ${event}\n` : "") + `data: ${JSON.stringify(data)}\n\n`);
      const content = (text) => ({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });

      if (asksForTool) {
        emit(null, content(""));
        emit(null, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: TOOL_CALL_ID, type: "function", function: { name: settings.toolName, arguments: settings.toolArguments } }] }, finish_reason: null }] });
      } else {
        if (wantsReasoning && settings.reasoning) {
          emit(null, { choices: [{ index: 0, delta: { reasoning: settings.reasoning }, finish_reason: null }] });
        }
        emit(null, content(settings.text));
      }
      emit(null, { choices: [{ index: 0, delta: {}, finish_reason: asksForTool ? "tool_calls" : "stop" }] });
      response.end("data: [DONE]\n\n");
    });
  });
}

/** Normalizes an SSE body to the events a UI is guaranteed to observe. */
function eventsOf(body) {
  const events = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload.length === 0) continue;
    try {
      const parsed = JSON.parse(payload);
      if (typeof parsed?.type === "string") events.push(normalize(parsed));
    } catch {
      events.push({ type: "unparsed", payload });
    }
  }
  return events;
}

/**
 * The stats event carries the wall clock the proxy measured, which differs by
 * milliseconds every run by design. Its shape is what a client depends on, so
 * that is what is compared: which fields were present, and how many calls the
 * turn made — never the readings themselves.
 */
function normalize(event) {
  if (event.type !== "stats") return event;
  const stats = event.stats ?? {};
  return {
    type: "stats",
    has: {
      spans: Array.isArray(stats.spans) ? stats.spans.length : 0,
      totalMs: typeof stats.totalMs === "number",
      usage: stats.usage !== null && stats.usage !== undefined,
      estimated: stats.estimated === true,
    },
  };
}
async function chatCase(scenario) {
  const response = await fetch(`${APP}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
      model: "mock-model",
      stream: true,
      messages: [{ role: "user", content: `${scenario} prompt` }],
    }),
  });
  const body = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    events: eventsOf(body),
  };
}

async function checkCase() {
  const response = await fetch(`${APP}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1` }),
  });
  return { status: response.status, body: await response.json() };
}

async function capture() {
  const chat = {};
  for (const scenario of Object.keys(SCENARIOS)) {
    chat[scenario] = await chatCase(scenario);
  }

  return { chat, check: await checkCase() };
}

function differences(baseline, current) {
  const problems = [];
  for (const key of Object.keys(baseline)) {
    const before = JSON.stringify(baseline[key]);
    const after = JSON.stringify(current[key]);
    if (before !== after) problems.push(key);
  }
  return problems;
}

const server = mockServer();
await new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", resolve));

try {
  const current = await capture();

  if (!compare) {
    await mkdir(path.dirname(BASELINE), { recursive: true });
    await writeFile(BASELINE, JSON.stringify(current, null, 2), "utf8");
    console.log(`baseline written to ${path.relative(process.cwd(), BASELINE)}`);
    console.log(`  chat cases: ${Object.keys(current.chat).length}`);
    console.log(`  check: ${current.check.status}`);
  } else {
    if (!existsSync(BASELINE)) {
      console.error("no baseline — run without --compare first");
      process.exit(2);
    }
    const baseline = JSON.parse(await readFile(BASELINE, "utf8"));
    let failed = false;
    for (const section of ["chat", "check"]) {
      const changed = differences(baseline[section], current[section]);
      if (changed.length === 0) {
        console.log(`  ${section}: unchanged (${Object.keys(baseline[section]).length} cases)`);
        continue;
      }
      failed = true;
      console.error(`  ${section}: CHANGED`);
      for (const key of changed) {
        const before = baseline[section][key];
        const after = current[section][key];
        console.error(`    - ${key}`);
        // A knob value that changed name shows up as a case that went and a case
        // that arrived, so each side is reported only when it exists.
        console.error(`        before: ${before === undefined ? "(no such case)" : JSON.stringify(before).slice(0, 240)}`);
        console.error(`        after:  ${after === undefined ? "(no such case)" : JSON.stringify(after).slice(0, 240)}`);
      }
    }
    console.log(failed ? "BEHAVIOUR CHANGED" : "behaviour identical");
    process.exit(failed ? 1 : 0);
  }
} finally {
  server.close();
}
