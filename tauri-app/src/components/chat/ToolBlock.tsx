import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  Terminal,
  FileText,
  FilePen,
  FolderSearch,
  Search,
  ChevronRight,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { DiffView } from "./DiffView";
import type { ToolCall } from "../../stores/chatStore";

interface ToolBlockProps {
  toolCall: ToolCall;
}

/** Tool name → lucide icon mapping per 04-UI-SPEC.md §Tool Call Block */
function ToolIcon({ tool }: { tool: string }) {
  const name = tool.toLowerCase();
  if (name === "bash" || name === "execute_command") return <Terminal className="h-4 w-4" />;
  if (name === "read_file" || name === "view") return <FileText className="h-4 w-4" />;
  if (name === "write_file" || name === "create_file" || name === "str_replace_editor" || name === "edit") return <FilePen className="h-4 w-4" />;
  if (name === "glob" || name === "find_files") return <FolderSearch className="h-4 w-4" />;
  if (name === "grep" || name === "search") return <Search className="h-4 w-4" />;
  return <Terminal className="h-4 w-4" />;
}

/** Whether this tool produces diff output (file write or edit operations). */
function isFileEditTool(tool: string): boolean {
  const name = tool.toLowerCase();
  return ["write_file", "create_file", "str_replace_editor", "edit", "write", "apply_patch"].includes(name);
}

/**
 * Collapsible tool call block embedded in the message list.
 * Default state: collapsed per discretion decision in CONTEXT.md.
 * Bash output truncation: 2000 chars with "Show N more characters" link.
 * File edit tools show DiffView if output contains diff-parseable before/after content.
 * Per 04-UI-SPEC.md §Tool Call Block.
 */
export function ToolBlock({ toolCall }: ToolBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showFullOutput, setShowFullOutput] = useState(false);

  const TRUNCATE_AT = 2000;
  const output = toolCall.output ?? "";
  const isTruncated = output.length > TRUNCATE_AT && !showFullOutput;
  const displayOutput = isTruncated ? output.slice(0, TRUNCATE_AT) : output;
  const hiddenCount = output.length - TRUNCATE_AT;

  // Input preview: first 60 chars, per 04-UI-SPEC.md
  const inputPreview = toolCall.input.length > 60
    ? `${toolCall.input.slice(0, 60)}…`
    : toolCall.input;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="my-1">
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 px-3 h-9 rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.135_0.004_245)] hover:bg-[oklch(0.155_0.004_240)] transition-colors cursor-pointer">
          <span className="text-[oklch(0.55_0_0)]">
            <ToolIcon tool={toolCall.tool} />
          </span>
          <span className="text-xs text-[oklch(0.55_0_0)] font-medium flex-none">{toolCall.tool}</span>
          <span className="text-xs text-[oklch(0.38_0_0)] flex-1 min-w-0 text-left truncate">
            {toolCall.loading && !output ? "running…" : inputPreview}
          </span>
          {toolCall.loading && !output ? (
            <Loader2 className="h-3.5 w-3.5 text-[oklch(0.38_0_0)] animate-spin" />
          ) : isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-[oklch(0.38_0_0)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[oklch(0.38_0_0)]" />
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-2 border border-t-0 border-[oklch(0.22_0.008_240)] rounded-b-md bg-[oklch(0.135_0.004_245)]">
          {/* Tool output */}
          {output && (
            <pre className="text-xs text-[oklch(0.55_0_0)] whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
              {displayOutput}
            </pre>
          )}
          {/* Truncation expand link per 04-UI-SPEC.md */}
          {isTruncated && (
            <button
              className="mt-1 text-xs text-[oklch(0.66_0.040_190)] hover:underline"
              onClick={() => setShowFullOutput(true)}
            >
              Show {hiddenCount.toLocaleString("en-US")} more characters
            </button>
          )}
          {/* Diff view for file edit tools per D-09 */}
          {isFileEditTool(toolCall.tool) && output && (() => {
            // Attempt to parse before/after from output.
            // Format expected: "<<<BEFORE\n{old}\n===\n{new}\n>>>AFTER"
            // If not present, render the raw output as a diff from empty → output.
            const match = output.match(/<<<BEFORE\n([\s\S]*?)\n===\n([\s\S]*?)\n>>>AFTER/);
            if (match) {
              return <DiffView oldStr={match[1]} newStr={match[2]} />;
            }
            return null;
          })()}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
