# Providers & models

Xolotl Code routes to multiple providers through one engine. Open coding models are first-class — not an afterthought.

## Provider API keys

Set these as environment variables, in the desktop **Providers** tab, or via `/connect` in the CLI.

| Variable | Provider |
| --- | --- |
| `KIMI_CODING_API_KEY` | Kimi K2.6 Coding |
| `KIMI_API_KEY` | Moonshot / Kimi |
| `MINIMAX_API_KEY` | MiniMax |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GLM_API_KEY` | Zhipu GLM |
| `DASHSCOPE_API_KEY` | Alibaba Qwen |
| `ANTHROPIC_API_KEY` | Anthropic direct |
| `BEDROCK_API_KEY` | AWS Bedrock |
| `OPENAI_API_KEY` | OpenAI or compatible fallback |

Base URLs are overridable via the `*_BASE_URL` variants.

> **Kimi-for-Coding note:** the coding endpoint requires coding-agent headers or it returns `403 access_terminated_error`. Its model id is `kimi-k2-turbo-preview`. The engine sends the correct header set automatically.

## Model aliases

Pick a route by short name (`/model <alias>` in the REPL, or the model selector in the app):

| Alias | Provider | Notes |
| --- | --- | --- |
| `kimi-coding` | Kimi Coding | Coding-tuned, 256K context, exposes `reasoning_content`, prompt cache |
| `kimi2.6` | Moonshot / Kimi | General Kimi route |
| `minimax2.7` | MiniMax | 1M context for broad reads |
| `deepseek`, `deepseek-v4-pro` | DeepSeek | V4 Pro, 1M context, thinking mode |
| `deepseek-flash`, `deepseek-v4-flash` | DeepSeek | V4 Flash, 1M context, lower cost |
| `glm5.1` | Zhipu GLM | 128K context |
| `qwen3.6` | Alibaba Qwen | Qwen-compatible route |
| `claude-sonnet-4-6`, `sonnet` | Anthropic / Bedrock | Claude Sonnet |
| `claude-opus-4-7`, `opus` | Anthropic / Bedrock | Claude Opus |
| `claude-haiku-4-5-20251001`, `haiku` | Anthropic / Bedrock | Fast Haiku — cheap default judge |
| `bedrock-nova-pro`, `bedrock-nova-lite`, `bedrock-llama-3.3-70b` | AWS Bedrock | Non-Claude Bedrock options |

## Dual-model planner + executor

In the CLI, run a smart planner alongside a cheaper executor:

```text
/model opus+sonnet
/model opus+kimi-coding
```

## Reasoning models

Kimi and DeepSeek stream chain-of-thought (`delta.reasoning_content`) before the answer (`delta.content`) — there can be 10s+ of silence before the answer begins. Both surfaces render reasoning in a separate track. See [Chat](guides/chat.md).
