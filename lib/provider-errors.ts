/**
 * What a caller says when the provider could not be reached at all.
 *
 * The engine words this for wherever it is running and claims nothing about networks, because the
 * distinction that matters — CORS, a refused permission, or a host that is simply not there — is
 * one only a browser can read, and the browser transport reads it and says so instead
 * (`explainFailure` in `lib/agent-transport`). What is left here is the wording for a caller with
 * no such reading to offer: the host, whatever was thrown, and the one thing a reader can do.
 */
export function unreachableProviderError(endpoint: string, error: unknown): string {
  const host = hostOf(endpoint);
  const detail = error instanceof Error && error.message.length > 0 ? error.message : "unreachable";

  if (isLoopback(host)) {
    return `Could not reach ${host}: a loopback address answers only on the machine running it, so the agent has to be running on this one. Start it here, or leave the URL empty to run in demo mode.`;
  }

  return `Could not reach ${host} (${detail}). Check the host and that this machine can reach it, or leave the URL empty to run in demo mode.`;
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

function isLoopback(host: string): boolean {
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "localhost" || name === "::1" || name === "0.0.0.0" || name.startsWith("127.");
}
