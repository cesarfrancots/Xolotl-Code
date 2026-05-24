import { describe, expect, it } from "vitest";

import {
  buildSlashHelpText,
  findSlashCommand,
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
    expect(help).toContain("**/review**");
    expect(help).toContain("Show token and cost usage");
  });

  it("builds development workflow prompts that ask for verification", () => {
    expect(getWorkflowPrompt("fix").toLowerCase()).toContain("fix");
    expect(getWorkflowPrompt("fix").toLowerCase()).toContain("verify");
    expect(getWorkflowPrompt("test").toLowerCase()).toContain("tests");
    expect(getWorkflowPrompt("plan").toLowerCase()).toContain("plan");
  });
});
