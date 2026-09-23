# Elvin

Point Elvin at any OpenAI-compatible endpoint and the same agent is rendered across seven design languages, three UI patterns and both themes — streaming, reasoning, tool calls and all — then export the exact source as a runnable Next.js app.

**[Live demo → elvinoss.vercel.app](https://elvinoss.vercel.app/)**

Requires Node 20.9 or newer.

```bash
git clone https://github.com/fwanggg/Elvin.git
cd Elvin
npm install
npm run dev          # http://localhost:3000
```

Paste an endpoint (for example `https://api.openai.com/v1`) and a key, press **Run**, and the sandbox renders the agent. The key stays in the browser session and is forwarded per request; nothing is persisted server-side.

---

## Why this exists

The model half of an agent product is rented. The interface half is not — it is where reasoning, tool calls, streaming and error states either read clearly or do not. Elvin is a testbed for that half: one agent, rendered every way it might ship, so a design decision can be *looked at* instead of argued about.

It is deliberately provider-agnostic. Anything that speaks the OpenAI wire format works, including a localhost proxy, and the sandbox tracks whichever of `content`, `reasoning`, `reasoning_content` and `tool_calls` your provider actually sends.

## Knobs

Every control changes the sandbox live. There is no build step between a decision and seeing it.

| Knob | Options |
| --- | --- |
| **UI pattern** | `Thread` · `Copilot` (docked sidebar) · `Floating` (modal launcher) |
| **App theme** | `Dark` · `Light` |
| **Design language** | Swiss Grid · Neo-Brutalism · Biophilic · Minimalist · Organic / Anti-grid · Skeuomorphism · Cyberpunk/Terminal |
| **Stream** | `true` · `false` — streamed deltas versus one final response |
| **Tool calls** | `Shown` · `Hidden` · `Off` — rendered card, carried in the data but not drawn, or never sent |
| **Reasoning group** | `Shown` · `Hidden` · `Off` — same three states for the reasoning trace |
| **Middle steps** | `Raw` (the provider's own trace; the turn's thinking time is left under the answer) · `Humanized` (plain-language steps) |
| **Default state** | `Collapsed` · `Expanded` — how the trace and tool cards rest |
| **Emoji** | `On` · `Off` — turn markers beside each message |
| **Soft stream** | `On` · `Off` — newest words tinted as they land |
| **Response status** | `On` · `Off` — the action bar and its timing metadata |

## Export

**Export Code** builds a zip containing a runnable Next.js app: the same assistant you are looking at, with the knobs frozen into a config file.

```
elvin.config.ts                     # the frozen knobs
.env.example                        # AGENT_BASE_URL, AGENT_API_KEY
app/api/chat/route.ts               # provider proxy, normalised into one event stream
components/assistant/
  ElvinAssistant.tsx                # the runtime, thread and message rendering
  reasoning-group.tsx               # collapsible reasoning trace
  tool-card.tsx                     # collapsible tool call
app/globals.css                     # the design language, as plain CSS
```

```bash
npm install
cp .env.example .env                # then fill in AGENT_BASE_URL and AGENT_API_KEY
npm run dev
```

The exported app has no dependency on this repository: no Tailwind, no component library, just React, Next.js and `@assistant-ui/react`.

## No provider key at hand

`scripts/local-openai-proxy.mjs` is a localhost OpenAI-compatible gateway that holds the upstream key in its own process, so a browser session never needs one. It also answers `/v1/models` and `/v1/capabilities` for the testbed's connect probe.

```bash
OPENROUTER_API_KEY=... npm run gateway                    # http://127.0.0.1:4024/v1
DEEPSEEK_API_KEY=... node scripts/local-openai-proxy.mjs --upstream deepseek
```

Then connect Elvin to `http://127.0.0.1:4024/v1`.

```
usage: node scripts/local-openai-proxy.mjs [--port 4024] [--upstream openrouter|deepseek] [--model id] [--reasoning on|off]
```

It binds to loopback only — it holds a key and must not be reachable from the network.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run gateway` | Local OpenAI-compatible gateway (see above) |
| `npm run design:sync` | Regenerate `lib/design-tokens.ts` from the playground stylesheet |
| `npm run design:check` | Verify the generated tokens are in sync |

## Development tools

```bash
node scripts/verify-behavior.mjs            # capture a behavioural baseline
node scripts/verify-behavior.mjs --compare  # diff against it; exits 1 on change
OPENROUTER_API_KEY=... node scripts/openrouter-probe.mjs --models=openai/gpt-6-luna
```

`verify-behavior.mjs` fingerprints the API routes against a local mock provider with fixed ids and canned text, so a diff means the code changed rather than that a model was in a different mood. `openrouter-probe.mjs` records the raw wire format of reasoning and tool calls per model into `reports/`.

## Project layout

```
app/                    # the testbed: shell, controls, sandbox, export dialog
  api/check/            #   connect probe: models and capabilities
  api/chat/             #   provider proxy, normalised into one event stream
  api/source/           #   the exported scaffold, as JSON or a zip
components/
  agent-testbed.tsx     #   the testbed itself: shell, controls, adapter
  sandbox/              #   the sandboxed app's renderers and knobs
  assistant-ui/         #   vendored assistant-ui elements, kept unmodified
  ui/                   #   vendored shadcn/ui primitives
lib/
  scaffold/             #   the source the export emits, one module per file
  design-tokens.ts      #   generated from the design-language CSS
  step-labels.ts        #   tool calls as plain-language steps
scripts/                # gateway, behaviour baseline, provider probe
reports/                # baselines and screenshots
```

## Deploying

Vercel detects the project; no configuration is required.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffwanggg%2FElvin)

Inference happens at the provider, so the functions only proxy and normalise streams. One thing to know: `/api/chat` streams, so a slow reasoning model can hold a request open for a long time. On a plan or project without Fluid Compute the per-request ceiling is 10 seconds by default — raise it for the streaming route (`export const maxDuration = 300`) if long traces matter to you.

## Contributing

Issues and pull requests are welcome.

Two conventions keep the repo honest:

- **Design languages are generated, not hand-maintained.** Editing the design-language blocks in `app/globals.css` means running `npm run design:sync`; `npm run design:check` fails when the generated tokens drift.
- **Behaviour is fingerprinted.** Run `node scripts/verify-behavior.mjs --compare` before and after a refactor; it must report identical behaviour.

## License

MIT — see [LICENSE](LICENSE). © 2026 Fan W.

Live demo: **[elvinoss.vercel.app](https://elvinoss.vercel.app/)**
