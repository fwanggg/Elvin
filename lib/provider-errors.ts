/**
 * Providers are called from wherever the request is served, and that is not
 * always the machine the browser is on: a deployed Elvin proxies the provider
 * through its own servers, where a loopback address means the server itself. A
 * raw fetch failure says none of that — it arrives as "fetch failed" — so the
 * routes phrase the two cases themselves.
 */
export function unreachableProviderError(endpoint: string, error: unknown): string {
  const host = hostOf(endpoint);
  const detail = error instanceof Error && error.message.length > 0 ? error.message : "unreachable";

  if (isLoopback(host)) {
    return `Could not reach ${host}: a loopback address only answers on the machine running it, and this server — not the browser — makes the provider call. Run Elvin locally to use it, or leave the URL empty to run in demo mode.`;
  }

  return `Could not reach ${host} (${detail}). Check the host and that it is publicly reachable, or leave the URL empty to run in demo mode.`;
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
