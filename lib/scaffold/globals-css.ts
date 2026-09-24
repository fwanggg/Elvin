import { DESIGN_FONTS, DESIGN_PALETTE, DESIGN_TOKENS, type Theme } from "@/lib/design-tokens";
import { joinEmittedSource, type SourceConfig } from "./shared";

/** app/globals.css: the design language of the sandbox, resolved for the chosen theme. */
/** Base scaffold styling. Every value resolves to a token on :root below. */
const SCAFFOLD_RULES = [
  "html,body{min-height:100%;margin:0}",
  "body{background:var(--a-bg);color:var(--a-fg);font-family:var(--font-body);font-size:var(--body-size);-webkit-font-smoothing:antialiased}",
  "button,input,textarea{font:inherit;color:inherit}",
  "*{box-sizing:border-box}",
  ":focus-visible{outline:2px solid var(--a-accent);outline-offset:2px}",
  ".app{height:100vh;display:flex;flex-direction:column;overflow:hidden;padding:var(--pad-canvas);background:var(--a-bg);color:var(--a-fg)}",
  ".app-header{font-family:var(--font-heading);font-size:13px;font-weight:var(--label-weight);letter-spacing:var(--label-tracking);text-transform:var(--label-transform)}",
  ".app-header span{font-weight:400;color:var(--a-muted)}",
  ".composer{display:flex;gap:8px;align-items:flex-end;padding:var(--pad-bar);border:var(--border-width) solid var(--a-border);border-radius:var(--radius);background:var(--a-bg);box-shadow:var(--shadow)}",
  ".composer-input{flex:1;min-width:0;border:0;outline:0;resize:none;background:transparent;color:inherit;font-family:var(--font-body);font-size:var(--body-size)}",
  ".composer button{padding:6px 12px;border:var(--border-width) solid var(--a-accent);border-radius:var(--radius);background:var(--a-accent);color:var(--a-accent-fg);cursor:pointer;font-family:var(--font-heading);font-size:13px;font-weight:var(--label-weight)}",
  ".user-bubble{padding:10px 16px;border:var(--border-width) solid var(--a-border);border-radius:var(--radius-card);background:var(--a-surface)}",
  ".assistant-message{font-size:var(--body-size);line-height:1.6}",
  ".assistant-text{margin:0;white-space:pre-wrap}",
  ".assistant-error{margin:0 0 8px;color:var(--danger);font-size:13px}",
  "",
].join("\n");

// The trace, drawn two ways. Dev Mode draws the group as a box of its own, with
// the trace as children and the word "Reasoning" on the trigger. User Mode draws
// the panel, which has no card in it, so its rules land on `.reasoning-panel` and
// on the step list inside it. Both share the trigger's shimmer and the trace's
// words, which land one at a time instead of in whole paragraphs.
const REASONING_RULES = [
  ".reasoning{margin:8px 0;border:var(--border-width) solid var(--a-border);border-radius:var(--radius-card);background:var(--a-bg);box-shadow:var(--shadow);overflow:hidden}",
  ".reasoning-trigger{display:flex;width:100%;gap:8px;align-items:center;justify-content:space-between;padding:8px 12px;border:0;background:transparent;color:inherit;cursor:pointer}",
  ".reasoning-trigger-label{font-size:13px;font-weight:var(--label-weight);letter-spacing:var(--label-tracking)}",
  ".reasoning-trigger-label[data-active]{background-image:linear-gradient(90deg,color-mix(in oklab,currentColor 35%,transparent) 40%,currentColor 50%,color-mix(in oklab,currentColor 35%,transparent) 60%);background-size:250% 100%;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:reasoning-shimmer 1.8s linear infinite}",
  "@keyframes reasoning-shimmer{from{background-position:100% 0}to{background-position:0 0}}",
  ".reasoning-content{padding:0 12px 12px;font-size:14px;line-height:1.6;opacity:.75;animation:reasoning-open .24s cubic-bezier(.23,1,.32,1) both}",
  ".reasoning-step{display:flex;gap:12px}",
  ".reasoning-dot{flex:none;width:5px;height:5px;margin-top:7px;border-radius:999px;background:color-mix(in srgb,currentColor 20%,transparent)}",
  ".reasoning-dot[data-active]{background:var(--a-accent);animation:reasoning-pulse 1.6s ease-in-out infinite}",
  ".reasoning-step-text{min-width:0;flex:1}",
  ".reasoning-step-title{margin:0;font-size:13.5px;font-weight:500;color:var(--a-fg)}",
  ".reasoning-step-body{margin:2px 0 0;font-size:13px;line-height:1.6;color:var(--a-muted);overflow-wrap:break-word}",
  "@keyframes reasoning-pulse{50%{opacity:.45}}",
  "@keyframes reasoning-open{from{opacity:0;translate:0 -4px}}",
  ".reasoning-panel{margin:8px 0}",
  ".reasoning-panel .reasoning-trigger{display:inline-flex;gap:6px;align-items:center;padding:4px 0;border:0;background:transparent;color:var(--a-muted);cursor:pointer;font-size:13.5px}",
  ".reasoning-panel .reasoning-trigger:hover{color:var(--a-fg)}",
  ".reasoning-panel .reasoning-trigger-label{font-weight:var(--label-weight);letter-spacing:var(--label-tracking)}",
  ".reasoning-panel .reasoning-steps{display:flex;flex-direction:column;gap:16px;list-style:none;margin:0;padding:12px 0 4px;animation:reasoning-open .24s cubic-bezier(.23,1,.32,1) both}",
  ".reasoning-line{margin:0;white-space:pre-wrap}",
  ".reasoning-word{animation:reasoning-word-in .35s cubic-bezier(.23,1,.32,1) both}",
  "@keyframes reasoning-word-in{from{opacity:0}}",
  "@media (prefers-reduced-motion:reduce){.reasoning-trigger-label[data-active]{animation:none;-webkit-text-fill-color:currentColor;background-image:none}.reasoning-content,.reasoning-dot,.reasoning-steps,.reasoning-word{animation:none}}",
  "",
].join("\n");

/** Turn markers: a small animated emoji in a gutter beside the message. */
const EMOJI_RULES = [
  ".message-emoji{position:absolute;top:1px;width:22px;height:22px;font-size:18px;line-height:22px;object-fit:contain;user-select:none}",
  ".assistant-message.emoji-row{position:relative;padding-left:30px}",
  ".assistant-message.emoji-row>.message-emoji{left:0}",
  ".user-bubble.emoji{position:relative;margin-right:30px}",
  ".user-bubble.emoji>.message-emoji{left:100%;margin-left:8px}",
  "",
].join("\n");

const TOOL_RULES = [
  ".tool-card{margin:8px 0;border:var(--border-width) solid var(--a-border);border-radius:var(--radius-card);background:var(--a-bg);box-shadow:var(--shadow);overflow:hidden}",
  ".tool-card-trigger{display:flex;width:100%;gap:8px;align-items:center;justify-content:space-between;padding:8px 12px;border:0;background:transparent;color:inherit;cursor:pointer}",
  ".tool-card-name{font-size:13px;font-weight:var(--label-weight)}",
  ".tool-card-content{padding:0 12px 12px}",
  ".tool-card-content pre{margin:0;font-family:var(--font-mono);font-size:12px;overflow:auto}",
  ".tool-call{margin:6px 0}",
  ".tool-call .font-mono:empty{display:none}",
  ".tool-call-trigger{display:flex;width:100%;gap:8px;align-items:center;padding:4px 0;border:0;background:transparent;color:var(--a-muted);cursor:pointer;font:inherit;font-size:13.5px;text-align:left}",
  ".tool-call-trigger:hover{color:var(--a-fg)}",
  ".tool-call-chevron{opacity:.6}",
  ".tool-call-label[data-active]{background-image:linear-gradient(90deg,color-mix(in oklab,currentColor 35%,transparent) 40%,currentColor 50%,color-mix(in oklab,currentColor 35%,transparent) 60%);background-size:250% 100%;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:reasoning-shimmer 1.8s linear infinite}",
  ".tool-call-chip{background:color-mix(in srgb,currentColor 8%,transparent);border-radius:6px;font-family:var(--font-mono);font-size:11px;padding:2px 6px}",
  ".tool-call-check{color:var(--color-ok,#1c6b3f);margin-left:auto}",
  ".tool-call-panel{background:color-mix(in srgb,currentColor 5%,transparent);border-radius:14px;margin-top:8px;padding:10px 14px}",
  ".tool-call-field{margin:0 0 4px;color:var(--a-muted);font-family:var(--font-mono);font-size:11px}",
  ".tool-call-request{margin:0;font-family:var(--font-mono);font-size:12px;white-space:pre-wrap}",
  ".tool-call-result{margin:0;font-size:13px;white-space:pre-wrap}",
  ".tool-call-divider{height:1px;margin:8px -14px;background:color-mix(in srgb,currentColor 8%,transparent)}",
  "",
].join("\n");

/**
 * The scaffold has no chrome of its own, so the language lands on :root rather
 * than behind a [data-design] scope. Values come from lib/design-tokens.ts,
 * which is generated from the playground stylesheet.
 */
export function globalsSource(config: SourceConfig): string {
  const theme: Theme = config.theme === "light" ? "light" : "dark";
  const tokens = { ...DESIGN_TOKENS[config.design], ...DESIGN_PALETTE[config.design][theme] };
  const root = Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(";");

  return joinEmittedSource([
    `@import url('${DESIGN_FONTS[config.design]}');\n`,
    `:root{${root}}\n`,
    SCAFFOLD_RULES,
    REASONING_RULES,
    TOOL_RULES,
    config.emoji === "on" && EMOJI_RULES,
  ], "");
}
