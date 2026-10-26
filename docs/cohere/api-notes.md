# Cohere v2 API Notlari (appProxy `kind: cohere`)

Kaynaklar (docs.cohere.com, 2026-10 erisim):

- Chat: https://docs.cohere.com/reference/chat — `POST https://api.cohere.com/v2/chat`
- Streaming: https://docs.cohere.com/v2/docs/streaming
- Model listesi: https://docs.cohere.com/reference/list-models — `GET /v1/models?page_size=1000`
- Kimlik: `Authorization: bearer <CO_API_KEY>`

## Istek (v2 chat)

- Mesaj rolleri: `user | assistant | system | tool` — OpenAI bicimiyle ayni sema:
  - `assistant`: `content` (string | blok listesi) + `tool_calls: [{id, type: "function", function: {name, arguments: <string>}}]`
  - `tool`: `{role: "tool", tool_call_id, content}` (JSON object string)
- `tools`: OpenAI bicimi `[{type: "function", function: {name, description, parameters}}]`
- `tool_choice`: yalnizca `"REQUIRED" | "NONE"` (gonderilmezse auto)
- `stop -> stop_sequences`, `top_p -> p`, `max_tokens`, `temperature`, `seed`,
  `frequency_penalty`, `presence_penalty`, `response_format {type: "json_object"}`
- `stream_options` / `parallel_tool_calls` / `n` yoktur (proxy bunlari dusurur)

## Non-stream yanit

```json
{
  "id": "...",
  "finish_reason": "COMPLETE | STOP_SEQUENCE | MAX_TOKENS | TOOL_CALL | ERROR | TIMEOUT",
  "message": {
    "role": "assistant",
    "content": [{"type": "text", "text": "..."}, {"type": "thinking", "thinking": "..."}],
    "tool_calls": [{"id": "...", "type": "function", "function": {"name": "...", "arguments": "{...}"}}]
  },
  "usage": {
    "billed_units": {"input_tokens": 127, "output_tokens": 69},
    "tokens": {"input_tokens": 1032, "output_tokens": 124}
  }
}
```

`message.content` OpenAI'nin string biciminin aksine BLOK LISTESIDIR.

## SSE olaylari (v2 chat, stream: true)

Her olay `data: {json}

` biciminde; `type` alanina gore ayristirilir:

- `{"type":"message-start","id":"..."}`
- `{"type":"content-delta","index":0,"delta":{"message":{"content":{"text":"..."}}}}`
  (thinking icin `content.thinking` degeri de olabilir)
- `{"type":"tool-plan-delta","delta":{"message":{"tool_plan":"..."}}}`
- `{"type":"tool-call-start","index":0,"delta":{"message":{"tool_calls":{"id":"...","type":"function","function":{"name":"...","arguments":""}}}}}`
- `{"type":"tool-call-delta","index":0,"delta":{"message":{"tool_calls":{"function":{"arguments":"..."}}}}}`
- `{"type":"message-end","delta":{"finish_reason":"COMPLETE","usage":{...}}}`
  (bazen tum yanit `delta.response` icinde de tasinabilir)
- `content-start`, `content-end`, `tool-call-end`, `citation-*`: bilgi tasimaz

## Model listesi

`GET /v1/models?page_size=1000` -> `{"models": [{"name": "command-a-plus-05-2026", "endpoints": ["chat"], ...}], "next_page_token": "..."}`
- Sayfalamalidir; default 20. Proxy `page_size=1000` ister.
- Proxy yalnizca `endpoints` icinde `chat` bulunan modelleri listeler.
