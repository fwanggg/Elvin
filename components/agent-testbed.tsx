"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dropdown } from "@/components/dropdown";
import { ModelPicker } from "@/components/model-picker";
import { type Segment } from "@/components/assistant-ui/elements/streaming-text";
import { type AppTheme, type Design, type OpenMode, type Pattern, type Toggle, type ViewMode, type Viewport } from "@/components/sandbox/knobs";
import { type TurnStats, type UsageTotals } from "@/lib/turn-stats";
import { AssistantRuntimeMessage, UserRuntimeMessage } from "@/components/sandbox/messages";
import { RunPanel } from "@/components/sandbox/run-panel";
import { useRuns } from "@/components/sandbox/runs";
import { StepDebugBoundary } from "@/components/sandbox/step-link";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadPrimitive,
  AuiIf,
  useAuiState,
  useLocalRuntime,
  type AssistantRuntime,
  type ChatModelAdapter,
  type MessageTiming as StreamTiming,
  type ReasoningMessagePartComponent,
  type TextMessagePartComponent,
  type ThreadMessage,
} from "@assistant-ui/react";

type ConnectionState = "demo" | "connecting" | "live" | "error";

/**
 * The provider keeps the conversation but cannot list sessions, so the client
 * owns the id. Persisted so a reload continues the same thread.
 */
const THREAD_STORAGE_KEY = "elvin.threadId";


type ToolCall = {
  name: string;
  arguments?: unknown;
  result?: unknown;
  latencyMs?: number;
};

type ChatResponse = {
  content: string;
  reasoning?: string | null;
  toolCalls?: ToolCall[];
  latencyMs?: number;
  error?: string;
  usage?: UsageTotals | null;
};
type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue };
type JsonObject = { readonly [key: string]: JsonValue };

type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: JsonObject;
  argsText: string;
  result: unknown;
};

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown; status?: string }
  | { type: "stats"; stats: TurnStats }
  | { type: "error"; error: string }
  | { type: "done"; sessionId?: string };


type CheckResponse = {
  ok: boolean;
  model?: string;
  models?: string[];
  capabilities?: string[];
  error?: string;
};

type ThemeVariableName =
  | "--a-bg"
  | "--a-fg"
  | "--a-muted"
  | "--a-border"
  | "--a-surface"
  | "--a-chrome"
  | "--a-accent"
  | "--a-accent-fg";
type RenderedPart = { type: "reasoning"; text: string } | ToolCallPart | { type: "text"; text: string };

type ControlSidebarProps = Readonly<{
  appTheme: AppTheme;
  pattern: Pattern;
  viewport: Viewport;
  design: Design;
  viewMode: ViewMode;
  emoji: Toggle;
  openMode: OpenMode;
  onAppThemeChange: (value: AppTheme) => void;
  onPatternChange: (value: Pattern) => void;
  onViewportChange: (value: Viewport) => void;
  onDesignChange: (value: Design) => void;
  onViewModeChange: (value: ViewMode) => void;
  onEmojiChange: (value: Toggle) => void;
  onOpenModeChange: (value: OpenMode) => void;
}>;

type PreviewStageProps = Readonly<{
  statusColor: string;
  statusHost: string;
  statusState: string;
  isConnected: boolean;
  appTheme: AppTheme;
  viewport: Viewport;
  design: Design;
  emoji: Toggle;
  pattern: Pattern;
  runtime: AssistantRuntime;
  modelName: string;
  model: string;
  models: string[];
  onModelChange: (value: string) => void;
  viewMode: ViewMode;
  defaultOpen: boolean;
  threadKey: number;
  baseUrl: string;
  apiKey: string;
  connecting: boolean;
  error: string;
  onDisconnect: () => void;
  onStartThread: () => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onConnect: () => void;
}>;

type ConnectEmptyStateProps = Readonly<{
  baseUrl: string;
  apiKey: string;
  connecting: boolean;
  error: string;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onConnect: () => void;
}>;

type AssistantSandboxProps = Readonly<{
  pattern: Pattern;
  modelName: string;
  emoji: Toggle;
  viewMode: ViewMode;
  defaultOpen: boolean;
  threadKey: number;
}>;


type PanelSectionProps = Readonly<{
  title: string;
  children: ReactNode;
}>;

type ControlBlockProps = Readonly<{
  label: string;
  children: ReactNode;
}>;

type SegmentProps<T extends string> = Readonly<{
  name: string;
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
}>;

type SegmentedPanelProps<T extends string> = SegmentProps<T> & Readonly<{
  title: string;
  children?: ReactNode;
}>;

type SegmentedControlBlockProps<T extends string> = SegmentProps<T> & Readonly<{
  label: string;
  hint: string;
}>;

const PATTERN_SEGMENT_LABELS: Record<Pattern, string> = {
  thread: "Thread",
  sidebar: "Copilot",
  modal: "Floating",
};
const APP_THEME_LABELS: Record<AppTheme, string> = { dark: "Dark", light: "Light" };
const VIEWPORT_LABELS: Record<Viewport, string> = { desktop: "Desktop", mobile: "Mobile" };
/** The house register first: it is the language the app was drawn in. Keyed by
    the generated union, so a language added to the stylesheet fails the build
    until it is named here. */
const DESIGN_LABELS: Record<Design, string> = {
  swiss: "Swiss Grid",
  brutalist: "Neo-Brutalism",
  biophilic: "Biophilic",
  minimal: "Minimalist",
  organic: "Organic / Anti-grid",
  skeuomorphic: "Skeuomorphism",
  cyberpunk: "Cyberpunk/Terminal",
};
const DESIGN_LANGUAGES: ReadonlyArray<{ value: Design; label: string }> = (Object.keys(DESIGN_LABELS) as Design[]).map((value) => ({ value, label: DESIGN_LABELS[value] }));
/** Who the parts render for. Both always render; only the writing changes. */
const VIEW_MODE_LABELS: Record<ViewMode, string> = { dev: "Dev Mode", user: "User Mode" };
const OPEN_MODE_LABELS: Record<OpenMode, string> = { collapsed: "Collapsed", expanded: "Expanded" };
const TOGGLE_LABELS: Record<Toggle, string> = { on: "On", off: "Off" };
const STATUS_COLORS: Record<ConnectionState, string> = {
  demo: "var(--color-accent)",
  connecting: "var(--color-text)",
  live: "var(--color-ok)",
  error: "var(--color-accent-700)",
};

export function AgentTestbed(): ReactNode {
  const [pattern, setPattern] = useState<Pattern>("thread");
  const [appTheme, setAppTheme] = useState<AppTheme>("dark");
  const [design, setDesign] = useState<Design>("swiss");
  const [viewMode, setViewMode] = useState<ViewMode>("dev");
  const [emoji, setEmoji] = useState<Toggle>("off");
  const [openMode, setOpenMode] = useState<OpenMode>("collapsed");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [capability, setCapability] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("demo");
  const [connectionError, setConnectionError] = useState("");
  const [threadGeneration, setThreadGeneration] = useState(0);
  const sessionRef = useRef("");

  useEffect(() => {
    if (sessionRef.current.length === 0) sessionRef.current = storedThreadId();
  }, []);

  const modelAdapter = useMemo<ChatModelAdapter>(() => ({
    async *run({ messages, abortSignal, unstable_threadId }) {
      const sessionId = sessionRef.current || unstable_threadId;
      const streamStartTime = Date.now();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          model,
          apiKey,
          stream: true,
          capability: capability || undefined,
          threadId: sessionId || undefined,
          messages: messages.map((message) => ({ role: message.role, content: readableMessageContent(message) })),
        }),
        signal: abortSignal,
      });

      if (!(response.headers.get("Content-Type") ?? "").includes("text/event-stream")) {
        const data = (await response.json()) as ChatResponse;
        const text = data.error ?? data.content;
        const usage = data.usage ?? null;
        // One shot: a response that arrived whole has no windows to place on a
        // timeline, so the rows carry no fills and the badge carries the turn.
        const stats: TurnStats = {
          spans: [],
          totalMs: 0,
          usage,
          estimated: usage === null,
        };
        yield {
          content: assembleContent({ text, reasoning: data.reasoning ?? "", toolCalls: fromResponse(data.toolCalls) }),
          metadata: { timing: streamTiming({ streamStartTime, firstTokenTime: Date.now() - streamStartTime, totalChunks: 1, toolCallCount: data.toolCalls?.length ?? 0, text, usage }), custom: { stats } },
        };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("The agent returned no response body.");
      const decoder = new TextDecoder();
      const toolCalls = new Map<string, ToolCallPart>();
      let buffer = "";
      let text = "";
      let reasoning = "";
      let firstTokenTime: number | undefined;
      let totalChunks = 0;
      let stats: TurnStats | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const chunk = line.slice(5).trim();
          if (chunk.length === 0) continue;

          const event = JSON.parse(chunk) as StreamEvent;
          if (event.type !== "done") {
            totalChunks += 1;
            if (firstTokenTime === undefined) firstTokenTime = Date.now() - streamStartTime;
          }
          if (event.type === "text") text = event.text;
          else if (event.type === "reasoning") reasoning = event.text;
          else if (event.type === "error") text = event.error;
          else if (event.type === "stats") stats = event.stats;
          else if (event.type === "tool-call") {
            const args = toJsonObject(event.args);
            toolCalls.set(event.toolCallId, {
              type: "tool-call",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args,
              argsText: JSON.stringify(args),
              result: event.status && !isRunningStatus(event.status) ? { status: event.status } : undefined,
            });
          }

          yield { content: assembleContent({ text, reasoning, toolCalls }), ...(stats ? { metadata: { custom: { stats } } } : {}) };
        }
      }

      const timing = streamTiming({ streamStartTime, firstTokenTime, totalChunks, toolCallCount: toolCalls.size, text: text.length > 0 ? text : reasoning, usage: stats?.usage ?? null });

      if (text.length === 0 && reasoning.length === 0 && toolCalls.size === 0) {
        yield { content: [{ type: "text" as const, text: "The agent streamed nothing Elvin could render. Check the provider's response shape." }], metadata: { timing, ...(stats ? { custom: { stats } } : {}) } };
        return;
      }

      yield { content: assembleContent({ text, reasoning, toolCalls }), metadata: { timing, ...(stats ? { custom: { stats } } : {}) } };
    },
  }), [apiKey, baseUrl, capability, model]);
  const runtime = useLocalRuntime(modelAdapter);

  /**
   * A new thread on the connection that is already open: a fresh session id for
   * the provider and an empty transcript. Reloading here would drop the agent,
   * the key and the model list with it.
   */
  function startThread(): void {
    const id = `elvin-${crypto.randomUUID().slice(0, 8)}`;
    window.localStorage.setItem(THREAD_STORAGE_KEY, id);
    sessionRef.current = id;
    setThreadGeneration((generation) => generation + 1);
    void runtime.threads.switchToNewThread();
  }
  const { host: statusHost, state: statusState } = getStatusLabel(connection, baseUrl, connectionError);
  const statusColor = STATUS_COLORS[connection];
  const isConnected = connection === "live";
  /** Drops what the provider told us, so a reconnect starts from nothing. */
  function forgetProvider(): void {
    setModels([]);
    setCapabilities([]);
    setCapability("");
  }

  function disconnect(): void {
    setConnection("demo");
    setConnectionError("");
    forgetProvider();
  }

  async function checkConnection(): Promise<void> {
    const trimmedUrl = baseUrl.trim();
    if (trimmedUrl.length === 0) {
      setConnection("demo");
      setConnectionError("Paste an OpenAI-compatible URL to render the sandbox.");
      forgetProvider();
      return;
    }

    setConnection("connecting");
    setConnectionError("");
    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: trimmedUrl, apiKey, model }),
      });
      const data = (await response.json()) as CheckResponse;
      if (!response.ok || !data.ok) {
        setConnection("error");
        setConnectionError(data.error ?? "Connection failed");
        forgetProvider();
        return;
      }
      const nextModels = data.models ?? [];
      const nextCapabilities = data.capabilities ?? [];
      setConnection("live");
      setModels(nextModels);
      setCapabilities(nextCapabilities);
      // Anything chosen for the previous agent may not exist on this one.
      setCapability((current) => (nextCapabilities.includes(current) ? current : nextCapabilities[0] ?? ""));
      // The check echoes back the model it was sent, so a model only survives if
      // this provider actually lists it.
      setModel((current) => {
        if (current.trim().length > 0 && nextModels.includes(current)) return current;
        if (data.model && nextModels.includes(data.model)) return data.model;
        return nextModels[0] ?? data.model ?? "";
      });
    } catch (error) {
      setConnection("error");
      setConnectionError(error instanceof Error ? error.message : "Connection failed");
      forgetProvider();
    }
  }

  return (
    <main className="shell">
      <section className="frame" aria-label="Elvin agent testbed">
        <nav className="nav">
          <span className="nav-brand">Elvin</span>
        </nav>

        <div className="main-grid">
          <ControlSidebar
            appTheme={appTheme}
            pattern={pattern}
            viewport={viewport}
            design={design}
            viewMode={viewMode}
            emoji={emoji}
            openMode={openMode}
            onAppThemeChange={setAppTheme}
            onPatternChange={setPattern}
            onViewportChange={setViewport}
            onDesignChange={setDesign}
            onViewModeChange={setViewMode}
            onEmojiChange={setEmoji}
            onOpenModeChange={setOpenMode}
          />
          <PreviewStage
            statusColor={statusColor}
            statusHost={statusHost}
            statusState={statusState}
            isConnected={isConnected}
            appTheme={appTheme}
            viewport={viewport}
            design={design}
            pattern={pattern}
            runtime={runtime}
            modelName={model.trim() || "connected-agent"}
            model={model}
            models={models}
            viewMode={viewMode}
            emoji={emoji}
            defaultOpen={openMode === "expanded"}
            threadKey={threadGeneration}
            baseUrl={baseUrl}
            apiKey={apiKey}
            connecting={connection === "connecting"}
            error={connection === "error" ? connectionError : ""}
            onDisconnect={disconnect}
            onStartThread={startThread}
            onModelChange={setModel}
            onBaseUrlChange={setBaseUrl}
            onApiKeyChange={setApiKey}
            onConnect={() => void checkConnection()}
          />
        </div>

      </section>
    </main>
  );
}

function ControlSidebar({
  appTheme,
  pattern,
  viewport,
  design,
  viewMode,
  emoji,
  openMode,
  onAppThemeChange,
  onPatternChange,
  onViewportChange,
  onDesignChange,
  onViewModeChange,
  onEmojiChange,
  onOpenModeChange,
}: ControlSidebarProps): ReactNode {
  return (
    <aside className="sidebar">
      <PanelSection title="Design language">
        <Dropdown label="Design language" value={design} options={DESIGN_LANGUAGES} onChange={(value) => onDesignChange(value as Design)} />
        <p className="hint">Swaps the visual system — palette, type, geometry and elevation — inside the sandboxed app.</p>
        <SegmentedControlBlock
          label="App theme"
          name="app-theme"
          value={appTheme}
          options={["dark", "light"]}
          labels={APP_THEME_LABELS}
          onChange={onAppThemeChange}
          hint="Switches the previewed app between dark and light."
        />
      </PanelSection>
      <div className="section-rule" />
      <SegmentedPanel
        title="UI pattern"
        name="pattern"
        value={pattern}
        options={["thread", "sidebar", "modal"]}
        labels={PATTERN_SEGMENT_LABELS}
        onChange={onPatternChange}
      >
        <p className="hint">Switches the assistant-ui sandbox shell without changing your agent runtime.</p>
      </SegmentedPanel>
      <div className="section-rule" />
      <SegmentedPanel
        title="Viewport"
        name="viewport"
        value={viewport}
        options={["desktop", "mobile"]}
        labels={VIEWPORT_LABELS}
        onChange={onViewportChange}
      >
        <p className="hint">Frames the sandbox as a phone. The agent and its runtime are untouched.</p>
      </SegmentedPanel>
      <div className="section-rule" />
      <PanelSection title="Message parts">
        <SegmentedControlBlock
          label="View mode"
          name="view"
          value={viewMode}
          options={["dev", "user"]}
          labels={VIEW_MODE_LABELS}
          onChange={onViewModeChange}
          hint={getViewModeHint(viewMode)}
        />
        <SegmentedControlBlock
          label="Default state"
          name="open"
          value={openMode}
          options={["collapsed", "expanded"]}
          labels={OPEN_MODE_LABELS}
          onChange={onOpenModeChange}
          hint={getOpenModeHint(openMode)}
        />
        <SegmentedControlBlock
          label="Emoji"
          name="emoji"
          value={emoji}
          options={["on", "off"]}
          labels={TOGGLE_LABELS}
          onChange={onEmojiChange}
          hint={getEmojiHint(emoji)}
        />
      </PanelSection>
    </aside>
  );
}

function PreviewStage({
  statusColor,
  statusHost,
  statusState,
  isConnected,
  appTheme,
  viewport,
  design,
  emoji,
  pattern,
  runtime,
  modelName,
  model,
  models,
  viewMode,
  defaultOpen,
  threadKey,
  baseUrl,
  apiKey,
  connecting,
  error,
  onDisconnect,
  onStartThread,
  onModelChange,
  onBaseUrlChange,
  onApiKeyChange,
  onConnect,
}: PreviewStageProps): ReactNode {
  // The click has to read even when the thread was already empty and nothing
  // else on screen moves, so the cell washes and the plus turns before the
  // thread underneath it is replaced.
  const [threadPulse, setThreadPulse] = useState(0);

  function startNewThread(): void {
    setThreadPulse((pulse) => pulse + 1);
    onStartThread();
  }

  return (
    <section className="stage">
      <div className="metric-bar">
        <div className="metric-cell metric-agent">
          <div className="metric-cell-head">
            <span>Agent</span>
            {isConnected && (
              <button className="metric-disconnect" type="button" onClick={onDisconnect}>Disconnect</button>
            )}
          </div>
          <span className="metric-value">
            <span className="metric-swatch" style={{ background: statusColor }} />
            {statusHost.length > 0
              ? <span className="metric-host">{statusHost}</span>
              : <span className="metric-state">{statusState}</span>}
          </span>
        </div>
        <div className="metric-cell metric-model">
          <span className="metric-cell-head">Model</span>
          <ModelPicker
            value={model}
            options={models}
            placeholder="Connect to load models"
            emptyLabel="No model matches."
            onValueChange={onModelChange}
          />
        </div>
        <button className="metric-cell metric-action thread-new" type="button" onClick={startNewThread}>
          {threadPulse > 0 && <span className="thread-wash" key={`wash-${threadPulse}`} aria-hidden="true" />}
          <span className={threadPulse > 0 ? "metric-cell-head metric-icon thread-plus" : "metric-cell-head metric-icon"} key={`plus-${threadPulse}`} aria-hidden="true">+</span>
          <span className="metric-value">New Thread</span>
        </button>
      </div>
      <div className="canvas" data-viewport={viewport}>
        <div className="app-shell" data-theme={appTheme} data-design={design}>
          {isConnected ? (
            <>
              {pattern !== "thread" && <MockApplication />}
              {pattern === "modal" && <div className="modal-launcher">⌄</div>}
              <AssistantRuntimeProvider runtime={runtime}>
                <AssistantSandbox pattern={pattern} modelName={modelName} viewMode={viewMode} emoji={emoji} defaultOpen={defaultOpen} threadKey={threadKey} />
              </AssistantRuntimeProvider>
            </>
          ) : (
            <ConnectEmptyState
              baseUrl={baseUrl}
              apiKey={apiKey}
              connecting={connecting}
              error={error}
              onBaseUrlChange={onBaseUrlChange}
              onApiKeyChange={onApiKeyChange}
              onConnect={onConnect}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ConnectEmptyState({ baseUrl, apiKey, connecting, error, onBaseUrlChange, onApiKeyChange, onConnect }: ConnectEmptyStateProps): ReactNode {
  const urlField = useRef<HTMLInputElement>(null);

  // The state exists to be filled in and starts with the field that matters, so
  // that field takes focus the moment the state appears — pasting a URL connects
  // on its own, which makes the whole flow paste-and-watch. It is done from an
  // effect rather than with `autoFocus`, which React skips for an element that
  // arrives in the server-rendered HTML: that is the first load, the one case
  // where nobody has clicked anything yet. The ring is requested explicitly:
  // focus nobody can see does not tell anyone where to type.
  useEffect(() => { urlField.current?.focus({ focusVisible: true }); }, []);

  return (
    <div className="connect-empty">
      <span className="connect-kicker">No agent connected</span>
      <h2>Connect Your Agent to Render</h2>
      <div className="connect-form">
        <label className="connect-field">
          <span className="connect-step">1</span>
          <span className="connect-field-label">OpenAI compatible URL</span>
          <input
            className="connect-input"
            ref={urlField}
            value={baseUrl}
            onChange={(event) => onBaseUrlChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") onConnect(); }}
            onPaste={() => window.setTimeout(onConnect, 0)}
            placeholder="https://your-agent.example.com/v1"
          />
        </label>
        <label className="connect-field">
          <span className="connect-step">2</span>
          <span className="connect-field-label">Key</span>
          <input
            className="connect-input"
            type="password"
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") onConnect(); }}
            placeholder="optional"
          />
        </label>
        <div className="connect-run">
          <button className="btn btn-primary" type="button" disabled={connecting} onClick={onConnect}>{connecting ? "Checking…" : "Run ↵"}</button>
        </div>
      </div>
      {error && <p className="connect-error">{error}</p>}
    </div>
  );
}

function AssistantSandbox({ pattern, modelName, viewMode, emoji, defaultOpen, threadKey }: AssistantSandboxProps): ReactNode {
  // The panel reads the thread itself; the sandbox only holds which turn is being
  // looked at, and scrolls the chat to it when the panel asks for one.
  const runs = useRuns();
  const [chosenRun, setChosenRun] = useState<number | null>(null);
  const activeRun = chosenRun ?? runs.at(-1)?.index ?? null;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const showStepDebug = viewMode === "dev" && pattern === "thread";

  function selectRun(index: number): void {
    setChosenRun(index);
    document.querySelector(`[data-run="${index}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // Reading the chat moves the panel with it. The turn to show is the latest run
  // marker that has entered the chat viewport: as you scroll down and the next
  // prompt appears, the stats rail follows that newer turn; when every marker is
  // still below the viewport, the first run is the one in hand.
  //
  // A pointer resting on the panel suspends this, because the scrolls in flight
  // then are the panel's own — the click that jumped to a turn, the hover that
  // brought a card into sight — and each of those already set the selection.
  // Reading them back would have the selection chase the pointer instead.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let frame = 0;
    const read = () => {
      if (document.querySelector(".run-panel")?.matches(":hover")) return;
      const bottom = viewport.getBoundingClientRect().bottom;
      const markers = viewport.querySelectorAll<HTMLElement>("[data-run]");
      const first = markers[0];
      if (first === undefined) return;
      let current = Number(first.dataset.run);
      for (const marker of markers) {
        if (marker.getBoundingClientRect().top > bottom) break;
        current = Number(marker.dataset.run);
      }
      setChosenRun((run) => (run === current ? run : current));
    };
    const queueRead = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    queueRead();
    viewport.addEventListener("scroll", queueRead, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", queueRead);
    };
  }, [runs.length]);

  const frame = (
    <div className={`assistant-frame ${pattern}`}>
      {pattern !== "thread" && <div className="assistant-header"><span>Acme Support</span><span>×</span></div>}
      <ThreadPrimitive.Root className="messages">
        <ThreadPrimitive.Viewport className="message-col" ref={viewportRef}>
          {/* The line belongs to the thread, so a fresh thread draws it again:
              the key is the thread's own generation, which New Thread bumps —
              mounting alone would not replay it on an already-empty thread. */}
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <div className="thread-empty" key={threadKey}>
              <h3>Ask your agent anything</h3>
            </div>
          </AuiIf>
          <ThreadPrimitive.Messages>
            {({ message }) => message.role === "user"
              ? <UserRuntimeMessage emoji={emoji} activeRun={activeRun} />
              : <AssistantRuntimeMessage viewMode={viewMode} emoji={emoji} defaultOpen={defaultOpen} />}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
        {/* Its own row, outside the scroller: the thread scrolls above the
            composer rather than passing behind it. */}
        <ThreadPrimitive.ViewportFooter className="composer-wrap">
          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input placeholder="Send a message…" rows={1} />
            <div className="composer-footer">
              <span>＋</span>
              <span>{modelName}</span>
              <AuiIf condition={(state) => !state.thread.isRunning}>
                <ComposerPrimitive.Send className="send-dot">↑</ComposerPrimitive.Send>
              </AuiIf>
              <AuiIf condition={(state) => state.thread.isRunning}>
                <ComposerPrimitive.Cancel className="send-dot running">■</ComposerPrimitive.Cancel>
              </AuiIf>
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Root>
      {/* The step debugger is one Dev Mode feature: the stats rail, the run span,
          and the panel-to-chat hover/choice link. User Mode is the product
          surface, so it gets none of that right-column debugger behavior. The
          narrow shells have no room for the rail either. */}
      {showStepDebug && <RunPanel runs={runs} active={activeRun} onSelect={selectRun} />}
    </div>
  );

  return <StepDebugBoundary activeRun={activeRun} enabled={showStepDebug}>{frame}</StepDebugBoundary>;
}

/**
 * The local runtime takes stream telemetry from the adapter
 * (`ChatModelRunResult.metadata.timing`), so the adapter records it: the same
 * arithmetic assistant-stream's TimingTracker applies to a streamed message.
 */
function streamTiming({ streamStartTime, firstTokenTime, totalChunks, toolCallCount, text, usage }: Readonly<{
  streamStartTime: number;
  firstTokenTime: number | undefined;
  totalChunks: number;
  toolCallCount: number;
  text: string;
  usage?: UsageTotals | null;
}>): StreamTiming {
  const totalStreamTime = Date.now() - streamStartTime;
  // The provider's own count when it reported one, otherwise a characters-over-
  // four estimate — which the popover marks as an estimate rather than passing
  // off as a measurement.
  const tokenCount = usage?.completionTokens ?? (text.length > 0 ? Math.ceil(text.length / 4) : undefined);

  return {
    streamStartTime,
    ...(firstTokenTime !== undefined ? { firstTokenTime } : {}),
    totalStreamTime,
    ...(tokenCount !== undefined ? { tokenCount } : {}),
    ...(tokenCount !== undefined && totalStreamTime > 0 ? { tokensPerSecond: (tokenCount / totalStreamTime) * 1000 } : {}),
    totalChunks,
    toolCallCount,
  };
}
function PanelSection({ title, children }: PanelSectionProps): ReactNode {
  return <div className="panel-section"><h6>{title}</h6>{children}</div>;
}

function ControlBlock({ label, children }: ControlBlockProps): ReactNode {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="top-label" style={{ paddingLeft: 0 }}>{label}</span>{children}</div>;
}

function Segment<T extends string>({ name, value, options, labels, onChange }: SegmentProps<T>): ReactNode {
  return (
    <div className="seg">
      {options.map((option) => (
        <label className="seg-opt" key={option}>
          <input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} />
          {labels[option]}
        </label>
      ))}
    </div>
  );
}

function SegmentedPanel<T extends string>({ title, children, name, value, options, labels, onChange }: SegmentedPanelProps<T>): ReactNode {
  return (
    <PanelSection title={title}>
      <Segment name={name} value={value} options={options} labels={labels} onChange={onChange} />
      {children}
    </PanelSection>
  );
}

function SegmentedControlBlock<T extends string>({ label, hint, name, value, options, labels, onChange }: SegmentedControlBlockProps<T>): ReactNode {
  return (
    <ControlBlock label={label}>
      <Segment name={name} value={value} options={options} labels={labels} onChange={onChange} />
      <p className="hint">{hint}</p>
    </ControlBlock>
  );
}

function MockApplication(): ReactNode {
  return (
    <div className="mock-app" style={{ background: "var(--a-chrome)" }}>
      <div className="mock-top"><span className="skeleton" style={{ width: 72, height: 12, background: "var(--a-muted)" }} /><span className="skeleton" style={{ width: 48, height: 8 }} /><span className="skeleton" style={{ width: 48, height: 8 }} /></div>
      <div className="mock-side"><span className="skeleton" style={{ height: 8 }} /><span className="skeleton" style={{ width: "70%", height: 8 }} /><span className="skeleton" style={{ width: "80%", height: 8 }} /></div>
      <div className="mock-content"><span style={{ height: 120, borderRadius: 12, background: "var(--a-surface)" }} /><span style={{ height: 120, borderRadius: 12, background: "var(--a-surface)" }} /><span style={{ gridColumn: "1 / -1", height: 160, borderRadius: 12, background: "var(--a-surface)" }} /></div>
    </div>
  );
}

function storedThreadId(): string {
  const existing = window.localStorage.getItem(THREAD_STORAGE_KEY);
  if (existing) return existing;
  const id = `elvin-${crypto.randomUUID().slice(0, 8)}`;
  window.localStorage.setItem(THREAD_STORAGE_KEY, id);
  return id;
}

/** The host is the primary fact; the state word qualifies it. */
function getStatusLabel(connection: ConnectionState, baseUrl: string, connectionError: string): { host: string; state: string } {
  const host = baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  switch (connection) {
    case "demo":
      return { host: "", state: "Not connected" };
    case "connecting":
      return { host: "", state: "Checking…" };
    case "live":
      return { host, state: "Connected" };
    case "error":
      return { host: "", state: connectionError || "Connection failed" };
  }
}

/**
 * Both parts always render, so the choice is who they render for: Dev Mode shows
 * them as the agent sent them, User Mode writes them for a person.
 */
function getViewModeHint(viewMode: ViewMode): string {
  return viewMode === "dev"
    ? "Tools and reasoning read as the agent sent them — a card per call, the trace in its group, and the turn's own timings in the runs panel beside the chat."
    : "The same parts written for a person: each call reads as a step in plain language, its argument as a chip, and the raw request and result behind a disclosure.";
}

function getEmojiHint(emoji: Toggle): string {
  switch (emoji) {
    case "on":
      return "Each turn carries a role emoji beside the message.";
    case "off":
      return "Messages render without an emoji marker.";
  }
}

function getOpenModeHint(openMode: OpenMode): string {
  switch (openMode) {
    case "expanded":
      return "Collapsible parts start open.";
    case "collapsed":
      return "Collapsible parts start closed.";
  }
}

function readableMessageContent(message: ThreadMessage): string {
  return message.content.map((part) => {
    if (part.type === "text" || part.type === "reasoning") return part.text;
    if (part.type === "tool-call") return `[tool:${part.toolName}] ${JSON.stringify(part.result ?? part.args)}`;
    return "";
  }).filter(Boolean).join("\n");
}

function toJsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  }
  return { value: value === undefined ? null : String(value) };
}

function isRunningStatus(status: string): boolean {
  const value = status.toLowerCase();
  return value === "running" || value === "pending" || value === "in_progress" || value === "started";
}

function fromResponse(toolCalls: ToolCall[] | undefined): Map<string, ToolCallPart> {
  const map = new Map<string, ToolCallPart>();
  for (const [index, tool] of (toolCalls ?? []).entries()) {
    const args = toJsonObject(tool.arguments);
    map.set(`tool-${index}`, {
      type: "tool-call",
      toolCallId: `tool-${index}`,
      toolName: tool.name,
      args,
      argsText: JSON.stringify(args),
      result: tool.result,
    });
  }
  return map;
}

function assembleContent({ text, reasoning, toolCalls }: Readonly<{ text: string; reasoning: string; toolCalls: Map<string, ToolCallPart> }>): RenderedPart[] {
  return [
    ...(reasoning.length > 0 ? [{ type: "reasoning" as const, text: reasoning }] : []),
    ...toolCalls.values(),
    ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
  ];
}