## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)

## Model Harness Configuration

### Supported Models

| Alias | Provider | Endpoint | Context | Thinking |
|---|---|---|---|---|
| `kimi-coding` | Kimi Coding | `api.kimi.com/coding/v1` | 256K | Yes (32K budget) |
| `kimi2.6` | Moonshot | `api.moonshot.cn/v1` | 256K | Yes |
| `minimax2.7` | MiniMax | `api.minimax.chat/v1` | 1M | Yes |
| `glm5.1` | Zhipu GLM | `open.bigmodel.cn/api/paas/v4` | 128K | Yes |
| `qwen3.6` | Alibaba Qwen | `dashscope.aliyuncs.com/compatible-mode/v1` | 128K | Yes |
| `sonnet` | AWS Bedrock | `bedrock-runtime.us-east-1.amazonaws.com` | 200K | Yes |
| `opus` | AWS Bedrock | `bedrock-runtime.us-east-1.amazonaws.com` | 200K | Yes |

### Environment Variables

- `KIMI_CODING_API_KEY` - Kimi K2.6 Coding API (coding-optimized model)
- `KIMI_API_KEY` - Standard Kimi / Moonshot API
- `MINIMAX_API_KEY` - MiniMax API
- `GLM_API_KEY` - Zhipu GLM API
- `DASHSCOPE_API_KEY` - Alibaba Qwen API
- `ANTHROPIC_API_KEY` - Anthropic direct API
- `BEDROCK_API_KEY` - AWS Bedrock API key

### Model-Specific Behavior

**Kimi K2.6 Coding:**
- Uses extended thinking with 32K budget
- Optimized system prompt for software engineering tasks
- Aggressive file reading (threshold: 12 files)
- Higher compaction ratio (0.7) due to 256K context

**MiniMax 2.7:**
- 1M token context - most generous for large codebases
- Aggressive file reading (threshold: 10 files)
- Prefers comprehensive initial research

**GLM 5.1:**
- Standard SDD practices
- Conservative file reading (threshold: 5 files)
- Good balance for general coding tasks

### Connecting Providers

Use `/connect <provider>` in the REPL for plug-and-play provider setup. You only need to provide the API key — endpoints and model IDs are configured automatically.

```
› /connect minimax
› /connect kimi
› /connect kimi-coding
› /connect glm
› /connect anthropic
› /connect bedrock
› /connect openai
```

Keys are saved to `~/.xolotl-code/config.json` and are available immediately without restarting the session.

### Switching Models

Use `/model <alias>` in the REPL to switch models mid-session:
```
› /model kimi-coding
› /model minimax2.7
› /model sonnet
```

For dual-model mode (planner + executor):
```
› /model opus+sonnet
```
