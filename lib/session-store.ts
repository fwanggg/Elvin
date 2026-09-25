import type { ExportedMessageRepository, ExportedMessageRepositoryItem, ThreadHistoryAdapter } from "@assistant-ui/react";

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
const API_KEY = "elvin.apiKey";
const VERSION = 1;
const KEEP_THREADS = 3;

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
    },
  };
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
