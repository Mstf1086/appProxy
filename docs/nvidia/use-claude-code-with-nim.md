<!-- source: https://docs.nvidia.com/nim/large-language-models/latest/ai-assistant-integrations/claude-code.html -->
<!-- fetched: 2026-10-24T21:20:26Z -->
<!-- official documentation mirror; do not edit by hand: run scripts/fetch-docs.sh -->

# Use Claude Code with NIM[#]

[Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) can use
NIM as its backend through the Anthropic-compatible `/v1/messages` endpoint.
For request and response details, refer to [Messages (Anthropic-compatible)].

## Prerequisites[#]

Before you start, complete the following prerequisites:

 -

Start a NIM deployment that serves a chat-capable model. For deployment
instructions, refer to the [Quickstart].

Note

Claude Code requires tool calling. Verify that your model supports tool use
before you rely on it with Claude Code. For instructions and troubleshooting,
refer to [Tool Calling and MCP Integration].

 -

Find the active model name and export it as `MODEL_NAME`. For more information,
refer to [Examples]. The examples on this page use this variable.

## Configure Claude Code with NIM[#]

To configure Claude Code with NIM, complete the following steps:

 -

Set the Claude Code environment variables to point to your NIM deployment, then start Claude Code.

```
export ANTHROPIC_BASE_URL="http://${NIM_ENDPOINT}:${NIM_SERVER_PORT}"
export ANTHROPIC_API_KEY="not-used"
export ANTHROPIC_CUSTOM_MODEL_OPTION="${MODEL_NAME}"
claude
```

 -

Replace `NIM_ENDPOINT` with the hostname or IP address of your NIM deployment.
Replace `NIM_SERVER_PORT` with the port, which is `8000` by default.

NIM does not validate `ANTHROPIC_API_KEY`. Set it to any non-empty string that
satisfies Claude Code or the Anthropic SDK client.

`ANTHROPIC_CUSTOM_MODEL_OPTION` adds the model to the Claude Code `/model`
picker. For additional options such as
`ANTHROPIC_CUSTOM_MODEL_OPTION_NAME` and
`ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION`, refer to the
[Claude Code model configuration documentation](https://code.claude.com/docs/en/model-config#add-a-custom-model-option).

 -

Optional: Map Claude Code built-in aliases to the model that NIM serves.

The custom model option adds a custom entry, but it does not replace Claude Code built-in
aliases such as `haiku`, `sonnet`, and `opus`. To map those aliases to the same
model that NIM serves, set the alias variables explicitly:

```
export ANTHROPIC_API_KEY="not-used"
export ANTHROPIC_BASE_URL="http://${NIM_ENDPOINT}:${NIM_SERVER_PORT}"
export ANTHROPIC_CUSTOM_MODEL_OPTION="${MODEL_NAME}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="${MODEL_NAME}"
export ANTHROPIC_DEFAULT_OPUS_MODEL="${MODEL_NAME}"
export ANTHROPIC_DEFAULT_SONNET_MODEL="${MODEL_NAME}"
export CLAUDE_CODE_SUBAGENT_MODEL="${MODEL_NAME}"
```

## Troubleshooting[#]

This section covers common issues when Claude Code or other Anthropic-compatible
clients connect to NIM through `/v1/messages`.

### Claude Code Returns a Model `404` Error[#]

Use this topic when Claude Code connects but requests a model name that NIM does not serve.

Symptoms

Claude Code appears to connect, but NIM logs contain errors such as the
following:

```
The model 'claude-haiku-4-5-20251001' does not exist
```

Cause

Claude Code can continue to use built-in aliases such as `haiku`, `sonnet`, or
`opus` for background functionality even after you add a custom model option.
If those aliases still resolve to Anthropic model IDs, NIM returns `404 Not Found` because it does not serve those model names.

Resolution

Map the Claude Code aliases to the same model name that NIM serves. To find the
active model name and export it as `MODEL_NAME`, refer to
[Examples].

```
export ANTHROPIC_API_KEY="not-used"
export ANTHROPIC_BASE_URL="http://${NIM_ENDPOINT}:${NIM_SERVER_PORT}"
export ANTHROPIC_CUSTOM_MODEL_OPTION="${MODEL_NAME}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="${MODEL_NAME}"
export ANTHROPIC_DEFAULT_OPUS_MODEL="${MODEL_NAME}"
export ANTHROPIC_DEFAULT_SONNET_MODEL="${MODEL_NAME}"
export CLAUDE_CODE_SUBAGENT_MODEL="${MODEL_NAME}"
```

## Next Steps[#]

After Claude Code can reach NIM, continue with the following topics:

 -

[Tool Calling and MCP Integration] if tool use fails.

 -

[Messages (Anthropic-compatible)] for `/v1/messages` request and response details.
