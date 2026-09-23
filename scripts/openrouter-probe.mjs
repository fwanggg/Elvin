#!/usr/bin/env node
/**
 * OpenRouter reasoning + tool-calling probe.
 *
 * Sends a fixed prompt to each model under every reasoning/tool combination,
 * records the raw wire format, and writes one report per model to reports/.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... node scripts/openrouter-probe.mjs
 *   OPENROUTER_API_KEY=... node scripts/openrouter-probe.mjs --models=openai/gpt-6-luna,z-ai/glm-5.3
 *
 * Flags: --models=a,b  --out=reports  --timeout=180000  --keep-raw
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("OPENROUTER_API_KEY is required");
  process.exit(1);
}

const BASE = "https://openrouter.ai/api/v1";
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...rest] = a.replace(/^--/, "").split("=");
  return [k, rest.join("=") || "true"];
}));

const OUT_DIR = path.resolve(args.out ?? "reports");
const RAW_DIR = path.join(OUT_DIR, "raw");
const SHOT_DIR = path.join(OUT_DIR, "screenshots");
const TIMEOUT_MS = Number(args.timeout ?? 180000);

/** Major families requested: OpenAI, Anthropic, Kimi, DeepSeek, GLM, Meta (+ Google as control). */
const DEFAULT_MODELS = [
  "openai/gpt-6-luna",
  "openai/gpt-5.5",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-5",
  "moonshotai/kimi-k3",
  "deepseek/deepseek-v4-pro-0813",
  "z-ai/glm-5.3",
  "meta-llama/llama-4-maverick",
  "google/gemini-3.8-flash",
];
const MODELS = args.models ? args.models.split(",").map((m) => m.trim()) : DEFAULT_MODELS;

/**
 * The tool follows the OpenRouter tool-calling guide: a `type: "function"` entry
 * with a JSON Schema `parameters` object, and `tool_choice: "auto"`.
 */
const WEATHER_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "The city name, e.g. Paris" } },
      required: ["city"],
    },
  },
};

/**
 * Forces both channels at once: a tool call is mandatory, and the arithmetic
 * cannot be answered without working. Deliberately non-trivial, because models
 * skip thinking on trivial prompts.
 */
const PROMPT = "Two things, please: (1) work out 17*23 step by step, and (2) call get_weather with city=\"Paris\" for the current weather there. Show your working for the arithmetic.";

const REASONING_MODES = ["on", "off"];
const TOOL_MODES = ["on", "off"];

/**
 * Reasoning is requested by omission of effort so the gateway applies the
 * model's own default — models advertise different `supported_efforts`, and a
 * value outside that set is rejected. `mandatory` models reject disabling
 * outright, so "off" can only be expressed by omitting the parameter.
 */
function reasoningParam(mode, meta) {
  const mandatory = meta?.reasoning?.mandatory === true;
  if (mode === "on") return { enabled: true };
  if (mandatory) return null;
  return { enabled: false };
}

async function post(body, { stream, timeout = TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/elvin-testbed",
        "X-Title": "Elvin OpenRouter Probe",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text, contentType: response.headers.get("content-type") ?? "" };
  } catch (error) {
    return { status: 0, ok: false, text: String(error?.message ?? error), contentType: "" };
  } finally {
    clearTimeout(timer);
  }
}

function parseChunks(text) {
  const chunks = [];
  const raw = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    raw.push(payload);
    if (payload.length === 0 || payload === "[DONE]") continue;
    try {
      chunks.push(JSON.parse(payload));
    } catch {
      chunks.push({ __unparsed: payload });
    }
  }
  return { chunks, raw };
}

/** Reports every key path that ever appears, so unknown shapes are visible rather than assumed. */
function keyInventory(chunks) {
  const paths = new Set();
  const visit = (value, prefix) => {
    if (value === null || typeof value !== "object") {
      if (prefix) paths.add(prefix);
      return;
    }
    if (Array.isArray(value)) {
      if (prefix) paths.add(`${prefix}[]`);
      for (const item of value) visit(item, `${prefix}[]`);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      paths.add(next);
      visit(child, next);
    }
  };
  for (const chunk of chunks) visit(chunk, "");
  return sortedValues(paths);
}

function sortedValues(values) {
  return [...values].sort();
}

function unionBy(items, selectValues) {
  const values = new Set();
  for (const item of items) {
    for (const value of selectValues(item) ?? []) values.add(value);
  }
  return sortedValues(values);
}

function accumulateStream(chunks) {
  let content = "";
  let reasoning = "";
  const reasoningFields = new Set();
  const reasoningTypes = new Set();
  const toolCalls = new Map();
  let finishReason = null;
  let usage = null;

  for (const chunk of chunks) {
    if (chunk.usage) usage = chunk.usage;
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string") content += delta.content;
      for (const field of ["reasoning", "reasoning_content", "reasoning_text", "thinking"]) {
        const value = delta[field];
        if (typeof value === "string" && value.length > 0) {
          reasoning += value;
          reasoningFields.add(`delta.${field}`);
        }
      }
      if (Array.isArray(delta.reasoning_details)) {
        for (const detail of delta.reasoning_details) {
          const text = typeof detail === "string" ? detail : detail?.text ?? detail?.summary ?? "";
          if (text) reasoning += text;
          if (detail && typeof detail === "object" && typeof detail.type === "string") reasoningTypes.add(detail.type);
          reasoningFields.add(`delta.reasoning_details[].${Object.keys(detail ?? {}).join("|") || "string"}`);
        }
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) {
          const index = call.index ?? toolCalls.size;
          const prior = toolCalls.get(index) ?? { id: null, name: "", arguments: "" };
          toolCalls.set(index, {
            id: call.id ?? prior.id,
            name: `${prior.name}${call.function?.name ?? ""}`,
            arguments: `${prior.arguments}${call.function?.arguments ?? ""}`,
          });
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }
  return { content, reasoning, reasoningFields: [...reasoningFields], reasoningTypes: [...reasoningTypes], toolCalls: [...toolCalls.values()], finishReason, usage };
}

function summarizeMessage(json) {
  const message = json?.choices?.[0]?.message ?? {};
  const reasoningFields = Object.keys(message).filter((k) => /reason|think/i.test(k));
  const reasoning = reasoningFields
    .map((k) => (typeof message[k] === "string" ? message[k] : Array.isArray(message[k]) ? JSON.stringify(message[k]) : ""))
    .join("");
  return {
    content: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? null),
    reasoning,
    reasoningFields,
    toolCalls: (message.tool_calls ?? []).map((c) => ({
      id: c.id ?? null,
      name: c.function?.name ?? null,
      arguments: c.function?.arguments ?? null,
      argumentsType: typeof c.function?.arguments,
    })),
    finishReason: json?.choices?.[0]?.finish_reason ?? null,
    usage: json?.usage ?? null,
    messageKeys: Object.keys(message),
  };
}

function argsType(value) {
  if (value === null || value === undefined) return "missing";
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return "string(JSON)";
    } catch {
      return "string(invalid JSON)";
    }
  }
  return typeof value;
}

async function probeOnce(model, reasoningMode, toolsMode, meta) {
  const reasoning = reasoningParam(reasoningMode, meta);
  const body = {
    model,
    messages: [{ role: "user", content: PROMPT }],
    max_tokens: 2000,
    stream: true,
    ...(toolsMode === "on" ? { tools: [WEATHER_TOOL], tool_choice: "auto" } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
  const started = Date.now();
  const { status, ok, text, contentType } = await post(body, { stream: true });
  const elapsed = Date.now() - started;
  const { chunks, raw } = parseChunks(text);
  const isStream = contentType.includes("text/event-stream");

  let result;
  if (isStream) {
    const streamed = accumulateStream(chunks);
    result = {
      mode: "stream",
      content: streamed.content,
      reasoning: streamed.reasoning,
      reasoningFields: streamed.reasoningFields,
      reasoningTypes: streamed.reasoningTypes,
      toolCalls: streamed.toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments, argumentsType: argsType(c.arguments) })),
      finishReason: streamed.finishReason,
      usage: streamed.usage,
      chunkCount: chunks.length,
      keys: keyInventory(chunks),
    };
  } else {
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    result = json
      ? { mode: "json", ...summarizeMessage(json), keys: keyInventory([json]), raw: text.slice(0, 4000) }
      : { mode: "unparsed", raw: text.slice(0, 4000), keys: [] };
  }

  return {
    request: body,
    status,
    ok,
    elapsedMs: elapsed,
    contentType,
    error: ok ? null : extractError(text),
    rawSample: raw.slice(0, 6).join("\n").slice(0, 3000),
    rawChunkCount: raw.length,
    ...result,
  };
}

function extractError(text) {
  try {
    const json = JSON.parse(text);
    return json?.error?.message ?? json?.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

function slugify(model) {
  return model.replace(/[^a-z0-9]+/gi, "-");
}

function verdict({ reasoning, reasoningFields, toolCalls, error }) {
  const hasReasoning = reasoning.trim().length > 0;
  const hasTools = toolCalls.length > 0;
  return {
    hasReasoning,
    hasTools,
    reasoningField: reasoningFields[0] ?? null,
    error,
  };
}

function mdTable(rows, headers) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function buildReportHeader(model) {
  return [
    `# ${model}`,
    "",
    `Probe of OpenRouter \`${model}\` — reasoning and tool-calling, each toggled independently.`,
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Endpoint: \`POST ${BASE}/chat/completions\` (streaming, \`max_tokens: 2000\`)`,
    `- Prompt: \`${PROMPT}\``,
    `- Tool: \`get_weather\` (\`type: "function"\`, JSON Schema params, \`tool_choice: "auto"\`)`,
    "",
  ];
}

function buildMetadataSection(meta) {
  if (!meta) return [];

  const supports = (p) => (meta.supported_parameters ?? []).includes(p);
  return [
    "## Model metadata (from `GET /api/v1/models`)",
    "",
    "```json",
    JSON.stringify({
      id: meta.id,
      name: meta.name,
      context_length: meta.context_length,
      supported_parameters: meta.supported_parameters,
      reasoning: meta.reasoning ?? null,
    }, null, 2),
    "```",
    "",
    `- declares \`tools\`: **${supports("tools")}**`,
    `- declares \`reasoning\`: **${supports("reasoning")}**`,
    "",
  ];
}

function buildVerdictSection(results) {
  const rows = results.map((r) => [
    r.combo.reasoning,
    r.combo.tools,
    r.status,
    r.error ? `\`${r.error.slice(0, 60)}\`` : (r.mode ?? "-"),
    r.reasoning ? `yes (${r.reasoning.length} chars)` : "no",
    r.reasoningTypes?.join(",") || (r.reasoning ? "?" : "-"),
    r.reasoningFields?.join(", ") || "-",
    r.toolCalls?.length ? `yes (${r.toolCalls.map((t) => t.name).join(",")})` : "no",
    r.toolCalls?.[0] ? argsType(r.toolCalls[0].arguments) : "-",
    r.finishReason ?? "-",
  ]);

  return [
    "## Matrix",
    "",
    mdTable(rows, ["reasoning", "tools", "HTTP", "mode", "reasoning?", "kind", "reasoning field", "tool call?", "args type", "finish"]),
    "",
  ];
}

function buildToggleSection(results) {
  const byCombo = Object.fromEntries(results.map((r) => [`${r.combo.reasoning}/${r.combo.tools}`, r]));
  const reasoningOn = byCombo["on/on"];
  const reasoningOff = byCombo["off/on"];
  const toolsOn = byCombo["on/on"];
  const toolsOff = byCombo["on/off"];

  return [
    "## Toggle behaviour",
    "",
    `- reasoning on → produced reasoning: **${Boolean(reasoningOn?.reasoning)}**; off → produced reasoning: **${Boolean(reasoningOff?.reasoning)}**`,
    `- tools on → tool call: **${Boolean(toolsOn?.toolCalls?.length)}**; tools off → tool call: **${Boolean(toolsOff?.toolCalls?.length)}**`,
    "",
  ];
}

function buildKeyInventorySection(results) {
  const allKeys = unionBy(results, (r) => r.keys ?? []);
  return [
    "## Key inventory (streamed chunks)",
    "",
    "```",
    allKeys.join("\n") || "(none)",
    "```",
    "",
  ];
}

function buildEvidenceSection(results) {
  const lines = ["## Raw evidence", ""];

  for (const r of results) {
    lines.push(`### reasoning=${r.combo.reasoning} tools=${r.combo.tools}`);
    lines.push("");
    lines.push(`- HTTP ${r.status} in ${r.elapsedMs}ms, content-type \`${r.contentType}\`, ${r.rawChunkCount} SSE lines`);
    if (r.error) lines.push(`- **error**: ${r.error}`);
    if (r.reasoning) {
      lines.push("- reasoning captured:");
      lines.push("");
      lines.push("```text");
      lines.push(r.reasoning.slice(0, 800));
      lines.push("```");
    }
    if (r.toolCalls?.length) {
      lines.push("- tool calls:");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(r.toolCalls, null, 2).slice(0, 800));
      lines.push("```");
    }
    if (r.content) {
      lines.push("- content:");
      lines.push("");
      lines.push("```text");
      lines.push(r.content.slice(0, 400));
      lines.push("```");
    }
    lines.push("- first SSE payloads verbatim:");
    lines.push("");
    lines.push("```text");
    lines.push((r.rawSample ?? "").slice(0, 1200));
    lines.push("```");
    lines.push("");
  }

  return lines;
}

function buildScreenshotsSection(shots) {
  const lines = ["## Screenshots (Elvin testbed against this model)", ""];

  if (shots.length === 0) {
    lines.push("_No screenshots captured for this model._");
  } else {
    for (const shot of shots) lines.push(`![${shot}](${path.relative(OUT_DIR, path.join(SHOT_DIR, shot))})`);
  }
  lines.push("");

  return lines;
}

async function writeReport(model, meta, results) {
  const slug = slugify(model);
  const lines = [
    ...buildReportHeader(model),
    ...buildMetadataSection(meta),
    ...buildVerdictSection(results),
    ...buildToggleSection(results),
    ...buildKeyInventorySection(results),
    ...buildEvidenceSection(results),
  ];

  const shots = await listScreenshots(slug);
  lines.push(...buildScreenshotsSection(shots));

  await writeFile(path.join(OUT_DIR, `${slug}.md`), lines.join("\n"), "utf8");
  return slug;
}

async function listScreenshots(slug) {
  if (!existsSync(SHOT_DIR)) return [];
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(SHOT_DIR);
  return files.filter((f) => f.startsWith(slug) && /\.(png|webp)$/.test(f)).sort();
}

async function fetchModels() {
  const response = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
  const json = await response.json();
  return new Map((json.data ?? []).map((m) => [m.id, m]));
}

function summaryRow(model, slug, results) {
  const onOn = results.find((r) => r.combo.reasoning === "on" && r.combo.tools === "on");
  return {
    model,
    slug,
    ...verdict({
      reasoning: onOn?.reasoning ?? "",
      reasoningFields: onOn?.reasoningFields ?? [],
      toolCalls: onOn?.toolCalls ?? [],
      error: onOn?.error ?? null,
    }),
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  if (!args["keep-raw"] && !args["reports-only"] && existsSync(RAW_DIR)) await rm(RAW_DIR, { recursive: true, force: true });
  await mkdir(RAW_DIR, { recursive: true });

  const catalog = await fetchModels();
  const summary = [];

  for (const model of MODELS) {
    const resultsFile = path.join(RAW_DIR, `${slugify(model)}.json`);
    if (args["reports-only"]) {
      const { readFile } = await import("node:fs/promises");
      const results = JSON.parse(await readFile(resultsFile, "utf8"));
      const slug = await writeReport(model, catalog.get(model), results);
      summary.push(summaryRow(model, slug, results));
      continue;
    }

    const results = [];
    for (const reasoningMode of REASONING_MODES) {
      for (const toolsMode of TOOL_MODES) {
        const combo = { reasoning: reasoningMode, tools: toolsMode };
        process.stdout.write(`${model} reasoning=${reasoningMode} tools=${toolsMode} ... `);
        const result = await probeOnce(model, reasoningMode, toolsMode, catalog.get(model));
        console.log(`${result.status} reasoning=${result.reasoning ? result.reasoning.length : 0}ch tools=${result.toolCalls?.length ?? 0}${result.error ? ` error=${result.error.slice(0, 60)}` : ""}`);
        results.push({ combo, ...result });
        await writeFile(
          path.join(RAW_DIR, `${slugify(model)}--r${reasoningMode}-t${toolsMode}.txt`),
          result.rawSample ?? result.raw ?? "",
          "utf8",
        );
      }
    }
    await writeFile(resultsFile, JSON.stringify(results, null, 2), "utf8");
    const slug = await writeReport(model, catalog.get(model), results);
    summary.push(summaryRow(model, slug, results));
  }

  await writeFile(path.join(OUT_DIR, "_summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log("\n=== summary (reasoning=on, tools=on) ===");
  for (const row of summary) {
    console.log(`${row.model}: reasoning=${row.hasReasoning ? row.reasoningField : "NO"} tools=${row.hasTools ? "yes" : "NO"}${row.error ? ` error=${row.error.slice(0, 80)}` : ""}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
