import type { Message, PermissionItem } from "../../stores/chatStore";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PermissionCard } from "./PermissionCard";
import { ToolBlock } from "./ToolBlock";
import { useChatStore } from "../../stores/chatStore";
import { formatTurnFootnote } from "../../lib/cost";

interface MessageItemProps {
  item: Message | PermissionItem;
}

/**
 * Renders a single chat item — user message, assistant message, or permission prompt placeholder.
 * PermissionCard rendering is in Plan 05; this component renders the PermissionItem
 * as a loading state placeholder until PermissionCard is available.
 *
 * User message: right-aligned, surface-raised background, accent left border.
 * Assistant message: left-aligned, transparent background, prose markdown.
 * Per 04-UI-SPEC.md §Message.
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

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="py-2 px-4 flex justify-end">
      <div
        className="max-w-[75%] rounded-lg bg-[oklch(0.20_0_0)] border-l-2 border-[oklch(0.65_0.18_250)] px-3 py-2"
      >
        <p className="text-sm text-[oklch(0.92_0_0)] whitespace-pre-wrap break-words">
          {message.content}
        </p>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const model = useChatStore((s) => s.model);

  return (
    <div className="py-2 px-4">
      <MarkdownRenderer content={message.content} />
      {/* Tool call blocks per plan 05 */}
      {message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-1 mt-2">
          {message.toolCalls.map((tc) => (
            <ToolBlock key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
      {/* Cost footnote per D-06 */}
      {message.usage && (
        <p className="text-xs text-[oklch(0.38_0_0)] mt-1">
          {formatTurnFootnote(message.usage, model)}
          {message.stopped && (
            <span className="ml-2 text-[oklch(0.60_0.20_25)]">(stopped)</span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * StreamingMessage: renders the in-progress assistant turn.
 * Receives streamingContent from chatStore and adds an animated cursor.
 */
export function StreamingMessage({ content }: { content: string }) {
  return (
    <div className="py-2 px-4">
      <div className="relative">
        <MarkdownRenderer content={content} />
        {/* Streaming cursor: 2px × 14px accent bar, animate-pulse (04-UI-SPEC.md) */}
        <span
          className="inline-block w-0.5 h-[14px] bg-[oklch(0.65_0.18_250)] animate-pulse ml-0.5 align-text-bottom"
          aria-label="AI is typing"
        />
      </div>
    </div>
  );
}
