export type EvalArtifactKind = "web" | "python";

export interface EvalArtifactFile {
  relativePath: string;
  content: string;
  language: string;
}

export interface EvalArtifact {
  id: string;
  kind: EvalArtifactKind;
  title: string;
  entryPath: string;
  files: EvalArtifactFile[];
  canStart: boolean;
  canPreviewInline: boolean;
  previewHtml?: string;
}

interface CodeBlock {
  language: string;
  content: string;
}

const FENCE_RE = /```([A-Za-z0-9_+.-]*)[^\n\r]*\r?\n([\s\S]*?)```/g;

export function extractEvalArtifacts(content: string): EvalArtifact[] {
  const blocks = extractCodeBlocks(content);
  const artifacts: EvalArtifact[] = [];

  const webArtifact = buildWebArtifact(content, blocks);
  if (webArtifact) artifacts.push(webArtifact);

  const pythonArtifact = buildPythonArtifact(content, blocks);
  if (pythonArtifact) artifacts.push(pythonArtifact);

  return artifacts;
}

function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  for (const match of content.matchAll(FENCE_RE)) {
    const language = normalizeLanguage(match[1] ?? "");
    const blockContent = (match[2] ?? "").replace(/\s+$/, "");
    if (blockContent.trim()) {
      blocks.push({ language, content: blockContent });
    }
  }
  return blocks;
}

function normalizeLanguage(language: string): string {
  const lang = language.trim().toLowerCase();
  if (lang === "py") return "python";
  if (lang === "javascript" || lang === "jsx" || lang === "ts" || lang === "tsx") return "js";
  if (lang === "htm") return "html";
  return lang;
}

function buildPythonArtifact(markdown: string, blocks: CodeBlock[]): EvalArtifact | null {
  const pythonBlocks = blocks.filter((block) =>
    block.language === "python" || looksLikePythonApp(block.content)
  );
  const source = pickLargest(pythonBlocks)?.content ?? (looksLikePythonApp(markdown) ? markdown : "");
  if (!source.trim()) return null;

  const fileName = findFileHint(markdown, ["py"]) ?? "app.py";
  return {
    id: `python:${fileName}`,
    kind: "python",
    title: fileName,
    entryPath: fileName,
    files: [{ relativePath: fileName, content: source, language: "python" }],
    canStart: true,
    canPreviewInline: false,
  };
}

function buildWebArtifact(markdown: string, blocks: CodeBlock[]): EvalArtifact | null {
  const htmlBlock = blocks.find((block) => block.language === "html" || looksLikeHtml(block.content));
  const cssBlocks = blocks.filter((block) => block.language === "css");
  const jsBlocks = blocks.filter((block) => block.language === "js");
  const svgBlock = blocks.find((block) => block.language === "svg" || looksLikeSvg(block.content));
  const rawHtml = htmlBlock?.content ?? extractFullHtml(markdown);

  if (!rawHtml && !svgBlock && cssBlocks.length === 0 && jsBlocks.length === 0) return null;

  const fileName = findFileHint(markdown, ["html", "htm", "svg"]) ?? "index.html";
  const html = rawHtml
    ? composeHtml(rawHtml, cssBlocks.map((block) => block.content), jsBlocks.map((block) => block.content))
    : composeHtml(svgBlock?.content ?? "", cssBlocks.map((block) => block.content), jsBlocks.map((block) => block.content));

  return {
    id: `web:${fileName}`,
    kind: "web",
    title: fileName,
    entryPath: "index.html",
    files: [{ relativePath: "index.html", content: html, language: "html" }],
    canStart: true,
    canPreviewInline: true,
    previewHtml: html,
  };
}

function pickLargest(blocks: CodeBlock[]): CodeBlock | undefined {
  return [...blocks].sort((a, b) => b.content.length - a.content.length)[0];
}

function looksLikePythonApp(source: string): boolean {
  return /\bimport\s+pygame\b|\bpygame\.init\s*\(|\btkinter\b|\bfrom\s+tkinter\s+import\b/i.test(source);
}

function looksLikeHtml(source: string): boolean {
  return /<!doctype\s+html|<html[\s>]|<canvas[\s>]|<script[\s>]|<body[\s>]/i.test(source);
}

function looksLikeSvg(source: string): boolean {
  return /<svg[\s>][\s\S]*<\/svg>/i.test(source);
}

function extractFullHtml(markdown: string): string {
  const match = markdown.match(/<!doctype\s+html[\s\S]*<\/html>|<html[\s\S]*<\/html>/i);
  return match?.[0] ?? "";
}

function findFileHint(markdown: string, extensions: string[]): string | null {
  const extPattern = extensions.map(escapeRegex).join("|");
  const quoted = new RegExp("[`'\"]([A-Za-z0-9_. -]+\\.(" + extPattern + "))[`'\"]", "i");
  const quotedMatch = markdown.match(quoted);
  if (quotedMatch?.[1]) return sanitizeFileName(quotedMatch[1]);

  const loose = new RegExp("\\b([A-Za-z0-9_.-]+\\.(" + extPattern + "))\\b", "i");
  const looseMatch = markdown.match(loose);
  return looseMatch?.[1] ? sanitizeFileName(looseMatch[1]) : null;
}

function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[\\/]+/g, "-");
  return trimmed.replace(/[^A-Za-z0-9_. -]/g, "").replace(/\s+/g, "-") || "app";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function composeHtml(html: string, cssBlocks: string[], jsBlocks: string[]): string {
  const css = cssBlocks.map((block) => `<style>\n${block}\n</style>`).join("\n");
  const js = jsBlocks.map((block) => `<script>\n${block}\n</script>`).join("\n");
  const base = html.trim();

  if (looksLikeHtml(base)) {
    let doc = base;
    if (css) {
      doc = /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, `${css}\n</head>`) : `${css}\n${doc}`;
    }
    if (js) {
      doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>/i, `${js}\n</body>`) : `${doc}\n${js}`;
    }
    return doc;
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body { margin: 0; min-height: 100%; background: #050607; color: #f5f7fb; }
    body { display: grid; place-items: center; overflow: hidden; }
    canvas, svg { max-width: 100vw; max-height: 100vh; }
  </style>
  ${css}
</head>
<body>
  ${base}
  ${js}
</body>
</html>`;
}
