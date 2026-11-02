/**
 * Model-not-found fallback.
 *
 * Claude Code asks for a "fast" model (ANTHROPIC_SMALL_FAST_MODEL, e.g. the
 * nvidia fastModel "z-ai/glm-5.3-flash") for background calls. If the upstream
 * does not serve that model it answers 404/410 and Claude Code shows
 * "There's an issue with the selected model". Instead of failing, retry the
 * request once with the provider's defaultModel.
 */

const MODEL_ERROR_HINT = /model|not.?found|does not exist|no access|unavailable|end.?of.?life|gone/i;

/** True when the error looks like "the upstream cannot serve this model". */
export function isModelNotFound(error) {
  if (!error) return false;
  const status = Number(error.status);
  if (status === 404 || status === 410) return true;
  if (status === 400 || status === 403 || status === 422) {
    return MODEL_ERROR_HINT.test(String(error.message ?? '')) && /model/i.test(String(error.message ?? ''));
  }
  return false;
}

/**
 * Pick the model to retry with, or null when no fallback applies
 * (no default configured, or the failed model already is the default).
 */
export function fallbackModelFor(failedModel, providerCfg) {
  const fallback = providerCfg?.defaultModel;
  if (!fallback || fallback === failedModel) return null;
  return fallback;
}

/**
 * Run `attempt()`; on a model-not-found error before any response bytes were
 * sent, switch ctx.request.model / ctx.meta.model to the default and retry once.
 */
export async function withModelFallback(ctx, attempt) {
  try {
    return await attempt();
  } catch (error) {
    const { res, request, meta, providerCfg, log } = ctx;
    if (res?.headersSent || !isModelNotFound(error)) throw error;
    const next = fallbackModelFor(request.model, providerCfg);
    if (!next) throw error;
    log?.warn?.('model.fallback', {
      provider: providerCfg.name,
      from: request.model,
      to: next,
      status: error.status,
    });
    request.model = next;
    if (meta) meta.model = next;
    return await attempt();
  }
}
