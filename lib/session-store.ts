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
 * A transcript is stored once, under its own id, because that id is also what the provider is
 * asked to remember. What belongs to *whom* is a separate index: every endpoint has a bucket
 * listing the conversations that are its own and the one it is currently on, so pointing the
 * sandbox at another agent shows that agent's conversations and nothing else — the ids a previous
 * endpoint minted mean nothing to the next one, and a list that survives the switch is a list of
 * sessions the endpoint in front of the reader has never heard of.
 *
 * The endpoint and model are ordinary state and live in `localStorage`. The key lives in
 * `sessionStorage`, which is what the page promises: it is forwarded per request, kept for the
 * browser session, and gone when the tab is.
 */

const TRANSCRIPT_PREFIX = "elvin.transcript.";
const SESSIONS_PREFIX = "elvin.sessions.";
const CONNECTION_KEY = "elvin.connection";
const LEGACY_THREAD_KEY = "elvin.threadId";
const API_KEY = "elvin.apiKey";
const VERSION = 1;
const KEEP_THREADS = 5;

/** Listeners wanting to hear about a transcript being written; see `subscribeToTranscripts`. */
const listeners = new Set<() => void>();

type StoredThread = {
  version: number;
  savedAt: number;
  headId: string | null;
  messages: ExportedMessageRepositoryItem[];
};

/** One endpoint's conversations: the ids that are its own, and the one it is on. */
type StoredSessions = {
  version: number;
  current: string;
  ids: string[];
};

/** The endpoint and model a reload should reconnect with. */
export type StoredConnection = {
  baseUrl: string;
  model: string;
};

/**
 * What an endpoint is filed under.
 *
 * The scheme and host are read through `URL` and folded to lower case, because those are case
 * insensitive and a reader typing `HTTP://Box/v1` means the box they already have sessions on. The
 * path is kept exactly as typed — a path can be case sensitive, and two endpoints differing there
 * are two endpoints — with a trailing slash dropped, so `/v1` and `/v1/` are the same place. An
 * address written without a scheme is read as the browser would read it, with one.
 */
export function endpointKey(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return "";

  for (const candidate of [trimmed, `http://${trimmed}`]) {
    try {
      const parsed = new URL(candidate);
      if (parsed.hostname.length === 0) continue;
      return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
    } catch {
      // Not an address as written; the next spelling is the browser's own.
    }
  }

  return trimmed.replace(/\/+$/, "");
}

/**
 * The history adapter for one endpoint's current thread.
 *
 * Both of them are read on every call rather than captured, because both change under a runtime
 * that outlives them: starting a new thread writes a new id first, and pointing the sandbox at
 * another endpoint moves the conversation to that endpoint's list. The load either change triggers
 * has to find the transcript it now belongs to rather than the one it came from.
 *
 * A thread is a conversation, not a document. The newest few of an endpoint are kept and the rest
 * dropped, and a message rewritten by its own later state — a run that streams, then finalizes —
 * replaces the entry it came from instead of piling up beside it.
 */
export function localHistory(where: () => string, threadId: () => string): ThreadHistoryAdapter {
  return {
    async load(): Promise<ExportedMessageRepository> {
      const stored = readThread(threadId());
      return { headId: stored?.headId ?? null, messages: stored?.messages ?? [] };
    },

    async append(item: ExportedMessageRepositoryItem): Promise<void> {
      const id = threadId();
      const endpoint = where();
      const stored = readThread(id) ?? { version: VERSION, savedAt: 0, headId: null, messages: [] };
      const existing = stored.messages.findIndex((entry) => entry.message.id === item.message.id);
      if (existing === -1) stored.messages.push(item);
      else stored.messages[existing] = item;

      // The thread is linear, so the head is whatever was written last.
      stored.headId = stored.messages.at(-1)?.message.id ?? null;
      stored.savedAt = Date.now();
      write(TRANSCRIPT_PREFIX + id, JSON.stringify(stored));
      prune(endpoint);
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

/** The thread this endpoint is on, or empty when it has never been spoken to. */
export function currentThreadId(endpoint: string): string {
  return readSessions(endpoint).current;
}

/**
 * File the thread an endpoint is on, and count it among that endpoint's conversations: the id goes
 * back on the wire as the session, so the provider's own memory follows the reader rather than
 * running ahead of them.
 */
export function setCurrentThread(endpoint: string, id: string): void {
  if (id.length === 0) return;
  const sessions = readSessions(endpoint);
  const ids = sessions.ids.includes(id) ? sessions.ids : [...sessions.ids, id];
  writeSessions(endpoint, { ...sessions, current: id, ids });
}

/**
 * Everything a stored conversation holds, for replaying it into a live thread: switching to a
 * session creates a thread, and a thread that has just been created has no history to load.
 */
export function readSessionMessages(id: string): ThreadMessage[] {
  return readThread(id)?.messages.map((entry) => entry.message) ?? [];
}

/**
 * Drop a conversation: its transcript, and with it its row — and its place in the endpoint's list,
 * which is what keeps a dropped conversation from coming back as a row with nothing behind it.
 */
export function forgetSession(endpoint: string, id: string): void {
  if (id.length === 0) return;
  try {
    window.localStorage.removeItem(TRANSCRIPT_PREFIX + id);
  } catch (error) {
    console.warn(`Could not remove the transcript of ${id}.`, error);
  }

  const sessions = readSessions(endpoint);
  writeSessions(endpoint, {
    ...sessions,
    ids: sessions.ids.filter((entry) => entry !== id),
    current: sessions.current === id ? "" : sessions.current,
  });
  for (const listener of listeners) listener();
}

/**
 * Note a thread as a conversation before anything has been said in it. A session the reader started
 * and stepped away from is still one they made, and without this it would leave the list the moment
 * it was no longer the one in use — which is exactly when they would look for it.
 */
export function rememberSession(endpoint: string, id: string): void {
  if (id.length === 0) return;

  if (!readThread(id)) {
    const empty: StoredThread = { version: VERSION, savedAt: Date.now(), headId: null, messages: [] };
    write(TRANSCRIPT_PREFIX + id, JSON.stringify(empty));
  }

  const sessions = readSessions(endpoint);
  if (!sessions.ids.includes(id)) writeSessions(endpoint, { ...sessions, ids: [...sessions.ids, id] });
  prune(endpoint);
  for (const listener of listeners) listener();
}

/**
 * This endpoint's conversations, newest first.
 *
 * Ordered by when each was last written and nothing else, so the row being looked at keeps its
 * place: a list that reorders under the pointer loses the one thing a list is for. The conversation
 * in use is included even with no transcript, which is a session too.
 */
export function listSessions(endpoint: string): SessionSummary[] {
  const sessions = readSessions(endpoint);
  const rows: SessionSummary[] = [];

  for (const id of sessions.ids) {
    const stored = readThread(id);
    if (stored) rows.push({ id, ...summarize(stored) });
  }

  rows.sort((left, right) => right.savedAt - left.savedAt);
  if (sessions.current.length === 0 || rows.some((row) => row.id === sessions.current)) return rows;
  return [{ id: sessions.current, title: "", runs: 0, ms: 0, savedAt: Date.now() }, ...rows];
}

/**
 * Adopt what was stored before conversations were filed by endpoint.
 *
 * Sessions used to hang off one global thread key, so a browser upgrading from that has
 * conversations with no endpoint to belong to. They are the ones the reader was just using, so they
 * are filed under the endpoint that is live now, and the global key is dropped as the receipt that
 * this has happened: no endpoint that has not been seen is given another's conversations.
 */
export function adoptLegacySessions(endpoint: string): void {
  const legacyThread = read(LEGACY_THREAD_KEY);
  if (legacyThread.length === 0) return;

  const orphans: string[] = [];
  const sessions = readSessions(endpoint);
  const known = new Set(sessions.ids);
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(TRANSCRIPT_PREFIX)) continue;
      const id = key.slice(TRANSCRIPT_PREFIX.length);
      if (!known.has(id) && readThread(id)) orphans.push(id);
    }
  } catch (error) {
    console.warn("Could not read the transcripts stored before endpoints.", error);
  }

  writeSessions(endpoint, { version: VERSION, current: legacyThread, ids: [...sessions.ids, ...orphans] });
  try {
    window.localStorage.removeItem(LEGACY_THREAD_KEY);
  } catch (error) {
    console.warn(`Could not clear ${LEGACY_THREAD_KEY}.`, error);
  }
  for (const listener of listeners) listener();
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

function readSessions(endpoint: string): StoredSessions {
  const parsed = readJson(SESSIONS_PREFIX + endpoint);
  if (parsed === null || typeof parsed !== "object") return { version: VERSION, current: "", ids: [] };

  const candidate = parsed as Partial<StoredSessions>;
  if (candidate.version !== VERSION || !Array.isArray(candidate.ids)) return { version: VERSION, current: "", ids: [] };
  return {
    version: VERSION,
    current: typeof candidate.current === "string" ? candidate.current : "",
    ids: candidate.ids.filter((id): id is string => typeof id === "string"),
  };
}

function writeSessions(endpoint: string, sessions: StoredSessions): void {
  write(SESSIONS_PREFIX + endpoint, JSON.stringify(sessions));
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

/**
 * Keeps the newest few conversations of one endpoint, so a long-lived browser does not fill its
 * store with them. The one in use is kept whatever its age: it is the conversation on screen.
 */
function prune(endpoint: string): void {
  const sessions = readSessions(endpoint);
  if (sessions.ids.length <= KEEP_THREADS) return;

  const kept = sessions.ids
    .map((id) => ({ id, savedAt: readThread(id)?.savedAt ?? 0 }))
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, KEEP_THREADS)
    .map((entry) => entry.id);
  if (sessions.current.length > 0 && !kept.includes(sessions.current)) kept.push(sessions.current);

  const keep = new Set(kept);
  for (const id of sessions.ids) {
    if (keep.has(id)) continue;
    try {
      window.localStorage.removeItem(TRANSCRIPT_PREFIX + id);
    } catch (error) {
      console.warn(`Could not remove the transcript of ${id}.`, error);
    }
  }

  writeSessions(endpoint, { ...sessions, ids: kept });
}
