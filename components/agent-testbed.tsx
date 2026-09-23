"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, EllipsisIcon, RefreshCwIcon, ThumbsDownIcon, ThumbsUpIcon, Volume2Icon } from "lucide-react";
import { Dropdown } from "@/components/dropdown";
import { describeStep, type StepPhase } from "@/lib/step-labels";
import { ModelPicker } from "@/components/model-picker";
import { MessageTiming } from "@/components/assistant-ui/elements/message-timing.aui";
import { StreamingText, type Segment } from "@/components/assistant-ui/elements/streaming-text";
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import type { Design } from "@/lib/design-tokens";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiConfig,
  AuiProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  SuggestionPrimitive,
  Suggestions,
  ThreadPrimitive,
  AuiIf,
  useAui,
  useAuiState,
  useLocalRuntime,
  type AssistantRuntime,
  type ChatModelAdapter,
  type MessageTiming as StreamTiming,
  type TextMessagePartComponent,
  type ThreadMessage,
} from "@assistant-ui/react";

type Pattern = "thread" | "sidebar" | "modal";
type AppTheme = "dark" | "light";
type PartMode = "shown" | "hidden" | "off";
type StepsMode = "raw" | "humanized";
type OpenMode = "collapsed" | "expanded";
type StreamMode = "true" | "false";
type Toggle = "on" | "off";
type ConnectionState = "demo" | "connecting" | "live" | "error";

/**
 * The provider keeps the conversation but cannot list sessions, so the client
 * owns the id. Persisted so a reload continues the same thread.
 */
const THREAD_STORAGE_KEY = "elvin.threadId";
/** File the export pane opens on: the one that records every knob. */
const DEFAULT_SOURCE_FILE = "elvin.config.ts";


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
type SourceFile = Readonly<{ name: string; content: string }>;
type FileTreeRow = { label: string; depth: number; dir: boolean; path: string };

type ControlSidebarProps = Readonly<{
  pattern: Pattern;
  streamMode: StreamMode;
  appTheme: AppTheme;
  design: Design;
  toolsMode: PartMode;
  reasoningMode: PartMode;
  stepsMode: StepsMode;
  openMode: OpenMode;
  softStream: Toggle;
  responseStatus: Toggle;
  onPatternChange: (value: Pattern) => void;
  onStreamModeChange: (value: StreamMode) => void;
  onAppThemeChange: (value: AppTheme) => void;
  onDesignChange: (value: Design) => void;
  onToolsModeChange: (value: PartMode) => void;
  onReasoningModeChange: (value: PartMode) => void;
  onStepsModeChange: (value: StepsMode) => void;
  onOpenModeChange: (value: OpenMode) => void;
  onSoftStreamChange: (value: Toggle) => void;
  onResponseStatusChange: (value: Toggle) => void;
  onOpenExport: () => void;
}>;

type PreviewStageProps = Readonly<{
  statusColor: string;
  statusHost: string;
  statusState: string;
  isConnected: boolean;
  appTheme: AppTheme;
  design: Design;
  stepsMode: StepsMode;
  pattern: Pattern;
  runtime: AssistantRuntime;
  modelName: string;
  model: string;
  models: string[];
  onModelChange: (value: string) => void;
  toolsMode: PartMode;
  reasoningMode: PartMode;
  defaultOpen: boolean;
  softStream: Toggle;
  responseStatus: Toggle;
  baseUrl: string;
  apiKey: string;
  connecting: boolean;
  error: string;
  onDisconnect: () => void;
  onStartThread: () => void;
  onExport: () => void;
  exportOpen: boolean;
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
  stepsMode: StepsMode;
  toolsMode: PartMode;
  reasoningMode: PartMode;
  defaultOpen: boolean;
  softStream: Toggle;
  responseStatus: Toggle;
}>;

type AssistantRuntimeMessageProps = Readonly<{
  toolsMode: PartMode;
  reasoningMode: PartMode;
  stepsMode: StepsMode;
  defaultOpen: boolean;
  softStream: Toggle;
  responseStatus: Toggle;
}>;

type DisclosureProps = Readonly<{
  defaultOpen: boolean;
  children: ReactNode;
}>;

type ToolCardProps = Readonly<{
  name: string;
  args: unknown;
  result: unknown;
  defaultOpen: boolean;
}>;

type StepLineProps = Readonly<{
  name: string;
  args: unknown;
  result: unknown;
  isError?: boolean;
}>;

type ExportDialogProps = Readonly<{
  files: readonly SourceFile[];
  selectedFile: string;
  onSelectFile: (name: string) => void;
  sourceUrl: string;
  onClose: () => void;
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
const PART_MODE_LABELS: Record<PartMode, string> = { shown: "Shown", hidden: "Hidden", off: "Off" };
const STEPS_MODE_LABELS: Record<StepsMode, string> = { raw: "Raw", humanized: "Humanized" };
const OPEN_MODE_LABELS: Record<OpenMode, string> = { collapsed: "Collapsed", expanded: "Expanded" };
const STREAM_MODE_LABELS: Record<StreamMode, string> = { true: "True", false: "False" };
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
  const [toolsMode, setToolsMode] = useState<PartMode>("shown");
  const [reasoningMode, setReasoningMode] = useState<PartMode>("shown");
  const [stepsMode, setStepsMode] = useState<StepsMode>("raw");
  const [openMode, setOpenMode] = useState<OpenMode>("collapsed");
  const [softStream, setSoftStream] = useState<Toggle>("on");
  const [responseStatus, setResponseStatus] = useState<Toggle>("on");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [capability, setCapability] = useState("");
  const [streamMode, setStreamMode] = useState<StreamMode>("true");
  const [apiKey, setApiKey] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("demo");
  const [connectionError, setConnectionError] = useState("");
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportFiles, setExportFiles] = useState<readonly SourceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState(DEFAULT_SOURCE_FILE);
  const sessionRef = useRef("");

  useEffect(() => {
    if (sessionRef.current.length === 0) sessionRef.current = storedThreadId();
  }, []);

  function startThread(): void {
    window.localStorage.setItem(THREAD_STORAGE_KEY, `elvin-${crypto.randomUUID().slice(0, 8)}`);
    window.location.reload();
  }

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
          toolsMode,
          reasoningMode,
          stream: streamMode === "true",
          capability: capability || undefined,
          threadId: sessionId || undefined,
          messages: messages.map((message) => ({ role: message.role, content: readableMessageContent(message) })),
        }),
        signal: abortSignal,
      });

      if (!(response.headers.get("Content-Type") ?? "").includes("text/event-stream")) {
        const data = (await response.json()) as ChatResponse;
        const text = data.error ?? data.content;
        yield {
          content: assembleContent({ toolsMode, reasoningMode, text, reasoning: data.reasoning ?? "", toolCalls: fromResponse(data.toolCalls) }),
          metadata: { timing: streamTiming({ streamStartTime, firstTokenTime: Date.now() - streamStartTime, totalChunks: 1, toolCallCount: data.toolCalls?.length ?? 0, text }) },
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

          yield { content: assembleContent({ toolsMode, reasoningMode, text, reasoning, toolCalls }) };
        }
      }

      const timing = streamTiming({ streamStartTime, firstTokenTime, totalChunks, toolCallCount: toolCalls.size, text: text.length > 0 ? text : reasoning });

      if (text.length === 0 && reasoning.length === 0 && toolCalls.size === 0) {
        yield { content: [{ type: "text" as const, text: "The agent streamed nothing Elvin could render. Check the provider's response shape." }], metadata: { timing } };
        return;
      }

      yield { content: assembleContent({ toolsMode, reasoningMode, text, reasoning, toolCalls }), metadata: { timing } };
    },
  }), [apiKey, baseUrl, capability, model, reasoningMode, streamMode, toolsMode]);
  const runtime = useLocalRuntime(modelAdapter);
  const { host: statusHost, state: statusState } = getStatusLabel(connection, baseUrl, connectionError);
  const statusColor = STATUS_COLORS[connection];
  const isConnected = connection === "live";
  const sourceParams = useMemo(() => {
    return buildSourceParams({ pattern, appTheme, design, toolsMode, reasoningMode, openMode, streamMode, model, capability });
  }, [appTheme, capability, design, model, openMode, pattern, reasoningMode, streamMode, toolsMode]);
  const sourceUrl = `/api/source?${sourceParams}`;

  // The pane reads the bytes the download carries rather than re-rendering them,
  // so the preview and the zip cannot disagree.
  useEffect(() => {
    if (!showExportPanel) return;
    let cancelled = false;
    fetch(`/api/source?${sourceParams}&contents=1`)
      .then((response) => response.json() as Promise<{ files?: SourceFile[] }>)
      .then((data) => { if (!cancelled) setExportFiles(data.files ?? []); })
      .catch(() => { if (!cancelled) setExportFiles([]); });
    return () => { cancelled = true; };
  }, [showExportPanel, sourceParams]);

  function disconnect(): void {
    setConnection("demo");
    setConnectionError("");
  }

  async function checkConnection(): Promise<void> {
    const trimmedUrl = baseUrl.trim();
    if (trimmedUrl.length === 0) {
      setConnection("demo");
      setConnectionError("Paste an OpenAI-compatible URL to render the sandbox.");
      setModels([]);
      setCapabilities([]);
      setCapability("");
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
        return;
      }
      setConnection("live");
      setModels(data.models ?? []);
      setCapabilities(data.capabilities ?? []);
      if (!model.trim() && data.model) setModel(data.model);
      if ((data.capabilities ?? []).length > 0) setCapability((current) => current || data.capabilities?.[0] || "");
    } catch (error) {
      setConnection("error");
      setConnectionError(error instanceof Error ? error.message : "Connection failed");
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
            pattern={pattern}
            streamMode={streamMode}
            appTheme={appTheme}
            design={design}
            toolsMode={toolsMode}
            reasoningMode={reasoningMode}
            stepsMode={stepsMode}
            openMode={openMode}
            softStream={softStream}
            responseStatus={responseStatus}
            onPatternChange={setPattern}
            onStreamModeChange={setStreamMode}
            onAppThemeChange={setAppTheme}
            onDesignChange={setDesign}
            onToolsModeChange={setToolsMode}
            onReasoningModeChange={setReasoningMode}
            onStepsModeChange={setStepsMode}
            onOpenModeChange={setOpenMode}
            onSoftStreamChange={setSoftStream}
            onResponseStatusChange={setResponseStatus}
            onOpenExport={() => setShowExportPanel(true)}
          />
          <PreviewStage
            statusColor={statusColor}
            statusHost={statusHost}
            statusState={statusState}
            isConnected={isConnected}
            appTheme={appTheme}
            design={design}
            pattern={pattern}
            runtime={runtime}
            modelName={model.trim() || "connected-agent"}
            model={model}
            models={models}
            toolsMode={toolsMode}
            reasoningMode={reasoningMode}
            stepsMode={stepsMode}
            defaultOpen={openMode === "expanded"}
            softStream={softStream}
            responseStatus={responseStatus}
            baseUrl={baseUrl}
            apiKey={apiKey}
            connecting={connection === "connecting"}
            error={connection === "error" ? connectionError : ""}
            onDisconnect={disconnect}
            onStartThread={startThread}
            onModelChange={setModel}
            onExport={() => setShowExportPanel(true)}
            exportOpen={showExportPanel}
            onBaseUrlChange={setBaseUrl}
            onApiKeyChange={setApiKey}
            onConnect={() => void checkConnection()}
          />
        </div>

        {showExportPanel && <ExportDialog files={exportFiles} selectedFile={selectedFile} onSelectFile={setSelectedFile} sourceUrl={sourceUrl} onClose={() => setShowExportPanel(false)} />}
      </section>
    </main>
  );
}

function ControlSidebar({
  pattern,
  streamMode,
  appTheme,
  design,
  toolsMode,
  reasoningMode,
  stepsMode,
  openMode,
  softStream,
  responseStatus,
  onPatternChange,
  onStreamModeChange,
  onAppThemeChange,
  onDesignChange,
  onToolsModeChange,
  onReasoningModeChange,
  onStepsModeChange,
  onOpenModeChange,
  onSoftStreamChange,
  onResponseStatusChange,
  onOpenExport,
}: ControlSidebarProps): ReactNode {
  return (
    <aside className="sidebar">
      <PanelSection title="Design language">
        <Dropdown label="Design language" value={design} options={DESIGN_LANGUAGES} onChange={(value) => onDesignChange(value as Design)} />
        <p className="hint">Swaps the visual system — palette, type, geometry and elevation — inside the sandboxed app.</p>
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
        title="Stream"
        name="stream"
        value={streamMode}
        options={["true", "false"]}
        labels={STREAM_MODE_LABELS}
        onChange={onStreamModeChange}
      />
      <div className="section-rule" />
      <SegmentedPanel
        title="App theme"
        name="app-theme"
        value={appTheme}
        options={["dark", "light"]}
        labels={APP_THEME_LABELS}
        onChange={onAppThemeChange}
      />
      <div className="section-rule" />
      <PanelSection title="Message parts">
        <SegmentedControlBlock
          label="Tool calls"
          name="tools"
          value={toolsMode}
          options={["shown", "hidden", "off"]}
          labels={PART_MODE_LABELS}
          onChange={onToolsModeChange}
          hint={getToolsModeHint(toolsMode)}
        />
        <SegmentedControlBlock
          label="Reasoning group"
          name="reasoning"
          value={reasoningMode}
          options={["shown", "hidden", "off"]}
          labels={PART_MODE_LABELS}
          onChange={onReasoningModeChange}
          hint={getReasoningModeHint(reasoningMode)}
        />
        <SegmentedControlBlock
          label="Middle steps"
          name="steps"
          value={stepsMode}
          options={["raw", "humanized"]}
          labels={STEPS_MODE_LABELS}
          onChange={onStepsModeChange}
          hint={getStepsModeHint(stepsMode)}
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
      </PanelSection>
      <div className="section-rule" />
      <PanelSection title="Response">
        <SegmentedControlBlock
          label="Soft stream"
          name="soft-stream"
          value={softStream}
          options={["on", "off"]}
          labels={TOGGLE_LABELS}
          onChange={onSoftStreamChange}
          hint={getSoftStreamHint(softStream)}
        />
        <SegmentedControlBlock
          label="Response status"
          name="response-status"
          value={responseStatus}
          options={["on", "off"]}
          labels={TOGGLE_LABELS}
          onChange={onResponseStatusChange}
          hint={getResponseStatusHint(responseStatus)}
        />
      </PanelSection>
      <div className="section-rule" />
      <ExportSuggestionLink onOpenExport={onOpenExport} />
    </aside>
  );
}

function PreviewStage({
  statusColor,
  statusHost,
  statusState,
  isConnected,
  appTheme,
  design,
  stepsMode,
  pattern,
  runtime,
  modelName,
  model,
  models,
  toolsMode,
  reasoningMode,
  defaultOpen,
  softStream,
  responseStatus,
  baseUrl,
  apiKey,
  connecting,
  error,
  onDisconnect,
  onStartThread,
  onModelChange,
  onExport,
  exportOpen,
  onBaseUrlChange,
  onApiKeyChange,
  onConnect,
}: PreviewStageProps): ReactNode {
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
        <button className="metric-cell metric-action" type="button" onClick={onStartThread}>
          <span className="metric-cell-head metric-icon" aria-hidden="true">+</span>
          <span className="metric-value">New Thread</span>
        </button>
        <button className="metric-cell metric-action solid" type="button" aria-haspopup="dialog" aria-controls="export" onClick={onExport}>
          <span className="metric-cell-head metric-icon" aria-hidden="true">{"<>"}</span>
          <span className="metric-value">Export Code</span>
        </button>
      </div>
      <div className="canvas">
        <div className="app-shell" data-theme={appTheme} data-design={design}>
          {isConnected ? (
            <>
              {pattern !== "thread" && <MockApplication />}
              {pattern === "modal" && <div className="modal-launcher">⌄</div>}
              <AssistantRuntimeProvider runtime={runtime}>
                <AssistantSandbox pattern={pattern} modelName={modelName} toolsMode={toolsMode} reasoningMode={reasoningMode} stepsMode={stepsMode} defaultOpen={defaultOpen} softStream={softStream} responseStatus={responseStatus} />
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

function ExportDialog({ files, selectedFile, onSelectFile, sourceUrl, onClose }: ExportDialogProps): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Open on the close button, and hand focus back to whatever opened the dialog.
  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => { if (opener instanceof HTMLElement) opener.focus(); };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="export-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="export-modal" id="export" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="export-modal-head">
          <h2 id="export-title">Get the source</h2>
          <button className="export-modal-close" type="button" aria-label="Close export dialog" onClick={onClose} ref={closeRef}>×</button>
        </div>
        <div className="export-modal-body">
          <div className="file-list">
            <h6>Files · {files.length}</h6>
            {fileTreeRows(files.map((file) => file.name)).map((row) => row.dir
              ? <div className="file-row dir" key={row.path} style={{ paddingLeft: 16 + row.depth * 14 }}>{row.label}/</div>
              : (
                <button
                  className="file-row"
                  key={row.path}
                  type="button"
                  aria-current={row.path === selectedFile}
                  style={{ paddingLeft: 16 + row.depth * 14 }}
                  onClick={() => onSelectFile(row.path)}
                >
                  <span className="file-row-label">{row.label}</span>
                  {row.path === selectedFile && <span className="selection-mark" aria-hidden="true" />}
                </button>
              ))}
          </div>
          <div className="code-preview">
            <div className="code-title">{selectedFile}</div>
            {/* The key resets the pane's scroll when another file is opened. */}
            <pre key={selectedFile}>{files.find((file) => file.name === selectedFile)?.content ?? ""}</pre>
          </div>
        </div>
        <div className="export-cta">
          <p className="hint">Download the exact Next.js + assistant-ui scaffold for the current knobs. Sign-up gating is intentionally stubbed out for this MVP.</p>
          <a className="btn btn-primary" href={sourceUrl}>Download .zip ↓</a>
        </div>
      </div>
    </div>
  );
}

function ConnectEmptyState({ baseUrl, apiKey, connecting, error, onBaseUrlChange, onApiKeyChange, onConnect }: ConnectEmptyStateProps): ReactNode {
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

function AssistantSandbox({ pattern, modelName, toolsMode, reasoningMode, stepsMode, defaultOpen, softStream, responseStatus }: AssistantSandboxProps): ReactNode {
  const aui = useAui();
  const config = AuiConfig({
    suggestions: Suggestions([
      {
        title: "Test the agent",
        label: "with a short prompt",
        prompt: "Reply with one sentence confirming this agent is connected.",
      },
      {
        title: "Try tool rendering",
        label: "with an order lookup",
        prompt: "Where is order #4821?",
      },
    ]),
  });

  return (
    <AuiProvider extends={aui} config={config}>
      <div className={`assistant-frame ${pattern}`}>
        {pattern !== "thread" && <div className="assistant-header"><span>Acme Support</span><span>×</span></div>}
        <ThreadPrimitive.Root className="messages">
          <ThreadPrimitive.Viewport className="message-col">
            <AuiIf condition={(state) => state.thread.isEmpty}>
              <div className="thread-empty">
                <span className="connect-kicker">Connected</span>
                <h3>Ask your agent anything</h3>
                <div className="suggestions">
                  <ThreadPrimitive.Suggestions>
                    {({ suggestion }) => (
                      <SuggestionPrimitive.Trigger className="suggestion-card" send>
                        <strong>{suggestion.title}</strong>
                        <span>{suggestion.label}</span>
                      </SuggestionPrimitive.Trigger>
                    )}
                  </ThreadPrimitive.Suggestions>
                </div>
              </div>
            </AuiIf>
            <ThreadPrimitive.Messages>
              {({ message }) => message.role === "user"
                ? <UserRuntimeMessage />
                : <AssistantRuntimeMessage toolsMode={toolsMode} reasoningMode={reasoningMode} stepsMode={stepsMode} defaultOpen={defaultOpen} softStream={softStream} responseStatus={responseStatus} />}
            </ThreadPrimitive.Messages>
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
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </div>
    </AuiProvider>
  );
}

function UserRuntimeMessage(): ReactNode {
  return (
    <MessagePrimitive.Root className="user-bubble">
      <MessagePrimitive.Parts>
        {({ part }) => part.type === "text" ? part.text : null}
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  );
}

function AssistantRuntimeMessage({ toolsMode, reasoningMode, stepsMode, defaultOpen, softStream, responseStatus }: AssistantRuntimeMessageProps): ReactNode {
  const humanized = stepsMode === "humanized";
  const stepsShown = humanized && toolsMode === "shown";
  // Humanized mode puts reasoning and tool calls in one group, so the middle of
  // the turn collapses into a single block of plain-language steps.
  const groupBy = useMemo(() => groupPartByType({
    ...(reasoningMode === "shown" ? { reasoning: humanized ? ["group-steps", "group-reasoning"] : ["group-reasoning"] } : {}),
    ...(stepsShown ? { "tool-call": ["group-steps", "group-tool"] } : {}),
  }), [humanized, reasoningMode, stepsShown]);

  return (
    <MessagePrimitive.Root asChild>
      <div>
        <AssistantThinking humanized={stepsShown} />
        <MessagePrimitive.Error>
          <p className="error-note"><ErrorPrimitive.Message /></p>
        </MessagePrimitive.Error>
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-steps":
                return <StepList key={`steps-${part.indices[0]}-${defaultOpen}`} defaultOpen={defaultOpen}>{children}</StepList>;
              case "group-reasoning":
                return humanized
                  ? <div className="steps-reasoning" key={`reasoning-${part.indices[0]}`}>{children}</div>
                  : <ReasoningGroup key={`${part.indices[0]}-${defaultOpen}`} defaultOpen={defaultOpen}>{children}</ReasoningGroup>;
              case "group-tool":
                return <div className="steps-list" key={`tools-${part.indices[0]}`}>{children}</div>;
              case "reasoning":
                return reasoningMode === "shown" ? <p className="reasoning-line">{part.text}</p> : <></>;
              case "tool-call":
                if (toolsMode !== "shown") return <></>;
                return humanized
                  ? <StepLine key={part.toolCallId} name={part.toolName} args={part.args} result={part.result} isError={part.isError} />
                  : <ToolCard key={`${part.toolCallId}-${defaultOpen}`} name={part.toolName} args={part.args} result={part.result} defaultOpen={defaultOpen} />;
              case "text":
                return softStream === "on"
                  ? <StreamingTextPart type="text" text={part.text} status={part.status} />
                  : <div className="assistant-text">{part.text}</div>;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        {responseStatus === "on" && <AssistantActionBar />}
      </div>
    </MessagePrimitive.Root>
  );
}

/**
 * The disciplined middle of a turn: one quiet line naming the work in flight,
 * opening onto the steps themselves when asked for.
 */
function StepList({ defaultOpen, children }: DisclosureProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const summary = useStepsSummary();

  return (
    <div className="steps">
      <button className="steps-head" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{summary}</span>
        <span aria-hidden="true" style={{ marginLeft: "auto" }}>{open ? "⌄" : "›"}</span>
      </button>
      {open && <div className="steps-body">{children}</div>}
    </div>
  );
}

/** Our adapter does not set `isError`, so an error-shaped result counts too. */
function resultFailed(result: unknown): boolean {
  return result !== null && typeof result === "object" && "error" in (result as Record<string, unknown>);
}

/** One tool call in plain language: no arguments, no payload. */
function StepLine({ name, args, result, isError }: StepLineProps): ReactNode {
  const running = useAuiState((state) => state.message.status?.type === "running");
  const failed = isError === true || resultFailed(result);
  const phase: StepPhase = failed ? "failed" : running && result === undefined ? "running" : "complete";

  return (
    <p className="step" data-phase={phase}>
      <span className="step-mark" aria-hidden="true" />
      <span>{describeStep(name, args, phase)}</span>
    </p>
  );
}

/** The work in flight, or a count of it once the turn settles. */
function useStepsSummary(): string {
  return useAuiState((state) => {
    const calls = state.message.parts.filter((part) => part.type === "tool-call");

    if (state.message.status?.type === "running") {
      const pending = calls.find((part) => part.result === undefined);
      return pending?.type === "tool-call" ? describeStep(pending.toolName, pending.args, "running") : "Thinking";
    }
    if (calls.length === 0) return "Thought";
    return calls.length === 1 ? "1 step" : `${calls.length} steps`;
  });
}

function AssistantThinking({ humanized }: Readonly<{ humanized: boolean }>): ReactNode {
  const label = useThinkingLabel(humanized);
  const elapsed = useElapsedLabel(label !== undefined);

  if (label === undefined) return null;
  return <ThinkingIndicator className="thinking-indicator" label={label} elapsed={elapsed} />;
}

/**
 * Names the work in flight from the message itself: a pending tool call by name,
 * plain "Thinking" until the first part lands, and nothing once content streams.
 * While the step list is showing it already says which call is running.
 */
function useThinkingLabel(suppressPendingCall: boolean): string | undefined {
  return useAuiState((state) => {
    if (state.message.status?.type !== "running") return undefined;
    const pending = state.message.parts.find((part) => part.type === "tool-call" && part.result === undefined);
    if (pending?.type === "tool-call") return suppressPendingCall ? undefined : `Running ${pending.toolName}`;
    return state.message.parts.length === 0 ? "Thinking" : undefined;
  });
}

function useElapsedLabel(active: boolean): string | undefined {
  const [label, setLabel] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      setLabel(undefined);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => setLabel(`${Math.round((Date.now() - start) / 1000)}s`), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return label;
}

/**
 * Soft streaming: the same text the plain renderer shows, handed to the
 * assistant-ui element so the newest words land tinted and settle into ink.
 */
const StreamingTextPart: TextMessagePartComponent = ({ text, status }) => {
  const segments = useMemo<Segment[]>(() => [{ text }], [text]);
  const count = useMemo(() => text.split(" ").length, [text]);

  return <StreamingText className="assistant-text streaming-text" segments={segments} count={count} streaming={status.type === "running"} />;
};

/**
 * The assistant-ui action bar: copy, rate, speak, regenerate, the more menu, and
 * the timing badge whose tooltip carries the stream's own telemetry.
 */
function AssistantActionBar(): ReactNode {
  return (
    <ActionBarPrimitive.Root className="action-bar" hideWhenRunning autohide="not-last">
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy" className="action-icon">
          <AuiIf condition={(state) => state.message.isCopied}><CheckIcon /></AuiIf>
          <AuiIf condition={(state) => !state.message.isCopied}><CopyIcon /></AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.FeedbackPositive asChild>
        <TooltipIconButton tooltip="Good response" className="action-icon"><ThumbsUpIcon /></TooltipIconButton>
      </ActionBarPrimitive.FeedbackPositive>
      <ActionBarPrimitive.FeedbackNegative asChild>
        <TooltipIconButton tooltip="Bad response" className="action-icon"><ThumbsDownIcon /></TooltipIconButton>
      </ActionBarPrimitive.FeedbackNegative>
      <ActionBarPrimitive.Speak asChild>
        <TooltipIconButton tooltip="Read aloud" className="action-icon"><Volume2Icon /></TooltipIconButton>
      </ActionBarPrimitive.Speak>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Regenerate" className="action-icon"><RefreshCwIcon /></TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton tooltip="More actions" className="action-icon"><EllipsisIcon /></TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content className="action-menu" side="bottom" align="start">
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="action-menu-item"><DownloadIcon />Export as Markdown</ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
      <MessageTiming className="action-timing" side="bottom" />
    </ActionBarPrimitive.Root>
  );
}

/**
 * The local runtime takes stream telemetry from the adapter
 * (`ChatModelRunResult.metadata.timing`), so the adapter records it: the same
 * arithmetic assistant-stream's TimingTracker applies to a streamed message.
 */
function streamTiming({ streamStartTime, firstTokenTime, totalChunks, toolCallCount, text }: Readonly<{
  streamStartTime: number;
  firstTokenTime: number | undefined;
  totalChunks: number;
  toolCallCount: number;
  text: string;
}>): StreamTiming {
  const totalStreamTime = Date.now() - streamStartTime;
  const tokenCount = text.length > 0 ? Math.ceil(text.length / 4) : undefined;

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

function ReasoningGroup({ defaultOpen, children }: DisclosureProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="reasoning">
      <button className="part-head" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span>☼ Reasoning</span><span style={{ marginLeft: "auto" }}>{open ? "⌄" : "›"}</span></button>
      {open && <div className="reasoning-body">{children}</div>}
    </div>
  );
}

function ToolCard({ name, args, result, defaultOpen }: ToolCardProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="part-card">
      <button className="part-head" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span>✓ Used tool <strong>{name}</strong></span><span style={{ marginLeft: "auto" }}>{open ? "⌄" : "›"}</span></button>
      {open && <div className="part-detail">{`Arguments\n${JSON.stringify(args ?? {}, null, 2)}\n\nResult\n${JSON.stringify(result ?? {}, null, 2)}`}</div>}
    </div>
  );
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

function ExportSuggestionLink({ onOpenExport }: Readonly<{ onOpenExport: () => void }>): ReactNode {
  return (
    <a className="status-link" href="#export" onClick={(event) => { event.preventDefault(); onOpenExport(); }}>
      <span><strong>3 usability suggestions</strong><br /><span className="hint">Exploratory, not shipped</span></span>
      <span className="tag">Beta</span>
    </a>
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

function getToolsModeHint(toolsMode: PartMode): string {
  switch (toolsMode) {
    case "off":
      return "No tools are sent to the model.";
    case "hidden":
      return "Tools are sent; call cards are hidden.";
    case "shown":
      return "Tools are sent and rendered as cards.";
  }
}

function getReasoningModeHint(reasoningMode: PartMode): string {
  switch (reasoningMode) {
    case "off":
      return "Reasoning is not requested from the agent.";
    case "hidden":
      return "Reasoning can exist, but the UI suppresses it.";
    case "shown":
      return "Reasoning renders in a collapsible group.";
  }
}

function getStepsModeHint(stepsMode: StepsMode): string {
  switch (stepsMode) {
    case "raw":
      return "Tool calls and reasoning arrive as they are, arguments included.";
    case "humanized":
      return "Tool calls become plain language: “Searching the web for …”.";
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

function getSoftStreamHint(softStream: Toggle): string {
  return softStream === "on"
    ? "Words arrive tinted, with a caret, and settle into ink."
    : "Text lands as plain streamed text.";
}

function getResponseStatusHint(responseStatus: Toggle): string {
  return responseStatus === "on"
    ? "Copy, rate, speak, regenerate, and timing on hover."
    : "No actions or timing are rendered.";
}

function buildSourceParams({ pattern, appTheme, design, toolsMode, reasoningMode, openMode, streamMode, model, capability }: Readonly<{ pattern: Pattern; appTheme: AppTheme; design: Design; toolsMode: PartMode; reasoningMode: PartMode; openMode: OpenMode; streamMode: StreamMode; model: string; capability: string }>): string {
  const params = new URLSearchParams({ pattern, theme: appTheme, design, tools: toolsMode, reasoning: reasoningMode, open: openMode, stream: streamMode });
  if (model.trim()) params.set("model", model.trim());
  if (capability) params.set("capability", capability);
  return params.toString();
}

function fileTreeRows(files: string[]): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  const seen = new Set<string>();

  for (const file of [...files].sort()) {
    const segments = file.split("/");
    for (let index = 0; index < segments.length - 1; index += 1) {
      const dir = `${segments.slice(0, index + 1).join("/")}/`;
      if (seen.has(dir)) continue;
      seen.add(dir);
      rows.push({ label: segments[index], depth: index, dir: true, path: dir });
    }
    rows.push({ label: segments[segments.length - 1], depth: segments.length - 1, dir: false, path: file });
  }

  return rows;
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

function assembleContent({ toolsMode, reasoningMode, text, reasoning, toolCalls }: Readonly<{ toolsMode: PartMode; reasoningMode: PartMode; text: string; reasoning: string; toolCalls: Map<string, ToolCallPart> }>): RenderedPart[] {
  return [
    ...(reasoningMode !== "off" && reasoning.length > 0 ? [{ type: "reasoning" as const, text: reasoning }] : []),
    ...(toolsMode !== "off" ? [...toolCalls.values()] : []),
    ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
  ];
}