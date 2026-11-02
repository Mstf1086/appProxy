# AGENTS.md — appProxy

Bu dosya, bu repoda çalışan kod ajanları için proje talimatlarıdır. Claude Code
`AGENTS.md` dosyasını otomatik okur (v2.1.277+); depoda `CLAUDE.md` yoksa bu dosya
proje talimatı olarak yüklenir. Token bütçesi kuralları ayrıca
`.claude/rules/token-budget.md` içinde ve her oturumda otomatik yüklenir.

## Proje nedir

`appProxy`, **sıfır npm bağımlılığı** olan yerel bir LLM proxy'sidir (Node.js >= 20,
yalnızca standart kütüphane). İki uyumlu giriş sunar ve bunları sağlayıcıların
doğal API'lerine çevirir:

| Giriş | Yol | Hedef |
| --- | --- | --- |
| Anthropic Messages | `POST /<provider>/v1/messages` | Anthropic passthrough · OpenAI uyumlu · Cohere |
| OpenAI Chat Completions | `POST /<provider>/v1/chat/completions` | OpenAI uyumlu · Cohere |
| Model listesi | `GET /<provider>/v1/models` | sağlayıcının `/models` ucu |

Temel iş: **protokol çevirisi** (Anthropic ↔ OpenAI ↔ Cohere), SSE olay sırası,
araç çağrısı (tool_use), thinking/reasoning eşlemesi ve model adı eşlemesi.

## Harita

```
src/server.mjs        yönlendirme, kimlik doğrulama, istek gövdesi, hata yanıtı
src/auth.mjs          PROXY_TOKEN denetimi (loopback dışı fail-closed)
src/sse.mjs           AnthropicStream: olay yazıcı, ping, geri basınç
src/tokens.mjs        kaba token tahmini (count_tokens + akış)
src/providers/        anthropic | openai | gemini | cohere | pi bağdaştırıcıları
src/translate/        anthropic-in, openai-in/out, cohere-in/out
src/config.mjs        .env + config/*.json yükleme
src/cli.mjs           doctor | models | urls | add-provider | remove-provider
bin/proxy-run         interaktif başlatıcı (provider → model → istemci)
config/providers.json sağlayıcı tanımları (baseUrl, apiKeyEnv, mod)
config/models.json    model eşleme kuralları ve ön ayarlar
docs/                 resmî doküman aynası — KAYNAK, elle düzenlenmez
```

`providers/openai.mjs` içindeki `runOpenAiChat` ortak boru hattıdır: NVIDIA, Gemini
ve OpenAI uyumlu tüm sağlayıcılar aynı SSE çevirisini paylaşır. Yeni bir
"OpenAI konuşan" sağlayıcı eklerken bu hattı kullan, çeviri kodunu kopyalama.

## Komutlar

```bash
npm test                      # node --test tests/*.test.mjs (yaklaşık 2,5 sn)
node --test tests/x.test.mjs  # tek dosya
node src/cli.mjs doctor       # sağlayıcı + anahtar özeti
node src/cli.mjs urls <prov>  # anthropic/openai taban URL'leri
bin/proxy-run status          # çalışan örnekler + proje/dizin bilgisi
bin/proxy-run stop            # yalnızca bu projeden başlatılanları durdurur
bin/proxy-run <p> <m> --client cline   # proxy + Cline CLI (openai-compatible)
bin/proxy-run <isim>          # çalışan proxy'ye yeniden bağlan (yeni süreç yok)
bin/proxy-run attach <isim>   # aynısı; isim provider adıyla çakışıyorsa
```

## Bozulmaması gereken sözleşmeler

Bunlar testle korunuyor; değiştireceksen **önce** testi güncelle:

1. **İstek gövdesi tek seferde çözülür.** `readBody` Buffer'ları toplayıp sonda
   UTF-8'e çevirir. Parça parça çözmek çok baytlı karakterleri bozar
   (`tests/request-body.test.mjs`).
2. **SSE sırası**: `message_start` → `content_block_start` → `content_block_delta*`
   → `content_block_stop` → `message_delta` → `message_stop`. `ping` araya girebilir.
3. **`message_start` input_tokens**: upstream `prompt_tokens`'ı yalnızca son chunk'ta
   bildirir. Başlangıçta tahmin yazılır, `message_delta`'da gerçek değerle düzeltilir.
4. **Anthropic taban URL'si `/v1` içermez.** SDK yolu kendisi ekler; `/v1` varsa
   istek `/<provider>/v1/v1/messages` olur ve 404 döner.
5. **`PROXY_TOKEN` boşsa yalnızca loopback kabul edilir.** Dış istemci 401 alır;
   bu davranışı gevşetme.
6. **İstek/yanıt gövdeleri loglanmaz.** `PROXY_LOG_BODIES=1` yoksa yalnızca boyut
   yazılır. Upstream hata gövdeleri prompt'u geri yansıttığı için varsayılanda
   kırpılır (`summarizeErrorMessage`).
7. **Model eşlemesi `config/models.json` üzerinden** yapılır; istemcinin gönderdiği
   ad (`claude-sonnet-*` gibi) upstream'e olduğu gibi gitmez.
8. **`proxy-run stop` proje kapsamlıdır.** Her örnek `run/.../project` alanında
   başlatıldığı dizini taşır; `stop` yalnızca eşleşenleri durdurur. Bu alanı
   `list_running_instances` çıktısından (7. kolon) düşürürsen diğer projelerin
   proxy'leri de ölür (`tests/proxy-run-project.test.mjs`).
9. **Cline istemcisi `openai-compatible` sağlayıcısını kullanır.** `cline auth
   openai-compatible -k <token> -m <model> -b <...>/<provider>/v1` base URL'i
   `~/.cline` altına yazar; port/örnek değiştiği için her oturumda yeniden
   çağrılır. Cline akış bekler: yanıt SSE değilse
   `Response stream ended without a finish reason` hatası verir
   (`tests/proxy-run-cline.test.mjs`).
10. **`proxy-run <isim>` yeni süreç başlatmaz.** İlk argüman provider değil de
   çalışan bir örnek adıysa yalnızca istemci bağlanır: port/provider/model
   `run/` kaydından okunur, `/health` doğrulanır, `run/` dosyalarına yazılmaz.
   Provider adı çakışırsa provider kazanır; açık bağlanma `attach` iledir
   (`tests/proxy-run-attach.test.mjs`).

## Kod kuralları

- **Bağımlılık ekleme.** `dependencies` yok; çözüm standart kütüphanede olmalı.
- Node >= 20 API'leri: `fetch`, `AbortController`, `node:test`, `node:fs/promises`.
- ESM (`.mjs`), 2 boşluk girinti, tek tırnak, noktalı virgül.
- Tanımlayıcılar İngilizce; **yorumlar Türkçe**. Yorum, "ne" değil **"neden"**
  anlatır — özellikle bir hata/regresyonun nedenini.
- Yeni dosya açmadan önce mevcut bir dosyaya sığar mı diye bak; `src/` küçük ve
  dosya başına tek sorumluluk.
- Hata yolları: `UpstreamError` kullan, `status` + `body` + `headers` taşı.

## Test kuralları

- Her düzeltme **regresyon testi** ile gelir; test adı hatayı anlatır
  ("bölünmüş çok baytlı karakterler bozulmadan upstream'e ulaşır").
- Testler `node:test` + `node:assert/strict`; dış bağımlılık yok.
- Ağ gereken testlerde `globalThis.fetch` stub'lanır veya yerel `http` sunucusu
  `127.0.0.1` üzerinde açılır; gerçek API anahtarı kullanılmaz.
- Yeni test dosyası yazarken `tests/gemini-provider.test.mjs` şablonunu izle.

## Doküman aynası

`docs/` altındaki dosyalar `scripts/doc-sources.txt` + `scripts/fetch-docs.sh` ile
dış kaynaklardan indirilir. **Elle düzenlenmez** — değişiklik gerekiyorsa kaynak
listesine URL eklenip yeniden çekilir. `docs/openrouter/openapi.json` birebir
kopyadır; içinde geçen üçüncü taraf adları (ör. başka istemciler) temizlenmez.

## Git ve teslim

- Commit mesajları ASCII Türkçe (ç, ğ, ı, ö, ş, ü yerine c, g, i, o, s, u) ve
  `tip(kapsam): kısa emir kipi` biçiminde; gövdede **neden** anlatılır.
- Kullanıcı aksini söylemedikçe **doğrudan `master`'a push** edilir; PR açılmaz.
- Push öncesi: `npm test` yeşil + `bash -n bin/proxy-run` (betik değiştiyse).
- Kullanıcıya rapor: ne değişti (dosya + satır), nasıl doğrulandı (komut + sonuç),
  kalan risk. Kod bloğu yapıştırma, özet ver.

## Dil

Kullanıcı Türkçe konuşur; yanıtlar Türkçe. Kod, tanımlayıcı, commit mesajı ve
terminal çıktısı ASCII kalır. Doküman metinleri (README, docs) Türkçe ve gerçek
Türkçe karakterlerle yazılır — ASCII kuralı yalnızca commit mesajı ve kod içindir.
