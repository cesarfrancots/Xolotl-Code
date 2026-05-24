import type { PromptCommand } from "../bindings";

export type SlashCommandId =
  | "clear"
  | "model"
  | "save"
  | "load"
  | "help"
  | "cost"
  | "compact"
  | "review"
  | "fix"
  | "test"
  | "plan"
  | "explain";

export interface SlashCommandItem {
  id: SlashCommandId;
  command: `/${SlashCommandId}`;
  description: string;
  kind: "session" | "development";
}

export const slashCommandItems: SlashCommandItem[] = [
  { id: "clear", command: "/clear", description: "Reset current session thread", kind: "session" },
  { id: "model", command: "/model", description: "Switch model", kind: "session" },
  { id: "save", command: "/save", description: "Save this session", kind: "session" },
  { id: "load", command: "/load", description: "Load a saved session", kind: "session" },
  { id: "help", command: "/help", description: "List all commands", kind: "session" },
  { id: "cost", command: "/cost", description: "Show token and cost usage", kind: "session" },
  { id: "compact", command: "/compact", description: "Checkpoint older context", kind: "session" },
  { id: "review", command: "/review", description: "Review current changes for bugs", kind: "development" },
  { id: "fix", command: "/fix", description: "Investigate and fix a bug", kind: "development" },
  { id: "test", command: "/test", description: "Add or repair focused tests", kind: "development" },
  { id: "plan", command: "/plan", description: "Create an implementation plan", kind: "development" },
  { id: "explain", command: "/explain", description: "Explain a file, diff, or architecture path", kind: "development" },
];

export function findSlashCommand(command: string): SlashCommandItem | undefined {
  const normalized = command.trim().toLowerCase();
  return slashCommandItems.find((item) => item.command === normalized);
}

export function filterSlashCommands(value: string): SlashCommandItem[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith("/")) return slashCommandItems;
  return slashCommandItems.filter((item) => item.command.startsWith(normalized));
}

export function buildSlashHelpText(): string {
  return slashCommandItems
    .map((item) => `**${item.command}** - ${item.description}`)
    .join("\n\n");
}

export function customPromptCommandConflicts(command: PromptCommand): boolean {
  return slashCommandItems.some((item) => item.command === command.command.toLowerCase());
}

export function filterCustomPromptCommands(value: string, customCommands: PromptCommand[]): PromptCommand[] {
  const normalized = value.trim().toLowerCase();
  const visible = customCommands.filter((command) => !customPromptCommandConflicts(command));
  if (!normalized.startsWith("/")) return visible;
  return visible.filter((command) => command.command.toLowerCase().startsWith(normalized));
}

export function findCustomPromptCommand(command: string, customCommands: PromptCommand[]): PromptCommand | undefined {
  const normalized = command.trim().toLowerCase();
  return customCommands.find((item) => item.command.toLowerCase() === normalized && !customPromptCommandConflicts(item));
}

export function getWorkflowPrompt(id: Extract<SlashCommandId, "review" | "fix" | "test" | "plan" | "explain">): string {
  switch (id) {
    case "review":
      return "Review the current changes like a senior engineer. Focus on bugs, regressions, missing tests, and risky assumptions. Cite files and lines, then summarize the highest-value fixes.";
    case "fix":
      return "Investigate and fix the bug below. Reproduce or narrow the failure first, keep the change scoped, and verify with the most relevant tests.";
    case "test":
      return "Add focused tests for the behavior below. Start with the smallest failing case, implement the missing behavior if needed, and verify the suite passes.";
    case "plan":
      return "Plan the implementation for the goal below. Read the relevant code first, identify risks and tests, then propose a concise step-by-step approach.";
    case "explain":
      return "Explain the code, diff, or architecture path below. Highlight responsibilities, data flow, important tradeoffs, and where I should look next.";
  }
}
