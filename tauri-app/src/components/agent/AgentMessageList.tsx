import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAgentStore } from "../../stores/agentStore";
import { MessageItem, StreamingMessage } from "../chat/Message";
import type { Message } from "../../stores/chatStore";

/**
 * Virtualized message list for an expanded agent's conversation.
 * Mirrors MessageList.tsx but reads from agentStore instead of chatStore.
 * Read-only — no input bar (D-05).
 *
 * Uses MessageItem for committed messages and StreamingMessage for the
 * in-progress streaming row (same approach as MessageList.tsx).
 *
 * Note on MessageItem import: MessageItem accepts { item: Message | PermissionItem }.
 * Agent messages are always Message (never PermissionItem), so we cast via "as Message"
 * and filter non-Message items defensively.
 */
export function AgentMessageList({ agentId }: { agentId: string }) {
  const record = useAgentStore((s) => s.agents.find((a) => a.id === agentId));
  const parentRef = useRef<HTMLDivElement>(null);
  const prevItemCount = useRef(0);

  const items = record?.messages ?? [];
  const isStreaming = record?.isStreaming ?? false;
  const streamingContent = record?.streamingContent ?? "";

  // +1 row for the streaming message when active
  const totalCount = items.length + (isStreaming ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 80,
    overscan: 5,
  });

  // Auto-scroll to bottom when new items arrive or streaming content grows
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    const hasNewItems = totalCount > prevItemCount.current;
    if (isNearBottom || hasNewItems || isStreaming) {
      virtualizer.scrollToIndex(totalCount - 1, { align: "end", behavior: "auto" });
    }
    prevItemCount.current = totalCount;
  }, [totalCount, streamingContent, isStreaming, virtualizer]);

  if (!record) {
    return (
      <div className="flex items-center justify-center h-full text-[oklch(0.55_0_0)] text-sm">
        Agent not found.
      </div>
    );
  }

  if (items.length === 0 && !isStreaming) {
    return (
      <div ref={parentRef} className="h-full overflow-y-auto flex items-center justify-center">
        <div className="text-center px-8">
          <p className="text-base font-semibold text-[oklch(0.92_0_0)]">No messages yet</p>
          <p className="text-sm text-[oklch(0.55_0_0)] mt-1">
            Agent output will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto"
      style={{ contain: "strict" }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((vItem) => {
          const isStreamingSlot = vItem.index === items.length && isStreaming;

          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              {isStreamingSlot ? (
                <StreamingMessage content={streamingContent} />
              ) : (
                (() => {
                  const chatItem = items[vItem.index];
                  // AgentMessageList only renders Message items (never PermissionItem).
                  // Defensively skip items that don't have a role field.
                  if (!("role" in chatItem)) return null;
                  return <MessageItem item={chatItem as Message} />;
                })()
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
