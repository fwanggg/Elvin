#!/usr/bin/env node
/**
 * Replay captured provider streams through Elvin's own `/api/chat` route.
 *
 * A fixture is one provider's captured bytes plus the normalised events the route is
 * expected to produce from them:
 *
 *   replay_test/<name>/raw_stream.sse   the provider's bytes, verbatim (SSE)
 *   replay_test/<name>/expected.json    {"prompt": "<the user message>", "events": [ … ]}
 *
 *   node replay_test/replay.mjs                 # replay every fixture, compare, exit 1 on mismatch
 *   node replay_test/replay.mjs hermes          # only the named fixtures
 *   node replay_test/replay.mjs --record        # rewrite "events" from the current pipeline
 *
 * Requires the app already running (default http://localhost:3000). No provider is ever
 * reached: each fixture's bytes are served by a local stand-in on an ephemeral port.
 */
import { createServer } from "node:http";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const APP = process.env.APP_URL ?? "http://localhost:3000";
/** The fixtures live beside this script, so it can be run from anywhere. */
const FIXTURES = path.dirname(fileURLToPath(import.meta.url));
/** Time the route measures itself by. Every one of these differs by a few milliseconds per
 *  run, so their readings are pinned before comparing; see `normalize`. */
const TIMING_FIELDS = new Set(["ms", "startMs", "totalMs", "answerMs", "leadMs"]);
const REQUEST_TIMEOUT_MS = 120_000;

const RAW_STREAM = "raw_stream.sse";
const EXPECTED = "expected.json";

/**
 * What a provider says when the turn is continued with a tool's result and it has nothing left to
 * add. A capture is one round of a conversation: the route continues any stream that requested a
 * tool, and answering that continuation with the capture again would replay the whole round two or
 * three times, which is not what the provider did and buries the round under test.
 */
const CLOSING_STREAM = `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

const args = process.argv.slice(2);
const record = args.includes("--record");
const unknownFlags = args.filter((arg) => arg.startsWith("--") && arg !== "--record");
if (unknownFlags.length > 0) {
  console.log(`unknown option ${unknownFlags[0]} — usage: node replay_test/replay.mjs [--record] [name …]`);
  process.exit(2);
}
const requested = args.filter((arg) => !arg.startsWith("--"));

/**
 * The stand-in provider: it serves a fixture's bytes at the OpenAI-compatible endpoints the
 * route calls, and nothing else.
 *
 * Serving the bytes over HTTP rather than handing the route a stream directly is the point of
 * the harness: the route under test still performs its own fetch, its own header negotiation
 * and its own SSE parsing of the provider's dialect. Feeding it pre-parsed events would test
 * our parser only; replaying the wire exercises the whole round trip — request shape, retry on
 * a refused parameter, tool continuation — against bytes that are identical every run.
 *
 * Every POST is answered with the same bytes. A fixture whose stream asks for a tool is
 * therefore continued with the same turn again, which is exactly what the route's bounded
 * tool rounds do with a provider that never changes its mind.
 */
function fixtureServer(rawStream) {
  const models = { object: "list", data: [{ id: "replay", object: "model", owned_by: "replay" }] };

  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(JSON.stringify(models));
    }

    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const continued = /"role"\s*:\s*"tool"/.test(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(continued ? CLOSING_STREAM : rawStream);
      });
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: `The replay server has no ${request.url}.` }));
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

/** The route keeps its provider connection alive, so the sockets are cut rather than waited on. */
async function shutdown(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function portOf(server) {
  const address = server.address();
  return address && typeof address === "object" ? address.port : 0;
}

/** One replay: the route is asked for the fixture's prompt, against the stand-in provider. */
async function replayThroughApp(name, prompt, port) {
  const response = await fetch(`${APP}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      stream: true,
      threadId: `replay-${name}`,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`/api/chat answered HTTP ${response.status}: ${body.slice(0, 400)}`);
  }
  return compact(normalize(eventsOf(body)));
}

/**
 * Drops the events a later one already says, so a long capture does not become a long expectation.
 *
 * The route re-sends a whole message on every frame it grows: each `text` or `reasoning` event is
 * the previous one plus what just arrived, so keeping them all makes the expectation grow with the
 * square of the stream and asserts nothing the last of them does not. A run whose payloads grow by
 * prefix collapses to its final event, and an event identical to the one before it goes too —
 * `stats` repeats itself that way between frames. Everything else is kept exactly as it arrived:
 * every tool call, every status, the order they came in, and the closing stats.
 */
function compact(events) {
  const out = [];
  /** The last event kept for each thing being reported, so a repeat finds its own predecessor. */
  const lastByKey = new Map();

  for (const event of events) {
    const key = event.type === "tool-call" ? `tool-call:${event.toolCallId}` : event.type;
    const previous = lastByKey.get(key);
    const repeats =
      previous !== undefined && (growsByPrefix(previous, event) || JSON.stringify(previous) === JSON.stringify(event));

    if (repeats) {
      // Replaced where it first appeared, so the expectation still reads in the order things
      // happened and a call's own slot carries its latest state.
      out[out.indexOf(previous)] = event;
    } else {
      out.push(event);
    }
    lastByKey.set(key, event);
  }
  return out;
}

/** True when `next` is `previous` with something appended — the same message, one frame further. */
function growsByPrefix(previous, next) {
  if (previous.type !== "text" && previous.type !== "reasoning") return false;
  return typeof next.text === "string" && next.text.startsWith(previous.text ?? "");
}

/** Elvin's normalised stream, one event per `data:` line. */
function eventsOf(body) {
  const events = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload.length === 0 || payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      events.push({ type: "unparsed", payload });
    }
  }
  return events;
}

/**
 * Removes what can never be equal between two runs of the same stream.
 *
 * The route stamps its timeline with `Date.now()` readings taken while it consumes the bytes:
 * how long thinking ran, how long the answer's words were arriving, how long the turn spent
 * before the provider said anything. Those readings are milliseconds apart on every run by
 * nature, so comparing them would make a fixture fail for a reason that has nothing to do with
 * the code. Their names and positions are what a client depends on, so the fields stay and only
 * their numbers are pinned. A session id is likewise an implementation detail of the endpoint
 * that served it, and the route echoes the one we asked it for, so it is dropped whole.
 */
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value === null || typeof value !== "object") return value;

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "sessionId") continue;
    out[key] = TIMING_FIELDS.has(key) && typeof entry === "number" ? "<ms>" : normalize(entry);
  }
  return out;
}

/** Order-insensitive: a hand-written fixture should not fail on key order alone. */
function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => same(item, b[index]));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;

  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
}

/** The index of the first event that differs, or the shorter length when one side ran on. */
function firstDifference(expected, actual) {
  const shared = Math.min(expected.length, actual.length);
  for (let index = 0; index < shared; index += 1) {
    if (!same(expected[index], actual[index])) return index;
  }
  return expected.length === actual.length ? -1 : shared;
}

function reportDifference(name, expected, actual) {
  const index = firstDifference(expected, actual);
  console.log(`FAIL ${name}  (${expected.length} expected events, ${actual.length} actual)`);
  console.log(`  first difference at event ${index}:`);
  console.log(`    expected: ${show(expected[index])}`);
  console.log(`    actual:   ${show(actual[index])}`);
}

/** Full JSON, so a differing event can be read rather than guessed at. */
function show(event) {
  if (event === undefined) return "(no such event)";
  return JSON.stringify(event, null, 2).split("\n").join("\n    ");
}

/** One directory per provider, and only one that carries both halves is a fixture. */
async function discoverFixtures() {
  const entries = await readdir(FIXTURES, { withFileTypes: true });
  const found = [];
  const incomplete = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(FIXTURES, entry.name);
    if (!existsSync(path.join(dir, RAW_STREAM))) continue;
    if (existsSync(path.join(dir, EXPECTED))) found.push(entry.name);
    else incomplete.push(entry.name);
  }

  return { found: found.sort(), incomplete: incomplete.sort() };
}

async function main() {
  const { found, incomplete } = await discoverFixtures();

  let selected;
  if (requested.length > 0) {
    const problems = [];
    for (const name of requested) {
      const dir = path.join(FIXTURES, name);
      if (!existsSync(dir)) problems.push(`replay_test/${name} does not exist`);
      else if (!existsSync(path.join(dir, RAW_STREAM))) problems.push(`replay_test/${name}/${RAW_STREAM} does not exist`);
      else if (!existsSync(path.join(dir, EXPECTED))) problems.push(`replay_test/${name}/${EXPECTED} does not exist — record preserves its "prompt", so create it first`);
    }
    if (problems.length > 0) {
      for (const problem of problems) console.log(problem);
      process.exit(2);
    }
    selected = requested;
  } else {
    for (const name of incomplete) {
      console.log(`skipping replay_test/${name}: ${RAW_STREAM} is there but ${EXPECTED} is not`);
    }
    selected = found;
  }

  if (selected.length === 0) {
    console.log(`no fixtures in replay_test/ — a fixture is <name>/${RAW_STREAM} with <name>/${EXPECTED}`);
    process.exit(0);
  }

  let failures = 0;
  let recorded = 0;
  let passed = 0;

  for (const name of selected) {
    const dir = path.join(FIXTURES, name);
    const expectedPath = path.join(dir, EXPECTED);

    let expected;
    try {
      expected = JSON.parse(await readFile(expectedPath, "utf8"));
    } catch (error) {
      console.log(`FAIL ${name}: ${EXPECTED} is not readable JSON (${error instanceof Error ? error.message : error})`);
      failures += 1;
      continue;
    }
    if (typeof expected.prompt !== "string") {
      console.log(`FAIL ${name}: ${EXPECTED} has no "prompt" to send`);
      failures += 1;
      continue;
    }

    const rawStream = await readFile(path.join(dir, RAW_STREAM));
    const server = fixtureServer(rawStream);
    await listen(server);

    let events;
    try {
      events = await replayThroughApp(name, expected.prompt, portOf(server));
    } catch (error) {
      console.log(`FAIL ${name}: ${error instanceof Error ? error.message : error}`);
      failures += 1;
      await shutdown(server);
      continue;
    }
    await shutdown(server);

    if (record) {
      // The prompt is the fixture's, never the pipeline's: only the events are re-recorded.
      await writeFile(expectedPath, `${JSON.stringify({ prompt: expected.prompt, events }, null, 2)}\n`, "utf8");
      console.log(`recorded replay_test/${name}/${EXPECTED} (${events.length} events)`);
      recorded += 1;
      continue;
    }

    if (firstDifference(expected.events ?? [], events) === -1) {
      console.log(`PASS ${name} (${events.length} events)`);
      passed += 1;
      continue;
    }

    reportDifference(name, expected.events ?? [], events);
    failures += 1;
  }

  if (record) {
    console.log(`${recorded} fixture${recorded === 1 ? "" : "s"} recorded`);
    process.exit(failures === 0 ? 0 : 1);
  }

  console.log(`${passed} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
