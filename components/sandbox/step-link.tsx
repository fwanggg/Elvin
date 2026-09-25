"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Dev Mode's step debugger.
 *
 * A step is drawn three times over — a row in the stats panel, a stretch of the run's
 * own span, and the card, or the block of a trace, it happened in — and all three are
 * the same step. Dev Mode keeps that state in the panel: put the pointer on a row or a
 * stretch and the chat answers, choose one and it stays marked while the card that owns
 * it opens onto the block it measured.
 *
 * Every drawing addresses itself in the DOM — `data-steps` for a card or a block of a
 * trace, `data-span` for a stretch of the run, `data-step` for a row — because neither
 * surface can hand the other a node. Those attributes are how a mark is found again;
 * the marks themselves are this state.
 */
type StepLink = {
  /** The panel keys under the pointer. */
  hovered: readonly string[];
  /** The step that was chosen, held until it is chosen again. */
  chosen: string | null;
  /** Marks the steps a panel row or span answers to. */
  mark: (keys: string) => void;
  /** Takes the pointer's mark off. */
  leave: () => void;
  /** Chooses a step, or gives it up when it is the one already chosen. */
  choose: (key: string) => void;
};

const DISABLED_STEP_LINK: StepLink = {
  hovered: [],
  chosen: null,
  mark: () => {},
  leave: () => {},
  choose: () => {},
};

const StepLinkContext = createContext<StepLink>(DISABLED_STEP_LINK);

/**
 * The feature boundary for Dev Mode's step debugger. Outside it the chat still renders
 * the same components, but `useStepLink` returns the no-op link.
 */
export function StepDebugBoundary({ activeRun, enabled, children }: Readonly<{ activeRun: number | null; enabled: boolean; children: ReactNode }>): ReactNode {
  if (!enabled) return children;
  return <StepLinkProvider activeRun={activeRun}>{children}</StepLinkProvider>;
}

/** Holds which step the pointer is on and which one was chosen. */
function StepLinkProvider({ activeRun, children }: Readonly<{ activeRun: number | null; children: ReactNode }>): ReactNode {
  const [hovered, setHovered] = useState<readonly string[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  const listed = useRef(activeRun);

  const show = useCallback((keys: string) => {
    const next = keys.split(" ").filter((key) => key.length > 0);
    // The same mark twice in a row is not news: a pointer crossing a row's children
    // should not cost a render.
    setHovered((current) => (current.join(" ") === next.join(" ") ? current : next));
  }, []);

  const mark = useCallback((keys: string) => show(keys), [show]);

  const leave = useCallback(() => {
    setHovered((current) => (current.length === 0 ? current : []));
  }, []);

  // What is marked or chosen belongs to the run that lists it: a panel turned to another
  // run is showing no choice, and no pointer, rather than keys whose rows are gone.
  useEffect(() => {
    if (listed.current === activeRun) return;
    listed.current = activeRun;
    setChosen(null);
    setHovered((current) => (current.length === 0 ? current : []));
  }, [activeRun]);

  // The chosen step owns the chat: choosing one opens the card that made it and points
  // at the exact part of it, choosing another closes the first, and choosing the same
  // one closes it again.
  useEffect(() => {
    const previous = opened.current;
    opened.current = chosen;
    if (previous !== null && previous !== chosen) closeAt(previous, chosen);
    if (chosen !== null) openAt(chosen);
  }, [chosen]);

  // A mark off the viewport is a mark nobody sees, so the chat gives up the least it
  // can: `nearest` moves nothing that is already in sight.
  useEffect(() => {
    if (hovered.length === 0) return;
    deepestCard(hovered)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hovered]);

  useEffect(() => () => {
    if (opened.current !== null) closeAt(opened.current, null);
  }, []);

  const value = useMemo<StepLink>(() => ({
    hovered,
    chosen,
    mark,
    leave,
    choose: (key: string) => setChosen((current) => (current === key ? null : key)),
  }), [hovered, chosen, mark, leave]);

  return <StepLinkContext.Provider value={value}>{children}</StepLinkContext.Provider>;
}

/** The link, from anywhere the linked drawings are. Outside Dev Mode it is inert. */
export function useStepLink(): StepLink {
  return useContext(StepLinkContext);
}

/** Whether a mark covers any of the keys an element answers to. */
export function touches(keys: readonly string[], answering: string): boolean {
  if (keys.length === 0 || answering.length === 0) return false;
  return keys.some((key) => answering.split(" ").includes(key));
}

/**
 * The class a row or a stretch of the run wears: banded while that panel piece is the
 * one under the pointer, or the one being held.
 */
export function marked(base: string, answering: string, link: Pick<StepLink, "hovered" | "chosen">): string {
  return `${base}${touches(link.hovered, answering) ? " is-linked" : ""}${heldBy(answering, link) ? " is-pointed" : ""}`;
}

/**
 * The class a drawing in the thread wears. The thread is no longer a source for the
 * panel — hovering cards made the stats rail too noisy — but it still answers panel
 * hover and choice. A panel row points to the deepest drawing for its key: a block when
 * the trace is open, otherwise the card that owns it.
 */
export function pointed(base: string, answering: string, link: Pick<StepLink, "hovered" | "chosen">): string {
  if (answering.length === 0) return base;
  const on = link.hovered.length === 1 ? touches(link.hovered, answering) : link.hovered.length > 1 && link.hovered.join(" ") === answering;
  const held = heldBy(answering, link);
  return `${base}${on || held ? " is-linked" : ""}${held ? " is-pointed" : ""}`;
}

/** Whether the element is the one the choice holds. */
function heldBy(answering: string, link: Pick<StepLink, "chosen">): boolean {
  return link.chosen !== null && answering.split(" ").includes(link.chosen);
}

/** Every card in the chat that answers to any of these keys, in the order drawn. */
function chatCards(keys: readonly string[]): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-steps]")].filter((card) => touches(keys, card.dataset.steps ?? ""));
}

/** The deepest of them: the block of a trace when the trace is drawn in blocks, else the card. */
function deepestCard(keys: readonly string[]): HTMLElement | undefined {
  return chatCards(keys).at(-1);
}

/**
 * How long a card takes to open. The pointer waits it out: the box grows while the trace
 * opens, so a scroll taken during the animation lands where the content will no longer be.
 */
function openMs(card: HTMLElement): number {
  const declared = getComputedStyle(card).getPropertyValue("--animation-duration").trim();
  const value = Number.parseFloat(declared);
  if (!Number.isFinite(value) || value <= 0) return 260;
  return (declared.endsWith("ms") ? value : value * 1000) + 60;
}

/**
 * Opening the card a step's key names, and pointing at the exact part of it. The
 * disclosure belongs to the card, so it is asked to open rather than told: a card that is
 * already open has nothing to wait for.
 */
function openAt(key: string): void {
  const card = chatCards([key])[0];
  if (card === undefined) return;
  const closed = card.querySelector<HTMLElement>('[aria-expanded="false"]');
  closed?.click();
  setTimeout(() => {
    const exact = deepestCard([key]) ?? card;
    exact.scrollIntoView({ block: exact === card ? "nearest" : "center", behavior: "smooth" });
  }, closed ? openMs(card) : 0);
}

/**
 * Closing what that key opened — unless the card the reader has just chosen is the same
 * one. A trace's rows are stretches of a single card, and closing it to open it again
 * would blink away the block being pointed at.
 */
function closeAt(key: string, keeping: string | null): void {
  const kept = keeping === null ? [] : chatCards([keeping]);
  for (const card of chatCards([key])) {
    if (!kept.includes(card)) card.querySelector<HTMLElement>('[aria-expanded="true"]')?.click();
  }
}
