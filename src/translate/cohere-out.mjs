#!/usr/bin/env node
/**
 * OpenAI / Anthropic Chat request -> Cohere v2 Chat request.
 *
 * Cohere v2 (docs.cohere.com/reference/chat) OpenAI Chat Completions ile aynı
 * mesaj/araç şemasını kullanir (roles: user|assistant|system|tool, tool_calls,
 * role:"tool" + tool_call_id); farkliliklar:
 *  - POST {baseUrl}/v2/chat (chat/completions degil)
 *  - tool_choice yalnizca "REQUIRED" | "NONE" (auto = gönderilmez)
 *  - top_p -> p, stop -> stop_sequences
 *  - stream_options / parallel_tool_calls yok (kullanilmiyor)
 *
 * Kaynak: docs/cohere/api-notes.md
 */
import { toOpenAiRequest } from './openai-out.mjs';

/** Cohere chat URL: {baseUrl}/v2/chat. */
export function cohereChatUrl(providerCfg) {
  const base = String(providerCfg.baseUrl ?? '').replace(/\/$/, '');
  return `${base}/v2/chat`;
}

/** Cohere model listesi URL (GET, bearer auth; sayfalama page_size ile). */
export function cohereModelsUrl(providerCfg) {
  const base = String(providerCfg.baseUrl ?? '').replace(/\/$/, '');
  return `${base}/v1/models?page_size=1000`;
}

/**
 * OpenAI tool_choice -> Cohere tool_choice.
 * Cohere yalnizca "REQUIRED" ve "NONE" kabul eder; "auto" = alan gönderilmez.
 */
export function toCohereToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === 'string') {
    if (toolChoice === 'required' || toolChoice === 'any') return 'REQUIRED';
    if (toolChoice === 'none') return 'NONE';
    return undefined;
  }
  // Belirli bir tool zorlaniyorsa en yakin esdeger REQUIRED.
  return 'REQUIRED';
}

/**
 * Mesaj seviyesinde kucuk duzeltmeler:
 *  - assistant: bos metin icerigi Cohere'ye bos string yerine hic gonderilmez
 *    (AssistantMessageV2Content opsiyoneldir; tool_calls tek basina yeterli)
 */
function cohereMessage(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.role === 'assistant') {
    const out = { role: 'assistant' };
    if (typeof message.content === 'string' && message.content.length) out.content = message.content;
    else if (Array.isArray(message.content) && message.content.length) out.content = message.content;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) out.tool_calls = message.tool_calls;
    if (!out.content && !out.tool_calls) return null;
    return out;
  }
  return message;
}

/**
 * OpenAI Chat Completions gövdesi -> Cohere v2 gövdesi.
 * @param {object} body OpenAI biciminde istek (ingress'ten, model eslemesi yapilmis)
 */
export function toCohereFromOpenAi(body, { providerCfg = {}, stream = false } = {}) {
  const out = { model: body.model };
  out.messages = (body.messages ?? []).map(cohereMessage).filter(Boolean);
  out.stream = Boolean(stream);

  if (body.max_tokens !== undefined) out.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) out.temperature = body.temperature;
  if (body.top_p !== undefined) out.p = body.top_p; // Cohere: p (top-p)
  if (typeof body.stop === 'string' && body.stop) out.stop_sequences = [body.stop];
  else if (Array.isArray(body.stop) && body.stop.length) out.stop_sequences = body.stop;
  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools.filter((tool) => tool?.type === 'function');
  }
  const toolChoice = toCohereToolChoice(body.tool_choice);
  if (toolChoice) out.tool_choice = toolChoice;
  if (body.seed !== undefined) out.seed = body.seed;
  if (body.frequency_penalty !== undefined) out.frequency_penalty = body.frequency_penalty;
  if (body.presence_penalty !== undefined) out.presence_penalty = body.presence_penalty;
  if (body.response_format?.type === 'json_object') {
    out.response_format = body.response_format.json_schema
      ? { type: 'json_object', json_schema: body.response_format.json_schema }
      : { type: 'json_object' };
  }
  if (providerCfg.safetyMode) out.safety_mode = providerCfg.safetyMode;
  return out;
}

/**
 * Anthropic Messages istegi -> Cohere v2 gövdesi (toOpenAiRequest uzerinden).
 * @returns {{body: object, droppedBlocks: string[]}}
 */
export function toCohereRequest(request, { systemText = '', providerCfg = {}, stream = false } = {}) {
  const { body, droppedBlocks } = toOpenAiRequest(request, { systemText, providerCfg, stream });
  return { body: toCohereFromOpenAi(body, { providerCfg, stream }), droppedBlocks };
}
