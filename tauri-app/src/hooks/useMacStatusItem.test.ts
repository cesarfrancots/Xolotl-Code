import { describe, expect, it } from "vitest";
import { buildMacStatusItemState } from "./useMacStatusItem";
import type { Project } from "../bindings";
import type { AgentRecord } from "../stores/agentStore";

const project = (path: string, name: string): Project => ({
  path,
  name,
  added_at: 1,
  last_opened_at: 2,
});

const agent = (state: AgentRecord["state"]): AgentRecord => ({
  id: state,
  task: "Task",
  model: "claude-sonnet-4-6",
  state,
  cumulativeCost: 0,
  messages: [],
  streamingContent: "",
  isStreaming: false,
  branch: "",
  groupId: null,
});

describe("buildMacStatusItemState", () => {
  it("summarizes the active project and active agent counts", () => {
    expect(buildMacStatusItemState({
      activeProjectPath: "/Users/cesar/Work/Xolotl Code",
      projects: [project("/Users/cesar/Work/Xolotl Code", "Xolotl Code")],
      agents: [agent("Planning"), agent("Executing"), agent("Waiting"), agent("Done")],
    })).toEqual({
      active_project_name: "Xolotl Code",
      active_project_path: "/Users/cesar/Work/Xolotl Code",
      running_agents: 2,
      waiting_agents: 1,
      total_agents: 4,
    });
  });

  it("falls back to the path basename when the active project is not in recents", () => {
    expect(buildMacStatusItemState({
      activeProjectPath: "/Users/cesar/Work/Detached Project",
      projects: [],
      agents: [],
    }).active_project_name).toBe("Detached Project");
  });
});
