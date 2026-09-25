/**
 * The prompt the connect screen hands out.
 *
 * Most agents are not OpenAI-compatible, and the thing missing is a gateway in the agent's
 * own repository. That work needs no knowledge of this app, so the prompt carries none: it
 * names the contract, the reconnaissance it must do first, and the one test that decides it.
 *
 * It lives here rather than beside the button because it is prose a stranger will run, and
 * the details that decide whether a gateway works are all in the contract — a dropped frame
 * terminator, a doubled finish reason or a cached count added to the prompt all fail
 * silently on the other side.
 *
 * Everything is literal, including the `\n\n` sequences: they are what an SSE frame ends
 * with, and a client that never sees one waits forever.
 */
export const GATEWAY_PROMPT = `# Task
This repo is an AI agent. Wrap it in a local HTTP gateway indistinguishable from an
OpenAI-compatible provider, keep it in this repo, then start it and report the base URL and
model id. You do not know its name or shape — establish that from the code first. Match this
project's language and run tooling.

## 1. Recon, then a mapping table
- Find how one turn runs (exported function, CLI entry, server) and what it emits: text,
  thinking, tool calls, usage, errors. Read the code; do not assume.
- Call it in-process if anything is callable; spawn its CLI only as a fallback.
- Write out \`their event → OpenAI field\` before coding. Any event with no field is dropped
  deliberately and reported, never silently.

## 2. Contract
Under the /v1 prefix:
  GET  /v1/models            → {"object":"list","data":[{"id":<id>,"object":"model","owned_by":…}]}
  POST /v1/chat/completions  → SSE when stream:true, else JSON
  OPTIONS → 204 + CORS headers        GET /health → liveness

SSE: Content-Type text/event-stream; every frame is \`data: <one JSON>\\n\\n\`; one id per completion.
  {id, object:"chat.completion.chunk", created:<unix s>, model,
   choices:[{index:0, delta:{…}, finish_reason:null}]}
  1. delta:{role:"assistant"}
  2. delta:{content:"…"}  |  delta:{reasoning_content:"…"}   ← see 2b for this field's rules
  3. delta:{tool_calls:[{index, id?, type:"function", function:{name?, arguments:"…"}}]}
     arguments are STRING FRAGMENTS the client concatenates: send pieces, never resend the
     whole JSON; id and name once per index, on its first fragment
  4. exactly one frame: delta:{} with finish_reason:"stop"|"tool_calls"|"length"
  5. one usage frame: {choices:[], usage:{…}} — mandatory if stream_options.include_usage
  6. the literal bytes \`data: [DONE]\\n\\n\`, then close
  Emit \`: keep-alive\\n\\n\` comments while the agent is silent.
JSON response: {object:"chat.completion", choices:[{message:{role,content}, finish_reason}], usage}

Usage — clients trust it and cannot verify it:
- prompt_tokens = the whole prompt, cached reads included; cached_tokens ≤ prompt_tokens,
  a share of it, never an addition to it
- completion_tokens = generated only; total_tokens = prompt + completion
- the agent's own figures; a report repeated across frames of the same message counts once;
  if it reports none, mark your number estimated

## 2b. reasoning_content — the one field outside the OpenAI spec
OpenAI's schema carries no thinking text: its reasoning models expose only a token count. So
this field is a convention — DeepSeek's, mirrored by vLLM, SGLang and LiteLLM — and it is the
field OpenAI-compatible clients read. Treat it as an extension with fixed rules.

Channel
- one name, and only one: delta.reasoning_content streaming, message.reasoning_content in a
  JSON response. Never reasoning, thinking, thought, and never content.
- content is the answer ALONE. Merging them makes the client render thinking as the reply,
  replay it as assistant history, and count its tokens as the answer's.
- channels are fixed; order follows the agent. If it reveals thinking late, still send it on
  the reasoning channel rather than back-filling content.
- fragments append in arrival order, as emitted. Nothing goes on either channel after
  finish_reason.
- if a client you must serve reads a different key (reasoning), mirror the same fragment
  there. Never mirror it into content.

Absence
- the agent emits nothing → OMIT the field entirely. Not "", not a summary of the answer, not
  progress or status text. An empty flush makes clients render an empty reasoning panel, and
  synthesized thinking is fabricated output.
- a summary the agent does emit is reasoning: forward it verbatim, and do not present it as
  the full trace.

Tokens — reasoning is output, not an addition to it
- completion_tokens holds the total, reasoning included; if the agent reports the share, name
  it in completion_tokens_details.reasoning_tokens. Never add it on top: that is the same
  additive error as treating cached input as a separate number.

Boundaries
- never route tool-call JSON or tool arguments through it, in either direction.
- opaque blobs (signatures, encrypted thinking) are the agent's session state, not display:
  keep them with the agent, never put them on the wire, and do not discard them if the agent
  needs them back.
- strip reasoning from any history you forward to the agent: it is ephemeral display, not
  context.
- safe by construction — a spec-compliant client ignores unknown delta keys — so emitting it
  cannot break a client that does not read it.

## 3. Mapping and continuity
- one request = one turn; the prompt is the newest user message, content parts flattened to text
- key continuity on the client's session/thread header, else a hash of the system prompt; same
  key continues the agent's session, a new key starts one; echo the key back in a header
- stream as the agent produces: never buffer a turn and replay it, never fabricate an event
- honour what you can; 400 naming any parameter you cannot (tools, temperature, stop, n>1)

## 4. Failure
- before headers: 400 malformed body, 502 agent failure, {"error":{"message":…}}
- after headers: \`data: {"error":{…}}\` then \`[DONE]\`, then close — never a bare disconnect
- client disconnects or timeout → kill the agent at once; if content already streamed, end
  with a finish reason instead of discarding what the client has already seen
- keep the agent's stderr; a trimmed copy goes into the error

## 5. Done
The gateway starts with one command and prints the base URL and the model id. An unmodified
OpenAI client — the official SDK, or a UI that already speaks this protocol — points at that
URL with no adapter code and renders text, thinking, tool calls, usage and finish reasons, on
two concurrent conversations that stay separate. Your own curl is not evidence. Report the
URL, the model id, the start command, and every event you dropped.
`;
