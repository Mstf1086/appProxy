# appProxy · Doküman Aynası (resmî kaynaklar)

Bu klasördeki tüm dosyalar **resmî (birinci el) dokümanlardan** indirilmiştir.
Üçüncü taraf blog, forum, makale veya topluluk içeriği **kullanılmaz**.

- Manifest (URL + HTTP + boyut + tarih): [`SOURCES.md`](./SOURCES.md)
- Kaynak listesi: [`../scripts/doc-sources.txt`](../scripts/doc-sources.txt)
- Yenileme: `scripts/fetch-docs.sh` (idempotent, hepsi) veya `scripts/fetch-docs.sh gemini`

Her dosyanın başında şu satırlar bulunur:

```
<!-- source: <resmî URL> -->
<!-- fetched: <UTC tarih> -->
<!-- official documentation mirror; do not edit by hand: run scripts/fetch-docs.sh -->
```

## Neyi nereden uyguluyoruz (bağlayıcı kararlar)

| Karar / davranış | Kaynak dosya |
| --- | --- |
| Claude Code'un proxy'den beklediği endpoint'ler, header/body iletimi, SSE sırası | `anthropic/claude-code/llm-gateway-protocol.md` |
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_DEFAULT_*_MODEL`, `CLAUDE_CODE_*` | `anthropic/claude-code/env-vars.md` |
| Model alias'ları, `ANTHROPIC_CUSTOM_MODEL_OPTION`, üçüncü taraf sağlayıcı pinleme | `anthropic/claude-code/model-config.md` |
| Messages API istek/yanıt şeması ve `count_tokens` | `anthropic/api/messages.md` |
| SSE olay tipleri ve **zorunlu olay sırası** | `anthropic/api/streaming.md` |
| Beta header ↔ body alanı eşleşmesi | `anthropic/claude-code/llm-gateway-protocol.md` + `anthropic/api/beta-headers.md` |
| Hata şemaları, retry davranışı | `anthropic/api/errors.md` |
| Gateway'e bağlanma/kurumsal dağıtım ayrıntıları | `anthropic/claude-code/llm-gateway-connect.md`, `llm-gateway-rollout.md`, `gateways.md` |
| Gemini native REST şeması (`generateContent`, `streamGenerateContent?alt=sse`, `countTokens`) | `gemini/generate-content-rest.md` + `gemini/generativelanguage-v1beta-discovery.json` (Google'ın resmî makine şeması) |
| Gemini tool calling (`functionDeclarations`, `functionCall`, `functionResponse`) | `gemini/function-calling.md` |
| Gemini düşünme (`thinkingConfig`, `thought`, `thoughtSignature`) | `gemini/thinking.md` |
| Gemini token sayımı | `gemini/token-counting.md` |
| Gemini OpenAI uyumluluğu (yedek/karşılaştırma) | `gemini/openai-compatibility.md` |
| Gemini model kimlikleri | `gemini/models.md` |
| NVIDIA NIM endpoint tablosu (`/v1/chat/completions`, `/v1/messages`, `count_tokens`) | `nvidia/nim-api-reference.md` |
| NVIDIA'nın resmî Claude Code entegrasyonu (env değişkenleri, alias eşleme, 404 model hatası) | `nvidia/use-claude-code-with-nim.md` |
| NVIDIA NIM LLM API/model listesi | `nvidia/nim-llm-apis.md`, `nvidia/hosted-models-snapshot.json` |
| OpenRouter Chat Completions şeması | `openrouter/api-reference-overview.md`, `openrouter/openapi.json` |
| OpenRouter Anthropic Messages API (proxy'nin passthrough hedefi) | `openrouter/anthropic-messages-create-a-message.md` |
| OpenRouter resmî Claude Code kurulumu (env değişkenleri) | `openrouter/claude-code-integration.md`, `openrouter/anthropic-agent-sdk.md` |
| OpenRouter sağlayıcı seçimi/öncelik | `openrouter/provider-selection.md` |
| Cline'ın Anthropic / Gemini / OpenRouter / OpenAI-uyumlu sağlayıcı ayarları | `cline/provider-*.md` |

## Notlar

- `gemini/generativelanguage-v1beta-discovery.json` ve `nvidia/hosted-models-snapshot.json`
  **makine tarafından okunur**; kod alan adları/parametreler için bunlara güvenir.
- `openrouter/openapi.json` 2.5 MB'lık resmî OpenAPI spesifikasyonudur.
- HTML kaynaklar (`gemini/*.md`, `nvidia/*.md`) `scripts/html_to_text.py` ile metne
  çevrilir; yalnızca Python standart kütüphanesi kullanılır.
