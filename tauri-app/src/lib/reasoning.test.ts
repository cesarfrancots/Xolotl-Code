import { describe, expect, it } from "vitest";

import { extractThinkBlocks, stripThinkBlocks } from "./reasoning";

describe("reasoning helpers", () => {
  it("moves closed think blocks out of visible content", () => {
    expect(extractThinkBlocks("<think>private plan</think>Hello")).toEqual({
      visible: "Hello",
      reasoning: "private plan",
    });
  });

  it("handles multiple and mixed-case think blocks", () => {
    expect(extractThinkBlocks("A<THINK>one</THINK>B<think>two</think>C")).toEqual({
      visible: "ABC",
      reasoning: "one\n\ntwo",
    });
  });

  it("treats an unclosed think block as hidden reasoning", () => {
    expect(extractThinkBlocks("Visible\n<think>still thinking")).toEqual({
      visible: "Visible\n",
      reasoning: "still thinking",
    });
  });

  it("strips reasoning before sending chat history back to providers", () => {
    expect(stripThinkBlocks("<think>do not send this</think>Final answer")).toBe("Final answer");
  });
});
