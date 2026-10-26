/**
 * OpenAI Chat Completions response → Anthropic Messages response/events.
 *
 * Anthropic stop reasons: end_turn | max_tokens | stop_sequence | tool_use | refusal
 * SSE event order: docs/anthropic/api/streaming.md
 */

export function stopReasonFromFinish(finishReason) {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return finishReason ? 'end_turn' : 'end_turn';
  }
}

/** Non-streaming: OpenAI message → Anthropic content blocks + usage. */
export function fromOpenAiResponse(json, { requestedModel } = {}) {
  const choice = json?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const content = [];

  const reasoning = message.reasoning_content ?? message.reasoning;
  if (typeof reasoning === 'string' && reasoning.length) {
    content.push({ type: 'thinking', thinking: reasoning, signature: '' });
  }
  if (typeof message.content === 'string' && message.content.length) {
    content.push({ type: 'text', text: message.content });
  }
  for (const call of message.tool_calls ?? []) {
    content.push({
      type: 'tool_use',
      id: call.id ?? `toolu_${Math.random().toString(36).slice(2, 12)}`,
      name: call.function?.name ?? 'unknown_tool',
      input: parseToolArguments(call.function?.arguments),
    });
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });

  const usage = json?.usage ?? {};
  return {
    content,
    stopReason: stopReasonFromFinish(choice.finish_reason),
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
    model: requestedModel ?? json?.model,
    upstreamId: json?.id,
  };
}

export function parseToolArguments(raw) {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: String(raw) };
  }
}

/**
 * Streaming adapter: consumes OpenAI SSE payloads (`data: {...}` / `[DONE]`) and
 * drives an AnthropicStream (src/sse.mjs).
 */
export class OpenAiStreamAdapter {
  constructor(stream, { requestedModel, upstreamModel, mapReasoning = true } = {}) {
    this.stream = stream;
    this.requestedModel = requestedModel;
    this.upstreamModel = upstreamModel;
    this.mapReasoning = mapReasoning;
    this.started = false;
    this.textIndex = null;
    this.thinkingIndex = null;
    this.toolByOpenAiIndex = new Map();
    this.finishReason = null;
    this.usage = { output_tokens: 0 };
    this.messageId = null;
  }

  ensureStarted(chunk) {
    if (this.started) return;
    this.started = true;
    this.messageId = chunk?.id ?? null;
    this.stream.messageStart({
      id: chunk?.id,
      model: this.requestedModel ?? chunk?.model ?? this.upstreamModel,
      inputTokens: chunk?.usage?.prompt_tokens ?? 0,
    });
  }

  feed(chunk) {
    if (!chunk || typeof chunk !== 'object') return;
    this.ensureStarted(chunk);

    if (chunk.usage) {
      this.usage = {
        input_tokens: chunk.usage.prompt_tokens ?? this.usage.input_tokens ?? 0,
        output_tokens: chunk.usage.completion_tokens ?? this.usage.output_tokens ?? 0,
      };
    }

    const choice = chunk.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};

    const reasoning = this.mapReasoning ? (delta.reasoning_content ?? delta.reasoning) : undefined;
    if (typeof reasoning === 'string' && reasoning.length) {
      if (this.thinkingIndex === null) this.thinkingIndex = this.stream.startThinking();
      this.stream.thinkingDelta(this.thinkingIndex, reasoning);
    }

    if (typeof delta.content === 'string' && delta.content.length) {
      if (this.thinkingIndex !== null) this.stream.stopBlock(this.thinkingIndex);
      if (this.textIndex === null) this.textIndex = this.stream.startText();
      this.stream.textDelta(this.textIndex, delta.content);
    }

    for (const call of delta.tool_calls ?? []) {
      const key = call.index ?? 0;
      let entry = this.toolByOpenAiIndex.get(key);
      if (!entry) {
        entry = {
          index: this.stream.startToolUse({
            id: call.id ?? `toolu_${Math.random().toString(36).slice(2, 12)}`,
            name: call.function?.name ?? 'unknown_tool',
          }),
          emittedName: call.function?.name ?? null,
        };
        this.toolByOpenAiIndex.set(key, entry);
      }
      const args = call.function?.arguments;
      if (typeof args === 'string' && args.length) this.stream.inputJsonDelta(entry.index, args);
    }

    if (choice.finish_reason) this.finishReason = choice.finish_reason;
  }

  done() {
    if (!this.started) {
      // Upstream produced no chunks at all: still emit a valid empty message.
      this.stream.messageStart({ model: this.requestedModel ?? this.upstreamModel });
    }
    for (const entry of this.toolByOpenAiIndex.values()) this.stream.stopBlock(entry.index);
    if (this.thinkingIndex !== null) this.stream.stopBlock(this.thinkingIndex);
    if (this.textIndex !== null) this.stream.stopBlock(this.textIndex);
    this.stream.finish({
      stopReason: stopReasonFromFinish(this.finishReason ?? (this.toolByOpenAiIndex.size ? 'tool_calls' : 'stop')),
      outputTokens: this.usage.output_tokens,
    });
  }
}

/** Parse one SSE `data:` payload. Returns null for keep-alive comments. */
export function parseSseData(line) {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload) return null;
  if (payload === '[DONE]') return { done: true };
  try {
    return { json: JSON.parse(payload) };
  } catch {
    return null;
  }
}
