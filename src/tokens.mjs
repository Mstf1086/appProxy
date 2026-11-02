/**
 * Very rough token estimate (chars / 4).
 *
 * Used by POST /v1/messages/count_tokens and by the streaming path, where the
 * upstream only reports `prompt_tokens` in its final chunk — long after
 * `message_start` has to be sent. An estimate beats the 0 we used to report,
 * because Claude Code sizes its context window from that number.
 */

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/** CJK text packs far more information per character, so it needs ~1 token/char. */
export function estimateTokens(text = '') {
  const value = typeof text === 'string' ? text : JSON.stringify(text ?? '');
  if (!value) return 0;
  const wide = (value.match(new RegExp(CJK, 'g')) ?? []).length;
  const narrow = value.length - wide;
  return Math.max(1, Math.ceil(wide + narrow / 4));
}

/** Estimate for an Anthropic Messages request body (system + messages + tools). */
export function estimateRequestTokens(body = {}) {
  return estimateTokens(JSON.stringify({ system: body.system, messages: body.messages, tools: body.tools }));
}
