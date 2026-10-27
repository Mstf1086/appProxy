# appProxy · Cline CLI ile kullanım

appProxy iki uyumlu API sunar; hangi aracı kullanırsan kullan aynı proxy'ye bağlanırsın:

| Endpoint | Yol | Uyumlu istemci |
| --- | --- | --- |
| OpenAI Chat Completions | `POST /<provider>/v1/chat/completions` | **Cline CLI (`openai-compatible`)**, herhangi bir OpenAI SDK'sı |
| OpenAI model listesi | `GET /<provider>/v1/models` | Cline CLI, OpenAI SDK |
| Anthropic Messages | `POST /<provider>/v1/messages` | **Claude Code**, Anthropic SDK |

`<provider>` ∈ `gemini`, `nvidia`, `openrouter`, `cohere`, `refuseless` + sihirbazla eklenenler (yol belirtilmezse `DEFAULT_PROVIDER` kullanılır; `npm run doctor` ile listele).

## Hızlı başlangıç

```bash
bin/proxy-run
```

Akış sırayla şöyle işler:

1. **Provider seçimi** — `config/providers.json`'daki sağlayıcılar listelenir.
2. **Model seçimi** — sağlayıcının TÜM modelleri canlı listelenir (`--filter` ile daraltılabilir).
3. **İstemci seçimi** — `cline`, `claude`, `pi cli` veya `sadece proxy`:
   - `cline` → proxy arka planda başlar, Cline'ın `openai-compatible` sağlayıcısı
     otomatik yapılandırılır (`cline auth ...`) ve Cline bu terminalde açılır.
   - `claude` → proxy arka planda başlar, `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` /
     `ANTHROPIC_MODEL` ortam değişkenleri ayarlanır ve Claude Code bu terminalde açılır.
   - `pi cli` → proxy arka planda başlar; Pi CLI (https://pi.dev) seçilen
     provider/model ile başlatılır ve doğrudan sağlayıcının ucuna bağlanır
     (`pi --provider <p> --model <m>`). Proxy bir ara yüz değildir.
     Pi'nin yerleşik desteklemediği sağlayıcılar (cohere, refuseless, ...)
     için `~/.pi/agent/models.json`'a otomatik `"managedBy": "appProxy"`
     işaretli provider tanımı yazılır; appProxy `.env`'indeki anahtar Pi'ye
     aktarılır. Kendi models.json tanımınız varsa üzerine yazılmaz.
   - `sadece proxy` → yalnızca proxy başlar; el ile bağlanmak için ekrana hazır komutlar yazılır.

Çalışan bir proxy varken `proxy-run` yeniden çalıştırılırsa önceki proxy'nin kapatılıp
kapatılmayacağı sorulur: "kapat" derseniz önceki(ler) durur ve aynı port yeniden
kullanılır; "açık kalsın" derseniz yeni proxy'ye bir isim verirsiniz ve boş bir
portta açılır. İsimli örnekler `run/instances/<isim>/` ile izlenir.

İstemciyi baştan belirtmek istersen:

```bash
bin/proxy-run <provider> <model> --client cline    # Cline'ı başlat
bin/proxy-run <provider> <model> --client claude   # Claude Code'u başlat
bin/proxy-run <provider> <model> --client pi       # Pi CLI'ı (https://pi.dev) başlat
bin/proxy-run <provider> <model> --client none     # sadece proxy
```

Her iki istemci de proxy arkada çalışırken açılır; çıktıktan sonra proxy çalışmaya devam eder,
durdurmak için `bin/proxy-run stop` (isimli örnek için `bin/proxy-run stop <isim>`,
tümü için `bin/proxy-run stop all`). İstemci, `proxy-run`'ın çağrıldığı dizinde başlar.

El ile bağlanmak istersen (ör. ayrı bir terminalden):

```bash
# Proxy token'ını .env'den al (koda/loglara asla yazılmaz)
export PROXY_TOKEN="$(grep -E "^PROXY_TOKEN=" .env | cut -d= -f2-)"

# Cline CLI (openai-compatible)
cline auth openai-compatible -k "$PROXY_TOKEN" -m "<model>" -b "http://127.0.0.1:8790/<provider>/v1"
cline -P openai-compatible -m "<model>" "..."

# Claude Code (anthropic)
export ANTHROPIC_BASE_URL="http://127.0.0.1:8790/<provider>/v1"
export ANTHROPIC_AUTH_TOKEN="$PROXY_TOKEN"
export ANTHROPIC_MODEL="<model>"
claude
```

## proxy-run komutları

| Komut | Açıklama |
| --- | --- |
| `bin/proxy-run` | İnteraktif provider + model seçimi, arka planda başlatma |
| `bin/proxy-run <provider>` | Provider sabit, model listesi interaktif |
| `bin/proxy-run <provider> <model>` | Model sabit, istemci interaktif |
| `bin/proxy-run <provider> <model> --client cline\|claude\|pi\|none` | İstemciyi soru sormadan başlat |
| `bin/proxy-run <provider> --list` | Sadece modelleri listele |
| `bin/proxy-run <provider> --filter kimi` | Model listesini filtrele |
| `bin/proxy-run --foreground <provider> <model>` | Ön planda çalıştır (Ctrl+C ile dur) |
| `bin/proxy-run add` | Yeni provider ekleme sihirbazı (config + .env anahtar satırı) |
| `bin/proxy-run remove [provider]` | Provider'ı config'den kaldır (onay ister; `.env` anahtar satırını da siler) |
| `bin/proxy-run models [provider]` | Modelleri listele (proxy çalışmasa da olur) |
| `bin/proxy-run status` | Çalışan proxy örneklerinin durumu (varsayılan + isimli) |
| `bin/proxy-run stop [isim\|all]` | Varsayılan / isimli / tüm örnekleri durdur |
| `npm run proxy:run` | `bin/proxy-run` için npm kısayolu |
| `npm run models` | `node src/cli.mjs models` |
| `npm run urls` | Proxy/upstream URL özeti |
| `npm run doctor` | Anahtar/endpoint özeti (anahtarlar maskelenir) |

Model listesi sağlayıcının resmî `/models` endpoint'inden **canlı** çekilir
(OpenAI-uyumlu: `{baseUrl}/models`, OpenRouter/NIM: `{baseUrl}/v1/models`,
Gemini: `{baseUrl}/{apiVersion}/models`; yalnızca `generateContent` destekleyenler).
Upstream erişilemezse `config/models.json` presetlerine düşer.

## OpenAI-uyumlu yol nasıl çalışıyor?

Proxy, isteği sağlayıcının **kendi** OpenAI-uyumlu endpoint'ine yönlendirir — araç çağrısı
(tool calling) ve streaming upstream'in doğal biçiminde korunur:

| kind | Upstream chat endpoint | Kaynak |
| --- | --- | --- |
| `openai` | `{baseUrl}/chat/completions` | `docs/nvidia/nim-api-reference.md`, `docs/openrouter/` |
| `anthropic` | `{baseUrl}/v1/chat/completions` | OpenRouter, NIM |
| `gemini` | `{baseUrl}/{apiVersion}/openai/chat/completions` | `docs/gemini/openai-compatibility.md` |
| `cohere` | `{baseUrl}/v2/chat` | `docs/cohere/api-notes.md` (docs.cohere.com/reference/chat) |

Ayrıca:

- **Model eşleme**: Cline hangi model ID'sini isterse istesin `config/models.json`
  kuralları sağlayıcının gerçek modeline çevirir (`claude-sonnet-4-5-20250929` →
  `gemini-3.8-flash` gibi). Sağlayıcı modeli doğrudan da verilebilir
  (`-m glm-5.3-flash-abliterated`).
- **Gemini thought-signature**: Gemini 3+ her tool call'a şifreli bir
  `thought_signature` ekler ve bir sonraki istekte bu imzanın geri gelmesini ister;
  eksikse upstream 400 döner (`docs/gemini/openai-compatibility.md` → thought
  signatures). Cline bu alanı düşürdüğü için proxy imzaları yanıtlardan yakalayıp
  (`src/gemini-signature.mjs`) sonraki isteklerde tool call'lara geri enjekte eder.
- **Kimlik**: `PROXY_TOKEN` (`x-api-key` veya `Authorization: Bearer`) proxy'de
  doğrulanır; gerçek sağlayıcı anahtarı yalnızca `.env`'den okunur ve istemciye asla
  gönderilmez.
- **Günlük**: `logs/proxy-YYYY-AA-GG.jsonl`; prompt içerikleri yalnızca
  `PROXY_LOG_BODIES=1` ile loglanır, kimlik headerları her durumda maskelenir.

## Claude Code ile aynı proxy

`proxy-run` içinde `claude` seçeneği bu adımları otomatik yapar; el ile bağlanmak için:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8790/<provider>/v1"
export ANTHROPIC_AUTH_TOKEN="$PROXY_TOKEN"
export ANTHROPIC_MODEL="<seçilen-model>"
claude
```

## Sorun giderme

| Belirti | Sebep / çözüm |
| --- | --- |
| `401 invalid proxy token` | `-k` değeri `.env` içindeki `PROXY_TOKEN` ile aynı değil |
| `404 not found` | Base URL `/v1` ile bitmiyor veya provider adı yanlış |
| `unknown provider: ...` | `config/providers.json`'da olmayan isim; `npm run doctor` ile listele |
| `upstream 401/402` | Sağlayıcı anahtarı eksik ya da kredi bitti (ör. Refuseless "Insufficient credits") |
| `cohere` kullanımı | `config/models.json` içindeki `cohere` kurallarını kontrol edin; varsayılan model `command-a-plus-05-2026`, hızlı model `command-r7b-12-2024`, model ID'ler `command-` öneki ile başlar; `bin/proxy-run cohere --list` ile modelleri test edin. |
| `503 high demand` | Upstream model geçici olarak yoğun; başka model dene (`--filter` ile) |
| Model listesi boş | Anahtar yok / upstream kapalı → presetler kullanılır; `.env`'i kontrol et |
| Ücretsiz `:free` model istense de kredi hatası (`credits have been used up`) | İstenen model `config/models.json`'daki `passthroughPrefixes`'e takılmadığı için `'*'` kuralıyla varsayılan (ücretli) modele eşlenmiş olabilir; modelin satıcı önekini (ör. `deepseek/`) `passthroughPrefixes`'e ekle — proxy loglarındaki `requestedModel` ile `model` alanlarını karşılaştır |
| Yanlışlıkla eklenen provider | `bin/proxy-run remove <ad>` ile kaldır (onay ister; `config/providers.json`, `config/models.json` ve `.env` anahtar satırını temizler) |
| Cline hep plan sunuyor | `~/.cline/data/settings/global-settings.json` içinde `planActMode: plan` olabilir; `cline -y` ile act modunda çalıştır veya ayarı değiştir |
| Tool call sonrası 400 (yalnızca Gemini) | İmza enjeksiyonu devre dışı kalmış olamaz; `gemini.signature.injected` için proxy loglarına bak |


## Kurallar

appProxy **Cline CLI** ve **Claude Code** ile birlikte çalışmak üzere tasarlanmıştır; her iki aracı da
aynı proxy'ye bağlanırsınız. Aşağıdaki kurallar her iki aracın kullanımında da geçerlidir.

### 🔐 Anahtar güvenliği kuralları

- `.env` asla git'e eklenmez (`.gitignore`) ve asla loglara/ekrana yazılmaz.
- Gerçek API anahtarları koda gömülmez; yalnızca `.env`'den okunur.
- `.env` içinde GEMINI_API_KEY, REFUSELESS_API_KEY ve APINEX_API_KEY açık metin yazıyor.
  Bu anahtarlar `.gitignore` kapsamındadır ve git'e gitmez, ancak **açık metin içerikleri**
  potansiyel bir sızıntı riskidir — kullanıyorsanız rotasyon yapın.
- Provider eklerken anahtar `bin/proxy-run add` / `cli.mjs add-provider` sihirbazı aracılığıyla
  girilir, yalnızca `.env`'ye yazılır; ekrana/loga asla yazılmaz.
- `claude` clientı seçildiğinde otomatik olarak `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_MODEL`
  ortam değişkenleri ayarlanır; gerçek anahtarı koda girmeyin.

### 💰 Token tasarrufu kuralları

- **Hızlı model tercih edin:** Küçük düzeltmeler, soru-cevap ve arka plan görevleri için
  her zaman `fastModel`'ı kullanın (claude-haiku, gemini-3.5-flash-lite, command-r7b).
  Refactoring, planlama ve karmaşık görevler için `defaultModel`'ı seçin.
- **Model eşleme kurallarının farkında olun:** `config/models.json`'daki eşleşme kuralları
  Claude Code'un istediği model ID'sini sağlayıcının ucuz/hızlı modeline çevirebilir
  (`*haiku*` → `gemini-3.5-flash-lite` gibi). Hedefiniz ucuz modelse eşleme kurallarını
  kontrol edin; doğrudan model ID'si verilebilir (`-m claude-haiku-5.5` vb.).
- **Reasoning bütçesini sınırlayın:** Gemini'de `thinkingConfig` için `budgetTokens`'ı
  düşük tutun (varsayılan 8192); gereksiz derin düşünme token harcar.
- **Prompt'u kısa ve net tutun:** Her istekte yalnızca gerekeni yazın; açıklama/kibarlık
  kalıplarını gereksiz uzatmaktan kaçının. Gereksiz tekrarlı sorular yerine tek, net prompt kullanın.
- **Claude Code ile `tool_result` uzunluğunu kontrol edin:** Büyük dosya/çıktı durumlarında
  doğrudan çalıştırmak yerine `head`/`grep`/`wc` gibi ara araçlarla özet alın.
- **Cline ile plan adımını kısaltın:** Görev basitse `/plan` devre dışı bırakın; `cline -y`
  act modunda doğrudan işlem yapar.
- **Log gürültüsünü kısıntı:** `PROXY_LOG_BODIES=0` varsayılandır; prompt gövdeleri loglanmaz.
  Gerektiğinde `1` yapmayın — açık metin anahtarları içeren gövde sızıntısını önler.

## Testler

```bash
npm test   # tests/*.test.mjs — URL eşleme, model keşfi, imza gidiş-dönüşü, model eşleme
```
