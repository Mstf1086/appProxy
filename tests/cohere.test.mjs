import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cohereEventToOpenAiChunks,
  cohereToOpenAiResponse,
  cohereUsage,
  finishReasonFromCohere,
} from '../src/translate/cohere-in.mjs';
import {
  cohereChatUrl,
  toCohereFromOpenAi,
  toCohereRequest,
  toCohereToolChoice,
} from '../src/translate/cohere-out.mjs';
import { fromOpenAiResponse } from '../src/translate/openai-in.mjs';
import { AnthropicStream } from '../src/sse.mjs';
import { OpenAiStreamAdapter } from '../src/translate/openai-in.mjs';

const PROVIDER_CFG = { kind: 'cohere', baseUrl: 'https://api.cohere.com' };

test('cohereChatUrl /v2/chat uretir', () => {
  assert.equal(cohereChatUrl(PROVIDER_CFG), 'https://api.cohere.com/v2/chat');
  assert.equal(cohereChatUrl({ ...PROVIDER_CFG, baseUrl: 'https://api.cohere.com/' }), 'https://api.cohere.com/v2/chat');
});

test('toCohereToolChoice Cohere enumlarina cevirir', () => {
  assert.equal(toCohereToolChoice('auto'), undefined);
  assert.equal(toCohereToolChoice('required'), 'REQUIRED');
  assert.equal(toCohereToolChoice('any'), 'REQUIRED');
  assert.equal(toCohereToolChoice('none'), 'NONE');
  assert.equal(toCohereToolChoice({ type: 'function', function: { name: 'x' } }), 'REQUIRED');
});

test('toCohereFromOpenAi alan farklarini yamalar', () => {
  const body = toCohereFromOpenAi(
    {
      model: 'command-a-plus-05-2026',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'merhaba' },
      ],
      max_tokens: 128,
      temperature: 0.5,
      top_p: 0.9,
      stop: ['STOP'],
      tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }],
      tool_choice: 'required',
      stream_options: { include_usage: true },
      parallel_tool_calls: false,
      n: 3,
    },
    { stream: true },
  );
  assert.equal(body.model, 'command-a-plus-05-2026');
  assert.equal(body.stream, true);
  assert.deepEqual(body.stop_sequences, ['STOP']);
  assert.equal(body.p, 0.9);
  assert.equal(body.tool_choice, 'REQUIRED');
  assert.equal(body.stream_options, undefined);
  assert.equal(body.parallel_tool_calls, undefined);
  assert.equal(body.n, undefined);
  assert.equal(body.tools.length, 1);
});

test('toCohereFromOpenAi assistant bos icerik gondermez', () => {
  const body = toCohereFromOpenAi(
    {
      model: 'm',
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
        },
      ],
    },
    {},
  );
  assert.equal(body.messages[0].content, undefined);
  assert.equal(body.messages[0].tool_calls.length, 1);
});

test('toCohereRequest Anthropic tool_result/tool_use akisini cevirir', () => {
  const request = {
    model: 'command-a-plus-05-2026',
    max_tokens: 100,
    system: 'sys',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hava nasil?' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu1', name: 'hava', input: { sehir: 'Ankara' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'gunesli' }],
      },
    ],
    tools: [{ name: 'hava', description: 'hava durumu', input_schema: { type: 'object', properties: {} } }],
    tool_choice: { type: 'any' },
  };
  const { body, droppedBlocks } = toCohereRequest(request, { systemText: 'sys', providerCfg: PROVIDER_CFG, stream: false });
  assert.deepEqual(droppedBlocks, []);
  assert.equal(body.system, undefined);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
  const assistant = body.messages[2];
  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.tool_calls[0].id, 'tu1');
  assert.equal(assistant.tool_calls[0].function.name, 'hava');
  const tool = body.messages[3];
  assert.equal(tool.role, 'tool');
  assert.equal(tool.tool_call_id, 'tu1');
  assert.equal(tool.content, 'gunesli');
  assert.equal(body.tool_choice, 'REQUIRED');
  assert.equal(body.tools[0].function.name, 'hava');
});

test('finishReasonFromCohere esleme', () => {
  assert.equal(finishReasonFromCohere('COMPLETE'), 'stop');
  assert.equal(finishReasonFromCohere('MAX_TOKENS'), 'length');
  assert.equal(finishReasonFromCohere('TOOL_CALL'), 'tool_calls');
  assert.equal(finishReasonFromCohere('STOP_SEQUENCE'), 'stop');
});

test('cohereUsage tokens > billed_units onceligi', () => {
  assert.deepEqual(
    cohereUsage({ tokens: { input_tokens: 10, output_tokens: 5 }, billed_units: { input_tokens: 3, output_tokens: 1 } }),
    { prompt_tokens: 10, completion_tokens: 5 },
  );
  assert.deepEqual(cohereUsage({ billed_units: { input_tokens: 3, output_tokens: 1 } }), { prompt_tokens: 3, completion_tokens: 1 });
});

test('cohereToOpenAiResponse metin + thinking + tool_calls', () => {
  const converted = cohereToOpenAiResponse(
    {
      id: 'co-123',
      finish_reason: 'TOOL_CALL',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Once plan...' },
          { type: 'text', text: 'Satis ozeti:' },
        ],
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'query_daily_sales_report', arguments: '{"day": "2023-09-29"}' },
          },
        ],
      },
      usage: { tokens: { input_tokens: 127, output_tokens: 69 } },
    },
    { model: 'command-a-plus-05-2026' },
  );
  const message = converted.choices[0].message;
  assert.equal(message.content, 'Satis ozeti:');
  assert.equal(message.reasoning, 'Once plan...');
  assert.equal(message.tool_calls[0].function.name, 'query_daily_sales_report');
  assert.equal(converted.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(converted.usage, { prompt_tokens: 127, completion_tokens: 69 });
});

test('Cohere yaniti -> OpenAI -> Anthropic tam zincir', () => {
  const converted = cohereToOpenAiResponse(
    {
      id: 'co-9',
      finish_reason: 'TOOL_CALL',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Rapor geliyor' }],
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'rapor', arguments: '{"day": "2023-09-29"}' } },
        ],
      },
      usage: { tokens: { input_tokens: 50, output_tokens: 20 } },
    },
    { model: 'command-a-plus-05-2026' },
  );
  const anthropic = fromOpenAiResponse(converted, { requestedModel: 'command-a-plus-05-2026' });
  assert.equal(anthropic.stopReason, 'tool_use');
  assert.deepEqual(anthropic.usage, { input_tokens: 50, output_tokens: 20 });
  const toolUse = anthropic.content.find((b) => b.type === 'tool_use');
  assert.equal(toolUse.id, 'call-1');
  assert.equal(toolUse.name, 'rapor');
  assert.deepEqual(toolUse.input, { day: '2023-09-29' });
  const text = anthropic.content.find((b) => b.type === 'text');
  assert.equal(text.text, 'Rapor geliyor');
});

test('cohereEventToOpenAiChunks SSE olaylarini cevirir', () => {
  const events = [
    { type: 'message-start', id: 'co-1' },
    { type: 'content-delta', index: 0, delta: { message: { content: { text: 'Mer' } } } },
    { type: 'content-delta', index: 0, delta: { message: { content: { text: 'haba' } } } },
    { type: 'tool-plan-delta', delta: { message: { tool_plan: 'Raporu cekerim' } } },
    {
      type: 'tool-call-start',
      index: 0,
      delta: { message: { tool_calls: { id: 'call-1', type: 'function', function: { name: 'rapor', arguments: '' } } } },
    },
    {
      type: 'tool-call-delta',
      index: 0,
      delta: { message: { tool_calls: { function: { arguments: '{"day":' } } } },
    },
    { type: 'tool-call-end', index: 0 },
    { type: 'content-end', index: 0 },
    {
      type: 'message-end',
      delta: { finish_reason: 'TOOL_CALL', usage: { tokens: { input_tokens: 30, output_tokens: 12 } } },
    },
  ];

  const chunks = events.flatMap((event) => cohereEventToOpenAiChunks(event, { model: 'm' }));
  assert.equal(chunks[0].choices[0].delta.role, 'assistant');
  assert.equal(chunks[0].id, 'co-1');
  assert.equal(chunks[1].choices[0].delta.content, 'Mer');
  assert.equal(chunks[2].choices[0].delta.content, 'haba');
  assert.equal(chunks[3].choices[0].delta.reasoning, 'Raporu cekerim');
  const tcStart = chunks[4].choices[0].delta.tool_calls[0];
  assert.equal(tcStart.id, 'call-1');
  assert.equal(tcStart.function.name, 'rapor');
  assert.equal(tcStart.index, 0);
  assert.equal(chunks[5].choices[0].delta.tool_calls[0].function.arguments, '{"day":');
  const last = chunks[chunks.length - 1];
  assert.equal(last.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(last.usage, { prompt_tokens: 30, completion_tokens: 12 });
  // bilgi tasimayan olaylar chunk uretmez
  assert.deepEqual(cohereEventToOpenAiChunks({ type: 'content-start', index: 0 }), []);
});

test('Cohere SSE -> OpenAiStreamAdapter -> AnthropicStream butunlesi', () => {
  const written = [];
  const fakeRes = {
    writeHead() {},
    write(chunk) {
      written.push(String(chunk));
      return true;
    },
    end() {},
  };
  const stream = new AnthropicStream(fakeRes);
  const adapter = new OpenAiStreamAdapter(stream, { requestedModel: 'command-a-plus-05-2026', mapReasoning: true });

  const events = [
    { type: 'message-start', id: 'co-2' },
    { type: 'content-delta', index: 0, delta: { message: { content: { text: 'Selam' } } } },
    {
      type: 'tool-call-start',
      index: 0,
      delta: { message: { tool_calls: { id: 'call-9', type: 'function', function: { name: 'topla', arguments: '' } } } },
    },
    { type: 'tool-call-delta', index: 0, delta: { message: { tool_calls: { function: { arguments: '{"a": 1}' } } } } },
    { type: 'message-end', delta: { finish_reason: 'TOOL_CALL', usage: { tokens: { input_tokens: 8, output_tokens: 4 } } } },
  ];
  for (const event of events) {
    for (const chunk of cohereEventToOpenAiChunks(event, { model: 'm' })) adapter.feed(chunk);
  }
  adapter.done();

  const text = written.join('');
  assert.match(text, /message_start/);
  assert.match(text, /text_delta/);
  assert.match(text, /content_block_start.*tool_use/s);
  assert.match(text, /input_json_delta/s);
  assert.match(text, /"stop_reason":"tool_use"/);
  // usage message_end yerine message_delta icinde tasinir
  assert.match(text, /"output_tokens":4/s);
});
