import { ShieldAlert, Check, X, Lock } from "lucide-react";
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { commands } from "../../bindings";
import { useChatStore } from "../../stores/chatStore";
import type { PermissionItem } from "../../stores/chatStore";

interface PermissionCardProps {
  item: PermissionItem;
}

/**
 * Inline permission prompt card rendered in the chat thread.
 * Approve / Deny / Always Allow buttons flow to respondToPermission Tauri command.
 * Per D-07 (locked): inline card, user approves/denies/always-allows per tool.
 * Per RESEARCH.md Pitfall 6: AlwaysAllow adds tool to chatStore.alwaysAllowedTools.
 * Per 04-UI-SPEC.md §Permission Card.
 */
export function PermissionCard({ item }: PermissionCardProps) {
  const { resolvePermission, addAlwaysAllow } = useChatStore();
  const isResolved = item.decision !== undefined;

  async function handleDecision(decision: "Allow" | "Deny" | "AlwaysAllow") {
    // Optimistic update: resolve in UI immediately
    resolvePermission(item.promptId, decision);
    if (decision === "AlwaysAllow") {
      addAlwaysAllow(item.toolName);
    }
    // Respond to Rust backend
    const result = await commands.respondToPermission(item.promptId, decision);
    if (result.status === "error") {
      console.error("respondToPermission error:", result.error);
    }
  }

  return (
    <div className="py-2 px-4">
      <Card className="border-amber-800/50 bg-[oklch(0.16_0_0)]">
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-400 flex-none" />
            <span className="text-sm font-semibold text-[oklch(0.92_0_0)]">
              Permission Required
            </span>
          </div>
          {/* Tool name pill */}
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xs text-[oklch(0.55_0_0)]">tool:</span>
            <code className="text-xs bg-[oklch(0.20_0_0)] text-[oklch(0.85_0.04_250)] px-1.5 py-0.5 rounded">
              {item.toolName}
            </code>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-2">
          {/* Input preview (first 120 chars per permission_prompter.rs) */}
          <pre className="text-sm text-[oklch(0.55_0_0)] whitespace-pre-wrap font-mono text-xs leading-relaxed">
            {item.preview}
          </pre>
        </CardContent>
        <CardFooter className="px-4 pb-3 pt-0">
          {isResolved ? (
            <ResolvedBadge decision={item.decision!} />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Allow button */}
              <Button
                variant="outline"
                size="sm"
                className="border-green-700 text-[oklch(0.60_0.16_145)] hover:bg-green-900/20 h-8"
                onClick={() => void handleDecision("Allow")}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                Allow
              </Button>
              {/* Deny button */}
              <Button
                variant="outline"
                size="sm"
                className="border-red-700 text-[oklch(0.60_0.20_25)] hover:bg-red-900/20 h-8"
                onClick={() => void handleDecision("Deny")}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Deny
              </Button>
              {/* Always Allow button */}
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-[oklch(0.55_0_0)] hover:text-[oklch(0.92_0_0)] h-8 ml-auto"
                onClick={() => void handleDecision("AlwaysAllow")}
              >
                Always Allow
              </Button>
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

function ResolvedBadge({ decision }: { decision: "Allow" | "Deny" | "AlwaysAllow" }) {
  if (decision === "Allow") {
    return (
      <Badge className="bg-green-900/30 text-[oklch(0.60_0.16_145)] border-green-800">
        <Check className="h-3 w-3 mr-1" /> Allowed
      </Badge>
    );
  }
  if (decision === "Deny") {
    return (
      <Badge className="bg-red-900/30 text-[oklch(0.60_0.20_25)] border-red-800">
        <X className="h-3 w-3 mr-1" /> Denied
      </Badge>
    );
  }
  return (
    <Badge className="bg-green-900/30 text-[oklch(0.60_0.16_145)] border-green-800">
      <Lock className="h-3 w-3 mr-1" /> Always Allowed
    </Badge>
  );
}
