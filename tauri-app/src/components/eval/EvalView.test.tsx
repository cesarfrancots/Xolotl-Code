import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvalView } from "./EvalView";
import { commands } from "../../bindings";
import type { EvalMeta, EvalResult } from "../../bindings";
import { buildBlindLabels, useEvalStore } from "../../stores/evalStore";

type CommandResult<T> = { status: "ok"; data: T } | { status: "error"; error: string };

const commandMocks = vi.hoisted(() => ({
  listModels: vi.fn<() => Promise<string[]>>(() => Promise.resolve(["model-a", "model-b", "claude-sonnet-4-6"])),
  listEvalSuites: vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([])),
  listEvals: vi.fn<() => Promise<EvalMeta[]>>(() => Promise.resolve([])),
  loadEval: vi.fn<() => Promise<CommandResult<string>>>(() => Promise.resolve({ status: "ok", data: "{}" })),
  deleteEval: vi.fn<() => Promise<CommandResult<null>>>(() => Promise.resolve({ status: "ok", data: null })),
  cleanupEvalProcesses: vi.fn<() => Promise<number>>(() => Promise.resolve(0)),
  revealEvalResultInFinder: vi.fn<() => Promise<CommandResult<null>>>(() => Promise.resolve({ status: "ok", data: null })),
  exportEvalReport: vi.fn<(id: string) => Promise<CommandResult<{ report_path: string; message: string }>>>((_id) => Promise.resolve({
    status: "ok" as const,
    data: {
      report_path: "/Users/cesar/Documents/Xolotl Code/Eval Reports/1700000000-eval-1.md",
      message: "Eval report exported.",
    },
  })),
  revealEvalArtifactsInFinder: vi.fn<() => Promise<CommandResult<null>>>(() => Promise.resolve({ status: "ok", data: null })),
  startEvalArtifact: vi.fn<() => Promise<CommandResult<{ artifact_dir: string; entry_path: string; message: string }>>>(() => Promise.resolve({
    status: "ok" as const,
    data: {
      artifact_dir: "/Users/cesar/.xolotl-code/eval-artifacts/artifact-1",
      entry_path: "index.html",
      message: "Artifact opened.",
    },
  })),
  revealInFinder: vi.fn<() => Promise<CommandResult<null>>>(() => Promise.resolve({ status: "ok", data: null })),
}));

const pathActionMocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn<(text: string) => Promise<void>>((_text) => Promise.resolve()),
  copyXolotlCodeOpenUrl: vi.fn<(path: string) => Promise<void>>((_path) => Promise.resolve()),
  openPathInExternalEditor: vi.fn<(path: string) => Promise<void>>((_path) => Promise.resolve()),
  revealPathInFinder: vi.fn<(path: string) => Promise<void>>((_path) => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../../bindings", () => ({
  commands: commandMocks,
}));

vi.mock("../../lib/pathActions", () => ({
  copyTextToClipboard: pathActionMocks.copyTextToClipboard,
  copyXolotlCodeOpenUrl: pathActionMocks.copyXolotlCodeOpenUrl,
  openPathInExternalEditor: pathActionMocks.openPathInExternalEditor,
  revealPathInFinder: pathActionMocks.revealPathInFinder,
}));

const savedEvalMeta: EvalMeta = {
  id: "eval-1",
  prompt: "Create a visual HTML mockup for review",
  models: ["model-a"],
  created_at: 1_700_000_000,
  manual_review_count: 0,
  suite_id: null,
  suite_run_id: null,
};

const savedEvalResult: EvalResult = {
  id: savedEvalMeta.id,
  prompt: savedEvalMeta.prompt,
  models: savedEvalMeta.models,
  results: [
    {
      model: "model-a",
      content: "<!doctype html><html><body><button>Preview</button></body></html>",
      input_tokens: 10,
      output_tokens: 20,
      duration_ms: 1000,
      error: null,
    },
  ],
  human_scores: {},
  manual_reviews: {},
  auto_scores: {},
  judge: null,
  reasoning_traces: {},
  goal_grades: {},
  is_goal_eval: true,
  goal: savedEvalMeta.prompt,
  suite_id: null,
  suite_run_id: null,
  suite_prompt_id: null,
  reliability_metrics: null,
  created_at: savedEvalMeta.created_at,
};

function resetEvalStore() {
  useEvalStore.setState({
    activeEval: null,
    humanScores: {},
    manualReviews: {},
    scoresDirty: false,
    reviewDirty: false,
    evalOpen: false,
    blindMode: true,
    activeSuite: null,
  });
}

function seedCompletedEval(content = savedEvalResult.results[0].content) {
  const models = ["model-a"];
  useEvalStore.setState({
    activeEval: {
      id: "active-eval",
      prompt: "Build a visual UI prototype with success criteria for review.",
      models,
      blindLabels: buildBlindLabels("active-eval", models),
      modelStates: {
        "model-a": {
          model: "model-a",
          status: "done",
          content,
          reasoning: "",
          flags: [],
          input_tokens: 10,
          output_tokens: 20,
          duration_ms: 1000,
        },
      },
      complete: true,
      created_at: Date.now(),
      suite_id: null,
      suite_run_id: null,
      suite_prompt_id: null,
      judge: null,
      is_goal_eval: true,
      live_supervisor: false,
    },
    humanScores: {},
    manualReviews: {},
    scoresDirty: false,
    reviewDirty: false,
    evalOpen: true,
    blindMode: true,
    activeSuite: null,
  });
}

describe("EvalView Mac Finder handoffs", () => {
  beforeEach(() => {
    resetEvalStore();
    window.sessionStorage.clear();
    vi.clearAllMocks();
    commandMocks.listEvals.mockResolvedValue([savedEvalMeta]);
    commandMocks.loadEval.mockResolvedValue({ status: "ok", data: JSON.stringify(savedEvalResult) });
    pathActionMocks.copyTextToClipboard.mockResolvedValue(undefined);
    pathActionMocks.copyXolotlCodeOpenUrl.mockResolvedValue(undefined);
    pathActionMocks.openPathInExternalEditor.mockResolvedValue(undefined);
    pathActionMocks.revealPathInFinder.mockResolvedValue(undefined);
  });

  it("shows recovery guidance when revealing a saved eval fails", async () => {
    seedCompletedEval();
    commandMocks.revealEvalResultInFinder.mockResolvedValueOnce({
      status: "error",
      error: "eval file missing",
    });
    const user = userEvent.setup();

    render(<EvalView />);
    await user.click(screen.getByRole("button", { name: /History/ }));
    await user.click(await screen.findByLabelText("Reveal saved eval in Finder"));

    expect(await screen.findByText("Reveal saved eval in Finder failed.")).toBeTruthy();
    expect(screen.getByText(/Check that the saved eval still exists/)).toBeTruthy();
    expect(screen.getByText(/eval file missing/)).toBeTruthy();
  });

  it("shows recovery guidance when revealing the eval artifacts folder fails", async () => {
    seedCompletedEval();
    commandMocks.revealEvalArtifactsInFinder.mockResolvedValueOnce({
      status: "error",
      error: "operation not permitted",
    });
    const user = userEvent.setup();

    render(<EvalView />);
    await user.click(screen.getByRole("button", { name: /History/ }));
    await user.click(await screen.findByLabelText("Reveal Eval Artifacts in Finder"));

    expect(await screen.findByText("Reveal Eval Artifacts in Finder failed.")).toBeTruthy();
    expect(screen.getByText(/can create and open the eval artifacts folder/)).toBeTruthy();
    expect(screen.getByText(/operation not permitted/)).toBeTruthy();
  });

  it("exports a saved eval report and copies the report path", async () => {
    seedCompletedEval();
    const user = userEvent.setup();

    render(<EvalView />);
    await user.click(screen.getByRole("button", { name: /History/ }));
    await user.click(await screen.findByLabelText("Export eval report"));

    await waitFor(() => {
      expect(commandMocks.exportEvalReport).toHaveBeenCalledWith("eval-1");
    });
    expect(await screen.findByText("Eval report exported.")).toBeTruthy();
    expect(screen.getByText("/Users/cesar/Documents/Xolotl Code/Eval Reports/1700000000-eval-1.md")).toBeTruthy();

    await user.click(screen.getByLabelText("Copy exported eval report path"));
    await waitFor(() => {
      expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("/Users/cesar/Documents/Xolotl Code/Eval Reports/1700000000-eval-1.md");
    });
    expect(await screen.findByText("Eval report path copied.")).toBeTruthy();
  });

  it("shows recovery guidance when exporting a saved eval report fails", async () => {
    seedCompletedEval();
    commandMocks.exportEvalReport.mockResolvedValueOnce({
      status: "error",
      error: "permission denied",
    });
    const user = userEvent.setup();

    render(<EvalView />);
    await user.click(screen.getByRole("button", { name: /History/ }));
    await user.click(await screen.findByLabelText("Export eval report"));

    expect(await screen.findByText("Export eval report failed.")).toBeTruthy();
    expect(screen.getByText(/Documents\/Xolotl Code\/Eval Reports/)).toBeTruthy();
    expect(screen.getByText(/permission denied/)).toBeTruthy();
  });

  it("shows recovery guidance when revealing a generated artifact folder fails", async () => {
    seedCompletedEval(`
\`\`\`html
<!doctype html>
<html><body><button>Open me</button></body></html>
\`\`\`
`);
    commandMocks.revealInFinder.mockResolvedValueOnce({
      status: "error",
      error: "artifact folder missing",
    });
    const user = userEvent.setup();

    render(<EvalView />);
    await user.click(screen.getByRole("button", { name: "Ready for scores" }));
    await user.click(await screen.findByRole("button", { name: /Open index.html/ }));
    await waitFor(() => {
      expect(commands.startEvalArtifact).toHaveBeenCalled();
    });
    await user.click(await screen.findByLabelText("Reveal index.html artifact in Finder"));

    expect(await screen.findByText("Reveal generated artifact folder in Finder failed.")).toBeTruthy();
    expect(screen.getByText(/Check that the generated artifact folder still exists/)).toBeTruthy();
    expect(screen.getByText(/artifact folder missing/)).toBeTruthy();
  });

  it("copies a generated artifact folder path after launch", async () => {
    seedCompletedEval(`
\`\`\`html
<!doctype html>
<html><body><button>Open me</button></body></html>
\`\`\`
`);
    const user = userEvent.setup();

    render(<EvalView />);
    await user.click(screen.getByRole("button", { name: "Ready for scores" }));
    await user.click(await screen.findByRole("button", { name: /Open index.html/ }));
    await waitFor(() => {
      expect(commands.startEvalArtifact).toHaveBeenCalled();
    });
    await user.click(await screen.findByLabelText("Copy index.html artifact folder path"));

    await waitFor(() => {
      expect(pathActionMocks.copyTextToClipboard).toHaveBeenCalledWith("/Users/cesar/.xolotl-code/eval-artifacts/artifact-1");
    });
    expect(await screen.findByText("Generated artifact folder path copied.")).toBeTruthy();
  });

  it("copies a generated artifact folder Xolotl link after launch", async () => {
    seedCompletedEval(`
\`\`\`html
<!doctype html>
<html><body><button>Open me</button></body></html>
\`\`\`
`);
    const user = userEvent.setup();

    render(<EvalView />);
    await user.click(screen.getByRole("button", { name: "Ready for scores" }));
    await user.click(await screen.findByRole("button", { name: /Open index.html/ }));
    await waitFor(() => {
      expect(commands.startEvalArtifact).toHaveBeenCalled();
    });
    await user.click(await screen.findByLabelText("Copy index.html artifact folder Xolotl link"));

    await waitFor(() => {
      expect(pathActionMocks.copyXolotlCodeOpenUrl).toHaveBeenCalledWith("/Users/cesar/.xolotl-code/eval-artifacts/artifact-1");
    });
    expect(await screen.findByText("Generated artifact folder Xolotl link copied.")).toBeTruthy();
  });

  it("shows recovery guidance when opening a generated artifact folder in the editor fails", async () => {
    seedCompletedEval(`
\`\`\`html
<!doctype html>
<html><body><button>Open me</button></body></html>
\`\`\`
`);
    pathActionMocks.openPathInExternalEditor.mockRejectedValueOnce(new Error("No configured editor"));
    const user = userEvent.setup();

    render(<EvalView />);
    await user.click(screen.getByRole("button", { name: "Ready for scores" }));
    await user.click(await screen.findByRole("button", { name: /Open index.html/ }));
    await waitFor(() => {
      expect(commands.startEvalArtifact).toHaveBeenCalled();
    });
    await user.click(await screen.findByLabelText("Open index.html artifact folder in editor"));

    await waitFor(() => {
      expect(pathActionMocks.openPathInExternalEditor).toHaveBeenCalledWith("/Users/cesar/.xolotl-code/eval-artifacts/artifact-1");
    });
    expect(await screen.findByText("Open generated artifact folder in editor failed.")).toBeTruthy();
    expect(screen.getByText(/preferred editor in macOS Settings/)).toBeTruthy();
    expect(screen.getByText(/No configured editor/)).toBeTruthy();
  });
});
