/**
 * Turns a tool call into the sentence a polished assistant shows instead of the
 * raw call: "Searching the web for “4821”".
 *
 * The tool set belongs to whatever backend the agent runs on, so nothing here
 * knows a specific tool. The name is read for a verb anywhere in it, the rest of
 * the name becomes the subject, and the first recognisable argument becomes the
 * object. Unknown tools still read as English rather than as an identifier.
 */
export type StepPhase = "running" | "complete" | "failed";

type VerbForms = Readonly<{ running: string; complete: string; failed: string }>;

/** Keyed by the word to look for in the tool name; it may appear in any position. */
export const STEP_VERBS: Readonly<Record<string, VerbForms>> = {
  search: { running: "Searching", complete: "Searched", failed: "Couldn't search" },
  find: { running: "Searching", complete: "Searched", failed: "Couldn't search" },
  lookup: { running: "Searching", complete: "Searched", failed: "Couldn't search" },
  query: { running: "Searching", complete: "Searched", failed: "Couldn't search" },
  browse: { running: "Browsing", complete: "Browsed", failed: "Couldn't browse" },
  scrape: { running: "Reading", complete: "Read", failed: "Couldn't read" },
  get: { running: "Looking up", complete: "Looked up", failed: "Couldn't look up" },
  fetch: { running: "Looking up", complete: "Looked up", failed: "Couldn't look up" },
  read: { running: "Reading", complete: "Read", failed: "Couldn't read" },
  load: { running: "Loading", complete: "Loaded", failed: "Couldn't load" },
  list: { running: "Listing", complete: "Listed", failed: "Couldn't list" },
  create: { running: "Creating", complete: "Created", failed: "Couldn't create" },
  add: { running: "Adding", complete: "Added", failed: "Couldn't add" },
  update: { running: "Updating", complete: "Updated", failed: "Couldn't update" },
  edit: { running: "Editing", complete: "Edited", failed: "Couldn't edit" },
  write: { running: "Writing", complete: "Wrote", failed: "Couldn't write" },
  save: { running: "Saving", complete: "Saved", failed: "Couldn't save" },
  delete: { running: "Deleting", complete: "Deleted", failed: "Couldn't delete" },
  remove: { running: "Removing", complete: "Removed", failed: "Couldn't remove" },
  send: { running: "Sending", complete: "Sent", failed: "Couldn't send" },
  post: { running: "Posting", complete: "Posted", failed: "Couldn't post" },
  run: { running: "Running", complete: "Ran", failed: "Couldn't run" },
  execute: { running: "Running", complete: "Ran", failed: "Couldn't run" },
  call: { running: "Calling", complete: "Called", failed: "Couldn't call" },
  check: { running: "Checking", complete: "Checked", failed: "Couldn't check" },
  verify: { running: "Verifying", complete: "Verified", failed: "Couldn't verify" },
  analyze: { running: "Analyzing", complete: "Analyzed", failed: "Couldn't analyze" },
  summarize: { running: "Summarizing", complete: "Summarized", failed: "Couldn't summarize" },
  translate: { running: "Translating", complete: "Translated", failed: "Couldn't translate" },
  calculate: { running: "Calculating", complete: "Calculated", failed: "Couldn't calculate" },
  compute: { running: "Calculating", complete: "Calculated", failed: "Couldn't calculate" },
  count: { running: "Counting", complete: "Counted", failed: "Couldn't count" },
  open: { running: "Opening", complete: "Opened", failed: "Couldn't open" },
  download: { running: "Downloading", complete: "Downloaded", failed: "Couldn't download" },
  upload: { running: "Uploading", complete: "Uploaded", failed: "Couldn't upload" },
  schedule: { running: "Scheduling", complete: "Scheduled", failed: "Couldn't schedule" },
  notify: { running: "Notifying", complete: "Notified", failed: "Couldn't notify" },
  email: { running: "Emailing", complete: "Emailed", failed: "Couldn't email" },
  book: { running: "Booking", complete: "Booked", failed: "Couldn't book" },
  track: { running: "Tracking", complete: "Tracked", failed: "Couldn't track" },
  generate: { running: "Generating", complete: "Generated", failed: "Couldn't generate" },
};

/** Subjects that want an article: "searching the web", not "searching web". */
export const DEFINITE = new Set(["web", "internet", "online", "database", "db", "file", "files", "disk", "cloud", "api", "network", "repo", "calendar", "inbox", "docs", "account", "order", "orders", "system", "weather", "news", "stock", "prices"]);

/** Argument keys tried first when choosing the step's object. */
export const OBJECT_KEYS = ["query", "q", "search", "term", "prompt", "text", "message", "input", "url", "uri", "link", "path", "file", "filename", "name", "title", "id", "order_id", "location", "city", "symbol", "ticker", "email", "to", "sku", "code"];

/** Longest object we will quote; beyond this it is data, not a label. */
const OBJECT_LIMIT = 48;

/** `getOrderStatus`, `get_order_status` and `web.search` all become words. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function objectOf(args: unknown): string | undefined {
  if (typeof args === "string") return args.length > 0 && args.length <= OBJECT_LIMIT ? args : undefined;
  if (!args || typeof args !== "object") return undefined;

  const record = args as Record<string, unknown>;
  for (const key of OBJECT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0 && value.length <= OBJECT_LIMIT) return value;
  }
  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.length > 0 && value.length <= OBJECT_LIMIT) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

export function describeStep(toolName: string, args: unknown, phase: StepPhase): string {
  const words = wordsOf(toolName);
  const at = words.findIndex((word) => word in STEP_VERBS);
  const verb = at >= 0 ? STEP_VERBS[words[at]] : undefined;
  const subjectWords = at >= 0 ? [...words.slice(0, at), ...words.slice(at + 1)] : words;
  const subject = subjectWords.join(" ");

  const headline = verb ? verb[phase] : phase === "running" ? "Working on" : phase === "complete" ? "Worked on" : "Couldn't finish";
  const noun = subject.length === 0 ? "" : DEFINITE.has(subject) ? `the ${subject}` : subject;
  const object = objectOf(args);

  return `${headline}${noun ? ` ${noun}` : ""}${object ? ` for “${object}”` : ""}`;
}
