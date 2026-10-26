#!/usr/bin/env node
/**
 * Cohere v2 Chat response/SSE -> OpenAI Chat Completions bicimi.
 *
 * Boylece iki ingress de mevcut cevirileri yeniden kullanir:
 *  - Anthropic ingress: cohereToOpenAiResponse -> fromOpenAiResponse,
 *    SSE: cohereEventToOpenAiChunks -> OpenAiStreamAdapter
 *  - OpenAI ingress: cohereToOpenAiResponse / chunk'lar dogrudan istemciye
 *
 * Cohere v2 yanit farkliliklari (docs/cohere/api-notes.md):
 *  - message.content BLOK LISTESIDIR: [{type:"text", text} | {type:"thinking", thinking}]
 *  - finish_reason: COMPLETE | STOP_SEQUENCE | MAX_TOKENS | TOOL_CALL | ERROR | TIMEOUT
 *  - usage: {billed_units: {input_tokens, output_tokens}, tokens: {input_tokens, output_tokens}}
 *  - SSE olaylari: message-start, content-start, content-delta, content-end,
 *    tool-plan-delta, tool-call-start, tool-call-delta, tool-call-end, message-end
 */

/** Cohere finish_reason -> OpenAI finish_reason. */
export function finishReasonFromCohere(reason) {
  switch (String(reason ?? '').toUpperCase()) {
    case 'MAX_TOKENS':
      return 'length';
    case 'TOOL_CALL':
      return 'tool_calls';
    case 'ERROR':
      return 'error';
    case 'TIMEOUT':
      return 'timeout';
    default:
      return 'stop'; // COMPLETE, STOP_SEQUENCE ve bilinmeyenler
  }
}

/** Cohere usage -> OpenAI usage (tokens yoksa billed_units'e duser). */
export function cohereUsage(usage) {
  const tokens = usage?.tokens ?? usage?.billed_units ?? {};
  return {
    prompt_tokens: tokens.input_tokens ?? 0,
    completion_tokens: tokens.output_tokens ?? 0,
  };
}

/** Cohere v2 non-stream yaniti -> OpenAI Chat Completions yaniti. */
export function cohereToOpenAiResponse(json, { model } = {}) {
  const message = json?.message ?? {};
  const blocks = Array.isArray(message.content) ? message.content : [];
  const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('');
  const reasoning =
    blocks.filter((b) => b?.type === 'thinking').map((b) => b.thinking ?? '').join('') ||
    (typeof message.tool_plan === 'string' ? message.tool_plan : '');
  const toolCalls = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    type: 'function',
    function: { name: call.function?.name, arguments: call.function?.arguments ?? '' },
  }));

  const openAiMessage = { role: 'assistant', content: text };
  if (reasoning) openAiMessage.reasoning = reasoning;
  if (toolCalls.length) openAiMessage.tool_calls = toolCalls;

  return {
    id: json?.id ?? null,
    object: 'chat.completion',
    model: model ?? json?.model ?? null,
    choices: [
      {
        index: 0,
        message: openAiMessage,
        finish_reason: finishReasonFromCohere(json?.finish_reason),
      },
    ],
 usage: cohereUsage(json?.usage),
  };
}

/**
 * Tek bir Cohere SSE olayini OpenAI chunk(lar)ina cevirir.
 * Saf fonksiyondur: iki ingress de bunun uzerine kendi yazma bicimini kurar.
 *
 * Wire bicimi (Fern uretimi; toleransli ayristirilir):
 *  {"type":"message-start","id":"...","delta":{...}}
 *  {"type":"content-delta","index":0,"delta":{"message":{"content":{"text":"..."}}}}
 *  {"type":"tool-plan-delta","delta":{"message":{"tool_plan":"..."}}}
 *  {"type":"tool-call-start","index":0,"delta":{"message":{"tool_calls":{"id":"...","type":"function","function":{"name":"...","arguments":""}}}}}
 *  {"type":"tool-call-delta","index":0,"delta":{"message":{"tool_calls":{"function":{"arguments":"..."}}}}}
 *  {"type":"message-end","delta":{"finish_reason":"COMPLETE","usage":{...}}}
 *  (message-end bazen tam yaniti "delta.response" icinde de tasir.)
 *
 * @returns {object[]} sifir veya daha fazla OpenAI biciminde chunk
 */
export function cohereEventToOpenAiChunks(event, { model } = {}) {
  if (!event || typeof event !== 'object') return [];
  const delta = event.delta ?? {};
  const chunks = [];
  const push = (choiceDelta, finishReason = null, usage = null) => {
    const chunk = {
      id: event.id ?? event.delta?.id ?? event.delta?.message?.id ?? null,
      object: 'chat.completion.chunk',
      model: model ?? null,
      choices: [{ index: 0, delta: choiceDelta, finish_reason: finishReason }],
    };
    if (usage) chunk.usage = usage;
    chunks.push(chunk);
  };

  switch (event.type) {
    case 'message-start':
      push({ role: 'assistant', content: '' });
      break;

    case 'content-delta': {
      const content = delta.message?.content ?? delta.content ?? {};
      if (typeof content.text === 'string' && content.text) push({ content: content.text });
      if (typeof content.thinking === 'string' && content.thinking) push({ reasoning: content.thinking });
      break;
    }

    case 'tool-plan-delta': {
      const plan = delta.message?.tool_plan ?? delta.tool_plan ?? '';
      if (plan) push({ reasoning: plan });
      break;
    }

    case 'tool-call-start': {
      const call = delta.message?.tool_calls ?? delta.tool_calls ?? {};
      push({
        tool_calls: [
          {
            index: event.index ?? 0,
            id: call.id ?? `call_${Math.random().toString(36).slice(2, 12)}`,
            type: 'function',
            function: { name: call.function?.name ?? 'unknown_tool', arguments: call.function?.arguments ?? '' },
          },
        ],
      });
      break;
    }

    case 'tool-call-delta': {
      const call = delta.message?.tool_calls ?? delta.tool_calls ?? {};
      const args = call.function?.arguments ?? '';
      if (args) {
        push({ tool_calls: [{ index: event.index ?? 0, function: { arguments: args } }] });
      }
      break;
    }

    case 'message-end': {
      const source = delta.usage ?? delta.response?.usage ?? event.usage ?? null;
      const finish = delta.finish_reason ?? delta.response?.finish_reason ?? null;
      push({}, finishReasonFromCohere(finish), source ? cohereUsage(source) : null);
      break;
    }

    default:
      break; // content-start, content-end, tool-call-end, citation-* vb. bilgi tasimaz
  }
  return chunks;
}
