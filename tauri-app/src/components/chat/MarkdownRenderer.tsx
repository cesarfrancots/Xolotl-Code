import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { Check, Copy } from "lucide-react";
import { Button } from "../ui/button";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

interface MarkdownRendererProps {
  content: string;
}

/**
 * Renders markdown content with syntax-highlighted code blocks.
 * Uses react-markdown + rehype-highlight (highlight.js github-dark theme).
 * Custom `code` component adds a copy-to-clipboard button on fenced code blocks.
 *
 * Per D-08 (locked): react-markdown + rehype-highlight, NOT shiki.
 * Per RESEARCH.md anti-patterns: never use rehypeRaw — XSS risk (T-4-04-01).
 * Per RESEARCH.md Pitfall 5: wrap code blocks in not-prose to avoid Tailwind
 * typography overriding highlight.js styles.
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // Override Tailwind typography defaults with explicit high-contrast values.
  // `@theme` tokens don't always propagate into `.prose` so we set them here.
  const proseVars: React.CSSProperties = {
    // @ts-expect-error CSS custom properties
    "--tw-prose-body": "oklch(0.95 0 0)",
    "--tw-prose-headings": "oklch(0.97 0 0)",
    "--tw-prose-bold": "oklch(0.98 0 0)",
    "--tw-prose-code": "oklch(0.88 0.06 250)",
    "--tw-prose-pre-bg": "oklch(0.16 0 0)",
    "--tw-prose-pre-code": "oklch(0.92 0 0)",
    "--tw-prose-links": "oklch(0.72 0.18 250)",
    "--tw-prose-quotes": "oklch(0.80 0 0)",
    "--tw-prose-quote-borders": "oklch(0.30 0 0)",
    "--tw-prose-hr": "oklch(0.28 0 0)",
    "--tw-prose-bullets": "oklch(0.60 0 0)",
    "--tw-prose-counters": "oklch(0.60 0 0)",
  };
  return (
    <div className="prose prose-sm max-w-none" style={proseVars}>
    <ReactMarkdown
      rehypePlugins={[rehypeHighlight]}
      components={{
        code({ className, children, ...props }) {
          const isBlock = Boolean(className?.startsWith("language-"));
          if (isBlock) {
            return (
              <div className="not-prose relative group my-2">
                <code
                  className={`${className} block overflow-x-auto rounded-md bg-[oklch(0.16_0_0)] text-sm leading-relaxed`}
                  {...props}
                >
                  {children}
                </code>
                <CopyButton text={String(children).replace(/\n$/, "")} />
              </div>
            );
          }
          return (
            <code
              className="bg-[oklch(0.20_0_0)] text-[oklch(0.85_0.04_250)] px-1 py-0.5 rounded text-sm font-mono"
              {...props}
            >
              {children}
            </code>
          );
        },
        // Override pre to remove default prose padding that fights hljs
        pre({ children, ...props }) {
          return (
            <pre className="not-prose p-0 m-0 bg-transparent" {...props}>
              {children}
            </pre>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
}

/** Copy-to-clipboard button for code blocks. Uses Tauri clipboard plugin. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback to navigator.clipboard if Tauri plugin fails
      await navigator.clipboard.writeText(text).catch(() => undefined);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-[oklch(0.20_0_0)] hover:bg-[oklch(0.22_0_0)]"
      title="Copy code"
      onClick={() => void handleCopy()}
    >
      {copied ? (
        <Check className="h-3 w-3 text-[oklch(0.60_0.16_145)]" />
      ) : (
        <Copy className="h-3 w-3 text-[oklch(0.55_0_0)]" />
      )}
    </Button>
  );
}
