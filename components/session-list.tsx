"use client";

import { useEffect, useState, type ReactNode } from "react";
import { listSessions, subscribeToTranscripts, type SessionSummary } from "@/lib/session-store";

type SessionListProps = Readonly<{
  /** The conversation the sandbox is on, marked and kept at the top. */
  currentId: string;
  onSelect: (id: string) => void;
  onNewThread: () => void;
}>;

/**
 * The conversations this browser has, in the rail above the knobs.
 *
 * Read from the same store the sandbox writes its transcript to, and re-read when it says so: the
 * adapter appends as messages land, outside React's view, so nothing else would tell the list that
 * a turn has been taken. Selecting one hands the sandbox that thread and its id goes back on the
 * wire, so the provider's own memory follows the reader rather than running ahead of them.
 */
export function SessionList({ currentId, onSelect, onNewThread }: SessionListProps): ReactNode {
  // Read in an effect rather than while rendering: the store is the browser's, and a client
  // component also renders on the server, where there is none.
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  useEffect(() => {
    const read = (): void => setSessions(listSessions());
    read();
    return subscribeToTranscripts(read);
  }, [currentId]);

  return (
    <div className="sessions">
      <div className="sessions-head">
        <h6>Sessions</h6>
        <span className="sessions-count">{sessions.length}</span>
        <button className="btn btn-primary sessions-new" type="button" onClick={onNewThread}>
          <span aria-hidden="true">+</span> New thread
        </button>
      </div>
      <ul className="sessions-list">
        {sessions.map((session) => {
          const live = session.id === currentId;
          return (
            <li key={session.id}>
              <button
                className={live ? "session is-live" : "session"}
                type="button"
                aria-current={live ? "true" : undefined}
                onClick={() => onSelect(session.id)}
              >
                <span className="session-line">
                  {live && <span className="session-mark" aria-hidden="true" />}
                  <span className="session-title">{session.title.length > 0 ? session.title : "New thread"}</span>
                  <span className="session-when">{live ? "LIVE" : whenOf(session.savedAt)}</span>
                </span>
                <span className="session-meta">{metaOf(session)}</span>
              </button>
            </li>
          );
        })}
      </ul>
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
