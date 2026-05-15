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
 * a blinking cursor and no usage footer.
 */
export function StreamingMessage({ content }: { content: string }) {
  const model = useChatStore((s) => s.model);
  return (
    <div className="py-3 px-4 flex gap-3">
      <Avatar initial="x" tone="assistant" />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <MessageHeader name={ASSISTANT_NAME} subtitle={model} tone="assistant" />
        <div className="text-[15px] leading-relaxed text-[oklch(0.95_0_0)] relative">
          <MarkdownRenderer content={content} />
          <span
            className="inline-block w-0.5 h-[14px] bg-[oklch(0.65_0.18_250)] animate-pulse ml-0.5 align-text-bottom"
            aria-label="xolotl is typing"
          />
        </div>
      </div>
    </div>
  );
}
