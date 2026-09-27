"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { listSessions, subscribeToTranscripts, type SessionSummary } from "@/lib/session-store";

type SessionPickerProps = Readonly<{
  /** The endpoint whose conversations these are: another endpoint's are another list. */
  endpoint: string;
  /** The conversation the sandbox is on, marked but not moved: the list stays in time order. */
  currentId: string;
  onSelect: (id: string) => void;
  onNewThread: () => void;
  onDelete: (id: string) => void;
}>;

/** Space between the trigger and its menu. */
const GAP = 6;

/**
 * The conversation the sandbox is on, in the bar beside the agent it belongs to.
 *
 * The list used to live in the rail, above knobs that only shape the sandbox. It belongs with the
 * agent instead: a conversation is only ever continued by the endpoint it was taken against, and
 * the endpoint is what the rest of the bar is about. The trigger carries the one in use — a thread
 * nothing has been said in yet is still a conversation — and the menu carries the rest, in the
 * rows the rail had: newest first, never reordered by being selected, deleted from the row itself.
 *
 * The menu is portalled and fixed-positioned because the bar is not a scroll container and the
 * stage under it must not move: opening a list of conversations should not shift the conversation
 * being read.
 */
export function SessionPicker({ endpoint, currentId, onSelect, onNewThread, onDelete }: SessionPickerProps): ReactNode {
  // Read in an effect rather than while rendering: the store is the browser's, and a client
  // component also renders on the server, where there is none.
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = (): void => setSessions(listSessions(endpoint));
    read();
    return subscribeToTranscripts(read);
  }, [endpoint, currentId]);

  // Measured after the menu is in the DOM but before paint, so it never flashes somewhere else.
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPlacement({ top: rect.bottom + GAP, left: rect.left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // A menu that outlives the press that opened it has to close on the next press elsewhere, and on
  // Escape: it covers the stage, which is what the reader would otherwise be reading.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = sessions.find((session) => session.id === currentId);
  const currentTitle = current && current.title.length > 0 ? current.title : "New thread";

  return (
    <div className="metric-cell metric-session">
      <span className="metric-cell-head">Session</span>
      <button
        ref={triggerRef}
        className="session-current"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="session-current-title">{currentTitle}</span>
        <span className="session-current-badge">Live</span>
        <svg className="session-current-chevron" viewBox="0 0 14 8" aria-hidden="true" focusable="false">
          <path d="M1 1l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button className="session-new" type="button" aria-label="New thread" title="New thread" onClick={onNewThread}>
        <span aria-hidden="true">+</span>
      </button>

      {open && placement && createPortal(
        <div className="session-menu" ref={menuRef} style={{ top: placement.top, left: placement.left }}>
          <ul className="sessions-list">
            {sessions.map((session) => {
              const live = session.id === currentId;
              const title = session.title.length > 0 ? session.title : "New thread";
              return (
                <li className="session-item" key={session.id}>
                  <button
                    className={live ? "session is-live" : "session"}
                    type="button"
                    aria-current={live ? "true" : undefined}
                    onClick={() => {
                      onSelect(session.id);
                      setOpen(false);
                    }}
                  >
                    <span className="session-line">
                      {live && <span className="session-mark" aria-hidden="true" />}
                      <span className="session-title">{title}</span>
                      <span className="session-when">{live ? "LIVE" : whenOf(session.savedAt)}</span>
                    </span>
                    <span className="session-meta">{metaOf(session)}</span>
                  </button>
                  {/* Sits where the time does and takes its place on hover, so nothing shifts. */}
                  <button
                    className="session-delete"
                    type="button"
                    aria-label={`Delete ${title}`}
                    title={`Delete ${title}`}
                    onClick={() => onDelete(session.id)}
                  />
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** How a conversation's age reads: just now, a time today, or a date. */
function whenOf(savedAt: number): string {
  if (Date.now() - savedAt < 60_000) return "now";
  const at = new Date(savedAt);
  if (at.toDateString() === new Date().toDateString()) {
    return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return at.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** What a conversation holds: how many turns, and what they cost where that was measured. */
function metaOf(session: SessionSummary): string {
  if (session.runs === 0) return "Empty · waiting for first message";
  const runs = `${session.runs} run${session.runs === 1 ? "" : "s"}`;
  // A window too short to round to a second reads as noise beside the runs panel's own figure.
  return session.ms >= 1000 ? `${runs} · ${durationOf(session.ms)}` : runs;
}

function durationOf(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
