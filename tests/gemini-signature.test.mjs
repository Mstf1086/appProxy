import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGeminiSignatures,
  captureGeminiSignatures,
  clearSignatures,
  recallSignature,
  rememberSignature,
  StreamSignatureCapture,
} from '../src/gemini-signature.mjs';

test('remember/recall round trip', () => {
  clearSignatures();
  rememberSignature('call_1', 'sig-abc');
  assert.equal(recallSignature('call_1'), 'sig-abc');
  assert.equal(recallSignature('missing'), undefined);
  clearSignatures();
});

test('captureGeminiSignatures stores per-tool-call signatures', () => {
  clearSignatures();
  captureGeminiSignatures({
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: 'call_a',
              function: { name: 'get_weather', arguments: '{}' },
              extra_content: { google: { thought_signature: 'sig-a' } },
            },
            {
              id: 'call_b',
              function: { name: 'get_time', arguments: '{}' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(recallSignature('call_a'), 'sig-a');
  assert.equal(recallSignature('call_b'), undefined);
  clearSignatures();
});

test('applyGeminiSignatures re-injects into assistant tool calls', () => {
  clearSignatures();
  rememberSignature('call_x', 'sig-x');
  const body = {
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_x', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_x', content: '15C' },
    ],
  };
  const patched = applyGeminiSignatures(body);
  assert.equal(patched, 1);
  assert.equal(body.messages[1].tool_calls[0].extra_content.google.thought_signature, 'sig-x');
  clearSignatures();
});

test('applyGeminiSignatures keeps an existing signature untouched', () => {
  clearSignatures();
  rememberSignature('call_y', 'sig-new');
  const body = {
    messages: [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_y',
            function: { name: 'f', arguments: '{}' },
            extra_content: { google: { thought_signature: 'sig-original' } },
          },
        ],
      },
    ],
  };
  assert.equal(applyGeminiSignatures(body), 0);
  assert.equal(body.messages[0].tool_calls[0].extra_content.google.thought_signature, 'sig-original');
  clearSignatures();
});

test('StreamSignatureCapture binds a delta signature to tool-call ids', () => {
  clearSignatures();
  const capture = new StreamSignatureCapture();
  capture.feed('data: ' + JSON.stringify({
    choices: [{ index: 0, delta: { tool_calls: [{ id: 'call_s', function: { name: 'f', arguments: '{}' } }] } }],
  }) + '\n\n');
  capture.feed('data: ' + JSON.stringify({
    choices: [{ index: 0, delta: { extra_content: { google: { thought_signature: 'sig-stream' } } } }],
  }) + '\n\n');
  capture.feed('data: [DONE]\n\n');
  capture.finish();
  assert.equal(recallSignature('call_s'), 'sig-stream');
  clearSignatures();
});

test('StreamSignatureCapture ignores partial JSON and comments', () => {
  clearSignatures();
  const capture = new StreamSignatureCapture();
  capture.feed(': keep-alive\n');
  capture.feed('data: {"choices":');
  capture.feed(JSON.stringify([{ index: 0, delta: { extra_content: { google: { thought_signature: 'sig-p' } } } }]) + '}\n\n');
  capture.finish();
  // No tool-call ids seen: nothing stored.
  assert.equal(recallSignature('nope'), undefined);
  clearSignatures();
});
