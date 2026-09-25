import type { ExportedMessageRepository, ExportedMessageRepositoryItem, ThreadHistoryAdapter, ThreadMessage } from "@assistant-ui/react";

/**
 * What the browser keeps so a reload comes back to the conversation it was on.
 *
 * Nothing on the wire replays a thread. `chat/completions` is stateless by contract, and a
 * provider's own memory is reached through its session id rather than by asking for history — so a
 * client that reloads with an empty transcript renders nothing, however well the provider
 * remembers the thread. Two things are kept here instead:
 *
 * - the transcript, through assistant-ui's own history adapter, which loads when a thread opens
 *   and appends as messages land;
 * - the connection it belongs to, so the reload reconnects rather than showing the connect screen.
 *
 * The endpoint and model are ordinary state and live in `localStorage`. The key lives in
 * `sessionStorage`, which is what the page promises: it is forwarded per request, kept for the
 * browser session, and gone when the tab is.
 */

const TRANSCRIPT_PREFIX = "elvin.transcript.";
const CONNECTION_KEY = "elvin.connection";
const THREAD_KEY = "elvin.threadId";
const API_KEY = "elvin.apiKey";
const VERSION = 1;
const KEEP_THREADS = 12;

/** Listeners wanting to hear about a transcript being written; see `subscribeToTranscripts`. */
const listeners = new Set<() => void>();

type StoredThread = {
  version: number;
  savedAt: number;
  headId: string | null;
  messages: ExportedMessageRepositoryItem[];
};

/** The endpoint and model a reload should reconnect with. */
export type StoredConnection = {
  baseUrl: string;
  model: string;
};

/**
 * The history adapter for one thread at a time.
 *
 * `threadId` is read on every call rather than captured, because the thread the sandbox is on
 * changes under a runtime that outlives it: starting a new thread writes a new id first, and the
 * load that triggers must find that thread's transcript — empty — rather than the old one's.
 *
 * A thread is a conversation, not a document. The newest few are kept and the rest dropped, and a
 * message rewritten by its own later state — a run that streams, then finalizes — replaces the
 * entry it came from instead of piling up beside it.
 */
export function localHistory(threadId: () => string): ThreadHistoryAdapter {
  return {
    async load(): Promise<ExportedMessageRepository> {
      const stored = readThread(threadId());
      return { headId: stored?.headId ?? null, messages: stored?.messages ?? [] };
    },

    async append(item: ExportedMessageRepositoryItem): Promise<void> {
      const id = threadId();
      const stored = readThread(id) ?? { version: VERSION, savedAt: 0, headId: null, messages: [] };
      const existing = stored.messages.findIndex((entry) => entry.message.id === item.message.id);
      if (existing === -1) stored.messages.push(item);
      else stored.messages[existing] = item;

      // The thread is linear, so the head is whatever was written last.
      stored.headId = stored.messages.at(-1)?.message.id ?? null;
      stored.savedAt = Date.now();
      write(TRANSCRIPT_PREFIX + id, JSON.stringify(stored));
      prune();
      for (const listener of listeners) listener();
    },
  };
}

/** One conversation in the list: what it was about, and what it cost. */
export type SessionSummary = {
  id: string;
  /** The first thing asked, or empty for a thread nothing has been said in yet. */
  title: string;
  /** How many turns were taken in it. */
  runs: number;
  /** What its answers took, summed over the turns that reported a window. */
  ms: number;
  savedAt: number;
};

/**
 * Notified whenever a transcript is written. The adapter writes as messages land, outside React's
 * view, so this is how a list of transcripts keeps up with the thread it is describing.
 */
export function subscribeToTranscripts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The thread the sandbox is on, or empty if this browser has never started one. */
export function currentThreadId(): string {
  return read(THREAD_KEY);
}

/**
 * Every conversation this browser has, the one in use first — including a thread nothing has been
 * said in yet, which is a session too and the one the list would otherwise be missing.
 */
export function listSessions(): SessionSummary[] {
  const current = currentThreadId();
  const sessions: SessionSummary[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(TRANSCRIPT_PREFIX)) continue;
    const id = key.slice(TRANSCRIPT_PREFIX.length);
    const stored = readThread(id);
    if (stored) sessions.push({ id, ...summarize(stored) });
  }

  sessions.sort((left, right) => (left.id === current ? -1 : right.id === current ? 1 : 0) || right.savedAt - left.savedAt);
  if (sessions.some((session) => session.id === current)) return sessions;
  return [{ id: current, title: "", runs: 0, ms: 0, savedAt: Date.now() }, ...sessions];
}

function summarize(stored: StoredThread): Omit<SessionSummary, "id"> {
  const messages = stored.messages.map((entry) => entry.message);
  return {
    title: titleOf(messages),
    runs: messages.filter((message) => message.role === "user").length,
    ms: messages.reduce((total, message) => total + (message.role === "assistant" ? message.metadata?.timing?.totalStreamTime ?? 0 : 0), 0),
    savedAt: stored.savedAt,
  };
}

function titleOf(messages: readonly ThreadMessage[]): string {
  const asked = messages.find((message) => message.role === "user" && partsOf(message).length > 0);
  return asked ? partsOf(asked) : "";
}

function partsOf(message: ThreadMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function readConnection(): StoredConnection | null {
  const parsed = readJson(CONNECTION_KEY);
  if (parsed === null || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<StoredConnection>;
  if (typeof candidate.baseUrl !== "string" || typeof candidate.model !== "string") return null;
  return { baseUrl: candidate.baseUrl, model: candidate.model };
}

export function writeConnection(connection: StoredConnection): void {
  write(CONNECTION_KEY, JSON.stringify(connection));
}

/** The key is session-scoped on purpose: a reload keeps it, closing the tab does not. */
export function readApiKey(): string {
  return read(API_KEY, window.sessionStorage);
}

export function writeApiKey(key: string): void {
  write(API_KEY, key, window.sessionStorage);
}

function readThread(id: string): StoredThread | null {
  const parsed = readJson(TRANSCRIPT_PREFIX + id);
  if (parsed === null || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<StoredThread>;
  if (candidate.version !== VERSION || !Array.isArray(candidate.messages)) return null;
  return candidate as StoredThread;
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch (error) {
    console.warn(`Could not read ${key}; starting without it.`, error);
    return null;
  }
}

function read(key: string, store: Storage = window.localStorage): string {
  try {
    return store.getItem(key) ?? "";
  } catch (error) {
    console.warn(`Could not read ${key}.`, error);
    return "";
  }
}

function write(key: string, value: string, store: Storage = window.localStorage): void {
  try {
    store.setItem(key, value);
  } catch (error) {
    // A full or disabled store costs the reload, not the conversation in front of the reader.
    console.warn(`Could not store ${key}.`, error);
  }
}

/** Keeps the newest few threads, so a long-lived browser does not fill its store with them. */
function prune(): void {
  const threads: Array<{ key: string; savedAt: number }> = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(TRANSCRIPT_PREFIX)) continue;
    threads.push({ key, savedAt: readThread(key.slice(TRANSCRIPT_PREFIX.length))?.savedAt ?? 0 });
  }
  if (threads.length <= KEEP_THREADS) return;
  threads
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(KEEP_THREADS)
    .forEach((entry) => window.localStorage.removeItem(entry.key));
}
