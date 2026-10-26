/**
 * Anthropic Messages request → OpenAI Chat Completions request.
 * Used for OpenAI-compatible upstreams (NVIDIA hosted NIM,
 * docs/nvidia/nim-api-reference.md → "POST /v1/chat/completions").
 */

export function imagePartToOpenAi(block) {
  const source = block?.source ?? {};
  if (source.type === 'base64') {
    return { type: 'image_url', image_url: { url: `data:${source.media_type};base64,${source.data}` } };
  }
  if (source.type === 'url') {
    return { type: 'image_url', image_url: { url: source.url } };
  }
  return null;
}

function textOf(block) {
  return typeof block === 'string' ? block : (block?.text ?? '');
}

/** Anthropic tool definition → OpenAI function tool. */
export function toOpenAiTools(tools = []) {
  return tools
    .filter((tool) => tool?.name && (tool.input_schema || tool.type === 'custom' || !tool.type))
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.input_schema ?? { type: 'object', properties: {} },
      },
    }));
}

/** Anthropic tool_choice → OpenAI tool_choice (annotated in the gateway doc). */
export function toOpenAiToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  switch (toolChoice.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'tool':
      return { type: 'function', function: { name: toolChoice.name } };
    case 'none':
      return 'none';
    default:
      return undefined;
  }
}

function userContentParts(content = [], extras) {
  const parts = [];
  for (const block of content) {
    if (block?.type === 'text') {
      parts.push({ type: 'text', text: block.text ?? '' });
    } else if (block?.type === 'image' || block?.type === 'document') {
      const part = imagePartToOpenAi(block);
      if (part) parts.push(part);
      else if (extras) extras.droppedBlocks.push(block.type);
    }
  }
  return parts;
}

/** Convert the whole conversation. `tool_result` blocks become `role: "tool"` messages. */
export function toOpenAiMessages(request, { systemText = '' } = {}) {
  const messages = [];
  const droppedBlocks = [];
  if (systemText) messages.push({ role: 'system', content: systemText });

  for (const message of request.messages ?? []) {
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? [];

    if (message.role === 'assistant') {
      const textParts = [];
      const toolCalls = [];
      for (const block of content) {
        if (block?.type === 'text') textParts.push(block.text ?? '');
        else if (block?.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          });
        } else if (block?.type === 'thinking') {
          droppedBlocks.push('thinking');
        }
      }
      const out = { role: 'assistant' };
      out.content = textParts.join('');
      if (toolCalls.length) out.tool_calls = toolCalls;
      if (!out.content && !toolCalls.length) continue;
      messages.push(out);
      continue;
    }

    // user role: tool results first, then the remaining content.
    const toolResults = content.filter((block) => block?.type === 'tool_result');
    for (const block of toolResults) {
      let text = '';
      if (typeof block.content === 'string') text = block.content;
      else if (Array.isArray(block.content)) {
        text = block.content
          .map((inner) => (inner?.type === 'text' ? inner.text : inner?.type === 'image' ? '[image]' : ''))
          .filter(Boolean)
          .join('\n');
      }
      messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: text || '(no output)' });
    }
    const parts = userContentParts(
      content.filter((block) => block?.type !== 'tool_result'),
      { droppedBlocks },
    );
    if (parts.length === 0) continue;
    const onlyText = parts.every((part) => part.type === 'text');
    messages.push({ role: 'user', content: onlyText ? parts.map((p) => p.text).join('\n') : parts });
  }
  return { messages, droppedBlocks };
}

/**
 * Full request conversion.
 * @param {object} request normalized Anthropic request
 * @param {{systemText?: string, providerCfg?: object, stream?: boolean}} options
 */
export function toOpenAiRequest(request, { systemText = '', providerCfg = {}, stream = false } = {}) {
  const { messages, droppedBlocks } = toOpenAiMessages(request, { systemText });
  const body = { model: request.model, messages, stream: Boolean(stream) };

  const maxTokensField = providerCfg.maxTokensField ?? 'max_tokens';
  if (request.max_tokens) body[maxTokensField] = request.max_tokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.top_p !== undefined) body.top_p = request.top_p;
  if (Array.isArray(request.stop_sequences) && request.stop_sequences.length) {
    body.stop = request.stop_sequences;
  }
  if (request.tools?.length) body.tools = toOpenAiTools(request.tools);
  const toolChoice = toOpenAiToolChoice(request.tool_choice);
  if (toolChoice !== undefined) body.tool_choice = toolChoice;
  if (request.tool_choice?.disable_parallel_tool_use) body.parallel_tool_calls = false;
  if (stream && providerCfg.streamIncludeUsage !== false) body.stream_options = { include_usage: true };

  return { body, droppedBlocks };
}
