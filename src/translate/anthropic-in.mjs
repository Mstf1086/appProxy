/**
 * Inbound request normalization.
 *
 * Claude Code sends the full Anthropic Messages request — including fields that
 * only Anthropic (or its cloud endpoints) accept, such as adaptive reasoning,
 * `output_config.effort`, context management, prompt-cache breakpoints and
 * tool-search blocks. Non-Anthropic upstreams reject those, so the proxy drops or
 * rewrites them here.
 *
 * Source: docs/anthropic/claude-code/llm-gateway-protocol.md → "Feature pass-through"
 * and "Requests and defaults by connection method".
 */

export const DROPPED_TOP_LEVEL_FIELDS = [
  'cache_control',
  'container',
  'context_management',
  'mcp_servers',
  'metadata',
  'service_tier',
  'speed',
  'output_config',
  'betas',
  'safeguards',
];

const BLOCK_TYPES_TO_DROP = new Set([
  'tool_reference',
  'tool_search_tool_result',
  'tool_search_tool_result_error',
  'server_tool_use',
  'web_search_tool_result',
  'redacted_thinking',
  'fallback',
]);

export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
}

/** Map a requested model ID (Claude alias/ID or provider ID) to the upstream model. */
export function resolveModel(requested, rules = {}, fallback = undefined) {
  const model = requested || '';
  const passthroughPrefixes = rules.passthroughPrefixes ?? [];
  if (model && passthroughPrefixes.some((prefix) => model.toLowerCase().startsWith(prefix.toLowerCase()))) {
    return { model, matched: 'passthrough' };
  }
  for (const rule of rules.rules ?? []) {
    if (globToRegExp(rule.match).test(model)) {
      // A bare "*" catch-all must not silently swap vendor-prefixed upstream ids
      // (e.g. "z-ai/glm-5.3", "meta/llama-3.2-90b-vision-instruct"): those are real
      // provider model ids the client picked from the live model list. Forward them
      // unchanged; if the upstream cannot serve them it returns a clear 4xx error.
      // Explicit patterns ("*haiku*", "*sonnet*", ...) still remap as before, and
      // alias-style ids without "/" (claude-sonnet-5.5, ...) still hit the catch-all.
      if (rule.match === '*' && model.includes('/')) {
        return { model, matched: 'passthrough' };
      }
      return { model: rule.model ?? fallback ?? model, matched: rule.match };
    }
  }
  return { model: fallback ?? model, matched: 'fallback' };
}

export function stripCacheControl(value) {
  if (Array.isArray(value)) return value.map(stripCacheControl);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (['cache_control', 'defer_loading', 'eager_input_streaming'].includes(key)) continue;
      if (['allowed_callers', 'input_examples', 'strict'].includes(key)) continue;
      out[key] = stripCacheControl(item);
    }
    return out;
  }
  return value;
}

function blockText(block) {
  if (typeof block === 'string') return block;
  if (block?.type === 'text') return block.text ?? '';
  return '';
}

/** Flatten the `system` field (string | blocks) to plain text pieces. */
export function systemTextOf(body) {
  const pieces = [];
  const system = body?.system;
  if (typeof system === 'string') {
    pieces.push(system);
  } else if (Array.isArray(system)) {
    for (const block of system) {
      const text = blockText(block);
      if (text) pieces.push(text);
    }
  }
  return pieces;
}
/**
 * Extract mid-conversation `role: "system"` messages (Claude Code sends these when
 * routing through a custom base URL). Providers other than Anthropic have no such
 * concept, so they are hoisted into the system instruction.
 */
export function hoistSystemMessages(messages = []) {
  const hoisted = [];
  const kept = [];
  for (const message of messages) {
    if (message?.role === 'system') {
      let text = '';
      if (typeof message.content === 'string') text = message.content;
      else if (Array.isArray(message.content)) text = message.content.map(blockText).filter(Boolean).join('\n');
      if (text) hoisted.push(text);
      continue;
    }
    kept.push(message);
  }
  return { messages: kept, hoisted };
}

/** Remove blocks an upstream cannot use, keeping the rest of the message list intact. */
export function cleanMessages(messages = [], { dropThinking = false } = {}) {
  const dropped = [];
  const out = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    const content = [];
    for (const block of message.content) {
      const type = block?.type;
      if (BLOCK_TYPES_TO_DROP.has(type) || (dropThinking && type === 'thinking')) {
        dropped.push(type);
        continue;
      }
      content.push(stripCacheControl(block));
    }
    if (content.length === 0) dropped.push(`empty:${message.role}`);
    else out.push({ role: message.role, content });
  }
  return { messages: out, dropped };
}

/**
 * Normalize an inbound Anthropic Messages request for one provider.
 *
 * @returns {{request: object, meta: object}} normalized request + audit metadata
 */
export function normalizeRequest(body, { provider, providerCfg = {}, modelRules = {}, dropThinking = false } = {}) {
  const meta = { provider, dropped: [], requestedModel: body?.model ?? null };
  const request = { ...body };

  for (const field of DROPPED_TOP_LEVEL_FIELDS) {
    if (request[field] !== undefined) {
      delete request[field];
      meta.dropped.push(field);
    }
  }
  if (providerCfg.maxOutputTokens && Number(request.max_tokens) > providerCfg.maxOutputTokens) {
    meta.clampedMaxTokens = { from: request.max_tokens, to: providerCfg.maxOutputTokens };
    request.max_tokens = providerCfg.maxOutputTokens;
  }
  if (!request.max_tokens) request.max_tokens = 8192;

  const { model, matched } = resolveModel(body?.model, modelRules, providerCfg.defaultModel);
  meta.model = model;
  meta.modelMatchedBy = matched;
  request.model = model;

  const { messages, hoisted } = hoistSystemMessages(request.messages ?? []);
  const cleaned = cleanMessages(messages, { dropThinking });
  meta.dropped.push(...cleaned.dropped);
  request.messages = cleaned.messages;

  const systemPieces = systemTextOf(body);
  if (hoisted.length) systemPieces.push(...hoisted);
  meta.systemText = systemPieces.join('\n\n');

  if (Array.isArray(request.tools)) request.tools = stripCacheControl(request.tools);
  if (request.thinking) meta.thinking = request.thinking;
  return { request, meta };
}

