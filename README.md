# appProxy

**Claude Code ve Cline CLI için sıfır bağımlılıklı yerel LLM proxy.** Tek Node.js
sunucu, arkasında **Gemini / OpenRouter / NVIDIA (NIM) / Cohere / OpenAI-uyumlu**
sağlayıcılar; öne iki uyumlu API sunar:

| Endpoint | Yol | Uyumlu istemci |
| --- | --- | --- |
| OpenAI Chat Completions | `POST /<provider>/v1/chat/completions` | **Cline CLI (`openai-compatible`)**, herhangi bir OpenAI SDK |
| OpenAI model listesi | `GET /<provider>/v1/models` | Cline CLI, OpenAI SDK |
| Anthropic Messages | `POST /<provider>/v1/messages` | **Claude Code**, Anthropic SDK |

Her sağlayıcı kendi doğal API dilinde kullanılır (tool calling + streaming aynen
korunur); proxy model eşlemesi (`config/models.json`), kimlik maskesi ve thought
signature yönetimini üstlenir. Sağlayıcı anahtarları yalnızca `.env`'de kalır,
istemciye asla gönderilmez.

- 🔗 Git: [github.com/Mstf1086/appProxy](https://github.com/Mstf1086/appProxy)
- 📚 Ayrıntılı kullanım: [`CLINE.md`](./CLINE.md) · Doküman aynası: [`docs/`](./docs/)
- ⚙️ Node.js >= 20, npm bağımlılığı YOK (yalnızca standart kütüphane)

---

## 📋 İçindekiler

1. [Kurulum](#-kurulum)
2. [İlk Kurulum (Sıfırdan Başlama)](#-ilk-kurulum-sıfırdan-başlama)
3. [Kullanım](#-kullanım)
4. [Provider Yönetimi](#-provider-yönetimi)
5. [Manuel Kurulum (Detaylı)](#-manuel-kurulum-detaylı-adımlarla)
6. [Testler](#-testler)
7. [Mimari](#-mimari)
8. [Güvenlik](#-güvenlik)
9. [Sorun Giderme](#-sorun-giderme)

---

## 🔧 Kurulum

### Gereksinimler

- **Node.js >= 20.0.0** (örn. `node --version`)
- Git (kullanmak isterseniz)
- `bash` (yönetim betikleri için)

Bağımlılık kurulumuna **gerek yoktur** (sıfır npm paketi).

### Adım 1 — Projeyi Klonlayın

```bash
git clone https://github.com/Mstf1086/appProxy.git
cd appProxy
```

### Adım 2 — Node.js Sürümünü Kontrol Edin

```bash
node --version   # >= v20 olmalı
```

Node 20+ yoksa önce [nodejs.org](https://nodejs.org/) veya nvm üzerinden yükleyin.

### Adım 3 — Ortam Değişkenlerini Hazırlayın

`.env` gerçek anahtarları tutar ve `.gitignore`'dadır (git'e gitmez). Şablonu
kopyalayın, boş anahtar satırlarına değerlerinizi yazın:

```bash
cp .env.example .env
nano .env      # veya vim / code .env
```

`.env`'de düzenlenmesi gereken ana satırlar:

```bash
# Sağlayıcı anahtarları — aldığınız yerde doldurun:
GEMINI_API_KEY=                 # Google AI Studio: https://aistudio.google.com/apikey
OPENROUTER_API_KEY=             # https://openrouter.ai/settings/keys
NVIDIA_API_KEY=                 # build.nvidia.com (nvapi-... ile başlar)
CO_API_KEY=                     # https://dashboard.cohere.com/api-keys
REFUSELESS_API_KEY=             # https://api.refuseless.com
APINEX_API_KEY=                 # https://api.apinex.bond/v1
ANYROUTER_API_KEY=              # https://anyrouter.dev/api/v1

# NVIDIA çalışma modu
NVIDIA_MODE=hosted              # 'hosted' (integrate.api.nvidia.com) veya 'nim' (self-hosted)
NIM_BASE_URL=http://127.0.0.1:8000   # sadece NVIDIA_MODE=nim iken geçerli
NIM_API_KEY=not-used

# Yerel proxy sunucusu
PROXY_HOST=127.0.0.1            # varsayılan: sadece loopback
PROXY_PORT=8790
PROXY_TOKEN=appproxy-local-dev  # Claude Code/Cline'ın proxy'ye bağlanması için kimlik

# Varsayılan sağlayıcı
DEFAULT_PROVIDER=openrouter

# Gövde loglama (0 = kapalı, 1 = açık) — varsayılan 0
PROXY_LOG_BODIES=0

# Upstream 429 (rate limit): bekle ve yeniden dene — tüm sağlayıcılar/modeller.
# Upstream süre belirtirse (Retry-After / gövdedeki süre) onu kullanılır.
PROXY_RATE_LIMIT_WAIT_MS=30000     # upstream süre belirtmezse beklenecek süre (ms)
PROXY_RATE_LIMIT_MAX_RETRIES=2     # 429'da ek deneme sayısı
```

⚠️ **Güvenlik uyarısı:** `.env` içindeki anahtarlar açık metindir. `.env` dosyasını
asla git'e eklemeyin ve paylaşmayın. Anahtar sızıntısı durumunda rotasyon yapın.

### Adım 4 — Sağlayıcı Ekle (Opsiyonel)

Veya interaktif sihirbazı kullanın:

```bash
bin/proxy-run add
```

Bu sihirbaz provider'ı `config/providers.json`'a kaydeder ve `.env`'ye anahtar
satırını ekler.

### Adım 5 — Proxy'yi Başlat

En kolay yol (interaktif seçim):

```bash
bin/proxy-run
```

Sağlayıcı → model → istemci (Cline / Claude Code / Pi CLI / sadece proxy)
sırasıyla seçilir. İstemci adımında `pi cli` seçilirse Pi Coding Agent
(https://pi.dev) seçilen provider/model ile başlatılır; Pi doğrudan
sağlayıcının ucuna bağlanır, proxy arka planda çalışmaya devam eder.

#### Pi CLI entegrasyonu nasıl çalışır?

- **Yerleşik Pi sağlayıcıları**: `gemini → google`, `openrouter → openrouter`,
  `nvidia → nvidia` (Pi kendi kataloğu ile çözer; bilinmeyen model ID'leri
  "custom model id" olarak geçirilir).
- **Diğer sağlayıcılar** (`cohere`, `refuseless`, `apinex`, `anyrouter`,
  sihirbazla eklenenler): Pi'nin `models.json` desteği kullanılır. İlk `--client pi`
  çalıştırmasında `~/.pi/agent/models.json` içine `"managedBy": "appProxy"`
  işaretli bir provider tanımı otomatik yazılır (Cohere için resmî OpenAI-uyumlu
  `https://api.cohere.com/compatibility/v1` ucu kullanılır). Kendi
  tanımınızı yazdıysanız (`managedBy` işareti yoksa) appProxy ona dokunmaz.
- appProxy `.env`'indeki sağlayıcı anahtarı, Pi'nin beklediği ortam değişkeni
  adıyla Pi alt sürecine aktarılır (ör. `GEMINI_API_KEY → GOOGLE_API_KEY`).
- Model üst verisi mümkünse sağlayıcıdan alınır (Cohere `context_length`);
  çıktı limiti güvenli varsayılanla 8192'dir — `models.json`'dan
  `maxTokens`/`contextWindow` değerlerini kendiniz değiştirebilirsiniz.

veya tek satırda başlatma:

```bash
bin/proxy-run openrouter           # provider + model + istemci interaktif
bin/proxy-run openrouter gpt-4o    # provider + model sabit, istemci interaktif
```

Proxy çalışırken durdurmak: `bin/proxy-run stop` (isimli örnek için
`bin/proxy-run stop <isim>`, tümü için `bin/proxy-run stop all`). Durum:
`bin/proxy-run status`.

### Adım 6 — Test Edin

```bash
npm test               # 40 test: çevirmeler, model keşfi, imza, sihirbazlar
npm run doctor         # anahtar/endpoint özeti (anahtarlar maskelenir)
```

---

## ✨ İlk Kurulum (Sıfırdan Başlama)

Türkiye'de bir geliştirici için adım adım örnek (Gemini üzerinden):

```bash
# 1. Klonlama
git clone https://github.com/Mstf1086/appProxy.git && cd appProxy

# 2. Node sürümü
node --version   # v20+ olmalı

# 3. .env hazırlama
cp .env.example .env
# .env içinde GEMINI_API_KEY satırını Gemini API anahtarınızla doldurun.

# 4. Proxy'yi başlatıp Gemini + bir modeli seçin
bin/proxy-run gemini
# Model listesi canlı olarak gelir; numarayı yazıp Enter'a basın.

# 5. İstemci olarak "claude" seçerseniz, Claude Code otomatik başlar.
#
# Başka bir terminalden bağlanmak isterseniz:
export ANTHROPIC_BASE_URL="http://127.0.0.1:8790/gemini"
export ANTHROPIC_AUTH_TOKEN="appproxy-local-dev"
export ANTHROPIC_MODEL="gemini-pro"
claude
```

### Cline CLI ile kullanım

```bash
export PROXY_TOKEN="$(grep -E '^PROXY_TOKEN=' .env | cut -d= -f2-)"
cline auth openai-compatible -k "$PROXY_TOKEN" -m "gemini-pro" \
  -b "http://127.0.0.1:8790/gemini/v1"
cline -P openai-compatible -m "gemini-pro" "Merhaba"
```

---

## 🚀 Kullanım

### proxy-run Komutları

| Komut | Açıklama |
| --- | --- |
| `bin/proxy-run` | Interaktif provider + model + istemci seçimi, arka planda başlatma |
| `bin/proxy-run <provider>` | Provider sabit, model listesi interaktif |
| `bin/proxy-run <provider> <model>` | Model sabit, istemci interaktif |
| `bin/proxy-run <provider> <model> --client cline` | Proxy + Cline CLI başlat |
| `bin/proxy-run <provider> <model> --client claude` | Proxy + Claude Code başlat |
| `bin/proxy-run <provider> <model> --client pi` | Proxy + Pi CLI (https://pi.dev) başlat |
| `bin/proxy-run <provider> <model> --client none` | Sadece proxy'yi başlat |
| `bin/proxy-run <provider> --list` | Sadece modelleri listele |
| `bin/proxy-run <provider> --filter <metin>` | Model listesini filtrele |
| `bin/proxy-run --foreground <provider> <model>` | Ön planda çalıştır (Ctrl+C ile dur) |
| `bin/proxy-run add` | Yeni provider ekleme sihirbazı |
| `bin/proxy-run remove [provider]` | Provider'ı config'den kaldır (onay ister) |
| `bin/proxy-run models [provider]` | Modelleri listele (proxy çalışmasa da olur) |
| `bin/proxy-run status` | Çalışan proxy örneklerinin durumu |
| `bin/proxy-run stop [isim\|all]` | Varsayılan / isimli / tüm örnekleri durdur |

### Aynı Anda Birden Çok Proxy (İsimli Örnekler)

`proxy-run` yeniden çalıştırıldığında hâlâ açık bir proxy varsa öncekinin
kapatılıp kapatılmayacağı sorulur:

1. **Kapat** — önceki örnek(ler) durur, yeni proxy aynı portta başlar.
2. **Açık kalsın** — yeni proxy'ye bir isim verilir (ör. `proxy2`) ve boş bir
   portta açılır (ör. `127.0.0.1:8791`). Önceki proxy çalışmaya devam eder.

İsimli örnekler `run/instances/<isim>/` altında izlenir:

```bash
bin/proxy-run status            # varsayılan + isimli örnekler birlikte listelenir
bin/proxy-run stop proxy2       # sadece 'proxy2' örneğini durdur
bin/proxy-run stop all           # tüm örnekleri durdur
```

İsimli örneğe `--port` ile açık port da verilebilir:
`bin/proxy-run <provider> <model> --port 8899` (çalışan proxy varken
seçimde "açık kalsın" denirse bu port kullanılır).

### npm Komutları

```bash
npm run start      # sunucuyu başlat (node src/server.mjs)
npm run proxy      # bin/claude-proxy üzerinden Claude Code'a bağlanır
npm run proxy:run  # bin/proxy-run için kısayol
npm run doctor     # anahtar/endpoint özeti (anahtarlar maskelenir)
npm run models     # tüm provider'ların model listesi
npm run urls       # endpoint URL'lerini listeler
npm run docs       # resmî dokümanları docs/ klasörüne günceller
npm test           # tüm testler
```

### Proxy URL'leri

Çalışan proxy üzerinden erişim:

- Anthropic (Claude Code): `http://127.0.0.1:8790/<provider>/v1/messages`
- OpenAI (Cline SDK): `http://127.0.0.1:8790/<provider>/v1/chat/completions`
- Model listesi: `http://127.0.0.1:8790/<provider>/v1/models`

`<provider>` ∈ `gemini`, `nvidia`, `openrouter`, `cohere`, `refuseless` +
`sihirbazla eklenenler`. Yol belirtilmezse `DEFAULT_PROVIDER` kullanılır.

---

## 🔌 Provider Yönetimi

### Provider Ekleme (Sihirbaz)

```bash
bin/proxy-run add
```

Desteklenen: `openai`, `anthropic`, `gemini`, `cohere`, `refuseless`, `apinex`,
`anyrouter` ve diğer OpenAI-uyumlu sağlayıcılar. Sihirbaz provider'ı
`config/providers.json`'a kaydeder ve `.env`'ye anahtar satırını ekler.

### Provider Silme

```bash
bin/proxy-run remove <provider>
```

Config dosyalarından (`config/providers.json`, `config/models.json`) ve `.env`'den
anahtar satırını temizler. Onay ister.

### Model Listelemek

```bash
bin/proxy-run gemini --list      # Gemini modelleri
bin/proxy-run cohere --list      # Cohere modelleri
bin/proxy-run --filter flash     # "flash" geçen tüm modelleri filtrele
npm run models                   # tüm provider'lar için kısa özet
```

---

## ⚙️ Manuel Kurulum (Detaylı Adımlarla)

Proxy'yi elle yapılandırmak isterseniz:

### 1. Sunucuyu Arka Planda Başlat

```bash
cp .env.example .env
# .env içinde GEMINI_API_KEY veya OPENROUTER_API_KEY gibi anahtarları doldurun

DEFAULT_PROVIDER=openrouter node src/server.mjs &
```

Proxy varsayılan olarak `127.0.0.1:8790`'da dinler. `PROXY_HOST`/`PROXY_PORT` ile
değiştirilebilir.

### 2. Kimlik Doğrulama Token'ını Alın

```bash
export PROXY_TOKEN="$(grep -E '^PROXY_TOKEN=' .env | cut -d= -f2-)"
```

### 3. Claude Code ile Bağlan

```bash
export DEFAULT_PROVIDER=openrouter
export ANTHROPIC_BASE_URL="http://127.0.0.1:8790/openrouter"
export ANTHROPIC_AUTH_TOKEN="$PROXY_TOKEN"
export ANTHROPIC_MODEL="openai/gpt-4o"   # config/models.json eşlemelerine göre değişebilir
claude
```

### 4. Cline CLI ile Bağlan

```bash
cline auth openai-compatible \
  -k "$PROXY_TOKEN" \
  -m "openai/gpt-4o" \
  -b "http://127.0.0.1:8790/openrouter/v1"
```

### 5. Doğrulama

```bash
# Sunucu başlangıç mesajı: "appProxy listening on http://127.0.0.1:8790 (default=openrouter)"
curl -s -H "X-Api-Key: $PROXY_TOKEN" \
  "http://127.0.0.1:8790/openrouter/v1/chat/completions" -X POST \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"test"}]}'
```

### 6. Sunucuyu Durdurma

```bash
bin/proxy-run stop            # varsayılan (isimsiz) örneği durdur
bin/proxy-run stop <isim>     # isimli örneği durdur
bin/proxy-run stop all        # tüm örnekleri durdur
# veya tüm süreçleri elle bitirirken:
pkill -f "node src/server.mjs"
```

---

## 🧪 Testler

```bash
npm test
```

`node --test` ile çalışır — `tests/*.test.mjs`: URL eşleme, model keşfi, imza
gidiş-dönüşü, model eşleme, sihirbazlar (40 test).

---

## 🏗️ Mimari

```
appProxy/
├── bin/                # wrapper betikleri (proxy-run, claude-gemini, ...)
├── config/             # providers.json + models.json
├── docs/               # resmî doküman aynası (Anthropic, Google, NVIDIA, OpenRouter, Cline)
├── logs/               # proxy logları (git'e gitmez)
├── run/                # runtime dosyaları (pid, port, host, model, provider; isimli örnekler run/instances/ altında) (git'e gitmez)
├── scripts/            # fetch-docs.sh, html_to_text.py
├── src/
│   ├── server.mjs      # yönlendirici + kimlik doğrulama + akış
│   ├── cli.mjs         # doctor | models | urls | add-provider | remove-provider
│   ├── config.mjs      # .env + config yükleme
│   ├── add-provider.mjs / remove-provider.mjs   # sihirbazlar
│   ├── providers/      # anthropic | cohere | gemini | openai bağdaştırıcıları
│   ├── translate/      # protokol çevirileri (anthropic ↔ openai ↔ gemini ↔ cohere)
│   ├── http.mjs, sse.mjs, errors.mjs, log.mjs
│   └── models.mjs      # model keşfi + eşleme
└── tests/              # birim testler
```

- `src/server.mjs` — yönlendirme: `<provider>/v1/messages` + `<provider>/v1/chat/completions`
- `src/translate/` — protokol çevirileri (anthropic ↔ openai ↔ gemini ↔ cohere)
- `src/providers/` — sağlayıcıya özgü upstream bağdaştırıcıları
- `src/add-provider.mjs` / `src/remove-provider.mjs` — etkileşimli sihirbazlar
- `config/providers.json` + `config/models.json` — sağlayıcı ve model eşleme yapılandırması
- Sıfır npm bağımlılığı: yalnızca Node.js (>= 20) standart kütüphanesi

---

## 🔒 Güvenlik

- `.env` asla commit edilmez (`.gitignore`) ve anahtar değerleri loglara yazılmaz.
- Proxy, `PROXY_TOKEN` ile doğrular; gerçek sağlayıcı anahtarı istemciden gizli kalır.
- Sunucu varsayılan olarak yalnızca `127.0.0.1` dinler.
- `.env` içindeki anahtarlar açık metindir — saklama ve rotasyon sorumluluğu
  kullanıcudadır.
- `PROXY_LOG_BODIES=0` varsayılandır; prompt gövdeleri loglanmaz.

---

## 🐛 Sorun Giderme

| Hata | Olası neden | Çözüm |
| --- | --- | --- |
| `command not found: claude` / `cline` | İstemci araçları yüklü değil | Claude Code / Cline CLI'yı ayrıca kurun |
| Node sürüm hatası | Node < 20 | Node 20+ yükleyin |
| `401 Unauthorized` | Anahtar boş veya yanlış | `.env`'yi kontrol edin, `npm run doctor` ile özet alın |
| Port çakışması | 8790 zaten kullanımda | `PROXY_PORT` ile farklı port deneyin |
| Provider listede görünmüyor | `config/providers.json` güncel değil | `bin/proxy-run add` ile yeniden ekleyin |
| Model keşfi başarısız | Upstream kapalı / anahtar hatalı | `npm run models <provider>` ile deneyin, `PROXY_LOG_BODIES=1` ile logları artırın |
| Anahtar `.git`'e gitmişse | `.env` yanlışlıkla eklenmiş | `git rm --cached .env` + anahtarları rotasyona uğratın |

---

**Lisans:** Proje özel (private) geliştirme aracıdır; dağıtım için izin gereklidir.
