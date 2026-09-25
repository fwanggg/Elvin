/**
 * The prompt the connect screen hands out.
 *
 * Most agents are not OpenAI-compatible, and what is missing is a gateway in the agent's own
 * repository — work needing no knowledge of this app, so the prompt carries none. Contract
 * first: the frames a client hangs without, the fields it reads, the arithmetic that fails
 * silently. Everything is literal, including the `\n\n` sequences: a frame ends with them.
 */
export const GATEWAY_PROMPT = `# Task

This repo is an AI agent. Put a local HTTP gateway in front of it that an unmodified OpenAI
client cannot tell from a provider: keep it in this repo, start it with one command, report
the base URL and the model id. You do not know the agent's shape yet — establish it from the
code, and match this project's language and tooling.

## 1. Recon

Find how one turn runs and what it emits: text, thinking, tool calls, usage, errors. Read the
code; call it in-process if anything is callable. Write out \`<agent event> → <OpenAI field>\`
before coding, and report any event you deliberately drop — drop nothing silently.

## 2. The contract

Reference: platform.openai.com/docs/api-reference/chat/streaming

GET /v1/models →
  {"object":"list","data":[{"id":"<id>","object":"model","owned_by":"<you>"}]}

POST /v1/chat/completions   (stream:true; a JSON completion when false)

  client sends:  {"model","stream":true,"messages":[{"role":"user","content":"…"}],
                  "tools":[…],"stream_options":{"include_usage":true}}
  continuation:  {"role":"tool","tool_call_id":"call_1","content":"…"}   ← must be accepted
  response:      Content-Type: text/event-stream

  Every frame is \`data: <one json>\\n\\n\`. The chunk:
  {"id","object":"chat.completion.chunk","created":<unix s>,"model",
   "choices":[{"index":0,"delta":{…},"finish_reason":null}]}

  The order clients are built on:
    delta:{"role":"assistant"}
    delta:{"content":"…"}                      the answer, nothing else
    delta:{"reasoning_content":"…"}            thinking — see 4
    delta:{"tool_calls":[{"index":0,"id":"call_1","type":"function",
                          "function":{"name":"search","arguments":"{\\"q\\":"}}]}
    delta:{"tool_calls":[{"index":0,"function":{"arguments":"\\"eggs\\"}"}}]}
    delta:{} with finish_reason:"stop"|"tool_calls"|"length"     ← exactly one frame
    {"choices":[],"usage":{…}}                 ← when include_usage was asked
    \`data: [DONE]\\n\\n\`, then close

  While the agent is silent: \`: keepalive\\n\\n\`. A long tool call must not look dead.

## 3. What fails silently

- The call's name goes in function.name, not beside it. arguments is ONE JSON STRING sent as
  fragments that concatenate; id and name appear once, on the first fragment. OpenAI's own
  words: the model "does not always generate valid JSON" — forward it, never re-encode it.
- No argument quoted → send none. Never invent an empty object.
- finish_reason exactly once; null on every frame before it; "tool_calls" when calls were made.
- usage: "cached_tokens … are a subset of prompt tokens" — a share, never an addition.
  Reasoning is generated output: inside completion_tokens, named in
  completion_tokens_details.reasoning_tokens.
- A frame without \`\\n\\n\` hangs the client forever. A 400 on stream_options is survivable —
  estimate the tokens instead.

## 4. reasoning_content — the one field outside the spec

One key, never reasoning/thinking, never merged into content. The agent says nothing → omit
the field. Never route tool JSON, arguments or signatures through it. Strip it from history.

## 5. Continuity and failure

One request = one turn; the newest user message is the prompt. Key the agent's session on the
client's thread header, else on a hash of the system prompt; echo the key back. Stream as the
agent produces — never buffer and replay, never fabricate an event. Before headers: 400/502
with {"error":{"message":…}}. After: \`data: {"error":{…}}\` then [DONE]. Client gone → kill
the agent.

## 6. Done

An unmodified OpenAI client renders text, thinking, tool calls, usage and finish reasons from
that URL, across two concurrent conversations that stay separate. Your own curl is not
evidence. Report the URL, the model id, the start command, and every event you dropped.
`;
