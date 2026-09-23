# anthropic/claude-sonnet-5

Probe of OpenRouter `anthropic/claude-sonnet-5` — reasoning and tool-calling, each toggled independently.

- Generated: 2026-09-23T09:38:27.659Z
- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions` (streaming, `max_tokens: 2000`)
- Prompt: `Two things, please: (1) work out 17*23 step by step, and (2) call get_weather with city="Paris" for the current weather there. Show your working for the arithmetic.`
- Tool: `get_weather` (`type: "function"`, JSON Schema params, `tool_choice: "auto"`)

## Model metadata (from `GET /api/v1/models`)

```json
{
  "id": "anthropic/claude-sonnet-5",
  "name": "Anthropic: Claude Sonnet 5",
  "context_length": 1000000,
  "supported_parameters": [
    "include_reasoning",
    "max_completion_tokens",
    "max_tokens",
    "reasoning",
    "reasoning_effort",
    "response_format",
    "stop",
    "structured_outputs",
    "tool_choice",
    "tools",
    "verbosity"
  ],
  "reasoning": {
    "mandatory": false,
    "default_enabled": true,
    "supported_efforts": [
      "max",
      "xhigh",
      "high",
      "medium",
      "low"
    ],
    "default_effort": "high"
  }
}
```

- declares `tools`: **true**
- declares `reasoning`: **true**

## Matrix

| reasoning | tools | HTTP | mode | reasoning? | kind | reasoning field | tool call? | args type | finish |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| on | on | 200 | stream | yes (190 chars) | reasoning.text | delta.reasoning, delta.reasoning_details[].type|text|format|index, delta.reasoning_details[].type|signature|format|index | yes (get_weather) | string(JSON) | tool_calls |
| on | off | 200 | stream | yes (472 chars) | reasoning.text | delta.reasoning, delta.reasoning_details[].type|text|format|index, delta.reasoning_details[].type|signature|format|index | no | - | stop |
| off | on | 200 | stream | no | - | - | yes (get_weather) | string(JSON) | tool_calls |
| off | off | 200 | stream | no | - | - | no | - | stop |

## Toggle behaviour

- reasoning on → produced reasoning: **true**; off → produced reasoning: **false**
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
choices[].delta.reasoning_details[].signature
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

- HTTP 200 in 3696ms, content-type `text/event-stream`, 13 SSE lines
- reasoning captured:

```text
1717 times 23 breaks down to 17*20 plus 17*3, giving 340+51=391. Now I need to fetch the weather. times 23 breaks down to 17*20 plus 17*3, giving 340+51=391. Now I need to fetch the weather.
```
- tool calls:

```json
[
  {
    "id": "toolu_013sKRz8e9TVLQt7da2WrdrU",
    "name": "get_weather",
    "arguments": "{\"city\": \"Paris\"}",
    "argumentsType": "string(JSON)"
  }
]
```
- content:

```text
**Part 1: 17 × 23**

Breaking it down:
- 17 × 23 = 17 × (20 + 3)
- 17 × 20 = 340
- 17 × 3 = 51
- 340 + 51 = **391**

**Part 2: Weather in Paris**

Let me fetch that for you now.
```
- first SSE payloads verbatim:

```text
{"id":"gen-1790156286-4eADAGxLoHpnQcfAqIjD","object":"chat.completion.chunk","created":1790156286,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":"17","reasoning_details":[{"type":"reasoning.text","text":"17","format":"anthropic-claude-v1","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156286-4eADAGxLoHpnQcfAqIjD","object":"chat.completion.chunk","created":1790156286,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":" times 23 breaks down to 17*20 plus 17*3, giving 340+51=391. Now I need to fetch the weather.","reasoning_details":[{"type":"reasoning.text","text":" times 23 breaks down to 17*20 plus 17*3, giving 340+51=391. Now I need to fetch the weather.","format":"anthropic-claude-v1","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156286-4eADAGxLoHpnQcfAqIjD","object":"chat.completion.chunk","created":1790156286,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content"
```

### reasoning=on tools=off

- HTTP 200 in 7756ms, content-type `text/event-stream`, 15 SSE lines
- reasoning captured:

```text
II need to hand need to handle two parts: solving 17*23 manually, which breaks down to 340+51=391, and addressing the get_wele two parts: solving 17*23 manually, which breaks down to 340+51=391, and addressing the get_weather request even though no such tool is actually available to me in this context, so I'll need to clarify that limitation.ather request even though no such tool is actually available to me in this context, so I'll need to clarify that limitation.




```
- content:

```text
## (1) Arithmetic: 17 × 23

I'll break 23 into 20 + 3 to make the multiplication easier:

1. **17 × 20** = 340
2. **17 × 3** = 51
3. **Add the results:** 340 + 51 = **391**

So, **17 × 23 = 391**

*(Quick check via a different split: 17 × 23 = (17×25) − (17×2) = 425 − 34 = 391 ✓)*

## (2) get_weather(city="Paris")

I'm not able to actually call a `get_weather` function here — no such tool has been
```
- first SSE payloads verbatim:

```text
{"id":"gen-1790156290-k708XLf4eTqLvtkzSsrT","object":"chat.completion.chunk","created":1790156290,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":"I","reasoning_details":[{"type":"reasoning.text","text":"I","format":"anthropic-claude-v1","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156290-k708XLf4eTqLvtkzSsrT","object":"chat.completion.chunk","created":1790156290,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":" need to hand","reasoning_details":[{"type":"reasoning.text","text":" need to hand","format":"anthropic-claude-v1","index":0}]},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156290-k708XLf4eTqLvtkzSsrT","object":"chat.completion.chunk","created":1790156290,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":"le two parts: solving 17*23 manually, which breaks down to 340+51=391, and addressing the get_we","reasoning_details":[{"type"
```

### reasoning=off tools=on

- HTTP 200 in 3935ms, content-type `text/event-stream`, 11 SSE lines
- tool calls:

```json
[
  {
    "id": "toolu_01Wv86M8Q3NG1QkvuNMCWxbR",
    "name": "get_weather",
    "arguments": "{\"city\": \"Paris\"}",
    "argumentsType": "string(JSON)"
  }
]
```
- content:

```text
I'll handle both tasks for you.

**Task 1: Calculating 17 × 23 step by step**

I'll break this down using the distributive method:

17 × 23 = 17 × (20 + 3)
= (17 × 20) + (17 × 3)
= 340 + 51
= 391

Let me verify this another way:
17 × 23 = (20 - 3) × 23
= (20 × 23) - (3 × 23)
= 460 - 69
= 391

Both methods confirm: **17 × 23 = 391**

**Task 2: Getting the weather for Paris**
```
- first SSE payloads verbatim:

```text
{"id":"gen-1790156298-gtQyEJhjeDKm1S3TNT13","object":"chat.completion.chunk","created":1790156298,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":"I","role":"assistant"},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156298-gtQyEJhjeDKm1S3TNT13","object":"chat.completion.chunk","created":1790156298,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":"'ll handle both tasks for you.\n\n**Task 1: Calculating 17 × 23 step by step**\n\nI'll break this down using the distributive method:\n\n17 × 23 = 17 × (20 ","role":"assistant"},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156298-gtQyEJhjeDKm1S3TNT13","object":"chat.completion.chunk","created":1790156298,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":"+ 3)\n= (17 × 20) + (17 × 3)\n= 340 + 51\n= 391\n\nLet me verify this another way:\n17 × 23 = (20 - 3) × 23\n= (20 × 23) - (3 × 23)","role":"assistant"},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156298-gtQyEJhjeDKm1S3TNT13","object":"
```

### reasoning=off tools=off

- HTTP 200 in 5790ms, content-type `text/event-stream`, 12 SSE lines
- content:

```text
# Part 1: Calculating 17 × 23

I'll break this down using the distributive method (expanding 23 as 20 + 3):

**Step 1:** Split 23 into 20 + 3

**Step 2:** Multiply 17 × 20
- 17 × 20 = 340

**Step 3:** Multiply 17 × 3
- 17 × 3 = 51

**Step 4:** Add the results
- 340 + 51 = 391

**Answer: 17 × 23 = 391**

*Quick check using a different split:* 17 × 23 = (17 × 25) − (17 × 2) = 425 − 34 = 391 ✓

---


```
- first SSE payloads verbatim:

```text
{"id":"gen-1790156301-NLXGAklUEVnRK0cBdD9R","object":"chat.completion.chunk","created":1790156301,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":"#","role":"assistant"},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156301-NLXGAklUEVnRK0cBdD9R","object":"chat.completion.chunk","created":1790156301,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":" Part 1: Calculating 17 × 23\n\nI'll break this down using the distributive method (expanding 23 as 20 + 3):\n\n**Step 1:** Split 23 into 20 + 3","role":"assistant"},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156301-NLXGAklUEVnRK0cBdD9R","object":"chat.completion.chunk","created":1790156301,"model":"anthropic/claude-sonnet-5","provider":"Claude Platform on AWS","choices":[{"index":0,"delta":{"content":"\n\n**Step 2:** Multiply 17 × 20\n- 17 × 20 = 340\n\n**Step 3:** Multiply 17 × 3\n- 17 × 3 = 51\n\n**Step 4:** Add the results\n- 340 + 51 = ","role":"assistant"},"finish_reason":null,"native_finish_reason":null}]}
{"id":"gen-1790156301-NLXGAklUEVnRK0cBdD9R","object":"ch
```

## Screenshots (Elvin testbed against this model)

![anthropic-claude-sonnet-5--reasoning-off-tools-on.png](screenshots/anthropic-claude-sonnet-5--reasoning-off-tools-on.png)
![anthropic-claude-sonnet-5--reasoning-on-tools-on.png](screenshots/anthropic-claude-sonnet-5--reasoning-on-tools-on.png)
