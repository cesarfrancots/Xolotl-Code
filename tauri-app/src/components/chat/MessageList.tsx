import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { GitPullRequest, Wrench, ListChecks, Compass } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { MessageItem, StreamingMessage } from "./Message";

const WELCOME_SUGGESTIONS: {
  id: string;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "review", title: "Review code", desc: "Audit a diff or file for bugs and quality", icon: GitPullRequest },
  { id: "fix", title: "Fix a bug", desc: "Reproduce, diagnose, then patch it", icon: Wrench },
  { id: "test", title: "Write tests", desc: "Cover behavior with focused tests", icon: ListChecks },
  { id: "plan", title: "Plan work", desc: "Break a goal into a clear plan", icon: Compass },
];

/** Premium welcome shown before the first message. Suggestion cards seed the
 *  input via a window event the MessageInput listens for. */
function WelcomeScreen() {
  const seed = (id: string) =>
    window.dispatchEvent(new CustomEvent("xolotl:seed-prompt", { detail: { id } }));

  return (
    <div className="xolotl-rise w-full max-w-[620px] pt-5">
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-6 grid place-items-center">
          <div className="xolotl-welcome-orb pointer-events-none absolute -inset-12" aria-hidden="true" />
          <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-[oklch(0.30_0.020_195)] bg-[oklch(0.13_0.008_220)] shadow-[0_14px_44px_oklch(0.03_0_0_/_0.55)]">
            <div className="xolotl-mark scale-110" aria-hidden="true" />
          </div>
        </div>
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[oklch(0.94_0.008_220)]">
          What should we build?
        </h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[oklch(0.56_0.014_230)]">
          Ask a question, paste code, or attach files — or start from a workflow below.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {WELCOME_SUGGESTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => seed(s.id)}
            title={`Start: ${s.title}`}
            className="group flex items-start gap-3 rounded-xl border border-[oklch(0.20_0.006_245)] bg-[oklch(0.118_0.004_245)] px-3.5 py-3 text-left transition-all hover:-translate-y-px hover:border-[oklch(0.34_0.020_200)] hover:bg-[oklch(0.142_0.006_240)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[oklch(0.55_0.045_190)]"
          >
            <span className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-[oklch(0.24_0.012_205)] bg-[oklch(0.15_0.010_205)] text-[oklch(0.70_0.050_190)] transition-colors group-hover:text-[oklch(0.80_0.060_190)]">
              <s.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[oklch(0.86_0.012_220)]">{s.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-[oklch(0.52_0.012_230)]">{s.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const { items, streamingContent, streamingReasoning, isStreaming } = useChatStore();
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
    // Don't yank the viewport down on every streaming delta — only follow the
    // stream when the user is already near the bottom (isNearBottom), or when a
    // brand-new message/turn appears (hasNewItems). Respects manual scroll-up.
    if (isNearBottom || hasNewItems) {
      virtualizer.scrollToIndex(totalCount - 1, { align: "end", behavior: "auto" });
    }
    prevItemCount.current = totalCount;
  }, [totalCount, streamingContent, isStreaming, virtualizer]);

  if (items.length === 0 && !isStreaming) {
    return (
      <div ref={parentRef} className="h-full overflow-y-auto flex items-center justify-center px-8 pb-28">
        <WelcomeScreen />
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto pb-28"
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
                <StreamingMessage
                  content={streamingContent}
                  reasoning={streamingReasoning}
                />
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
