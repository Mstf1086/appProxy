#!/usr/bin/env bash
# claude-env.sh — Claude Code ortam değişkenleri (source edilir, doğrudan çalıştırılmaz).
#
# NVIDIA "Use Claude Code with NIM" kılavuzuna göre: Claude Code, özel model eklense
# bile arka plan işleri için yerleşik takma adları (haiku / sonnet / opus) ve alt
# ajanları kullanmaya devam eder. Bunlar Anthropic model ID'lerine çözülürse upstream
# 404 döner ("The model 'claude-haiku-...' does not exist"). Bu yüzden tüm takma
# adlar upstream'in sunduğu modele yönlendirilir.
# Kaynak: docs/nvidia/use-claude-code-with-nim.md
#
# Not: ANTHROPIC_API_KEY ayarlanmaz, TEMİZLENİR — proxy kimliği ANTHROPIC_AUTH_TOKEN ile
# doğrulanır ve ortamdaki gerçek bir Anthropic anahtarı proxy'ye sızmamalıdır.
#
# apply_claude_env <base_url> <token> <model> [fast_model]
#   APPPROXY_USE_FAST_MODEL=1 ise haiku (arka plan) takma adı fast_model'e gider;
#   varsayılan olarak seçilen modele gider (upstream'de var olduğu kesin olan model).
apply_claude_env() {
  local base="$1" token="$2" model="${3:-}" fast="${4:-}"
  unset ANTHROPIC_API_KEY
  export ANTHROPIC_BASE_URL="$base"
  export ANTHROPIC_AUTH_TOKEN="$token"
  [[ -n "$model" ]] || return 0

  local background="$model"
  if [[ "${APPPROXY_USE_FAST_MODEL:-0}" == "1" && -n "$fast" ]]; then
    background="$fast"
  fi

  export ANTHROPIC_MODEL="$model"
  export ANTHROPIC_CUSTOM_MODEL_OPTION="$model"
  export ANTHROPIC_CUSTOM_MODEL_OPTION_NAME="$model"
  export ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION="appProxy (${PROVIDER:-provider})"
  export ANTHROPIC_DEFAULT_HAIKU_MODEL="$background"
  export ANTHROPIC_DEFAULT_SONNET_MODEL="$model"
  export ANTHROPIC_DEFAULT_OPUS_MODEL="$model"
  export CLAUDE_CODE_SUBAGENT_MODEL="$model"
  export ANTHROPIC_SMALL_FAST_MODEL="$background"   # eski ad; geriye dönük uyumluluk
}

# print_claude_env_exports <base_url> <model> [fast_model] — başka terminalde kullanılacak export satırları
print_claude_env_exports() {
  local base="$1" model="${2:-}" fast="${3:-}"
  echo "  unset ANTHROPIC_API_KEY"
  echo "  export ANTHROPIC_BASE_URL=\"$base\""
  echo '  export ANTHROPIC_AUTH_TOKEN="$PROXY_TOKEN"'
  [[ -n "$model" ]] || return 0
  local background="$model"
  [[ "${APPPROXY_USE_FAST_MODEL:-0}" == "1" && -n "$fast" ]] && background="$fast"
  echo "  export ANTHROPIC_MODEL=\"$model\""
  echo "  export ANTHROPIC_CUSTOM_MODEL_OPTION=\"$model\""
  echo "  export ANTHROPIC_DEFAULT_HAIKU_MODEL=\"$background\""
  echo "  export ANTHROPIC_DEFAULT_SONNET_MODEL=\"$model\""
  echo "  export ANTHROPIC_DEFAULT_OPUS_MODEL=\"$model\""
  echo "  export CLAUDE_CODE_SUBAGENT_MODEL=\"$model\""
}
