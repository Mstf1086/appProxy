#!/usr/bin/env bash
#
# appProxy — resmî dokümanları yerel docs/ ağacına indirir.
#
# Kural (proje sahibinin talebi): yalnızca BİRİNCİ EL / RESMÎ kaynaklar kullanılır
# (Anthropic, Google Gemini, NVIDIA, OpenRouter, Cline). Üçüncü taraf blog/forum
# referans alınmaz. Betik idempotenttir: tekrar çalıştırmak dosyaları günceller ve
# docs/SOURCES.md manifestini yeniden üretir.
#
# Kullanım:
#   scripts/fetch-docs.sh                 # hepsi
#   scripts/fetch-docs.sh gemini nvidia   # sadece belirtilen klasörler
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS="$ROOT/docs"
MANIFEST="$DOCS/SOURCES.md"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
UA="appProxy-docs-fetcher/0.1 (local mirror of official documentation)"
FILTERS=("$@")

mkdir -p "$DOCS"
ROWS=()
FAILED=0

wanted() {
  [ "${#FILTERS[@]}" -eq 0 ] && return 0
  local rel="$1" f
  for f in "${FILTERS[@]}"; do
    case "$rel" in "$f"/*) return 0 ;; esac
  done
  return 1
}

write_header() { # $1 = source url
  printf '<!-- source: %s -->\n' "$1"
  printf '<!-- fetched: %s -->\n' "$STAMP"
  printf '<!-- official documentation mirror; do not edit by hand: run scripts/fetch-docs.sh -->\n\n'
}

while IFS='|' read -r kind url rel; do
  case "${kind:-}" in ''|\#*) continue ;; esac
  url="$(printf '%s' "$url" | tr -d '[:space:]')"
  rel="$(printf '%s' "$rel" | tr -d '[:space:]')"
  wanted "$rel" || continue

  tmp="$(mktemp)"
  status="$(curl -sSL --max-time 240 -A "$UA" -w '%{http_code}' -o "$tmp" "$url" 2>/dev/null || echo 000)"
  bytes="$(wc -c <"$tmp" | tr -d ' ')"
  out="$DOCS/$rel"

  if [ "$status" != "200" ] || [ "$bytes" -eq 0 ]; then
    printf '  !! %-56s HTTP %s\n' "$rel" "$status"
    ROWS+=("$status|$bytes|$rel|$url")
    FAILED=$((FAILED + 1))
    rm -f "$tmp"
    continue
  fi

  mkdir -p "$(dirname "$out")"
  case "$kind" in
    json) cp "$tmp" "$out" ;;
    html) { write_header "$url"; python3 "$ROOT/scripts/html_to_text.py" <"$tmp"; } >"$out" ;;
    *)    { write_header "$url"; cat "$tmp"; } >"$out" ;;
  esac
  bytes="$(wc -c <"$out" | tr -d ' ')"
  printf '  ok %-56s %8s bytes\n' "$rel" "$bytes"
  ROWS+=("$status|$bytes|$rel|$url")
  rm -f "$tmp"
done <"$ROOT/scripts/doc-sources.txt"

{
  printf '# Doküman Kaynakları (docs/SOURCES.md)\n\n'
  printf 'Bu dosya `scripts/fetch-docs.sh` tarafından üretilir; elle düzenlenmez.\n'
  printf 'Projede **yalnızca resmî dokümanlar** referans alınır.\n\n'
  printf -- '- Son güncelleme (UTC): `%s`\n- Kaynak sayısı: %d\n- Başarısız: %d\n\n' "$STAMP" "${#ROWS[@]}" "$FAILED"
  printf '| HTTP | Boyut (byte) | Yerel dosya | Kaynak URL |\n| --- | ---: | --- | --- |\n'
  for row in "${ROWS[@]}"; do
    IFS='|' read -r st by rel url <<<"$row"
    printf '| %s | %s | `%s` | %s |\n' "$st" "$by" "$rel" "$url"
  done
} >"$MANIFEST"

printf '\nManifest: %s\nKaynak: %d · Başarısız: %d\n' "$MANIFEST" "${#ROWS[@]}" "$FAILED"
exit 0
