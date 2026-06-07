import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

describe("macOS accessibility stylesheet", () => {
  it("keeps a fallback focus-visible ring for custom workbench controls", () => {
    expect(styles).toContain("--xolotl-focus-ring");
    expect(styles).toContain(".xolotl-shell :where(button, [role=\"button\"], [role=\"tab\"]");
    expect(styles).toContain("[tabindex]:not([tabindex=\"-1\"])):focus-visible");
  });

  it("respects reduced-motion users across custom and Tailwind animations", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(".eval-creature-active");
    expect(styles).toContain(".civ-thinking");
    expect(styles).toContain(".animate-spin");
    expect(styles).toContain("transition-duration: 0.001ms !important");
  });

  it("provides a higher-contrast treatment for macOS contrast preferences", () => {
    expect(styles).toContain("@media (prefers-contrast: more)");
    expect(styles).toContain("--xolotl-focus-ring-contrast");
    expect(styles).toContain(".xolotl-project-row-active");
    expect(styles).toContain(".xolotl-palette-row-action:focus-visible");
  });
});
