import { NextResponse } from "next/server";

type RequestBody = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
};

type ParsedRequest =
  | { ok: true; body: { baseUrl: string; apiKey?: string; model?: string } }
  | { ok: false; response: NextResponse };

type ProviderEndpoints = {
  models: string;
  chat: string;
  capabilities: string;
};

type ModelProbe =
  | { ok: true; models: string[] }
  | { ok: false; error?: string };

type CapabilitiesProbe =
  | { ok: true; capabilities: string[] }
  | { ok: false; capabilities: string[] };

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const MODELS_PATH = "/models";
const CAPABILITIES_PATH = "/capabilities";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await parseRequest(request);
  if (!parsed.ok) return parsed.response;

  const { apiKey, baseUrl, model } = parsed.body;
  if (baseUrl.length === 0) {
    return NextResponse.json({ ok: true, model: "acme-support-agent" });
  }

  const endpoints = providerEndpoints(baseUrl);
  const models = await probeModels(endpoints, apiKey, model);
  if (!models.ok) {
    return NextResponse.json({ ok: false, error: models.error }, { status: 502 });
  }

  const capabilities = await checkCapabilities(endpoints.capabilities, apiKey);
  return checkResponse(model, models.models, capabilities);
}

async function parseRequest(request: Request): Promise<ParsedRequest> {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 }),
    };
  }

  return {
    ok: true,
    body: {
      baseUrl: body.baseUrl?.trim() ?? "",
      apiKey: body.apiKey,
      model: body.model?.trim(),
    },
  };
}

async function probeModels(endpoints: ProviderEndpoints, apiKey: string | undefined, model: string | undefined): Promise<ModelProbe> {
  const models = await checkModels(endpoints.models, apiKey);
  if (models.ok) return models;
  if (!model) return { ok: false, error: models.error };

  const chat = await checkChat(endpoints.chat, apiKey, model);
  if (!chat.ok) return { ok: false, error: chat.error ?? models.error };

  return { ok: true, models: [] };
}

function checkResponse(model: string | undefined, models: string[], capabilities: CapabilitiesProbe): NextResponse {
  return NextResponse.json({
    ok: true,
    model: model || models[0],
    models,
    capabilities: capabilities.ok ? capabilities.capabilities : [],
  });
}

async function checkModels(endpoint: string, apiKey?: string): Promise<ModelProbe> {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: authHeaders(apiKey),
    cache: "no-store",
  }).catch((error: unknown) => error instanceof Error ? error : new Error("Unable to reach model endpoint."));

  if (response instanceof Error) return { ok: false, error: response.message };
  const text = await response.text();
  if (!response.ok) return { ok: false, error: providerError(text, response.status) };

  try {
    const data = JSON.parse(text) as { data?: Array<{ id?: string } | string> };
    const models = (data.data ?? []).map((item) => typeof item === "string" ? item : item.id).filter((item): item is string => Boolean(item));
    return { ok: true, models };
  } catch {
    return { ok: true, models: [] };
  }
}

async function checkChat(endpoint: string, apiKey: string | undefined, model: string): Promise<ModelProbe> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
    cache: "no-store",
  }).catch((error: unknown) => error instanceof Error ? error : new Error("Unable to reach chat endpoint."));

  if (response instanceof Error) return { ok: false, error: response.message };
  const text = await response.text();
  if (!response.ok) return { ok: false, error: providerError(text, response.status) };
  return { ok: true, models: [] };
}

async function checkCapabilities(endpoint: string, apiKey?: string): Promise<CapabilitiesProbe> {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: authHeaders(apiKey),
    cache: "no-store",
  }).catch((error: unknown) => error instanceof Error ? error : new Error("Unable to reach capabilities endpoint."));

  if (response instanceof Error) return { ok: false, capabilities: [] };
  const text = await response.text();
  if (!response.ok) return { ok: false, capabilities: [] };

  try {
    const data = JSON.parse(text) as { data?: unknown; capabilities?: unknown };
    return { ok: true, capabilities: normalizeCapabilities(data.capabilities ?? data.data ?? data) };
  } catch {
    return { ok: false, capabilities: [] };
  }
}

function providerEndpoints(baseUrl: string): ProviderEndpoints {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return {
    models: endpointFor(trimmed, MODELS_PATH, [CHAT_COMPLETIONS_PATH]),
    chat: endpointFor(trimmed, CHAT_COMPLETIONS_PATH),
    capabilities: endpointFor(trimmed, CAPABILITIES_PATH, [MODELS_PATH, CHAT_COMPLETIONS_PATH]),
  };
}

function endpointFor(trimmedBaseUrl: string, targetPath: string, sourcePaths: string[] = []): string {
  if (trimmedBaseUrl.endsWith(targetPath)) return trimmedBaseUrl;

  for (const sourcePath of sourcePaths) {
    if (trimmedBaseUrl.endsWith(sourcePath)) {
      return `${trimmedBaseUrl.slice(0, -sourcePath.length)}${targetPath}`;
    }
  }

  return `${trimmedBaseUrl}${targetPath}`;
}

function normalizeCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "id" in item && typeof item.id === "string") return item.id;
      if (item && typeof item === "object" && "name" in item && typeof item.name === "string") return item.name;
      return "";
    }).filter(Boolean);
  }
  if (!value || typeof value !== "object") return [];

  const record = value as { features?: unknown; capabilities?: unknown };
  const features = record.features ?? record.capabilities;
  if (features && typeof features === "object" && !Array.isArray(features)) {
    return Object.entries(features)
      .filter(([, enabled]) => enabled === true)
      .map(([name]) => name);
  }

  return Object.keys(value);
}

function authHeaders(apiKey?: string): Record<string, string> {
  const trimmed = apiKey?.trim();
  return trimmed ? { Authorization: `Bearer ${trimmed}` } : {};
}

function providerError(text: string, status: number) {
  try {
    const data = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return data.error?.message ?? data.message ?? `Provider returned HTTP ${status}.`;
  } catch {
    return text || `Provider returned HTTP ${status}.`;
  }
}
