/**
 * Upstream 429 (rate limit) retry: bekle ve yeniden dene.
 *
 * Tüm sağlayıcılar/modeler için: upstream 429 döndürdüğünde proxy, isteği
 * istemciye hata olarak iletmeden önce bekleyip yeniden dener. Bekleme süresi:
 *   1. Upstream'in verdiği ipucu (Retry-After header'ı veya gövdedeki süre),
 *   2. yoksa varsayılan süre (PROXY_RATE_LIMIT_WAIT_MS, öntanımlı 30 sn).
 *
 * Yeniden deneme yalnızca istemciye hiçbir bayt yazılmadan önce mümkündür;
 * akış (streaming) başladıysa hata olduğu gibi iletilir.
 */
import { UpstreamError } from './errors.mjs';

/** 429'da öntanımlı bekleme (30 sn) — PROXY_RATE_LIMIT_WAIT_MS ile değiştirilir. */
export const DEFAULT_RATE_LIMIT_WAIT_MS = 30_000;
/** 429 için ek deneme sayısı (toplam istek = 1 + bu değer). */
export const DEFAULT_RATE_LIMIT_MAX_RETRIES = 2;
/** Upstream ipucu ne derse desin beklenen üst sınır (2 dk). */
export const MAX_RATE_LIMIT_WAIT_MS = 120_000;

function clampWaitMs(ms, maxWaitMs = MAX_RATE_LIMIT_WAIT_MS) {
  return Math.max(0, Math.min(ms, maxWaitMs));
}

/**
 * Upstream 429 yanıtından beklenecek süreyi (ms) çıkarır; süre bilgisi yoksa null.
 *
 * Sırasıyla:
 *   1. retry-after header'ı (retryHeadersFrom zaten tam sayı saniyeye normalize eder),
 *   2. retryDelay alanı (Gemini protobuf biçimi: "retryDelay":"42s"),
 *   3. metin içindeki süre ("please wait 42 seconds", "try again in 20s",
 *      "30 saniye sonra tekrar deneyin", "wait 1 minute").
 */
export function parseRetryDelayMs(message, headers = {}) {
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (raw != null) {
    const seconds = Number(String(raw).trim());
    if (Number.isFinite(seconds) && seconds >= 0) return clampWaitMs(seconds * 1000);
  }

  const text = String(message ?? '');
  if (!text) return null;

  // "retryDelay":"42s" / "retry_delay": 7 / "retryDelayMs": 5000
  const msField = text.match(/retry[_-]?delay[_-]?ms"?\s*[:=]\s*"?(\d+)/i);
  if (msField) return clampWaitMs(Number(msField[1]));
  const delayField = text.match(/retry[_-]?delay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)\s*s\b/i);
  if (delayField) return clampWaitMs(Number(delayField[1]) * 1000);

  // Metin: aynı cümlede bekleme/retry bağlamı ile birlikte geçen süre.
  // "please wait 42 seconds and try again", "try again in 20s",
  // "30 saniye sonra tekrar deneyin", "wait 1 minute".
  const unit = String.raw`(?:seconds?|secs?|saniye|sn|s|minutes?|mins?|dakika|dk)`;
  const before = new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*(${unit})\b[^.]{0,48}?(?:wait|again|retry|later|bekle|tekrar|sonra)`, 'i');
  const after = new RegExp(String.raw`(?:wait|sleep|again|retry|bekle|tekrar)[^.]{0,48}?(\d+(?:[.,]\d+)?)\s*(${unit})\b`, 'i');
  const match = text.match(before) ?? text.match(after);
  if (match) {
    const value = Number(String(match[1]).replace(',', '.'));
    const isMinutes = /min|dakika|dk\b/i.test(match[2] ?? '');
    if (Number.isFinite(value) && value > 0) {
      return clampWaitMs(value * (isMinutes ? 60_000 : 1000));
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fn'i çalıştırır; upstream 429 (UpstreamError) alınırsa bekleyip yeniden dener.
 * fn her çağrıda taze bir upstream isteği kurar (ctx.request read-only kullanılır).
 *
 * @param {() => Promise} fn handler çağrısı
 * @param {object} opts { log, provider, model, maxRetries, defaultWaitMs, maxWaitMs, res }
 */
export async function runWithRateLimitRetry(fn, {
  log = null,
  provider = '',
  model = '',
  maxRetries = DEFAULT_RATE_LIMIT_MAX_RETRIES,
  defaultWaitMs = DEFAULT_RATE_LIMIT_WAIT_MS,
  maxWaitMs = MAX_RATE_LIMIT_WAIT_MS,
  res = null,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof UpstreamError) || err.status !== 429) throw err;
      if (attempt >= maxRetries) throw err;
      // İstemciye yazmaya başladıysak yeniden denemek artık güvenli değil.
      if (res && (res.headersSent || res.writableEnded)) throw err;

      const hinted = parseRetryDelayMs(err.message, err.headers);
      const waitMs = Math.min(hinted ?? defaultWaitMs, maxWaitMs);
      log?.warn('upstream.rateLimited', {
        provider,
        model,
        attempt: attempt + 1,
        maxRetries,
        waitMs,
        hinted: hinted != null,
        upstreamMessage: String(err.message).slice(0, 200),
      });
      await sleep(waitMs);
    }
  }
}
