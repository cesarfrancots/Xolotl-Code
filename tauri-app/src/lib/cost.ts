import type { TokenUsage } from "../bindings";

/**
 * Per-model pricing in USD per 1M tokens.
 * Source: Anthropic pricing page (2026-05).
 * input: per 1M input tokens
 * output: per 1M output tokens
 * cacheWrite: per 1M cache write tokens
 * cacheRead: per 1M cache read tokens
 */
const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-4-5":    { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-sonnet-4-5":  { input: 3.00,  output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  "claude-haiku-3-5":   { input: 0.80,  output: 4.00,  cacheWrite: 1.00,  cacheRead: 0.08 },
  "deepseek-v4-flash":  { input: 0.14,  output: 0.28,  cacheWrite: 0.14,  cacheRead: 0.0028 },
  "deepseek-v4-pro":    { input: 0.435, output: 0.87,  cacheWrite: 0.435, cacheRead: 0.003625 },
};

const DEFAULT_PRICING = MODEL_PRICING["claude-sonnet-4-5"];

/**
 * Calculate dollar cost for a single turn's TokenUsage.
 * Returns USD as a floating point number.
 */
export function calcTurnCost(usage: TokenUsage, model: string): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
  const cacheWriteCost = (usage.cache_creation_input_tokens / 1_000_000) * pricing.cacheWrite;
  const cacheReadCost = (usage.cache_read_input_tokens / 1_000_000) * pricing.cacheRead;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

/**
 * Format a dollar amount to 4 decimal places with $ prefix.
 * formatCost(0.001234) → "$0.0012"
 */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/**
 * Format a token count with comma separators and " tok" suffix.
 * formatTokens(1240) → "1,240 tok"
 */
export function formatTokens(tokens: number): string {
  return `${tokens.toLocaleString("en-US")} tok`;
}

/**
 * Format the session cost bar string: "$0.0042 · 1,240 tok"
 * Used in the chat top bar (D-06).
 */
export function formatCostBar(totalCost: number, totalTokens: number): string {
  return `${formatCost(totalCost)} · ${formatTokens(totalTokens)}`;
}

/**
 * Format the per-turn cost footnote: "↳ $0.0008 · in 342 / out 89 tok"
 * Used below each assistant message (D-06).
 */
export function formatTurnFootnote(usage: TokenUsage, model: string): string {
  const cost = calcTurnCost(usage, model);
  return `↳ ${formatCost(cost)} · in ${usage.input_tokens.toLocaleString("en-US")} / out ${usage.output_tokens.toLocaleString("en-US")} tok`;
}
