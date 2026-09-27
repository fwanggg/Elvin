## 1. Demo

[![Elvin demo on Loom](https://cdn.loom.com/sessions/thumbnails/d7bd40f519ed408aa0ad451499ad4e71-469e164be9577ad4.gif)](https://www.loom.com/share/d7bd40f519ed408aa0ad451499ad4e71)

**[elvinoss.vercel.app](https://elvinoss.vercel.app/)**

## 2. What Is Elvin

A lightweight 1-click frontend for an agent backend (OpenAI-compatible APIs for now): a polished chat UI for testing, plus duration and token measurement.

```bash
git clone https://github.com/fwanggg/Elvin.git && cd Elvin
npm install && npm run dev     # localhost:3000, Node 20.9+
```

Paste an endpoint and key, press **Run**. The key stays in the browser session; nothing is stored server-side.

## 3. Why Elvin

If you are a visual person and want to test your agent backend, this is for you.

It has not been easy for me to test an agent backend visually. Some frameworks (like Hermes) ship a chat dashboard that dumps too much information; LangGraph ships a chat UI ([docs](https://docs.langchain.com/oss/python/langchain/ui)) but it is quite unpolished and missing information. None has the agent trace view and spans that let me repro and find early bugs before heavier tools.

- When your agent harness's default chat UI is broken and emitting noisy data all over you.
- I want to get a feeling of my agent visually, to feel motivated 🙂

## 4. Features

- Give your agent a chat UI in 1 click (needs a prompt to convert your agent to an OpenAI-compatible API first).
- Performance monitoring (runs, turns, spans, token usage) side-by-side with visual highlighting.
- Session management — lightweight, stored in your browser's localStorage.
- Different polished visual styles — for debugging, or to get a feel of what a user likely sees.

## 5. Q&A

**My agent is not OpenAI compatible. What should I do?**

Add a gateway that makes it OpenAI compatible — try the prompt shipped in the tool; standing one up is 2–3 minutes of work for a coding agent. Many modern frameworks, like Hermes/OpenClaw, ship one by default.

**What's the CORS error?**

Elvin talks to your agent from inside the browser; all traffic stays on your browser. Your agent backend blocking CORS is what makes the connection fail.

- In general, ask your coding agent to "Make My Agent CORS Permissive".
- **For Hermes:** `hermes -p <profile> config set API_SERVER_CORS_ORIGINS '*'`

**Does it work with an agent backend that runs on localhost?**

O yes, it does. Just use `http://localhost:xxxx/<endpoint>`.

## 6. Contributions & License

Issues and pull requests are welcome. MIT — see [LICENSE](LICENSE). © 2026 Fan W.

## 7. Contact Me & Discussion

**[Twitter](https://x.com/WFan14005097)**

**[Subtrack](https://substack.com/@fanwang3)**

**[LinkedIn](https://www.linkedin.com/in/fan-wang-73061a39/)**
