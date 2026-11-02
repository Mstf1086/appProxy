/**
 * Anthropic SSE event writer.
 *
 * Claude Code reads each streaming response event by event and expects the full
 * sequence, in order, ending with `message_delta` and `message_stop`
 * (docs/anthropic/claude-code/llm-gateway-protocol.md → Streaming).
 *
 * Event shapes come from docs/anthropic/api/streaming.md.
 */

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

export function randomId(prefix = 'msg') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export class AnthropicStream {
  constructor(res, { onEvent = null, headers = {} } = {}) {
    this.res = res;
    this.onEvent = onEvent;
    this.extraHeaders = headers;
    this.headersSent = false;
    this.index = 0;
    this.openBlocks = new Set();
    this.state = 'init';
    this.startedAt = Date.now();
    this.eventCount = 0;
    this.outputTokens = 0;
    this.messageId = null;
    // Backpressure: res.write() returns false once the socket buffer is full.
    // Ignoring it lets a slow client turn into unbounded memory growth, so the
    // upstream read loop awaits throttle() before pulling the next event.
    this.paused = false;
    this.waiters = [];
    this.heartbeat = null;
    if (typeof res.on === 'function') {
      res.on('drain', () => this.release());
      res.on('close', () => this.release());
    }
  }

  /** Wake every throttle() waiter (socket drained, or the client went away). */
  release() {
    this.paused = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  /**
   * Resolves once the client socket can take more data. Bounded wait: a client
   * that stopped reading must not hang the request forever.
   */
  async throttle({ timeoutMs = 30000 } = {}) {
    if (!this.paused) return;
    await new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(finish, timeoutMs);
      timer.unref?.();
      this.waiters.push(finish);
    });
  }

  writeHead() {
    if (this.headersSent) return;
    this.res.writeHead(200, { ...SSE_HEADERS, ...this.extraHeaders });
    this.headersSent = true;
  }

  /**
   * Idle keep-alive: reasoning models can think for tens of seconds before the
   * first token, and clients abort an idle turn. `event: ping` is part of the
   * Anthropic streaming protocol, so it is safe mid-stream.
   */
  startHeartbeat(intervalMs = 15000) {
    if (this.heartbeat || !(intervalMs > 0)) return;
    this.heartbeat = setInterval(() => {
      if (this.state === 'done' || this.state === 'error' || this.res.writableEnded) {
        this.stopHeartbeat();
        return;
      }
      try {
        this.ping();
      } catch {
        this.stopHeartbeat();
      }
    }, intervalMs);
    this.heartbeat.unref?.();
  }

  stopHeartbeat() {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  send(event, data) {
    this.writeHead();
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    if (this.res.write(frame) === false) this.paused = true;
    this.eventCount += 1;
    if (this.onEvent) this.onEvent(event, data);
  }

  ping() {
    this.send('ping', { type: 'ping' });
  }

  messageStart({ id = randomId('msg'), model, inputTokens = 0, outputTokens = 0 } = {}) {
    this.messageId = id;
    this.state = 'streaming';
    this.send('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      },
    });
  }

  startBlock(contentBlock) {
    const index = this.index++;
    this.openBlocks.add(index);
    this.send('content_block_start', { type: 'content_block_start', index, content_block: contentBlock });
    return index;
  }

  startText() {
    return this.startBlock({ type: 'text', text: '' });
  }

  startThinking() {
    return this.startBlock({ type: 'thinking', thinking: '' });
  }

  startToolUse({ id, name }) {
    return this.startBlock({ type: 'tool_use', id, name, input: {} });
  }

  delta(index, delta) {
    this.send('content_block_delta', { type: 'content_block_delta', index, delta });
  }

  textDelta(index, text) {
    if (text) this.delta(index, { type: 'text_delta', text });
  }

  thinkingDelta(index, thinking) {
    if (thinking) this.delta(index, { type: 'thinking_delta', thinking });
  }

  signatureDelta(index, signature) {
    this.delta(index, { type: 'signature_delta', signature });
  }

  inputJsonDelta(index, partialJson) {
    this.delta(index, { type: 'input_json_delta', partial_json: partialJson });
  }

  stopBlock(index) {
    if (!this.openBlocks.has(index)) return;
    this.openBlocks.delete(index);
    this.send('content_block_stop', { type: 'content_block_stop', index });
  }

  /**
   * Emits the final `message_delta` + `message_stop` pair. Required.
   *
   * `inputTokens` is optional: upstreams only report `prompt_tokens` in their
   * last chunk, so the exact count can only be corrected here. Clients that
   * track context from the final usage (rather than from `message_start`) get
   * the real number instead of the estimate.
   */
  finish({ stopReason = 'end_turn', stopSequence = null, outputTokens = null, inputTokens = null } = {}) {
    for (const index of [...this.openBlocks]) this.stopBlock(index);
    const usage = { output_tokens: outputTokens ?? this.outputTokens };
    if (typeof inputTokens === 'number') usage.input_tokens = inputTokens;
    this.send('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: stopSequence },
      usage,
    });
    this.send('message_stop', { type: 'message_stop' });
    this.state = 'done';
    this.stopHeartbeat();
  }

  /** Mid-stream error surface (docs/anthropic/api/streaming.md → Error events). */
  errorEvent(type, message) {
    this.send('error', { type: 'error', error: { type, message } });
    this.state = 'error';
  }

  end() {
    this.stopHeartbeat();
    if (this.state !== 'done' && this.state !== 'error') {
      // Never leave the client hanging: the client treats a truncated body as a
      // dropped connection. Clip open blocks and finish with what we have.
      this.finish({ stopReason: 'end_turn' });
    }
    this.release();
    this.res.end();
  }
}

/** Non-streaming Anthropic Message object (docs/anthropic/api/messages.md). */
export function buildMessage({
  id = randomId('msg'),
  model,
  content,
  stopReason = 'end_turn',
  stopSequence = null,
  usage = {},
}) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage: {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      ...(usage.cache_read_input_tokens !== undefined
        ? { cache_read_input_tokens: usage.cache_read_input_tokens }
        : {}),
      ...(usage.cache_creation_input_tokens !== undefined
        ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
        : {}),
    },
  };
}
