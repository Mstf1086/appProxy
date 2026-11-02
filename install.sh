#!/usr/bin/env bash
# appProxy kurulum betiği.
#   curl -fsSL https://raw.githubusercontent.com/Mstf1086/appProxy/master/install.sh | bash
# Ortam değişkenleri: APPPROXY_DIR (varsayılan ~/appProxy), APPPROXY_BRANCH (varsayılan master)
set -euo pipefail

REPO_URL="https://github.com/Mstf1086/appProxy.git"
DIR="${APPPROXY_DIR:-$HOME/appProxy}"
BRANCH="${APPPROXY_BRANCH:-master}"

command -v git  >/dev/null || { echo "HATA: git gerekli." >&2; exit 1; }
command -v node >/dev/null || { echo "HATA: Node.js >= 20 gerekli." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "HATA: Node $NODE_MAJOR bulundu, >= 20 gerekli." >&2; exit 1; }

# 1. Klonla veya güncelle
if [ -d "$DIR/.git" ]; then
  echo "==> Güncelleniyor: $DIR"
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" pull --ff-only --quiet origin "$BRANCH"
else
  echo "==> Klonlanıyor: $DIR"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$DIR"
fi

# 2. Çalıştırma izinleri ve .env şablonu
chmod +x "$DIR"/bin/* 2>/dev/null || true
if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  chmod 600 "$DIR/.env"
  echo "==> .env oluşturuldu: $DIR/.env (API anahtarlarını buraya yazın)"
fi

# 3. ~/.bashrc'ye proxy-run alias'ı (tekrar çalıştırınca çoğaltmaz)
RC="$HOME/.bashrc"
touch "$RC"
sed -i '/# >>> appProxy >>>/,/# <<< appProxy <<</d' "$RC"
cat >> "$RC" <<RCEOF
# >>> appProxy >>>
alias proxy-run='bash $DIR/bin/proxy-run'
# <<< appProxy <<<
RCEOF
echo "==> ~/.bashrc'ye alias eklendi: proxy-run"

echo
echo "Hazır. Yeni terminal açın ya da: source ~/.bashrc"
echo "Sonra: proxy-run"
