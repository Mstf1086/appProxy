# appProxy

**Claude Code ve Cline CLI için sıfır bağımlılıklı LLM proxy.** Tek yerel sunucu,
arkasında Gemini / OpenRouter / NVIDIA (NIM) / Cohere / OpenAI-uyumlu sağlayıcılar;
öne iki uyumlu API:

| Endpoint | Yol | Uyumlu istemci |
| --- | --- | --- |
| OpenAI Chat Completions | `POST /<provider>/v1/chat/completions` | **Cline CLI (`openai-compatible`)**, her OpenAI SDK |
| OpenAI model listesi | `GET /<provider>/v1/models` | Cline CLI, OpenAI SDK |
| Anthropic Messages | `POST /<provider>/v1/messages` | **Claude Code**, Anthropic SDK |

Her sağlayıcı kendi doğal API dilinde kullanılır (tool calling + streaming aynen
korunur); proxy model eşlemesi (`config/models.json`), kimlik maskesi ve thought
signature yönetimini üstlenir. Sağlayıcı anahtarları yalnızca `.env`'de kalır,
istemciye asla gönderilmez.

## Hızlı başlangıç

```bash
bin/proxy-run            # provider -> model -> istemci seçimi (interaktif)
bin/proxy-run status     # çalışan proxy durumu
bin/proxy-run stop       # durdur
```

Anahtarlar için `.env.example`'i `.env`'e kopyalayın: `PROXY_TOKEN` (proxy
kimliği) + sağlayıcı anahtarları (`GEMINI_API_KEY`, `CO_API_KEY`, ...).

## Yönetim

| Komut | Açıklama |
| --- | --- |
| `bin/proxy-run add` | Yeni provider sihirbazı (openai / anthropic / gemini / cohere) |
| `bin/proxy-run remove [provider]` | Provider'ı config'den kaldır (onay ister) |
| `bin/proxy-run models [provider]` | Modelleri listele |
| `npm run doctor` | Anahtar/endpoint özeti (anahtarlar maskelenir) |
| `npm test` | `node --test` — 40 test: çevrimeler, keşif, imza, sihirbazlar |

Ayrıntılı kullanım: [`CLINE.md`](./CLINE.md) · doküman aynası: [`docs/`](./docs/)

## Mimari

- `src/server.mjs` — yönlendirme: `<provider>/v1/messages` + `<provider>/v1/chat/completions`
- `src/translate/` — protokol çevirileri (anthropic ↔ openai ↔ gemini ↔ cohere)
- `src/providers/` — sağlayıcıya özgü upstream bağdaştırıcıları
- `src/add-provider.mjs` / `src/remove-provider.mjs` — etkileşimli sihirbazlar
- `config/providers.json` + `config/models.json` — sağlayıcı ve model eşleme yapılandırması
- Sıfır npm bağımlılığı: yalnızca Node.js (>= 20) standart kütüphanesi

## Güvenlik

- `.env` asla commit edilmez (`.gitignore`) ve anahtar değerleri loglara yazılmaz
- Proxy, `PROXY_TOKEN` ile doğrular; gerçek sağlayıcı anahtarı istemciden gizli kalır
- Sunucu varsayılan olarak yalnızca `127.0.0.1` dinler
