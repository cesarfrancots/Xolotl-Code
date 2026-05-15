import { ChevronRight } from "lucide-react";
import type { Message, PermissionItem } from "../../stores/chatStore";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PermissionCard } from "./PermissionCard";
import { ToolBlock } from "./ToolBlock";
import { useChatStore } from "../../stores/chatStore";
import { formatTurnFootnote } from "../../lib/cost";

interface MessageItemProps {
  item: Message | PermissionItem;
}

const ASSISTANT_NAME = "xolotl";
const USER_NAME = "You";

/**
 * Slack-style chat message: avatar bubble + name + (subtitle) on the first
 * line, then the message body.
 *
 * User messages are right-aligned with a subtle raised-surface card.
 * Assistant messages span full width with high-contrast prose body so the
 * reply is actually readable against the dark background.
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

function Avatar({
  initial,
  tone,
}: {
  initial: string;
  tone: "user" | "assistant";
}) {
  const bg =
    tone === "assistant"
      ? "bg-[oklch(0.65_0.18_250)]" // accent blue for xolotl
      : "bg-[oklch(0.30_0_0)]";
  return (
    <div
      className={`flex-none w-8 h-8 rounded-md ${bg} flex items-center justify-center text-xs font-semibold text-white select-none`}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

/**
 * Collapsible reasoning / chain-of-thought block.
 *
 * - `defaultOpen` is honored on first paint, but the user can toggle freely.
 * - Content is rendered de-emphasized (smaller font, muted color, italic) so
 *   it never competes with the main reply for attention.
 * - During streaming we open it so the user sees activity; once the answer
 *   has finalized we render it closed by default.
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
      open={defaultOpen}
      className="group mt-1 mb-1 rounded-md border border-[oklch(0.22_0_0)] bg-[oklch(0.13_0_0)]/60"
    >
      <summary
        className="flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-1.5 text-xs text-[oklch(0.55_0_0)] hover:text-[oklch(0.75_0_0)] transition-colors list-none [&::-webkit-details-marker]:hidden"
      >
        <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
        <span>
          {isStreaming ? "Thinking…" : "Reasoning"}
          {!isStreaming && (
            <span className="ml-1 text-[oklch(0.40_0_0)]">({text.length} chars)</span>
          )}
        </span>
      </summary>
      <div className="px-3 pb-2 pt-1 text-[13px] leading-relaxed text-[oklch(0.62_0_0)] italic whitespace-pre-wrap break-words">
        {text}
      </div>
    </details>
  );
}

function MessageHeader({
  name,
  subtitle,
  tone,
}: {
  name: string;
  subtitle?: string;
  tone: "user" | "assistant";
}) {
  return (
    <div className="flex items-baseline gap-2 leading-none">
      <span
        className={`text-sm font-semibold ${
          tone === "assistant"
            ? "text-[oklch(0.78_0.12_250)]"
            : "text-[oklch(0.92_0_0)]"
        }`}
      >
        {name}
      </span>
      {subtitle && (
        <span className="text-xs text-[oklch(0.50_0_0)] font-normal">
          {subtitle}
        </span>
      )}
    </div>
  );
}

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="py-3 px-4 flex gap-3">
      <Avatar initial="Y" tone="user" />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <MessageHeader name={USER_NAME} tone="user" />
        <p className="text-[15px] leading-relaxed text-[oklch(0.95_0_0)] whitespace-pre-wrap break-words">
          {message.content}
        </p>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const model = useChatStore((s) => s.model);

  return (
    <div className="py-3 px-4 flex gap-3">
      <Avatar initial="x" tone="assistant" />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <MessageHeader name={ASSISTANT_NAME} subtitle={model} tone="assistant" />
        {message.reasoning && (
          <ReasoningBlock text={message.reasoning} defaultOpen={false} />
        )}
        <div className="text-[15px] leading-relaxed text-[oklch(0.95_0_0)]">
          <MarkdownRenderer content={message.content} />
        </div>
        {message.toolCalls.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            {message.toolCalls.map((tc) => (
              <ToolBlock key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
        {message.usage && (
          <p className="text-xs text-[oklch(0.45_0_0)] mt-1">
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
 * In-progress assistant turn — same Slack layout as AssistantMessage but with
 * a blinking cursor and no usage footer. Reasoning auto-collapses once the
 * main reply starts streaming so the user's eye lands on the answer.
 */
export function StreamingMessage({
  content,
  reasoning,
}: {
  content: string;
  reasoning?: string;
}) {
  const model = useChatStore((s) => s.model);
  // While there is reasoning but no content yet, keep the block open so the
  // user sees activity. The moment content arrives we close it so the actual
  // reply takes focus.
  const reasoningOpen = Boolean(reasoning) && !content;
  return (
    <div className="py-3 px-4 flex gap-3">
      <Avatar initial="x" tone="assistant" />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <MessageHeader name={ASSISTANT_NAME} subtitle={model} tone="assistant" />
        {reasoning && (
          <ReasoningBlock text={reasoning} defaultOpen={reasoningOpen} isStreaming />
        )}
        {content ? (
          <div className="text-[15px] leading-relaxed text-[oklch(0.95_0_0)] relative">
            <MarkdownRenderer content={content} />
            <span
              className="inline-block w-0.5 h-[14px] bg-[oklch(0.65_0.18_250)] animate-pulse ml-0.5 align-text-bottom"
              aria-label="xolotl is typing"
            />
          </div>
        ) : (
          !reasoning && (
            // Nothing streaming yet — show a tiny waiting hint
            <p className="text-xs text-[oklch(0.50_0_0)] italic">Waiting for response…</p>
          )
        )}
      </div>
    </div>
  );
}
