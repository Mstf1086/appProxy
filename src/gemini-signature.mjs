/**
 * Gemini thought-signature round-trip for the OpenAI-compatible ingress.
 *
 * Gemini 3+ models attach an encrypted `thought_signature` to every tool call
 * (docs/gemini/openai-compatibility.md → "thought signatures in chat completion
 * APIs"). The upstream rejects the NEXT request with 400 ("Function call is
 * missing a thought_signature in functionCall parts") when the signature is
 * dropped. Clients like Cline's openai-compatible provider strip unknown
 * fields such as `extra_content` when they echo tool calls back, so the proxy
 * captures signatures from upstream responses and re-injects them into the
 * tool calls of subsequent requests, keyed by tool-call id.
 */

const MAX_ENTRIES = 2000;
const TTL_MS = 6 * 60 * 60 * 1000;

/** tool_call id -> { sig, at } */
const store = new Map();

export function rememberSignature(id, sig) {
  if (!id || !sig) return;
  if (store.size >= MAX_ENTRIES) {
    // Map preserves insertion order: drop the oldest entries first.
    let dropped = 0;
    const drop = store.size - MAX_ENTRIES + 1;
    for (const key of store.keys()) {
      store.delete(key);
      dropped += 1;
      if (dropped >= drop) break;
    }
  }
  store.set(id, { sig, at: Date.now() });
}

export function recallSignature(id) {
  const entry = store.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) {
    store.delete(id);
    return undefined;
  }
  return entry.sig;
}

export function signatureStoreSize() {
  return store.size;
}

export function clearSignatures() {
  store.clear();
}

function signatureOf(node) {
  return node?.extra_content?.google?.thought_signature;
}

/** Non-streaming response: remember one signature per tool call. */
export function captureGeminiSignatures(json) {
  for (const choice of json?.choices ?? []) {
    const message = choice?.message ?? {};
    const messageSig = signatureOf(message);
    for (const call of message.tool_calls ?? []) {
      const sig = signatureOf(call) ?? messageSig;
      if (call?.id && sig) rememberSignature(call.id, sig);
    }
  }
}

/** Re-inject remembered signatures into a request body. Returns patched count. */
export function applyGeminiSignatures(body) {
  if (!Array.isArray(body?.messages)) return 0;
  let patched = 0;
  for (const message of body.messages) {
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (!call?.id || signatureOf(call)) continue;
      const sig = recallSignature(call.id);
      if (!sig) continue;
      call.extra_content = {
        ...(call.extra_content ?? {}),
        google: { ...(call.extra_content?.google ?? {}), thought_signature: sig },
      };
      patched += 1;
    }
  }
  return patched;
}

/**
 * Streaming capture: parses `data:` payloads of an SSE byte stream without
 * altering the bytes forwarded to the client.
 */
export class StreamSignatureCapture {
  constructor() {
    this.buffer = '';
    this.byChoice = new Map();
  }

  feed(text) {
    this.buffer += text;
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf('\n');
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        this.handleChunk(JSON.parse(data));
      } catch {
        // Partial or keep-alive payload: ignore.
      }
    }
  }

  handleChunk(chunk) {
    for (const choice of chunk?.choices ?? []) {
      const key = choice?.index ?? 0;
      const state = this.byChoice.get(key) ?? { sig: null, ids: [] };
      const delta = choice?.delta ?? {};
      const deltaSig = signatureOf(delta);
      if (deltaSig) state.sig = deltaSig;
      for (const call of delta.tool_calls ?? []) {
        const sig = signatureOf(call);
        if (call?.id) {
          if (!state.ids.includes(call.id)) state.ids.push(call.id);
          if (sig) rememberSignature(call.id, sig);
        } else if (sig) {
          // Signature arrived before the tool-call id: bind it later.
          state.sig = sig;
        }
      }
      this.byChoice.set(key, state);
      if (state.sig) {
        for (const id of state.ids) rememberSignature(id, state.sig);
      }
    }
  }

  /** Final binding pass once the stream ends. */
  finish() {
    for (const state of this.byChoice.values()) {
      if (state.sig) {
        for (const id of state.ids) rememberSignature(id, state.sig);
      }
    }
  }
}
