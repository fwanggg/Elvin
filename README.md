# Elvin

Point Elvin at any OpenAI-compatible endpoint and the same agent is rendered across seven design languages, three UI patterns and both themes — streaming, reasoning, tool calls and all.

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
| **View mode** | `Dev Mode` · `User Mode` — who the parts render for. Tools and reasoning always render: Dev Mode shows them as the agent sent them, with a card per call, the trace in its group and the turn's timings in the runs panel beside the chat; User Mode writes them for a person (each call a step in plain language, its argument a chip, and its raw request and result behind a disclosure) |
| **Default state** | `Collapsed` · `Expanded` — how the trace and tool cards rest |
| **Emoji** | `On` · `Off` — turn markers beside each message |
## Project layout

```
app/                    # the testbed: shell, controls, sandbox
  api/check/            #   connect probe: models and capabilities
  api/chat/             #   provider proxy, normalised into one event stream
components/
  agent-testbed.tsx     #   the testbed itself: shell, controls, adapter
  sandbox/              #   the sandboxed app's renderers and knobs
  assistant-ui/         #   vendored assistant-ui elements, kept unmodified
  ui/                   #   vendored shadcn/ui primitives
lib/
  step-labels.ts        #   tool calls as plain-language steps
  turn-stats.ts         #   what the proxy measured, shared with the renderers
scripts/                # gateway, behaviour baseline, provider probe
reports/                # baselines and screenshots
```

## Contributing

Issues and pull requests are welcome.

Two conventions keep the repo honest:

- **Design languages live in one place.** Each language's palette, type and geometry sits in its own `[data-design]` block in `app/globals.css`, and the sandbox reads it from the cascade rather than from a parallel token table.
- **Behaviour is fingerprinted.** Run `node scripts/verify-behavior.mjs --compare` before and after a refactor; it must report identical behaviour.

## License

MIT — see [LICENSE](LICENSE). © 2026 Fan W.

Live demo: **[elvinoss.vercel.app](https://elvinoss.vercel.app/)**
