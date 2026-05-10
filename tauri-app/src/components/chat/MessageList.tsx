import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useChatStore } from "../../stores/chatStore";
import { MessageItem, StreamingMessage } from "./Message";

/**
 * Virtualized message list.
 * Uses @tanstack/react-virtual useVirtualizer with measureElement for dynamic heights.
 *
 * Per UI-05: 200+ turn sessions remain performant via virtualization.
 * Per RESEARCH.md Pattern 2: measureElement ref on every item div captures real DOM heights.
 * Per RESEARCH.md Pitfall 2: scroll container MUST have explicit height (flex-1 h-full from parent).
 * Per 04-UI-SPEC.md §Message List: estimateSize=80, overscan=5, auto-scroll to bottom.
 */
export function MessageList() {
  const { items, streamingContent, isStreaming } = useChatStore();
  const parentRef = useRef<HTMLDivElement>(null);
  const prevItemCount = useRef(0);

  // Total virtual items = committed items + (1 for streaming message if active)
  const totalCount = items.length + (isStreaming ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 80,
    overscan: 5,
  });

  // Auto-scroll to bottom when new items arrive or streaming content grows
  // Pause auto-scroll when user has scrolled up (> 100px above bottom)
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

  if (items.length === 0 && !isStreaming) {
    return (
      <div ref={parentRef} className="h-full overflow-y-auto flex items-center justify-center">
        <div className="text-center px-8">
          <p className="text-base font-semibold text-[oklch(0.92_0_0)]">Start a conversation</p>
          <p className="text-sm text-[oklch(0.55_0_0)] mt-1">
            Type a message below or use / for commands.
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
                <MessageItem item={items[vItem.index]} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
