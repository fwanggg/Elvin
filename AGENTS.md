# AGENTS.md

## Verifying a change

The app is one static page — no server route, no fixture harness. There is nothing to POST to, so a
change is verified in the browser:

```bash
npm run build && npm run preview     # out/, served at localhost:4000
```

Drive the page yourself, or with a headless browser. `npm run dev` on 3000 is the same app
unbuilt.

Provider behaviour is reproduced offline with a stand-in that replays a captured stream from
loopback and sends `Access-Control-Allow-Origin` for the page's origin. It needs three answers:
`GET /v1/models` (with `data[].id`), `GET /v1/capabilities` (or a 404 — it is a courtesy), and
`POST /v1/chat/completions` as `text/event-stream`. That is the whole of the connection, so a
provider whose bytes are on disk can be replayed without calling anyone.

A capture that gets committed carries no hostname, username, path, handle or token: redact it, and
state what you redacted in the SSE comment at the top of the file.
