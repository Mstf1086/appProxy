<!-- source: https://docs.api.nvidia.com/nim/reference/llm-apis -->
<!-- fetched: 2026-10-24T21:20:26Z -->
<!-- official documentation mirror; do not edit by hand: run scripts/fetch-docs.sh -->

# LLM APIs

#

Overview

[]

The Large Language Model (LLM) NIM API endpoints provide simple access to use natural language based generative AI. This single API endpoint provides access to top models for use in a wide range of tasks including: chat, instruction following, question answering, summarization, creative text generation, and code generation.

NOTE: Select models are available as downloadable container images and supported with an NVIDIA AI Enterprise entitlement. These select models have additional OpenAI API spec details for running self-hosted localized NIMs. Please refer to the Downloadable NIM documentation for additional information.

URL: [https://integrate.api.nvidia.com](https://integrate.api.nvidia.com)

Endpoint: POST /v1/chat/completions

##

Models

[]

###

deepseek-ai

[]

 | Model | Endpoint

 | [deepseek-ai / deepseek-v4-flash](/reference-link/deepseek-ai-deepseek-v4-flash) | [Creates a model response for the given chat conversation. (deepseek-v4-flash)](/reference-link/deepseek-ai-deepseek-v4-flash-infer)
 | [deepseek-ai / deepseek-v4-flash-0731](/reference-link/deepseek-ai-deepseek-v4-flash-0731) | [Creates a model response for the given chat conversation. (deepseek-ai-deepseek-v4-flash-0731)](/reference-link/deepseek-ai-deepseek-v4-flash-0731-infer)
 | [deepseek-ai / deepseek-v4-pro](/reference-link/deepseek-ai-deepseek-v4-pro) | [Creates a model response for the given chat conversation. (deepseek-v4-pro)](/reference-link/deepseek-ai-deepseek-v4-pro-infer)

###

google

[]

 | Model | Endpoint

 | [google / codegemma-7b](/reference-link/google-codegemma-7b) | [Create a chat completion (codegemma-7b)](/reference-link/google-codegemma-7b-infer)
 | [google / gemma-7b](/reference-link/google-gemma-7b) | [Create a chat completion (gemma-7b)](/reference-link/google-gemma-7b-infer)

###

meta

[]

 | Model | Endpoint

 | [meta / llama2-70b](/reference-link/meta-llama2-70b) | [Create a chat completion (llama2-70b)](/reference-link/meta-llama2-70b-infer)
 | [meta / llama-3.1-8b-instruct](/reference-link/meta-llama-3_1-8b) | [Creates a model response for the given chat conversation. (llama-3.1-8b-instruct)](/reference-link/meta-llama-3_1-8b-infer)
 | [meta / llama-3.1-70b-instruct](/reference-link/meta-llama-3_1-70b) | [Creates a model response for the given chat conversation. (llama-3.1-70b-instruct)](/reference-link/meta-llama-3_1-70b-infer)
 | [meta / llama-3.2-1b-instruct](/reference-link/meta-llama-3_2-1b-instruct) | [Creates a model response for the given chat conversation. (llama-3.2-1b-instruct)](/reference-link/meta-llama-3_2-1b-instruct-infer)
 | [meta / llama-3.2-3b-instruct](/reference-link/meta-llama-3_2-3b-instruct) | [Creates a model response for the given chat conversation. (llama-3.2-3b-instruct)](/reference-link/meta-llama-3_2-3b-instruct-infer)
 | [meta / llama-3.3-70b-instruct](/reference-link/meta-llama-3_3-70b-instruct) | [Creates a model response for the given chat conversation. (llama-3.3-70b-instruct)](/reference-link/meta-llama-3_3-70b-instruct-infer)

###

microsoft

[]

 | Model | Endpoint

 | [microsoft / phi-4-mini-instruct](/reference-link/microsoft-phi-4-mini-instruct) | [Creates a model response for the given chat conversation. (phi-4-mini-instruct)](/reference-link/microsoft-phi-4-mini-instruct-infer)
 | [microsoft / phi-4-mini-flash-reasoning](/reference-link/microsoft-phi-4-mini-flash-reasoning) | [Creates a model response for the given chat conversation. (phi-4-mini-flash-reasoning)](/reference-link/microsoft-phi-4-mini-flash-reasoning-infer)

###

minimaxai

[]

 | Model | Endpoint

 | [minimaxai / minimax-m2.5](https://docs.api.nvidia.com/nim/reference/minimaxai-minimax-m2.5) | [Creates a model response for the given chat conversation. (minimax-m2.5)](https://docs.api.nvidia.com/nim/reference/minimaxai-minimax-m2.5-infer)
 | [minimaxai / minimax-m2.7](https://docs.api.nvidia.com/nim/reference/minimaxai-minimax-m2.7) | [Creates a model response for the given chat conversation. (minimax-m2.7)](https://docs.api.nvidia.com/nim/reference/minimaxai-minimax-m2.7-infer)

###

mistralai

[]

 | Model | Endpoint

 | [mistralai / mistral-nemotron](/reference-link/mistralai-mistral-nemotron) | [Creates a model response for the given chat conversation. (mistral-nemotron)](/reference-link/mistralai-mistral-nemotron-infer)
 | [mistralai / mixtral-8x7b-instruct](/reference-link/mistralai-mixtral-8x7b-instruct) | [Create a chat completion (mixtral-8x7b-instruct)](/reference-link/mistralai-mixtral-8x7b-instruct-infer)
 | [mistralai / mixtral-8x22b-instruct](/reference-link/mistralai-mixtral-8x22b-instruct) | [Create a chat completion (mixtral-8x22b-instruct)](/reference-link/mistralai-mixtral-8x22b-instruct-infer)

###

moonshotai

[]

 | Model | Endpoint

 | [moonshotai / kimi-k2-instruct](/reference-link/moonshotai-kimi-k2-instruct) | [Creates a model response for the given chat conversation. (kimi-k2-instruct)](/reference-link/moonshotai-kimi-k2-instruct-infer)
 | [moonshotai / kimi-k2-thinking](/reference-link/moonshotai-kimi-k2-thinking) | [Creates a model response for the given chat conversation. (kimi-k2-thinking)](/reference-link/moonshotai-kimi-k2-thinking-infer)
 | [moonshotai / kimi-k3](/reference-link/moonshotai-kimi-k3) | [ Request response from the model (kimi-k3)](/reference-link/moonshotai-kimi-k3-infer)

###

nvidia

[]

 | Model | Endpoint

 | [nvidia / gliner-pii](/reference-link/nvidia-gliner-pii) | [Extract named entities from text using GLiNER PII model (gliner-pii)](/reference-link/nvidia-gliner-pii-infer)
 | [nvidia / llama-3.1-nemoguard-8b-content-safety](/reference-link/nvidia-llama-3_1-nemoguard-8b-content-safety) | [Creates a model response for the given chat conversation. (llama-3.1-nemoguard-8b-content-safety)](/reference-link/nvidia-llama-3_1-nemoguard-8b-content-safety-infer)
 | [nvidia / llama-3.1-nemoguard-8b-topic-control](/reference-link/nvidia-llama-3_1-nemoguard-8b-topic-control) | [Creates a model response for the given chat conversation. (llama-3.1-nemoguard-8b-topic-control)](/reference-link/nvidia-llama-3_1-nemoguard-8b-topic-control-infer)
 | [nvidia / llama-3.1-nemotron-safety-guard-8b-v3](/reference-link/nvidia-llama-3_1-nemotron-safety-guard-8b-v3) | [Creates a model response for the given chat conversation. (llama-3.1-nemotron-safety-guard-8b-v3)](/reference-link/nvidia-llama-3_1-nemotron-safety-guard-8b-v3-infer)
 | [nvidia / llama-3.3-nemotron-super-49b-v1](/reference-link/nvidia-llama-3_3-nemotron-super-49b-v1) | [Creates a model response for the given chat conversation. (llama-3.3-nemotron-super-49b-v1)](/reference-link/nvidia-llama-3_3-nemotron-super-49b-v1-infer)
 | [nvidia / llama-3.3-nemotron-super-49b-v1.5](/reference-link/nvidia-llama-3_3-nemotron-super-49b-v1_5) | [Creates a model response for the given chat conversation. (llama-3.3-nemotron-super-49b-v1.5)](/reference-link/nvidia-llama-3_3-nemotron-super-49b-v1_5-infer)
 | [nvidia / llama-3.1-nemotron-ultra-253b-v1](/reference-link/nvidia-llama-3_1-nemotron-ultra-253b-v1) | [Create a model response for a given chat (nvidia-llama-3.1-nemotron-ultra-253b-v1)](/reference-link/nvidia-llama-3_1-nemotron-ultra-253b-v1-infer)
 | [nvidia / nemotron-3-ultra-550b-a55b](/reference-link/nvidia-nemotron-3-ultra-550b-a55b) | [Creates a model response for the given chat conversation (nemotron-3-ultra-550b-a55b)](/reference-link/nvidia-nemotron-3-ultra-550b-a55b-infer)
 | [nvidia / nemotron-3.5-lightning-30b-a3b](/reference-link/nvidia-nemotron-3-5-lightning-30b-a3b) | [Creates a model response for the given chat conversation. (nemotron-3.5-lightning-30b-a3b)](/reference-link/nvidia-nemotron-3-5-lightning-30b-a3b-infer)
 | [nvidia / nemotron-3.5-bolt-e4b](/reference-link/nvidia-nemotron-3_5-bolt-e4b) | [Create a model response for the given chat conversation. (nemotron-3.5-bolt-e4b)](/reference-link/nvidia-nemotron-3_5-bolt-e4b-infer)
 | [nvidia / nemoguard-jailbreak-detect](/reference-link/nvidia-nemoguard-jailbreak-detect) | [Classify text for jailbreak attempt (nemoguard-jailbreak-detect)](/reference-link/nvidia-nemoguard-jailbreak-detect-infer)
 | [nvidia / nemotron-3-nano-30b-a3b](/reference-link/nvidia-nemotron-3-nano-30b-a3b) | [Creates a model response for the given chat conversation. (nemotron-3-nano-30b-a3b)](/reference-link/nvidia-nemotron-3-nano-30b-a3b-infer)
 | [nvidia / nemotron-3-super-120b-a12b](/reference-link/nvidia-nemotron-3-super-120b-a12b) | [Creates a model response for the given chat conversation. (nemotron-3-super-120b-a12b)](/reference-link/nvidia-nemotron-3-super-120b-a12b-infer)
 | [nvidia / nemotron-content-safety-reasoning-4b](/reference-link/nvidia-nemotron-content-safety-reasoning-4b) | [Creates a model response for the given chat conversation. (nemotron-content-safety-reasoning-4b)](/reference-link/nvidia-nemotron-content-safety-reasoning-4b-infer)
 | [nvidia / nvidia-nemotron-nano-9b-v2](/reference-link/nvidia-nvidia-nemotron-nano-9b-v2) | [Creates a model response for the given chat conversation. (nvidia-nemotron-nano-9b-v2)](/reference-link/nvidia-nvidia-nemotron-nano-9b-v2-infer)
 | [nvidia / riva-translate-4b-instruct-v2](/reference-link/nvidia-riva-translate-4b-instruct-v2) | [Creates a model response for the given chat conversation. (riva-translate-4b-instruct-v2)](/reference-link/nvidia-riva-translate-4b-instruct-v2-infer)
 | [nvidia / usdcode](/reference-link/nvidia-usdcode) | [Creates a model response for the given chat conversation. (usdcode)](/reference-link/nvidia-usdcode-infer)

###

openai

[]

 | Model | Endpoint

 | [openai / gpt-oss-20b](/reference-link/openai-gpt-oss-20b) | [Creates a model response for the given chat conversation. (gpt-oss-20b)](/reference-link/openai-gpt-oss-20b-infer)
 | [openai / gpt-oss-120b](/reference-link/openai-gpt-oss-120b) | [Creates a model response for the given chat conversation. (gpt-oss-120b)](/reference-link/openai-gpt-oss-120b-infer)

###

poolside

[]

 | Model | Endpoint

 | [poolside / laguna-xs-2-1](/reference-link/poolside-laguna-xs-2-1) | [Creates a model response for the given chat conversation. (laguna-xs-2-1)](/reference-link/poolside-laguna-xs-2-1-infer)

###

qwen

[]

 | Model | Endpoint

 | [qwen / qwen2.5-coder-32b-instruct](/reference-link/qwen-qwen2_5-coder-32b-instruct) | [Creates a model response (qwen2.5-coder-32b-instruct)](/reference-link/qwen-qwen2_5-coder-32b-instruct-infer)
 | [qwen / qwen3-next-80b-a3b-instruct](/reference-link/qwen-qwen3-next-80b-a3b-instruct) | [Creates a model response for the given chat conversation. (qwen3-next-80b-a3b-instruct)](/reference-link/qwen-qwen3-next-80b-a3b-instruct-infer)
 | [qwen / qwen3-next-80b-a3b-thinking](/reference-link/qwen-qwen3-next-80b-a3b-thinking) | [Creates a model response for the given chat conversation. (qwen3-next-80b-a3b-thinking)](/reference-link/qwen-qwen3-next-80b-a3b-thinking-infer)
 | [qwen / qwq-32b](/reference-link/qwen-qwq-32b) | [Creates a model response for the given chat conversation. (qwq-32b)](/reference-link/qwen-qwq-32b-infer)

###

sarvamai

[]

 | Model | Endpoint

 | [sarvamai / sarvam-m](/reference-link/sarvamai-sarvam-m) | [Creates a model response for the given chat conversation. (sarvam-m)](/reference-link/sarvamai-sarvam-m-infer)

###

stepfun-ai

[]

 | Model | Endpoint

 | [stepfun-ai / step-3.5-flash](/reference-link/stepfun-ai-step-3-5-flash) | [Creates a model response for the given chat conversation. (step-3.5-flash)](/reference-link/stepfun-ai-step-3-5-flash-infer)

###

stockmark

[]

 | Model | Endpoint

 | [stockmark / stockmark-2-100b-instruct](/reference-link/stockmark-stockmark-2-100b-instruct) | [Creates a model response for the given chat conversation. (stockmark-2-100b-instruct)](/reference-link/stockmark-stockmark-2-100b-instruct-infer)

###

thinking machines

[]

 | Model | Endpoint

 | [thinking machines / inkling](/reference-link/thinkingmachines-inkling) | [Creates a model response for the given chat conversation. (inkling)](/reference-link/thinkingmachines-inkling-infer)

###

upstage

[]

 | Model | Endpoint

 | [upstage / solar-10.7b-instruct](/reference-link/upstage-solar-10_7b-instruct) | [Creates a model response for the given chat conversation. (solar-10.7b-instruct)](/reference-link/upstage-solar-10_7b-instruct-infer)

###

z-ai

[]

 | Model | Endpoint

 | [z-ai / glm4.7](/reference-link/z-ai-glm4-7) | [Creates a model response for the given chat conversation. (glm4.7)](/reference-link/z-ai-glm4-7-infer)
 | [z-ai / glm5.1](https://docs.api.nvidia.com/nim/reference/z-ai-glm5.1) | [Creates a model response for the given chat conversation. (glm5.1)](https://docs.api.nvidia.com/nim/reference/z-ai-glm5.1-infer)
 | [z-ai / glm-5.2] | [Creates a model response for the given chat conversation. (glm5.2])
 | [z-ai / glm-5.3](/reference-link/z-ai-glm-5-3) | [Creates a model response for the given chat conversation. (glm-5.3)](/reference-link/z-ai-glm-5-3-infer)
 | [z-ai / glm-5.3-flash](/reference-link/z-ai-glm-5-3-flash) | [Creates a model response for the given chat conversation. (glm-5.3-flash)](/reference-link/z-ai-glm-5-3-flash-infer)

Updated about 23 hours ago

---

Did this page help you?
