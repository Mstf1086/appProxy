import { UpstreamError } from '../errors.mjs';
import { anthropicAuthHeaders, readJsonLoose, readSseEvents, upstreamFetch } from '../http.mjs';
import { AnthropicStream, buildMessage } from '../sse.mjs';

export async function handleGeminiProvider(ctx) {
  const { providerCfg, request, meta, res, log, signal, sendJsonResponse } = ctx;
  const apiKey = ctx.apiKey;
  const wantsStream = Boolean(request.stream);
  const { toGeminiRequest } = await import('../translate/gemini-out.mjs');
  const body = toGeminiRequest(request, { systemText: meta.systemText });
  const model = request.model;
  const action = wantsStream ? 'streamGenerateContent' : 'generateContent';
  const url = `${providerCfg.baseUrl.replace(/\/$/, '')}/${providerCfg.apiVersion}/models/${encodeURIComponent(model)}:${action}${wantsStream ? '?alt=sse' : ''}`;
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
  const response = await upstreamFetch(url, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: providerCfg.upstreamTimeoutMs ?? ctx.server.upstreamTimeoutMs, signal });
  if (!response.ok) {
    const json = await readJsonLoose(response);
    throw new UpstreamError(json?.error?.message ?? 'gemini error', { status: response.status, body: JSON.stringify(json) });
  }
  if (!wantsStream) {
    const json = await readJsonLoose(response);
    const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') ?? '';
    sendJsonResponse(200, buildMessage({ model: meta.requestedModel ?? request.model, content: [{ type: 'text', text }], stopReason: 'end_turn', usage: { input_tokens: json?.usageMetadata?.promptTokenCount ?? 0, output_tokens: json?.usageMetadata?.candidatesTokenCount ?? 0 } }));
    return;
  }
  const stream = new AnthropicStream(res, { headers: {} });
  stream.writeHead();
  stream.messageStart({ model: meta.requestedModel ?? request.model, inputTokens: 0 });
  const idx = stream.startText();
  for await (const ev of readSseEvents(response)) {
    try {
      const j = JSON.parse(ev.data);
      const t = j?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('');
      if (t) stream.textDelta(idx, t);
    } catch {}
  }
  stream.stopBlock(idx);
  stream.finish({ stopReason: 'end_turn' });
  stream.end();
}
