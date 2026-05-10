import { diffLines } from "diff";
export type { Change } from "diff";

/**
 * Compute a line-level diff between two strings.
 * Returns an array of Change objects from the diff package.
 * Each Change: { value: string, added?: boolean, removed?: boolean, count: number }
 */
export function computeLineDiff(oldStr: string, newStr: string) {
  return diffLines(oldStr, newStr);
}
