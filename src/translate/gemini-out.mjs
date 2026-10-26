export function toGeminiRequest(request, { systemText = '' } = {}) {
  const contents = [];
  for (const m of request.messages ?? []) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) text = m.content.map(b => b?.text ?? '').filter(Boolean).join('\n');
    contents.push({ role, parts: [{ text }] });
  }
  const body = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  if (request.max_tokens) body.generationConfig = { maxOutputTokens: request.max_tokens };
  if (request.temperature !== undefined) { body.generationConfig = body.generationConfig || {}; body.generationConfig.temperature = request.temperature; }
  return body;
}