import { describe, expect, it } from "vitest";

import {
  buildSessionContextReport,
  buildSlashHelpText,
  filterCustomPromptCommands,
  findSlashCommand,
  findCustomPromptCommand,
  getWorkflowPrompt,
  slashCommandItems,
} from "./chatCommands";

describe("chat command catalog", () => {
  it("keeps core session commands and development workflows in one catalog", () => {
    expect(slashCommandItems.map((item) => item.command)).toEqual([
      "/clear",
      "/model",
      "/save",
      "/load",
      "/help",
      "/cost",
      "/context",
      "/compact",
      "/review",
      "/fix",
      "/test",
      "/plan",
      "/explain",
    ]);
  });

  it("finds slash commands case-insensitively", () => {
    expect(findSlashCommand("/REVIEW")?.command).toBe("/review");
    expect(findSlashCommand("/missing")).toBeUndefined();
  });

  it("prints help from the shared catalog", () => {
    const help = buildSlashHelpText();

    expect(help).toContain("**/cost**");
    expect(help).toContain("**/compact**");
    expect(help).toContain("**/review**");
    expect(help).toContain("Show token and cost usage");
  });

  it("builds a context report with compaction guidance", () => {
    const report = buildSessionContextReport({
      model: "kimi-coding",
      isStreaming: false,
      items: Array.from({ length: 9 }, (_, index) => ({
        id: `m${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: "Investigate the eval harness and keep the latest coding request intact. ".repeat(25),
        toolCalls: [],
      })),
      usage: {
        input_tokens: 1200,
        output_tokens: 800,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 300,
      },
    });

    expect(report).toContain("**Context report**");
    expect(report).toContain("Model: `kimi-coding`");
    expect(report).toContain("Messages: `9`");
    expect(report).toContain("Approx transcript tokens:");
    expect(report).toContain("Session usage tokens: `2,300`");
    expect(report).toContain("Recommendation: run `/compact`");
  });

  it("builds development workflow prompts that ask for verification", () => {
    expect(getWorkflowPrompt("fix").toLowerCase()).toContain("fix");
    expect(getWorkflowPrompt("fix").toLowerCase()).toContain("verify");
    expect(getWorkflowPrompt("test").toLowerCase()).toContain("tests");
    expect(getWorkflowPrompt("plan").toLowerCase()).toContain("plan");
  });

  it("filters custom prompt commands while hiding built-in command conflicts", () => {
    const commands = [
      {
        command: "/security-review",
        description: "Review for security issues",
        scope: "project",
        source_path: ".xolotl/commands/security-review.md",
        content: "Review this code for security issues.",
      },
      {
        command: "/review",
        description: "Conflicts with built-in review",
        scope: "project",
        source_path: ".xolotl/commands/review.md",
        content: "Shadow review",
      },
    ];

    expect(filterCustomPromptCommands("/sec", commands).map((item) => item.command)).toEqual([
      "/security-review",
    ]);
    expect(findCustomPromptCommand("/security-review", commands)?.content).toContain("security");
    expect(findCustomPromptCommand("/review", commands)).toBeUndefined();
  });
});
