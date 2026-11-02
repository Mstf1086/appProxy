/**
 * Model-not-found fallback.
 *
 * Claude Code reports ANY upstream 404 as "There's an issue with the selected
 * model", and it asks for several models (main, haiku/background, subagent).
 * When the upstream cannot serve the requested model (404/410, or a 400-style
 * "model ..." error) the proxy retries the request with other models of the
 * same provider instead of failing: defaultModel, fastModel, then the presets
 * from config/models.json. Every attempt is logged (model.fallback).
 */

const MAX_FALLBACK_ATTEMPTS = 3;

/** True when the error looks like "the upstream cannot serve this model". */
export function isModelNotFound(error) {
  if (!error) return false;
  const status = Number(error.status);
  if (status === 404 || status === 410) return true;
  if (status === 400 || status === 403 || status === 422) {
    const message = String(error.message ?? '');
    return /model/i.test(message) && /not.?found|does not exist|no access|unavailable|end.?of.?life|gone|invalid|unknown|unsupported/i.test(message);
  }
  return false;
}

/** Ordered, de-duplicated fallback candidates for a failed model. */
export function fallbackCandidates(failedModel, providerCfg, presets = []) {
  const ids = [providerCfg?.defaultModel, providerCfg?.fastModel, ...presets.map((p) => p?.id)].filter(Boolean);
  return [...new Set(ids)].filter((id) => id !== failedModel);
}

/** First fallback candidate, or null (kept for callers that want a single model). */
export function fallbackModelFor(failedModel, providerCfg, presets = []) {
  return fallbackCandidates(failedModel, providerCfg, presets)[0] ?? null;
}

/**
 * Run `attempt()`; on a model-not-found error before any response bytes were
 * sent, switch ctx.request.model / ctx.meta.model to the next candidate and retry
 * (at most MAX_FALLBACK_ATTEMPTS times). If every candidate fails the ORIGINAL
 * error is thrown, so the log and the client see the real first failure.
 */
export async function withModelFallback(ctx, attempt) {
  try {
    return await attempt();
  } catch (firstError) {
    const { res, request, meta, providerCfg, log } = ctx;
    if (res?.headersSent || !isModelNotFound(firstError)) throw firstError;
    const tried = new Set([request.model]);
    const candidates = fallbackCandidates(request.model, providerCfg, ctx.fallbackPresets ?? []).slice(0, MAX_FALLBACK_ATTEMPTS);
    let lastError = firstError;
    for (const next of candidates) {
      if (tried.has(next)) continue;
      tried.add(next);
      log?.warn?.('model.fallback', {
        provider: providerCfg?.name,
        from: request.model,
        to: next,
        status: lastError.status,
        reason: String(lastError.message ?? '').slice(0, 200),
      });
      request.model = next;
      if (meta) meta.model = next;
      try {
        return await attempt();
      } catch (error) {
        if (res?.headersSent || !isModelNotFound(error)) throw error;
        lastError = error;
      }
    }
    log?.error?.('model.fallback.exhausted', {
      provider: providerCfg?.name,
      tried: [...tried],
      status: firstError.status,
      message: String(firstError.message ?? '').slice(0, 300),
    });
    throw firstError;
  }
}
