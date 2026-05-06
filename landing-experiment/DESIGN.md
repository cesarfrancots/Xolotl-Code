---
version: alpha
name: Xolotl Harness Field Manual
description: Design system for an engineering-focused landing page that teaches Xolotl and harness engineering.
colors:
  ink: "#111417"
  graphite: "#242A30"
  paper: "#F7F3EA"
  bone: "#FFFDF7"
  grid: "#D8D1C2"
  xolotl: "#3DDC97"
  ember: "#FF6B3D"
  cobalt: "#3F7CFF"
  violet: "#7E57C2"
  signal: "#E8FF6A"
typography:
  display:
    fontFamily: Inter, Arial, sans-serif
    fontSize: 64px
    fontWeight: 780
    lineHeight: 0.98
    letterSpacing: 0
  headline:
    fontFamily: Inter, Arial, sans-serif
    fontSize: 38px
    fontWeight: 720
    lineHeight: 1.05
    letterSpacing: 0
  body:
    fontFamily: Inter, Arial, sans-serif
    fontSize: 17px
    fontWeight: 430
    lineHeight: 1.58
    letterSpacing: 0
  label:
    fontFamily: JetBrains Mono, Consolas, monospace
    fontSize: 12px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0
spacing:
  xs: 6px
  sm: 10px
  md: 16px
  lg: 24px
  xl: 40px
  xxl: 72px
rounded:
  sm: 4px
  md: 8px
  full: 999px
components:
  primary-button:
    background: "{colors.xolotl}"
    color: "{colors.ink}"
    radius: "{rounded.sm}"
  teaching-panel:
    background: "{colors.bone}"
    border: "{colors.grid}"
    radius: "{rounded.md}"
---

# Xolotl Harness Field Manual

## Overview

Xolotl should feel like a serious engineering instrument, not a marketing mascot. The page combines readable field-manual prose with live-looking runtime panels so visitors immediately understand that this is about agent loops, prompts, tool contracts, tests, and model-agnostic execution.

## Colors

Use ink and graphite for runtime surfaces, paper and bone for teaching sections, and multiple accents for state. Xolotl green is reserved for the main action and successful loop states. Ember marks intervention, cobalt marks model/provider routing, violet marks memory/context, and signal marks active execution.

## Typography

Use Inter for product narrative and JetBrains Mono or Consolas for command surfaces, labels, logs, metrics, and short technical affordances. Text must remain compact and legible; never scale type with viewport width.

## Layout

Use full-width bands with a constrained inner width. The first viewport must show the product name, a concrete value proposition, and a working visual of the harness loop. Prefer dense, scannable engineering sections over oversized generic hero composition.

## Elevation & Depth

Depth should come from borders, dark panels, subtle shadows, and layered terminal rows. Avoid decorative blobs, orbs, and generic gradients.

## Shapes

Use 4px radius for controls and 8px maximum radius for panels. Round pills are allowed only for compact status indicators.

## Components

Buttons are direct commands. Runtime visuals should show model routing, cache hits, tests, commits, and prompt refinement as live system states. Teaching panels should explain a single concept each and include a concrete harness artifact.

## Do's and Don'ts

Do make Xolotl and harness engineering visible in the first viewport. Do show the loop: prompt, plan, tools, tests, commit, learn. Do write specific engineering copy.

Don't use generic AI startup language, one-note color palettes, oversized rounded cards, or decorative visuals that do not reveal the product.
