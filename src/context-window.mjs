/**
 * Context window to tell Claude Code for a gateway model.
 *
 * Claude Code does not know provider model IDs (e.g. "minimaxai/minimax-m3.1-flash")
 * and warns "isn't described by this version's model catalog" while assuming 200k.
 * CLAUDE_CODE_MAX_CONTEXT_TOKENS makes the window explicit (docs/anthropic/claude-code/model-config.md).
 *
 * Resolution order:
 *   1. APPPROXY_CONTEXT_TOKENS env (explicit override)
 *   2. contextWindow on the matching preset in config/models.json
 *   3. contextWindow on the provider in config/providers.json
 *   4. DEFAULT_CONTEXT_TOKENS (200000: what Claude Code assumes anyway)
 */
export const DEFAULT_CONTEXT_TOKENS = 200000;

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function contextWindowFor({ providerCfg, presets = [], model, env = {} }) {
  const fromEnv = positiveInt(env.APPPROXY_CONTEXT_TOKENS);
  if (fromEnv) return fromEnv;
  const preset = presets.find((p) => p?.id === model);
  return positiveInt(preset?.contextWindow) ?? positiveInt(providerCfg?.contextWindow) ?? DEFAULT_CONTEXT_TOKENS;
}

// CLI: node src/context-window.mjs <provider> <model>  -> prints the number
if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadConfig } = await import('./config.mjs');
  const cfg = loadConfig();
  const [provider, model = ''] = process.argv.slice(2);
  console.log(
    contextWindowFor({
      providerCfg: cfg.active(provider),
      presets: cfg.models?.[provider]?.presets ?? [],
      model,
      env: process.env,
    }),
  );
}
