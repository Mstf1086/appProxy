#!/usr/bin/env bash
# nvidia-smoke.sh — NVIDIA hosted API + appProxy uçtan uca duman testi.
# Kullanım: bash scripts/nvidia-smoke.sh [model]     (varsayılan: z-ai/glm-5.3-flash)
# Anahtar .env'deki NVIDIA_API_KEY'den okunur; ekrana/loga yazılmaz.
set -uo pipefail
cd "$(dirname "$0")/.."
MODEL="${1:-z-ai/glm-5.3-flash}"
PORT="${PROXY_PORT:-8791}"
set -a; [ -f .env ] && . ./.env; set +a
[ -n "${NVIDIA_API_KEY:-}" ] || { echo "HATA: .env içinde NVIDIA_API_KEY yok" >&2; exit 1; }
TOKEN="${PROXY_TOKEN:-appproxy-local-dev}"
ok(){ echo "  OK   $*"; }; bad(){ echo "  FAIL $*"; FAILED=1; }; FAILED=0

echo "1) Upstream model listesi"
code=$(curl -s -m 20 -o /tmp/nv_models.json -w '%{http_code}' https://integrate.api.nvidia.com/v1/models -H "Authorization: Bearer $NVIDIA_API_KEY")
[ "$code" = 200 ] && ok "HTTP 200" || bad "HTTP $code"
grep -q "\"$MODEL\"" /tmp/nv_models.json && ok "$MODEL listede" || bad "$MODEL listede YOK"

echo "2) Upstream doğrudan chat ($MODEL)"
code=$(curl -s -m 60 -o /tmp/nv_chat.json -w '%{http_code}' https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"say ok\"}]}")
[ "$code" = 200 ] && ok "HTTP 200" || { bad "HTTP $code: $(head -c 300 /tmp/nv_chat.json)"; }

echo "3) Proxy (port $PORT)"
PROXY_PORT=$PORT PROXY_LOG_FILE=logs/smoke.log DEFAULT_PROVIDER=nvidia node src/server.mjs nvidia >/dev/null 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT; sleep 1.5
for m in "$MODEL" claude-haiku-4-5-20251001 claude-sonnet-5-5; do
  code=$(curl -s -m 60 -o /tmp/nv_proxy.json -w '%{http_code}' "http://127.0.0.1:$PORT/nvidia/v1/messages" \
    -H "x-api-key: $TOKEN" -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' \
    -d "{\"model\":\"$m\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"say ok\"}]}")
  [ "$code" = 200 ] && ok "messages model=$m -> 200" || bad "messages model=$m -> $code: $(head -c 300 /tmp/nv_proxy.json)"
done
echo; echo "Log: logs/smoke.log"; tail -n 12 logs/smoke.log 2>/dev/null | cut -c1-220
exit $FAILED
