import { DEFINITE, OBJECT_KEYS, STEP_VERBS } from "@/lib/step-labels";

/**
 * components/assistant/step-label.ts, the scaffold's own copy of the step
 * vocabulary.
 *
 * The scaffold cannot import from Elvin, so the tables are serialized from
 * lib/step-labels.ts — the words live in one place. Only the small lookup
 * functions are restated; they are the part that would otherwise have to be
 * code-generated.
 */
export function stepLabelSource(): string {
  return `export type StepPhase = "running" | "complete" | "failed";

const STEP_VERBS: Record<string, Record<StepPhase, string>> = ${JSON.stringify(STEP_VERBS)};

const DEFINITE = new Set<string>(${JSON.stringify([...DEFINITE])});

const OBJECT_KEYS = ${JSON.stringify(OBJECT_KEYS)};

/** Longest object we will quote; beyond this it is data, not a label. */
const OBJECT_LIMIT = 48;

/** \`getOrderStatus\`, \`get_order_status\` and \`web.search\` all become words. */
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
  const noun = subject.length === 0 ? "" : DEFINITE.has(subject) ? \`the \${subject}\` : subject;
  const object = objectOf(args);

  return \`\${headline}\${noun ? \` \${noun}\` : ""}\${object ? \` for “\${object}”\` : ""}\`;
}
`;
}
