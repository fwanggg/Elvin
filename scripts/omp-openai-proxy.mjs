#!/usr/bin/env node
/**
 * Local OpenAI-compatible gateway backed by an OMP session.
 *
 * Elvin talks to a provider; this makes a terminal session one. Point the playground's
 * base URL at this port and the agent answering is `omp`, with the workspace, tools and
 * skills the session was started with — so the playground renders a real coding agent's
 * turns rather than a stub.
 *
 * Each Elvin thread gets its own session directory, because the playground names its
 * thread in the `X-Hermes-Session-Id` header: a new thread here is a new conversation
 * there, and a continued one keeps its history. Text and thinking stream through as they
 * are produced, and the provider's own accounting — including how much of the prompt came
 * from its cache — is handed on in the final usage chunk.
 *
 *   node scripts/omp-openai-proxy.mjs --port 4030 --cwd /path/to/workspace
 *
 * Then set Elvin's agent URL to http://127.0.0.1:4030/v1 and leave the key empty.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

const OMP = process.env.OMP_BIN ?? "omp";

function parseArgs(argv) {
  const options = {
    port: 4030,
    cwd: process.cwd(),
    sessionRoot: join(homedir(), ".omp", "openai-proxy"),
    model: "omp",
    timeoutSeconds: 900,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--port") { options.port = Number(value); index += 1; }
    else if (argv[index] === "--cwd") { options.cwd = value; index += 1; }
    else if (argv[index] === "--session-dir") { options.sessionRoot = value; index += 1; }
    else if (argv[index] === "--model") { options.model = value; index += 1; }
    else if (argv[index] === "--timeout") { options.timeoutSeconds = Number(value); index += 1; }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

function log(...parts) {
  console.log(new Date().toISOString().slice(11, 19), ...parts);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** A thread's own session directory: the playground's thread id names the conversation. */
function sessionDirectory(thread) {
  const name = (thread ?? "default").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "default";
  const directory = join(options.sessionRoot, name);
  const continuing = existsSync(directory) && readdirSync(directory).length > 0;
  mkdirSync(directory, { recursive: true });
  return { directory, continuing };
}

/** The newest thing the user said, which is all a session that keeps its own history needs. */
function latestUserMessage(messages) {
  const last = [...(Array.isArray(messages) ? messages : [])].reverse().find((message) => message?.role === "user");
  const content = last?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? "").join(" ").trim();
  return "";
}

/**
 * One turn of the session, read as it happens. `omp --mode=json` writes one JSON object per
 * line: message parts as they stream, tool executions as they run, and the provider's
 * accounting when the turn closes. The caller is handed each event and the turn's totals.
 */
function runTurn({ prompt, directory, continuing, onEvent }) {
  return new Promise((resolve, reject) => {
    const args = ["--mode=json", "-p", prompt, "--cwd", options.cwd, "--session-dir", directory];
    if (continuing) args.push("-c");

    const child = spawn(OMP, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutSeconds * 1000);
    let buffer = "";
    let stderr = "";
    const totals = { input: 0, output: 0, cacheRead: 0, totalTokens: 0 };
    let model = null;

    const handle = (line) => {
      if (!line.startsWith("{")) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      // One assistant message each way: its opening frame carries zeros, its closing frame
      // the real figures, so only the closing frame is counted.
      if (event.type === "message_end" && event.message?.role === "assistant" && event.message.usage) {
        const usage = event.message.usage;
        totals.input += usage.input ?? 0;
        totals.output += usage.output ?? 0;
        totals.cacheRead += usage.cacheRead ?? 0;
        totals.totalTokens += usage.totalTokens ?? 0;
        model = event.message.model ?? model;
      }
      onEvent(event);
    };

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handle(line.trim());
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffer.trim().length > 0) handle(buffer.trim());
      if (code !== 0 && totals.totalTokens === 0) {
        reject(new Error(stderr.trim().slice(0, 400) || `${OMP} exited with code ${code}`));
        return;
      }
      resolve({ totals, model });
    });
  });
}

/**
 * The provider's accounting, said the way an OpenAI-compatible client reads it. A cached
 * read is part of the prompt rather than beside it, so it is counted inside prompt_tokens and
 * named again under prompt_tokens_details — which is what makes the panel's "input / cached"
 * read as a share of the input rather than as a number larger than it.
 */
function usagePayload(totals) {
  const prompt = totals.input + totals.cacheRead;
  const completion = totals.output;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: totals.cacheRead },
  };
}

function serveModels(response, thread) {
  sendJson(response, 200, {
    object: "list",
    data: [{ id: options.model, object: "model", owned_by: `omp${thread ? `:${thread}` : ""}` }],
  });
}

async function serveChat(request, response, rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    sendJson(response, 400, { error: "The gateway expects a JSON body." });
    return;
  }

  const prompt = latestUserMessage(payload.messages);
  if (prompt.length === 0) {
    sendJson(response, 400, { error: "No user message to send." });
    return;
  }

  const thread = request.headers["x-hermes-session-id"] ?? null;
  const { directory, continuing } = sessionDirectory(thread);
  const streaming = payload.stream === true;
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const envelope = { id, object: "chat.completion.chunk", created, model: options.model };
  const started = Date.now();

  const chunk = (delta) => ({ ...envelope, choices: [{ index: 0, delta, finish_reason: null }] });

  if (streaming) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      ...(thread ? { "x-hermes-session-id": thread } : {}),
    });
  }
  // Declared outside the branch above: the turn's events arrive on a callback, which cannot
  // see into a block.
  const send = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  if (streaming) send(chunk({ role: "assistant" }));

  let answer = "";
  let thinking = "";
  let aborted = false;
  request.on("close", () => { aborted = true; });

  try {
    const { totals, model } = await runTurn({
      prompt,
      directory,
      continuing,
      onEvent: (event) => {
        if (aborted || !streaming) return;
        const streamedPart = event.type === "message_update" ? event.assistantMessageEvent : null;
        if (streamedPart?.type === "text_delta" && streamedPart.delta) {
          answer += streamedPart.delta;
          send(chunk({ content: streamedPart.delta }));
        }
        if (streamedPart?.type === "thinking_delta" && streamedPart.delta) {
          thinking += streamedPart.delta;
          send(chunk({ reasoning_content: streamedPart.delta }));
        }
        if (event.type === "tool_execution_start") {
          log("  tool", event.toolName, JSON.stringify(event.args ?? {}).slice(0, 120));
        }
      },
    });

    const usage = usagePayload(totals);
    log(
      `turn done in ${Date.now() - started}ms — ${usage.prompt_tokens} in (${usage.prompt_tokens_details.cached_tokens} cached), ${usage.completion_tokens} out, model ${model ?? "unknown"}`,
    );

    if (streaming) {
      response.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...envelope, choices: [], usage })}\n\n`);
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }

    sendJson(response, 200, {
      id,
      object: "chat.completion",
      created,
      model: options.model,
      choices: [{ index: 0, message: { role: "assistant", content: answer, ...(thinking ? { reasoning_content: thinking } : {}) }, finish_reason: "stop" }],
      usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The session failed.";
    log("turn failed:", message);
    if (streaming) {
      response.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }
    sendJson(response, 502, { error: message });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = url.pathname.replace(/^\/v1(?=\/|$)/, "");

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    });
    response.end();
    return;
  }

  try {
    if (path === "/models" && request.method === "GET") {
      serveModels(response, request.headers["x-hermes-session-id"] ?? null);
      return;
    }
    if (path === "/health") {
      sendJson(response, 200, { ok: true, model: options.model, cwd: options.cwd });
      return;
    }
    if (path === "/chat/completions" && request.method === "POST") {
      await serveChat(request, response, await readBody(request));
      return;
    }
    sendJson(response, 404, { error: `No route for ${request.method} ${url.pathname}` });
  } catch (error) {
    log("request failed:", error instanceof Error ? error.message : error);
    if (!response.headersSent) sendJson(response, 500, { error: "The gateway failed." });
    else response.end();
  }
});

server.listen(options.port, "127.0.0.1", () => {
  log(`omp gateway on http://127.0.0.1:${options.port}/v1 — base URL for Elvin; workspace ${options.cwd}; sessions under ${options.sessionRoot}`);
});
