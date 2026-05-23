export interface ExtractedReasoning {
  visible: string;
  reasoning: string;
}

const THINK_TAG_PATTERN = /<\/?think>/gi;

export function extractThinkBlocks(content: string): ExtractedReasoning {
  let visible = "";
  const reasoningParts: string[] = [];
  let cursor = 0;
  let inThink = false;

  THINK_TAG_PATTERN.lastIndex = 0;

  for (let match = THINK_TAG_PATTERN.exec(content); match; match = THINK_TAG_PATTERN.exec(content)) {
    const tag = match[0].toLowerCase();
    const beforeTag = content.slice(cursor, match.index);

    if (tag === "<think>") {
      if (inThink) {
        reasoningParts.push(beforeTag);
      } else {
        visible += beforeTag;
        inThink = true;
      }
    } else if (inThink) {
      reasoningParts.push(beforeTag);
      inThink = false;
    } else {
      visible += beforeTag;
    }

    cursor = THINK_TAG_PATTERN.lastIndex;
  }

  const remainder = content.slice(cursor);
  if (inThink) {
    reasoningParts.push(remainder);
  } else {
    visible += remainder;
  }

  return {
    visible,
    reasoning: reasoningParts
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function stripThinkBlocks(content: string): string {
  return extractThinkBlocks(content).visible;
}
