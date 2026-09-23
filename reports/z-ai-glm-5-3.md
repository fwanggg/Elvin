# z-ai/glm-5.3

Probe of OpenRouter `z-ai/glm-5.3` — reasoning and tool-calling, each toggled independently.

- Generated: 2026-09-23T09:39:51.685Z
- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions` (streaming, `max_tokens: 2000`)
- Prompt: `Two things, please: (1) work out 17*23 step by step, and (2) call get_weather with city="Paris" for the current weather there. Show your working for the arithmetic.`
- Tool: `get_weather` (`type: "function"`, JSON Schema params, `tool_choice: "auto"`)

## Model metadata (from `GET /api/v1/models`)

```json
{
  "id": "z-ai/glm-5.3",
  "name": "Z.ai: GLM 5.3",
  "context_length": 1310720,
  "supported_parameters": [
    "frequency_penalty",
    "include_reasoning",
    "logit_bias",
    "logprobs",
    "max_tokens",
    "min_p",
    "parallel_tool_calls",
    "presence_penalty",
    "reasoning",
    "reasoning_effort",
    "repetition_penalty",
    "response_format",
    "seed",
    "stop",
    "structured_outputs",
    "temperature",
    "tool_choice",
    "tools",
    "top_k",
    "top_logprobs",
    "top_p"
  ],
  "reasoning": {
    "mandatory": true,
    "default_enabled": true,
    "supported_efforts": [
      "max",
      "high",
      "low"
    ],
    "default_effort": "max"
  }
}
```

- declares `tools`: **true**
- declares `reasoning`: **true**

## Matrix

| reasoning | tools | HTTP | mode | reasoning? | kind | reasoning field | tool call? | args type | finish |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| on | on | 200 | stream | yes (1210 chars) | reasoning.text | delta.reasoning, delta.reasoning_details[].type|text|format|index | yes (get_weather) | string(JSON) | tool_calls |
| on | off | 200 | stream | yes (3504 chars) | reasoning.text | delta.reasoning, delta.reasoning_details[].type|text|format|index | no | - | stop |
| off | on | 200 | stream | yes (664 chars) | reasoning.text | delta.reasoning, delta.reasoning_details[].type|text|format|index | yes (get_weather) | string(JSON) | tool_calls |
| off | off | 200 | stream | yes (2772 chars) | reasoning.text | delta.reasoning, delta.reasoning_details[].type|text|format|index | no | - | stop |

## Toggle behaviour

- reasoning on → produced reasoning: **true**; off → produced reasoning: **true**
- tools on → tool call: **true**; tools off → tool call: **false**

## Key inventory (streamed chunks)

```
choices
choices[]
choices[].delta
choices[].delta.content
choices[].delta.reasoning
choices[].delta.reasoning_details
choices[].delta.reasoning_details[]
choices[].delta.reasoning_details[].format
choices[].delta.reasoning_details[].index
choices[].delta.reasoning_details[].text
choices[].delta.reasoning_details[].type
choices[].delta.role
choices[].delta.tool_calls
choices[].delta.tool_calls[]
choices[].delta.tool_calls[].function
choices[].delta.tool_calls[].function.arguments
choices[].delta.tool_calls[].function.name
choices[].delta.tool_calls[].id
choices[].delta.tool_calls[].index
choices[].delta.tool_calls[].type
choices[].finish_reason
choices[].index
choices[].native_finish_reason
created
id
model
object
provider
service_tier
system_fingerprint
usage
usage.completion_tokens
usage.completion_tokens_details
usage.completion_tokens_details.audio_tokens
usage.completion_tokens_details.image_tokens
usage.completion_tokens_details.reasoning_tokens
usage.cost
usage.cost_details
usage.cost_details.upstream_inference_completions_cost
usage.cost_details.upstream_inference_cost
usage.cost_details.upstream_inference_prompt_cost
usage.is_byok
usage.prompt_tokens
usage.prompt_tokens_details
usage.prompt_tokens_details.audio_tokens
usage.prompt_tokens_details.cache_write_tokens
usage.prompt_tokens_details.cached_tokens
usage.prompt_tokens_details.video_tokens
usage.total_tokens
```

## Raw evidence

### reasoning=on tools=on

- HTTP 200 in 1096ms, content-type `text/event-stream`, 70 SSE lines
- reasoning captured:

```text
TheThe user wants two things:
1 user wants two things:
1. Work. Work out 17*23 step out 17*23 step by step
2. Call by step
2. Call get_weather with city="Paris get_weather with city="Paris"

These are independent tasks"

These are independent tasks, so I can call, so I can call the tool the tool while doing the arithmetic. Let while doing the arithmetic. Let me do both me do both.. The arithmetic doesn The arithmetic doesn't require any't require any tool calls tool calls, so I'll show, so I'll show my working and call my working and call the weather tool the weather tool.

.

1717 * * 23:
- 23:
- Break Break it it down: 17 * down: 17 * 23 = 17 23 = 17 * (20 + 3 * (20 + 3) = 17*) = 17*20 + 17*320 + 17*3 = 340 = 340 + 51 + 51 = 39 = 391

1

Let me verify: 17Let me verify: 17 * 20 * 20 = 340
```
- tool calls:

```json
[
  {
    "id": "call_01a0cda2aa7d7f4091701145",
    "name": "get_weather",
    "arguments": "{\"city\":\"Paris\"}",
    "argumentsType": "string(JSON)"
  }
]
```
- content:

```text
I'll handle both requests. Let me start the weather lookup and work through the arithmetic at the same time.
```
- first SSE payloads verbatim:

```text
{"id":"gen-1790156383-PjhnyKmVWBLvNHV9nPPU","object":"chat.completion.chunk","created":1790156383,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":"The","reasoning_details":[{"type":"reasoning.text","text":"The","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156383-PjhnyKmVWBLvNHV9nPPU","object":"chat.completion.chunk","created":1790156383,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":" user wants two things:\n1","reasoning_details":[{"type":"reasoning.text","text":" user wants two things:\n1","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156383-PjhnyKmVWBLvNHV9nPPU","object":"chat.completion.chunk","created":1790156383,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":". Work","reasoning_details":[{"type":"reasoning.text","text":". Work","format":"unknown","index":0}]},"finis
```

### reasoning=on tools=off

- HTTP 200 in 3215ms, content-type `text/event-stream`, 248 SSE lines
- reasoning captured:

```text
TheThe user wants two things:
1 user wants two things:
1. Work out 17*. Work out 17*23 step by step,23 step by step, showing the showing the arithmetic
2. Call get arithmetic
2. Call get_weather with city="Paris"_weather with city="Paris" for the current weather

For for the current weather

For the first the first part, I can part, I can easily easily show show the arithmetic step by step. the arithmetic step by step. Let me work Let me work through through 17*23:

 17*23:

MethodMethod 1: Break 1: Break it it down
17 down
17 * * 23 = 17 * 23 = 17 * (20 + 3) (20 + 3) = 17* = 17*20 + 1720 + 17*3 = 340*3 = 340 + 51 + 51 = 39 = 391

Or1

Or long long multiplication:
  multiplication:
  17
 17
× 23
----
× 23
----
  51  51 (17 × 3 (17 × 3)
 340)
 340 (17 × 20 (17 × 20, shifted)
----
, shifted)
```
- content:

```text
## 1. Working out 17 × 23

**Method: split 23 into 20 + 3**

- 17 × 20 = 340
- 17 × 3 = 51
- 340 + 51 = **391**

Or as long multiplication:

```
    17
  × 23
  ----
    51   (17 × 3)
   340   (17 × 20, shifted one place)
  ----
   391
```

**Answer: 17 × 23 = 391**

Quick check: 391 ÷ 17 = 23 ✓

## 2. Weather in Paris

I'm afraid I can't do this one — I don't have access to a `get_weather` tool (
```
- first SSE payloads verbatim:

```text
{"id":"gen-1790156384-AZ2JRrEozS6OE1EhRmX0","object":"chat.completion.chunk","created":1790156384,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":"The","reasoning_details":[{"type":"reasoning.text","text":"The","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156384-AZ2JRrEozS6OE1EhRmX0","object":"chat.completion.chunk","created":1790156384,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":" user wants two things:\n1","reasoning_details":[{"type":"reasoning.text","text":" user wants two things:\n1","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156384-AZ2JRrEozS6OE1EhRmX0","object":"chat.completion.chunk","created":1790156384,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":". Work out 17*","reasoning_details":[{"type":"reasoning.text","text":". Work out 17*","format":"unknown","in
```

### reasoning=off tools=on

- HTTP 200 in 1302ms, content-type `text/event-stream`, 89 SSE lines
- reasoning captured:

```text
TheThe user wants two things:
1 user wants two things:
1. Work. Work out 17*23 step out 17*23 step by step
2. Call by step
2. Call get_weather with city="Paris get_weather with city="Paris"

These are independent,"

These are independent, so I can do so I can do the arithmetic and call the arithmetic and call the tool the tool.. The The tool call should tool call should be made. be made. Let me show Let me show the working for the arithmetic and the working for the arithmetic and call the weather tool call the weather tool in the same response in the same response.

17.

17 * * 23 = 23 = 17 * 17 *  20 + 1720 + 17 * 3 = 340 * 3 = 340 + 51 + 51 = 391 = 391..
```
- tool calls:

```json
[
  {
    "id": "call_01a0cda2bc2177808893ec63",
    "name": "get_weather",
    "arguments": "{\"city\":\"Paris\"}",
    "argumentsType": "string(JSON)"
  }
]
```
- content:

```text
I'll handle both requests. Let me work through the arithmetic and fetch the weather for Paris at the same time.

**Arithmetic: 17 × 23 (step by step)**

Using the distributive property, split 23 into 20 + 3:

1. **17 × 20** = 17 × 2 × 10 = 34 × 10 = **340**
2. **17 × 3** = 10 × 3 + 7 × 3 = 30 + 21 = **51**
3. **Add the partial products:** 340 + 51 = **391**

So **17 × 23 = 391**.

*Quick check via
```
- first SSE payloads verbatim:

```text
{"id":"gen-1790156388-cEzVBRxFBfOR2FIIgDaY","object":"chat.completion.chunk","created":1790156388,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":"The","reasoning_details":[{"type":"reasoning.text","text":"The","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156388-cEzVBRxFBfOR2FIIgDaY","object":"chat.completion.chunk","created":1790156388,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":" user wants two things:\n1","reasoning_details":[{"type":"reasoning.text","text":" user wants two things:\n1","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156388-cEzVBRxFBfOR2FIIgDaY","object":"chat.completion.chunk","created":1790156388,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":". Work","reasoning_details":[{"type":"reasoning.text","text":". Work","format":"unknown","index":0}]},"finis
```

### reasoning=off tools=off

- HTTP 200 in 2265ms, content-type `text/event-stream`, 178 SSE lines
- reasoning captured:

```text
TheThe user is user is asking for asking for two things:
1. Work two things:
1. Work out 17*23 step out 17*23 step by step
2. Call by step
2. Call get_weather with city="Paris get_weather with city="Paris" for current" for current weather

For weather

For the first part, I can the first part, I can do the arithmetic do the arithmetic and and show my show my working. This working. This is straightforward.

For the second is straightforward.

For the second part, I don part, I don't have access't have access to a get to a get_weather tool_weather tool or function. I or function. I don't have any tools don't have any tools available in this conversation. I available in this conversation. I should be honest about should be honest about this — this — I cannot I cannot call call external extern
```
- content:

```text
## 1) Working out 17 × 23

**Method: break it into easier products**

17 × 23 = 17 × (20 + 3)

Step 1: 17 × 20 = 340

Step 2: 17 × 3 = 51

Step 3: 340 + 51 = **391**

**Verification:** (20 − 3)(20 + 3) = 400 − 9 = 391 ✓

So 17 × 23 = **391**

## 2) Weather in Paris

I can't do this one, I'm afraid — I don't have access to a `get_weather` function (or any external tools/APIs) in this conversation, 
```
- first SSE payloads verbatim:

```text
{"id":"gen-1790156389-BoI42XnBmKkY6ICrMWFQ","object":"chat.completion.chunk","created":1790156389,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":"The","reasoning_details":[{"type":"reasoning.text","text":"The","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156389-BoI42XnBmKkY6ICrMWFQ","object":"chat.completion.chunk","created":1790156389,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":" user is","reasoning_details":[{"type":"reasoning.text","text":" user is","format":"unknown","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156389-BoI42XnBmKkY6ICrMWFQ","object":"chat.completion.chunk","created":1790156389,"model":"z-ai/glm-5.3","provider":"Together","system_fingerprint":"default","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":" asking for","reasoning_details":[{"type":"reasoning.text","text":" asking for","format":"unknown","index":0}]},"finish_reason":null,"native_fin
```

## Screenshots (Elvin testbed against this model)

![z-ai-glm-5-3--reasoning-off-tools-off.png](screenshots/z-ai-glm-5-3--reasoning-off-tools-off.png)
![z-ai-glm-5-3--reasoning-off-tools-on.png](screenshots/z-ai-glm-5-3--reasoning-off-tools-on.png)
![z-ai-glm-5-3--reasoning-on-tools-on.png](screenshots/z-ai-glm-5-3--reasoning-on-tools-on.png)
