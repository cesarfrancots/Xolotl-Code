import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageItem, StreamingMessage } from "./Message";
import type { Message } from "../../stores/chatStore";
import { useChatStore } from "../../stores/chatStore";

const assistantMessage: Message = {
  id: "assistant-1",
  role: "assistant",
  content: "<think>private plan</think>Hello from MiniMax",
  toolCalls: [],
};

describe("Message reasoning rendering", () => {
  it("keeps provider think tags collapsed on committed assistant messages", () => {
    useChatStore.setState({ model: "minimax2.7" });
    render(<MessageItem item={assistantMessage} />);

    const details = screen.getByText("Thinking").closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("private plan");
    expect(screen.getByText("Hello from MiniMax")).toBeTruthy();
  });

  it("keeps provider think tags collapsed while streaming", () => {
    useChatStore.setState({ model: "minimax2.7" });
    render(<StreamingMessage content="<think>private plan</think>Hello" />);

    const details = screen.getByText("Thinking...").closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("private plan");
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("shows an immediate thinking status before the first delta", () => {
    useChatStore.setState({ model: "minimax2.7" });
    render(<StreamingMessage content="" />);

    expect(screen.getByText("Thinking...")).toBeTruthy();
  });
});
