# appProxy

**Claude Code için sıfır bağımlılıklı yerel LLM proxy.** Tek Node.js
sunucu, arkasında **Gemini / OpenRouter / NVIDIA (NIM) / Cohere / OpenAI-uyumlu**
sağlayıcılar; öne iki uyumlu API sunar:

| Endpoint | Yol | Uyumlu istemci |
| --- | --- | --- |
| OpenAI Chat Completions | `POST /<provider>/v1/chat/completions` | Herhangi bir OpenAI SDK / OpenAI-uyumlu istemci |
| OpenAI model listesi | `GET /<provider>/v1/models` | OpenAI SDK |
| Anthropic Messages | `POST /<provider>/v1/messages` | **Claude Code**, Anthropic SDK |

Her sağlayıcı kendi doğal API dilinde kullanılır (tool calling + streaming aynen
korunur); proxy model eşlemesi (`config/models.json`), kimlik maskesi ve thought
signature yönetimini üstlenir. Sağlayıcı anahtarları yalnızca `.env`'de kalır,
istemciye asla gönderilmez.

- 🔗 Git: [github.com/Mstf1086/appProxy](https://github.com/Mstf1086/appProxy)
- 📚 Kullanım kılavuzu: [`docs/`](./docs/) · Ajan kuralları: [`AGENTS.md`](./AGENTS.md)
- ⚙️ Node.js >= 20, npm bağımlılığı YOK (yalnızca standart kütüphane)

---

## 📋 İçindekiler

1. [Hızlı Kurulum (tek komut)](#-hızlı-kurulum-tek-komut)
2. [Kurulum](#-kurulum)
3. [İlk Kurulum (Sıfırdan Başlama)](#-ilk-kurulum-sıfırdan-başlama)
4. [Kullanım](#-kullanım)
5. [Log Dosyası](#-log-dosyası)
6. [Claude Code Model Eşlemesi ve Fallback](#-claude-code-model-eşlemesi-ve-fallback)
7. [Provider Yönetimi](#-provider-yönetimi)
8. [Manuel Kurulum (Detaylı)](#-manuel-kurulum-detaylı-adımlarla)
9. [Testler](#-testler)
10. [Mimari](#-mimari)
11. [Güvenlik](#-güvenlik)
12. [Sorun Giderme](#-sorun-giderme)

---

## ⚡ Hızlı Kurulum (tek komut)

```bash
curl -fsSL https://raw.githubusercontent.com/Mstf1086/appProxy/master/install.sh | bash
source ~/.bashrc
proxy-run
```

`install.sh` şunları yapar (tekrar çalıştırmak güvenlidir, güncelleme olarak da kullanılır):

1. Repoyu `~/appProxy` içine klonlar; varsa `git pull --ff-only` ile günceller.
2. `bin/` altındaki dosyalara çalıştırma izni verir.
3. `.env` yoksa `.env.example`'dan oluşturur (`chmod 600`). API anahtarlarını bu dosyaya yazın.
4. `~/.bashrc`'ye `proxy-run` alias'ını ekler (`# >>> appProxy >>>` bloğu; çoğalmaz).

Ortam değişkenleri: `APPPROXY_DIR` (varsayılan `~/appProxy`), `APPPROXY_BRANCH` (varsayılan `master`).
Gereksinim: `git` ve Node.js >= 20.

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
PROXY_TOKEN=appproxy-local-dev  # Claude Code'un proxy'ye bağlanması için kimlik

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

Sağlayıcı → model → istemci (Cline CLI / Claude Code / Pi CLI / sadece proxy)
sırasıyla seçilir. İstemci adımında `pi cli` seçilirse Pi Coding Agent
(https://pi.dev) seçilen provider/model ile başlatılır; Pi doğrudan
sağlayıcının ucuna bağlanır, proxy arka planda çalışmaya devam eder.

#### Cline CLI ile kullanım

Cline CLI (`npm i -g cline`, v3+) OpenAI uyumlu bir sağlayıcı ile çalışır;
appProxy onun `openai-compatible` sağlayıcısını proxy'ye yönlendirir:

```bash
npm i -g cline                       # bir kez
bin/proxy-run <provider> <model> --client cline
```

`proxy-run` her oturumda şunları yapar (port/örnek değişebildiği için):

```bash
cline auth openai-compatible -k "$PROXY_TOKEN" -m "<model>" -b "http://127.0.0.1:8790/<provider>/v1"
cline -P openai-compatible -m "<model>"
```

Elle bağlanmak isterseniz aynı iki komut `--client none` çıktısında yazılır.
Notlar:

- Cline **akış (stream) bekler**; proxy SSE döndürmezse
  `Response stream ended without a finish reason` hatası verir.
- Cline yalnızca **proxy token'ını** görür (`~/.cline/settings/providers.json`);
  gerçek sağlayıcı anahtarı `.env`'de kalır.
- `cline auth` sağlayıcı ayarını global yazar: iki farklı proxy'yi aynı anda
  kullanacaksanız her oturumda `proxy-run ... --client cline` ile başlatın
  (base URL otomatik güncellenir).

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

#### Yerel LFM3 modeliyle Pi CLI

`lfm3` sağlayıcısı, `/data/home/appTest` projesindeki yerel `llama-server`
OpenAI API'sine bağlanır. Önce model sunucusunu başlatın:

```bash
cd /data/home/appTest
./scripts/start_llama_server.sh
```

Ardından Pi CLI'yi şu komutla açın:

```bash
cd /data/home/appTest
proxy-run lfm3 LFM3-1.7B-Q8_0 --client pi
```

Bu akış `~/.pi/agent/models.json` içine `lfm3` sağlayıcısını yazar; Pi
streaming ve tool-calling destekleyen yerel OpenAI ucuna doğrudan bağlanır.
LFM3 bağlamı 32768 token, maksimum çıktı 4096 token olarak tanımlıdır.
Pi'nin her istekte ayırdığı 4096 tokenlık güvenlik payı nedeniyle 8K context
uzun araç konuşmalarında `max_tokens=1`e düşebiliyordu; 32K context bu durumu
giderir.

Proxy çalışırken durdurmak: `bin/proxy-run stop` — yalnızca bu projeden
başlatılan proxy'leri durdurur (isimli örnek için `bin/proxy-run stop <isim>`,
bu kurulumdaki her şey için `bin/proxy-run stop all`). Durum:
`bin/proxy-run status`.

#### AMD Radeon Cloud / Token Factory (ücretsiz OpenAI uyumlu uç)

`https://developer.amd.com.cn/radeon/api/v1` OpenAI uyumludur; Claude Code ise
Anthropic konuşur. Araya appProxy girer — `amd` sağlayıcısı hazır gelir
(`config/providers.json`), anahtar `Authorization: Bearer` olarak gönderilir.

1. Anahtar alın: [developer.amd.com.cn/login](https://developer.amd.com.cn/login)
   → giriş → **Token Factory** → ücretsiz bir model (ör. `DeepSeek-V4-Flash-0731`)
   → **API KEY** kopyala.
2. `.env` dosyasına yazın: `AMD_API_KEY=<anahtar>`
3. Başlatın:

```bash
bin/proxy-run amd                          # canlı model listesinden seç
bin/proxy-run amd DeepSeek-V4-Flash-0731 --client claude
```

Ücretsiz (Public Free) modeller: `DeepSeek-V4-Flash-0731` (LLM),
`DeepSeek-V4-Flash-Vision-Exp` (VLM), `Qwen3.8-Flash-Next` (VLM),
`MiniCPM5-1B` (küçük). Claude takma adları (`*sonnet*`, `*opus*`, `*haiku*`)
`DeepSeek-V4-Flash-0731`'e eşlenir; sağlayıcının kendi kimlikleri
(`DeepSeek-*`, `Qwen*`, `MiniCPM*`) olduğu gibi geçer.

Doğrudan OpenAI istemcileri için proxy adresi: `http://127.0.0.1:8790/amd/v1`.
Notlar: kullanım token bazında sayılır (kotası belirsiz), çıktı hızı ~800 tok/s
— uzun ajan oturumlarında yavaş kalabilir. `--client pi` de desteklenir.

### Adım 6 — Test Edin

```bash
npm test               # çevirmeler, model keşfi, imza, fallback, log, sihirbazlar
npm run doctor         # anahtar/endpoint özeti (anahtarlar maskelenir)
```

---

## 📝 Log Dosyası

`proxy-run` çalıştığı sürece her işlem **`logs/proxy-run.log`** dosyasına satır satır yazılır
(isimli örneklerde `logs/proxy-run-<isim>.log`). Sunucu çıktısı ayrıca `logs/proxy-run.out`,
ham JSON günlüğü `logs/proxy-YYYY-MM-DD.jsonl` dosyasındadır.

Canlı izleme:

```bash
tail -f ~/appProxy/logs/proxy-run.log
```

Örnek satırlar:

```text
2026-11-02T07:00:17.168Z INFO  http.request method=POST path=/nvidia/v1/messages length=92
2026-11-02T07:00:17.169Z INFO  request.start provider=nvidia model=z-ai/glm-5.3-flash messages=1
2026-11-02T07:00:17.170Z INFO  upstream.request url=https://integrate.api.nvidia.com/v1/chat/completions
2026-11-02T07:00:17.191Z ERROR request.failed status=404 upstreamBody="..."
2026-11-02T07:00:17.193Z INFO  http.response path=/nvidia/v1/messages status=502 ms=25
```

Kaydedilenler: gelen HTTP istekleri ve yanıt kodları/süreleri, istenen ve kullanılan model,
mesaj/tool sayısı, upstream isteği ve yanıt kodu, hatalar (upstream gövdesinin ilk 800 karakteriyle),
model fallback olayları, bilinmeyen route'lar ve `proxy-run` adımları (provider/model/istemci seçimi,
istemci başlangıcı ve çıkış kodu). **Prompt içerikleri ve API anahtarları yazılmaz**
(`PROXY_LOG_BODIES=1` olmadıkça gövde loglanmaz). Log dosyasının yolunu `PROXY_LOG_FILE` ile değiştirebilirsiniz.

---

## 🔁 Claude Code Model Eşlemesi ve Fallback

Kaynak: [NVIDIA — Use Claude Code with NIM](https://docs.nvidia.com/nim/large-language-models/latest/ai-assistant-integrations/claude-code.html)
(yerel kopya: [`docs/nvidia/use-claude-code-with-nim.md`](./docs/nvidia/use-claude-code-with-nim.md)).

Claude Code özel bir model seçilse bile arka plan işleri için yerleşik takma adları (`haiku`, `sonnet`, `opus`)
ve alt ajanları kullanmaya devam eder. Bunlar Anthropic model ID'lerine çözülürse upstream
`404 / model does not exist` döner ve Claude Code "There's an issue with the selected model" gösterir.

`proxy-run` ve `claude-proxy` bu yüzden Claude Code'u başlatırken (`bin/claude-env.sh`) şunları ayarlar:

| Değişken | Değer |
| --- | --- |
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:<port>/<provider>` |
| `ANTHROPIC_AUTH_TOKEN` | `PROXY_TOKEN` (`ANTHROPIC_API_KEY` **temizlenir**; gerçek anahtar proxy'ye sızmaz) |
| `ANTHROPIC_MODEL`, `ANTHROPIC_CUSTOM_MODEL_OPTION` | seçilen model (`/model` listesine de eklenir) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `_SONNET_MODEL` / `_OPUS_MODEL` | seçilen model |
| `CLAUDE_CODE_SUBAGENT_MODEL` | seçilen model |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | modelin bağlam penceresi (aşağıya bakın) |

Haiku (arka plan) takma adını sağlayıcının `fastModel` değerine yönlendirmek için `APPPROXY_USE_FAST_MODEL=1`
verin; varsayılan, upstream'de var olduğu kesin olan seçili modeldir. Başka terminalde kullanmak için gereken
`export` satırlarını `proxy-run` kendisi yazdırır.

**Bağlam penceresi:** Claude Code sağlayıcı model ID'lerini (örn. `minimaxai/minimax-m3.1-flash`) tanımaz ve
"isn't described by this version's model catalog" uyarısı verip 200k varsayar. `proxy-run` pencereyi açıkça bildirir
(`src/context-window.mjs`). Öncelik: `APPPROXY_CONTEXT_TOKENS` ortam değişkeni → `config/models.json`'daki preset'in
`contextWindow` alanı → `config/providers.json`'daki sağlayıcının `contextWindow` alanı → `200000`.
Modelin gerçek penceresini biliyorsanız örn. `APPPROXY_CONTEXT_TOKENS=1000000 proxy-run` ile verin.

**Ek güvence (fallback):** yine de bir model upstream'de yoksa 404/410 (veya "model" geçen 400/403/422)
alınır; proxy isteği **bir kez** sağlayıcının `defaultModel`'iyle yeniden dener ve `model.fallback` olayını loga yazar.
Yanıt başlamışsa (streaming) fallback uygulanmaz.

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
| `bin/proxy-run <isim>` | Çalışan proxy'ye yeniden bağlan (istemci seçilir: cline/claude/pi) |
| `bin/proxy-run attach <isim> [--client ...]` | Aynısı; isim bir provider ile çakışıyorsa |
| `bin/proxy-run --foreground <provider> <model>` | Ön planda çalıştır (Ctrl+C ile dur) |
| `bin/proxy-run add` | Yeni provider ekleme sihirbazı |
| `bin/proxy-run remove [provider]` | Provider'ı config'den kaldır (onay ister) |
| `bin/proxy-run models [provider]` | Modelleri listele (proxy çalışmasa da olur) |
| `bin/proxy-run status` | Çalışan proxy'ler; her biri için proje ve dizin bilgisi |
| `bin/proxy-run stop` | Yalnızca bu projeden başlatılan proxy'leri durdur |
| `bin/proxy-run stop <isim> [--force]` | Tek örneği durdur (başka projedense `--force` gerekir) |
| `bin/proxy-run stop all` | Bu kurulumun izlediği tüm örnekleri durdur |

### Aynı Anda Birden Çok Proxy (İsimli Örnekler)

`proxy-run` yeniden çalıştırıldığında hâlâ açık bir proxy varsa öncekinin
kapatılıp kapatılmayacağı sorulur:

1. **Kapat** — önceki örnek(ler) durur, yeni proxy aynı portta başlar.
2. **Açık kalsın** — yeni proxy'ye bir isim verilir (ör. `proxy2`) ve boş bir
   portta açılır (ör. `127.0.0.1:8791`). Önceki proxy çalışmaya devam eder.

İsimli örnekler `run/instances/<isim>/` altında izlenir:

```bash
bin/proxy-run status            # tüm örnekler, proje bilgisiyle listelenir
bin/proxy-run stop              # yalnızca bu projeden başlatılanları durdur
bin/proxy-run stop proxy2       # sadece 'proxy2' örneğini durdur
bin/proxy-run stop all          # bu kurulumun tüm örneklerini durdur
```

`status` her örnek için iki satır yazar:

- **Proje** — `proxy-run`'ın çağrıldığı dizin (ör. `/data/home/appNews`).
  Başlıkta `(bu proje)` / `(başka proje)` etiketi bulunur.
- **Dizin** — sunucunun gerçekten çalıştığı appProxy kurulumu. Proje ile
  aynıysa satır tekrarlanmaz.

### İstemciden Çıkıp Aynı Proxy'ye Dönmek

Proxy arka planda çalışmaya devam ettiği için Claude Code içinde `/exit`
dedikten sonra yeni bir proxy başlatmak gerekmez. Örnek adıyla dönülür:

```bash
bin/proxy-run pr3                     # çalışan proxy'ye bağlan, istemciyi seç
bin/proxy-run pr3 --client claude     # soru sormadan doğrudan Claude Code
bin/proxy-run attach pr3              # aynısı (isim bir provider adıysa bunu kullanın)
bin/proxy-run default                 # isimsiz (varsayılan) örneğe bağlan
```

Bu çağrı **yeni süreç başlatmaz**, provider/model sormaz: port, provider ve
model `run/` kaydından okunur, `/health` doğrulanır ve yalnızca istemci
seçilir (`claude` / `pi` / istemci yok). Proxy kapalıysa net bir hata verilir.

Menüyle çalışıyorsanız isim hatırlamak gerekmez: çalışan proxy varken
`bin/proxy-run` komutunun provider listesinde **`⟳ çalışan proxy'ye bağlan`**
seçeneği de görünür.

İlk argüman hem bir provider hem bir örnek adıysa provider kazanır (eski
davranış korunur); örnek adına açıkça bağlanmak için `attach` kullanın.
`--foreground` ve `--list` bu akışta kullanılamaz.

Aynı appProxy kurulumu birden çok projeden kullanılabildiği için örnekler
başlatıldıkları projeyle kaydedilir:

| Komut | Etki |
| --- | --- |
| `stop` | Yalnızca **bu projenin** proxy'leri durur; diğer projelerinki çalışmaya devam eder |
| `stop <isim>` | Yalnızca o örnek; başka projeye aitse `--force` olmadan reddeder |
| `stop all` | Bu kurulumun izlediği **tüm** örnekler (proje ayrımı yok) |

Eski sürümle başlatılmış (proje kaydı olmayan) örnekler `stop` ile
durdurulmaz; `stop <isim>` ile tek tek durdurulabilir. Bu kurulumun `run/`
kaydında olmayan, başka bir dizinden başlatılmış proxy'ler de `[izlenmeyen]`
etiketiyle listelenir.

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
- OpenAI (SDK / OpenAI-uyumlu istemciler): `http://127.0.0.1:8790/<provider>/v1/chat/completions`
- Model listesi: `http://127.0.0.1:8790/<provider>/v1/models`

`<provider>` ∈ `gemini`, `nvidia`, `openrouter`, `cohere`, `amd`, `lfm3` +
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

### 4. Doğrulama

```bash
# Sunucu başlangıç mesajı: "appProxy listening on http://127.0.0.1:8790 (default=openrouter)"
curl -s -H "X-Api-Key: $PROXY_TOKEN" \
  "http://127.0.0.1:8790/openrouter/v1/chat/completions" -X POST \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"test"}]}'
```

### 5. Sunucuyu Durdurma

```bash
bin/proxy-run stop            # bu projeden başlatılan tüm proxy'ler
bin/proxy-run stop <isim>     # isimli örnek (başka projedense --force)
bin/proxy-run stop all        # bu kurulumun tüm örnekleri
# veya tüm süreçleri elle bitirirken (diğer projeler dahil):
pkill -f "node src/server.mjs"
```

---

## 🧪 Testler

```bash
npm test
```

`node --test` ile çalışır — `tests/*.test.mjs`: URL eşleme, model keşfi, imza
gidiş-dönüşü, model eşleme, model fallback, log yazımı, sihirbazlar.

---

## 🏗️ Mimari

```
appProxy/
├── bin/                # wrapper betikleri (proxy-run, claude-gemini, ...)
├── config/             # providers.json + models.json
├── docs/               # resmî doküman aynası (Anthropic, Google, NVIDIA, OpenRouter)
├── logs/               # proxy logları (git'e gitmez)
├── run/                # runtime dosyaları (pid, port, host, model, provider; isimli örnekler run/instances/ altında) (git'e gitmez)
├── scripts/            # fetch-docs.sh, html_to_text.py
├── src/
│   ├── server.mjs      # yönlendirici + kimlik doğrulama + akış
│   ├── cli.mjs         # doctor | models | urls | add-provider | remove-provider
│   ├── config.mjs      # .env + config yükleme
│   ├── add-provider.mjs / remove-provider.mjs   # sihirbazlar
│   ├── providers/      # anthropic | cohere | gemini | openai bağdaştırıcıları
│   ├── translate/      # protokol çevirileri (anthropic ↔ openai ↔ cohere)
│   ├── http.mjs, sse.mjs, errors.mjs, log.mjs
│   ├── auth.mjs        # PROXY_TOKEN denetimi (loopback dışı fail-closed)
│   ├── tokens.mjs      # kaba token tahmini (count_tokens + akış)
│   └── models.mjs      # model keşfi + eşleme
└── tests/              # birim testler
```

- `src/server.mjs` — yönlendirme: `<provider>/v1/messages` + `<provider>/v1/chat/completions`
- `src/translate/` — protokol çevirileri (anthropic ↔ openai ↔ cohere); Gemini, OpenAI uyumlu ucundan geçer
- `src/providers/` — sağlayıcıya özgü upstream bağdaştırıcıları
- `src/add-provider.mjs` / `src/remove-provider.mjs` — etkileşimli sihirbazlar
- `config/providers.json` + `config/models.json` — sağlayıcı ve model eşleme yapılandırması
- Sıfır npm bağımlılığı: yalnızca Node.js (>= 20) standart kütüphanesi

---

## 🔒 Güvenlik

- `.env` asla commit edilmez (`.gitignore`) ve anahtar değerleri loglara yazılmaz.
- Proxy, `PROXY_TOKEN` ile doğrular; gerçek sağlayıcı anahtarı istemciden gizli kalır.
- `PROXY_TOKEN` boşsa yalnızca loopback istemcileri kabul edilir. `PROXY_HOST=0.0.0.0`
  yapıldığında dış istekler 401 alır (eskiden kimlik doğrulama tamamen kapanıyordu).
- Sunucu varsayılan olarak yalnızca `127.0.0.1` dinler.
- `.env` içindeki anahtarlar açık metindir — saklama ve rotasyon sorumluluğu
  kullanıcudadır.
- `PROXY_LOG_BODIES=0` varsayılandır; prompt gövdeleri loglanmaz. Upstream hata
  gövdeleri prompt'u geri yansıttığı için varsayılanda yalnızca boyutları loglanır.

---

## 🐛 Sorun Giderme

| Hata | Olası neden | Çözüm |
| --- | --- | --- |
| `command not found: claude` | Claude Code yüklü değil | Claude Code'u ayrıca kurun |
| Node sürüm hatası | Node < 20 | Node 20+ yükleyin |
| `401 Unauthorized` | Anahtar boş veya yanlış | `.env`'yi kontrol edin, `npm run doctor` ile özet alın |
| Port çakışması | 8790 zaten kullanımda | `PROXY_PORT` ile farklı port deneyin |
| Provider listede görünmüyor | `config/providers.json` güncel değil | `bin/proxy-run add` ile yeniden ekleyin |
| Model keşfi başarısız | Upstream kapalı / anahtar hatalı | `npm run models <provider>` ile deneyin, `PROXY_LOG_BODIES=1` ile logları artırın |
| `There's an issue with the selected model` | Upstream seçilen/hızlı modeli sunmuyor | `tail -n 30 logs/proxy-run.log` içindeki `request.failed` satırına (`status`, `upstreamBody`) bakın; takma adlar `bin/claude-env.sh` ile eşlenir; gerekirse `fastModel`'i değiştirin ([Model Eşlemesi](#-claude-code-model-eşlemesi-ve-fallback)) |
| `selected model` hatası, log'da `/v1/v1/messages` | `ANTHROPIC_BASE_URL` sonunda fazladan `/v1` var (Claude Code yola `/v1/messages` kendisi ekler) | Taban URL `http://127.0.0.1:8790/<provider>` olmalı (`proxy-run` artık böyle ayarlar; sunucu çift `/v1`'i de tolere eder) |
| `Response stream ended without a finish reason` (Cline) | Cline akış bekliyor, yanıt SSE değil | `--client cline` kullanın (base URL `.../<provider>/v1` olmalı); proxy'nin `stream:true` isteğini SSE'ye çevirdiğini `PROXY_LOG_BODIES=1` ile doğrulayın |
| Cline eski proxy'ye bağlanıyor | `cline auth` base URL'i `~/.cline` altında saklar | `bin/proxy-run <provider> <model> --client cline` ile yeniden yapılandırın (`cline auth ... -b` çıktısını kontrol edin) |
| `ESKİ bir proxy çalışıyor` | Önceki sürüm proxy portu tutuyor | `bin/proxy-run stop all`, sonra yeniden başlatın |
| `route.unknown` / 404 `not found` | İstemci desteklenmeyen bir yola istek attı | Log'daki `path` değerine bakın, `ANTHROPIC_BASE_URL`'in `/<provider>` ile bittiğini doğrulayın |
| `proxy-run: command not found` | Alias yüklenmedi | `source ~/.bashrc` veya `install.sh`'i yeniden çalıştırın |
| Anahtar `.git`'e gitmişse | `.env` yanlışlıkla eklenmiş | `git rm --cached .env` + anahtarları rotasyona uğratın |

---

**Lisans:** Proje özel (private) geliştirme aracıdır; dağıtım için izin gereklidir.
