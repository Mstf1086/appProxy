<!-- source: https://docs.nvidia.com/nim/large-language-models/latest/ai-assistant-integrations/codex-cli.html -->
<!-- fetched: 2026-10-24T21:20:26Z -->
<!-- official documentation mirror; do not edit by hand: run scripts/fetch-docs.sh -->

# Use Codex CLI with NIM[#]

[Codex CLI](https://github.com/openai/codex) can use NIM LLM and VLM
as its backend through the OpenAI Responses API at `/v1/responses`. NIM forwards
these requests to the inference engine in your image, vLLM or SGLang. Confirm
tool calling with the endpoint check below before starting Codex CLI.
For request and response details, refer to
[Responses (OpenAI Responses API)].

## Prerequisites[#]

Before you start, complete the following prerequisites:

 -

Start a NIM deployment that serves a chat-capable model with tool calling and
reasoning parsing enabled. For deployment instructions, refer to the
[Quickstart].

Note

Codex CLI requires tool calling. Verify that your model supports tool use before
you rely on it with Codex CLI. For instructions and troubleshooting, refer to
[Tool Calling and MCP Integration].

Configure tool calling and reasoning parsing for the model and backend in your image.
On vLLM, enable automatic tool choice in addition to selecting the parser.
SGLang uses `--tool-call-parser` without `--enable-auto-tool-choice`.

The following table describes why Codex CLI needs each argument:

 |

Argument

 |

Why Codex CLI Needs It

 |

`--tool-call-parser <parser>` (plus `--enable-auto-tool-choice` on vLLM)

 |

Codex CLI drives every file edit and shell command through tool calls. Without a matching parser, the model emits tool calls as plain text and Codex CLI takes no action.

 |

`--reasoning-parser <parser>`

 |

Reasoning models emit thinking tokens. Without a parser, that text lands in the assistant message and Codex CLI renders the model’s internal reasoning as its answer.

Pass them as CLI arguments to the container. This preserves any
`NIM_PASSTHROUGH_ARGS` value provided by the image. The following example serves
`nvidia/nemotron-3-super-120b-a12b` on vLLM. NIM selects a model profile that matches the
available GPUs; to pin tensor parallelism or a specific profile, refer to
[Model Profiles and Selection].

```
export NIM_LLM_IMAGE=nvcr.io/nim/nvidia/nemotron-3-super-120b-a12b:2.1.4
export LOCAL_NIM_CACHE=~/.cache/nim
mkdir -p "$LOCAL_NIM_CACHE"

docker run --gpus=all --shm-size=16GB \
 -e NGC_API_KEY=$NGC_API_KEY \
 -e NIM_SERVED_MODEL_NAME="nvidia/nemotron-3-super-120b-a12b" \
 -v "$LOCAL_NIM_CACHE:/opt/nim/.cache" \
 -p 8000:8000 \
 ${NIM_LLM_IMAGE} \
 --enable-auto-tool-choice \
 --tool-call-parser qwen3_coder \
 --reasoning-parser nemotron_v3
```

Parser names depend on both the model and the inference engine. For the full list of built-in parsers, the
models each one supports, and how to supply a custom parser plugin, refer to
[Custom Parsers and Chat Templates]. For a Kubernetes workload, pass the same
arguments through the container `args` field. For the NIM Helm chart, use
`customArgs`; for a NIM Operator deployment that does not set `spec.multiNode`,
use `spec.args`. Do not use `spec.args` for a multi-node NIMService; the current
LeaderWorkerSet path does not propagate it to the leader or worker NIM
containers. For more information about these
interfaces and the `NIM_PASSTHROUGH_ARGS` fallback,
refer to [Advanced Configuration].

 -

Find the active model name and export it as `MODEL_NAME`. For more information,
refer to [Examples]. The examples on this page use this variable.

## Configure Codex CLI with NIM[#]

To configure Codex CLI with NIM, complete the following steps:

 -

Add a provider entry to `~/.codex/config.toml` that points at your NIM deployment.

Codex CLI reads its configuration from `~/.codex/config.toml`.

```
model = "nvidia/nemotron-3-super-120b-a12b"
model_provider = "nim"

[model_providers.nim]
name = "NVIDIA NIM"
base_url = "http://localhost:8000/v1"
env_key = "NIM_API_KEY"
wire_api = "responses"
```

The following table describes the provider settings:

 |

Setting

 |

Description

 |

`model`

 |

Must match the model name that NIM serves, exactly as returned by `/v1/models`. Model names that contain a slash, such as `nvidia/nemotron-3-super-120b-a12b`, are supported.

 |

`base_url`

 |

The NIM endpoint including the `/v1` suffix. Replace `localhost` with the hostname or IP address of your NIM deployment, and `8000` with `NIM_SERVER_PORT` if you changed it.

 |

`env_key`

 |

The environment variable Codex CLI reads the API key from. NIM does not validate this key, but Codex CLI requires the variable to be set to a non-empty value.

 |

`wire_api`

 |

Must be `"responses"`. Codex CLI uses the OpenAI Responses API, not Chat Completions.

 -

Set `NIM_API_KEY` to any non-empty string.

Because NIM does not validate the key, the following value is sufficient:

```
export NIM_API_KEY="not-used"
```

 -

Confirm that NIM answers a Responses API request with a tool call.

This is the exact interaction Codex CLI depends on:

```
curl -s http://localhost:8000/v1/responses \
 -H "Content-Type: application/json" \
 -d "{
 \"model\": \"${MODEL_NAME}\",
 \"input\": [{\"role\": \"user\", \"content\": \"Run 'ls -la /tmp' using the shell tool.\"}],
 \"tools\": [{
 \"type\": \"function\",
 \"name\": \"shell\",
 \"description\": \"Run a shell command\",
 \"parameters\": {
 \"type\": \"object\",
 \"properties\": {\"command\": {\"type\": \"string\"}},
 \"required\": [\"command\"]
 }
 }],
 \"tool_choice\": \"auto\"
 }"
```

A correctly configured deployment returns an `output` array containing a
`function_call` item. For a reasoning model started with `--reasoning-parser`, a
separate `reasoning` item can accompany it; non-reasoning models omit that item.
The following example shows a vLLM response. Item ordering and `call_id` values
can differ by backend:

```
{
 "output": [
 {"type": "reasoning", "content": [{"type": "reasoning_text", "text": "..."}]},
 {
 "type": "function_call",
 "name": "shell",
 "arguments": "{\"command\": \"ls -la /tmp\"}",
 "call_id": "chatcmpl-tool-9f8297ff253c311f",
 "status": "completed"
 }
 ]
}
```

If the response contains only a `message` item whose text describes the tool
call, tool calling is not enabled. If the reasoning text appears inside the
`message` item instead of a separate `reasoning` item, the reasoning parser is
not configured.

 -

Start Codex CLI from your project directory.

```
codex
```

## Troubleshooting[#]

This section covers common issues when Codex CLI or other Responses API clients
connect to NIM through `/v1/responses`. Codex CLI reads files, runs shell
commands, and edits files against NIM through standard function tool calls,
which NIM handles natively.

### Unsupported Tool Type on a gpt-oss Model (vLLM Backend)[#]

Use this topic when Codex CLI fails against a gpt-oss NIM with unsupported tool types.

Symptoms

Codex CLI fails against a gpt-oss NIM with a `400` error such as:

```
{"error":{"message":"tool type namespace not supported","type":"BadRequestError","code":400}}
{"error":{"message":"tool type web_search not supported","type":"BadRequestError","code":400}}
```

Cause

On vLLM, gpt-oss models use the Harmony Responses path, which accepts only these
tool types: `function`, `web_search_preview`, `code_interpreter`, and
`container`. Codex CLI enables several features that send other tool types:

 -

Skills and multi-agent (sub-agent) tools are sent as `"type": "namespace"`.

 -

Web search is sent as `"type": "web_search"` (Harmony expects
`web_search_preview`).

The error names only the first unsupported tool vLLM encounters, so fixing one
feature can surface the same error with a different tool type. Disable all of
the features below at once rather than one at a time.

Resolution

Disable the Codex CLI features that emit unsupported tool types in
`~/.codex/config.toml`:

```
# Web search is sent as "web_search"; Harmony only accepts web_search_preview.
web_search = "disabled"

# Multi-agent (sub-agent) tools are sent as "namespace".
[agents]
enabled = false

[features]
multi_agent_v2 = false

# Bundled skills are sent as "namespace".
[skills.bundled]
enabled = false

[orchestrator.skills]
enabled = false

[orchestrator.mcp]
enabled = false
```

Note

`web_search` is a bare top-level key, not part of a table. Place it above every
`[section]` header in `config.toml`. In TOML a bare key binds to the preceding
table, so if `web_search` follows a header, such as the `[model_providers.nim]`
block from [Configure Codex CLI with NIM], or the `[projects."…"]`
table Codex CLI appends on first run, it silently becomes
`model_providers.nim.web_search` and has no effect, and the `tool type web_search not supported` error persists. The `[agents]`, `[features]`,
`[skills.bundled]`, and `[orchestrator.*]` tables are explicit tables and are
not affected by placement.

Restart Codex CLI after editing the file. With these disabled, Codex CLI drives
NIM entirely through `function` tools, which the Harmony path accepts. This does
not apply to non-gpt-oss models, which use the standard Responses path and
accept `function` tools without this configuration.

### Codex CLI Displays the Model’s Reasoning as Its Answer[#]

Use this topic when Codex CLI prints internal thinking as the assistant response.

Symptoms

Codex CLI prints the model’s internal thinking, such as `The user wants me to...`, as the assistant response.

Cause

No reasoning parser is configured, so the inference engine cannot separate reasoning tokens from
the final answer and emits both in the assistant message.

Resolution

Restart NIM with `--reasoning-parser` set to a parser that matches your model and backend,
as shown in [Prerequisites]. To confirm the fix, send the
request in step 3 of the procedure on this page and check that the
response contains a separate `reasoning` item.

### Codex CLI Takes No Action on File or Shell Requests[#]

Use this topic when Codex CLI describes a command instead of running it.

Symptoms

Codex CLI answers in prose and describes the command it would run instead of
running it. NIM returns `200 OK` and the `output` array contains only a
`message` item.

Cause

Tool calling is not enabled, so the model emits tool calls as text.

Resolution

On vLLM, restart NIM with `--enable-auto-tool-choice` and `--tool-call-parser <parser>`.
On SGLang, use `--tool-call-parser <parser>`. Select a parser that matches your
model and backend. For parser selection and troubleshooting, refer to
[Tool Calling and MCP Integration].

### Codex CLI Reports a Model 404 Error (vLLM Backend)[#]

Use this topic when Codex CLI cannot find the configured model name.

Symptoms

Codex CLI fails immediately with an error stating that the model does not exist.

Cause

The `model` value in `~/.codex/config.toml` does not match the name NIM serves.

Resolution

Query the models endpoint and copy the `id` value verbatim into `config.toml`:

```
curl -s http://localhost:8000/v1/models
```

For more information, refer to [Examples]. To control the served
name, set `NIM_SERVED_MODEL_NAME`. For more information, refer to
[Environment Variables].

### Codex CLI Cannot Connect[#]

Use this topic when Codex CLI cannot reach the NIM endpoint.

Symptoms

Codex CLI reports a connection refused or timeout error.

Cause

The `base_url` is wrong, omits the `/v1` suffix, or the deployment is not ready.

Resolution

Confirm that `base_url` ends in `/v1` and that the host and port match your
deployment, then verify that NIM is ready to serve:

```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/v1/health/ready
```

A ready deployment returns `200`. For more information, refer to
[API Reference].

### Long Agentic Sessions Time Out[#]

Use this topic when short tasks work but long multi-step sessions fail.

Symptoms

Codex CLI works for short tasks but fails partway through a long multi-step
task.

Cause

Agentic sessions replay the full conversation on every turn, so the prompt grows
with each tool call. After the conversation exceeds the model’s context window,
requests fail.

Resolution

Raise `NIM_MAX_MODEL_LEN` to the largest context the model and your GPU memory
support, and start a new Codex CLI session for unrelated tasks. For more
information, refer to [Environment Variables].

## Next Steps[#]

After Codex CLI can drive NIM through tool calls, continue with the following topics:

 -

[Tool Calling and MCP Integration] if tool calls are emitted as text.

 -

[Custom Parsers and Chat Templates] to select or supply parsers.
