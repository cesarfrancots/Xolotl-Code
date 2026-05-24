import { describe, expect, it } from "vitest";
import { extractEvalArtifacts } from "./evalArtifacts";

describe("extractEvalArtifacts", () => {
  it("detects a runnable pygame artifact from a python code block", () => {
    const artifacts = extractEvalArtifacts(`
Save this as \`pong.py\`.

\`\`\`python
import pygame

pygame.init()
screen = pygame.display.set_mode((800, 500))
pygame.display.set_caption("Pong")
\`\`\`
`);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: "python",
      title: "pong.py",
      entryPath: "pong.py",
      canStart: true,
      canPreviewInline: false,
    });
    expect(artifacts[0].files[0].content).toContain("pygame.init()");
  });

  it("combines html css and javascript blocks into an inline web preview", () => {
    const artifacts = extractEvalArtifacts(`
\`\`\`html
<canvas id="game"></canvas>
\`\`\`

\`\`\`css
canvas { width: 320px; height: 180px; }
\`\`\`

\`\`\`js
document.body.dataset.ready = "yes";
\`\`\`
`);

    expect(artifacts[0]).toMatchObject({
      kind: "web",
      entryPath: "index.html",
      canStart: true,
      canPreviewInline: true,
    });
    expect(artifacts[0].previewHtml).toContain("<canvas id=\"game\"></canvas>");
    expect(artifacts[0].previewHtml).toContain("canvas { width: 320px; height: 180px; }");
    expect(artifacts[0].previewHtml).toContain("document.body.dataset.ready");
  });
});
