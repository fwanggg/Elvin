# AGENTS.md

## Replay tests

Provider streams replay through the real chat route, without calling anyone. Each fixture is a real capture, redacted:

- `replay_test/<name>/raw_stream.sse` — the provider's bytes, verbatim
- `replay_test/<name>/expected.json` — `{"prompt", "events"}`

`node replay_test/replay.mjs` replays every fixture (or one, by name); `npm run dev` must be running. `--record` rewrites the expectations — read the diff before committing it. A capture must carry no hostname, username, path, handle or token: redact it, and state what you redacted in the SSE comment at the top of the file.
