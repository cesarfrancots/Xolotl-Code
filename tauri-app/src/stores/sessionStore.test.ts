import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the bindings module so tests run without Tauri
vi.mock("../bindings", () => ({
  commands: {
    listSessions: vi.fn().mockResolvedValue([]),
    deleteSession: vi.fn().mockResolvedValue({ status: "ok" }),
    saveSession: vi.fn().mockResolvedValue({ status: "ok" }),
  },
}));

import { useSessionStore } from "./sessionStore";

beforeEach(() => {
  useSessionStore.setState({
    sessions: null,
    activeSessionId: null,
    loading: false,
    error: null,
  });
  vi.clearAllMocks();
});

describe("loadSessions", () => {
  it("returns empty array when no sessions exist", async () => {
    await useSessionStore.getState().loadSessions();
    const state = useSessionStore.getState();
    expect(state.sessions).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });
});

describe("UUID validation (Rust-side)", () => {
  it("passes the id as-is to commands.saveSession — Rust validates path safety", async () => {
    const { commands } = await import("../bindings");
    await useSessionStore.getState().saveSession("test-id-123", '{"id":"test-id-123"}');
    expect(commands.saveSession).toHaveBeenCalledWith("test-id-123", '{"id":"test-id-123"}');
  });
});
