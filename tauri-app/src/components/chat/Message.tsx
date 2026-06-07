import { lazy, Suspense } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { Message, PermissionItem } from "../../stores/chatStore";
import { PermissionCard } from "./PermissionCard";
import { ToolBlock } from "./ToolBlock";
import { useChatStore } from "../../stores/chatStore";
import { formatTurnFootnote } from "../../lib/cost";
import { extractThinkBlocks } from "../../lib/reasoning";

interface MessageItemProps {
  item: Message | PermissionItem;
}

const LazyMarkdownRenderer = lazy(async () => {
  const module = await import("./MarkdownRenderer");
  return { default: module.MarkdownRenderer };
});

function MarkdownContent({ content }: { content: string }) {
  return (
    <Suspense fallback={<PlainMarkdownFallback content={content} />}>
      <LazyMarkdownRenderer content={content} />
    </Suspense>
  );
}

function PlainMarkdownFallback({ content }: { content: string }) {
  return <p className="whitespace-pre-wrap break-words">{content}</p>;
}

/**
 * Codex-style message row: centered transcript with user bubbles and
 * cardless assistant prose.
 */
export function MessageItem({ item }: MessageItemProps) {
  if ((item as PermissionItem).type === "permission") {
    return <PermissionCard item={item as PermissionItem} />;
  }

  const msg = item as Message;
  if (msg.role === "user") {
    return <UserMessage message={msg} />;
  }
  return <AssistantMessage message={msg} />;
}

/**
 * Collapsible reasoning block. It stays closed unless the user opens it,
 * matching Codex/Claude-style handling for model thinking traces.
 */
function ReasoningBlock({
  text,
  defaultOpen,
  isStreaming,
}: {
  text: string;
  defaultOpen: boolean;
  isStreaming?: boolean;
}) {
  return (
    <details
      open={defaultOpen ? true : undefined}
      className="group mt-1 mb-1 max-w-[760px] rounded-lg border border-[oklch(0.22_0.008_240)] bg-[oklch(0.122_0.004_245)]/70"
    >
      <summary className="flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-1.5 text-xs text-[oklch(0.55_0.014_230)] hover:text-[oklch(0.78_0.014_220)] transition-colors list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
        <span>
          {isStreaming ? "Thinking..." : "Thinking"}
          {!isStreaming && (
            <span className="ml-1 text-[oklch(0.42_0.010_230)]">
              ({text.length} chars)
            </span>
          )}
        </span>
      </summary>
      <div className="px-3 pb-2 pt-1 text-[13px] leading-relaxed text-[oklch(0.60_0.012_230)] italic whitespace-pre-wrap break-words">
        {text}
      </div>
    </details>
  );
}

function ThinkingStatus() {
  return (
    <div className="mt-1 mb-1 flex max-w-[760px] items-center gap-2 rounded-lg border border-[oklch(0.22_0.008_240)] bg-[oklch(0.122_0.004_245)]/70 px-2.5 py-1.5 text-xs text-[oklch(0.55_0.014_230)]">
      <Loader2 className="h-3 w-3 animate-spin text-[oklch(0.66_0.050_190)]" />
      <span>Thinking...</span>
    </div>
  );
}

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="py-3 px-4">
      <div className="mx-auto flex w-full max-w-[760px] justify-end">
        <p className="max-w-[min(680px,100%)] rounded-[20px] rounded-br-[6px] bg-[oklch(0.188_0.010_235)] px-4 py-3 text-[14px] leading-relaxed text-[oklch(0.94_0.008_220)] whitespace-pre-wrap break-words shadow-[inset_0_0_0_1px_oklch(0.70_0.05_195_/_0.12)]">
          {message.content}
        </p>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const model = useChatStore((s) => s.model);
  const extracted = extractThinkBlocks(message.content);
  const reasoning = [message.reasoning, extracted.reasoning]
    .filter(Boolean)
    .join("\n\n");
  const visibleContent = extracted.visible.trimStart();

  return (
    <div className="py-3 px-4">
      <div className="mx-auto w-full max-w-[760px]">
        {reasoning && <ReasoningBlock text={reasoning} defaultOpen={false} />}
        {visibleContent && (
          <div className="text-[14.5px] leading-7 text-[oklch(0.92_0.006_220)]">
            <MarkdownContent content={visibleContent} />
          </div>
        )}
        {message.toolCalls.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            {message.toolCalls.map((tc) => (
              <ToolBlock key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
        {message.usage && (
          <p className="text-xs text-[oklch(0.45_0.010_230)] mt-1">
            {formatTurnFootnote(message.usage, model)}
            {message.stopped && (
              <span className="ml-2 text-[oklch(0.60_0.20_25)]">(stopped)</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * In-progress assistant turn, same layout as AssistantMessage but with a
 * blinking cursor and no usage footer.
 */
export function StreamingMessage({
  content,
  reasoning,
}: {
  content: string;
  reasoning?: string;
}) {
  const extracted = extractThinkBlocks(content);
  const reasoningText = [reasoning, extracted.reasoning]
    .filter(Boolean)
    .join("\n\n");
  const visibleContent = extracted.visible.trimStart();
  const hasVisibleContent = visibleContent.trim().length > 0;

  return (
    <div className="py-3 px-4">
      <div className="mx-auto w-full max-w-[760px]">
        {reasoningText && (
          <ReasoningBlock text={reasoningText} defaultOpen={false} isStreaming />
        )}
        {!reasoningText && !hasVisibleContent && <ThinkingStatus />}
        {hasVisibleContent ? (
          <div className="text-[14.5px] leading-7 text-[oklch(0.92_0.006_220)] relative">
            <MarkdownContent content={visibleContent} />
            <span
              className="inline-block w-0.5 h-[14px] bg-[oklch(0.66_0.050_190)] animate-pulse ml-0.5 align-text-bottom"
              aria-label="xolotl is typing"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
