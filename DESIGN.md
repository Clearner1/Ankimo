---
name: Ankimo
description: A restrained, tag-first workspace for capturing notes into local Anki.
colors:
  paper: "#fffdfa"
  paper-strong: "#ffffff"
  quiet-rail: "#f4f6f2"
  quiet-rail-deep: "#edf1ed"
  graphite: "#26302b"
  graphite-soft: "#39443e"
  muted: "#66736c"
  faint: "#6b766f"
  hairline: "#dfe5df"
  hairline-strong: "#c7d1ca"
  botanical-green: "#246b4a"
  botanical-green-dark: "#1b573b"
  botanical-green-soft: "#e7f1e9"
  botanical-green-wash: "#f1f7f2"
  danger: "#a63d3d"
  danger-soft: "#fbf1f1"
  flag-red: "#c44444"
  flag-orange: "#bd741d"
  flag-green: "#388254"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "21px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  metadata:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  square: "0px"
  indicator: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.botanical-green}"
    textColor: "{colors.paper-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "9px 20px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0 11px"
    height: "42px"
  input:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "8px 12px"
    height: "42px"
  tag:
    backgroundColor: "{colors.botanical-green-wash}"
    textColor: "{colors.botanical-green-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "2px 7px"
    height: "24px"
  navigation-active:
    backgroundColor: "{colors.botanical-green-soft}"
    textColor: "{colors.botanical-green-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "8px 10px"
    height: "40px"
---

# Design System: Ankimo

## Overview

**Creative North Star: "The Quiet Study Desk / 安静的学习工作台"**

Ankimo should feel like a calm desk that is already connected to the user's learning system: quiet enough for long sessions, explicit enough that capture and review consequences never become ambiguous. Tags form the visible organizing structure, while decks, flags, statistics, and advanced settings remain accessible secondary tools.

The system uses restraint as an operating advantage. Whitespace separates tasks, hairlines establish topology, and one botanical green identifies active state, connection health, and the primary action. The interface is moderately dense rather than sparse for its own sake, with real note content carrying the visual weight.

**Key Characteristics:**

- Tag-first navigation with a continuous note stream.
- Paper and graphite neutrals with one botanical green accent.
- Flat, square controls and hairline-separated regions.
- State-explicit interaction for local connection, note mode, saving, answers, and filters.
- Responsive drawer behavior without hiding core capture actions.

## Colors

The palette resembles an uncluttered paper workspace: warm white surfaces, graphite ink, quiet green-gray rails, and botanical green reserved for meaningful action and state.

### Primary

- **Botanical Green** (`#246b4a`): primary save action, selected note mode, active indicators, and positive connection state.
- **Deep Botanical Green** (`#1b573b`): hover, active text, and higher-emphasis green states.
- **Botanical Wash** (`#f1f7f2`): restrained tag and answer-reveal surfaces.

### Neutral

- **Paper White** (`#fffdfa`): application canvas.
- **Strong Paper** (`#ffffff`): inputs and controls that need slight separation from the canvas.
- **Quiet Rail** (`#f4f6f2`): persistent navigation rail and subtle hover field.
- **Graphite Ink** (`#26302b`): primary text.
- **Soft Graphite** (`#39443e`): secondary control text.
- **Muted Green-Gray** (`#66736c`): labels and secondary copy.
- **Accessible Faint** (`#6b766f`): metadata and placeholders; it remains above 4.5:1 against Paper White.
- **Hairline** (`#dfe5df`) and **Strong Hairline** (`#c7d1ca`): topology, fields, and stream separators.

### Functional

- **Danger Red** (`#a63d3d`): destructive and disconnected states.
- **Flag Red** (`#c44444`), **Flag Orange** (`#bd741d`), and **Flag Green** (`#388254`): Anki's three supported study queues only.

**The One Green Voice Rule.** Botanical green carries the primary action and meaningful state; do not scatter additional accent colors across ordinary content.

## Typography

**Display Font:** none; this is an operating surface, not a marketing page.
**Body Font:** platform Chinese system sans stack, led by SF Pro Text and PingFang SC.
**Metadata Font:** platform monospace stack for timestamps and compact measurements only.

**Character:** Workhorse typography keeps Chinese text familiar and legible. Hierarchy comes from restrained changes in size and weight rather than decorative type pairing.

### Hierarchy

- **Headline** (650, `21px`, `1.25`, `-0.02em`): the composer title and equivalent primary task headings.
- **Title** (650, `15px`, `1.4`, `-0.01em`): stream and local section headings.
- **Body** (400, `14px`, `1.55`; note content may use `15px/1.8`): controls, explanations, and sustained reading.
- **Label** (600, `12px`, `1.4`): buttons, modes, navigation, and concise state text.
- **Metadata** (400, `10px`, `1.4`): timestamps and measurements; never use monospace as a technical costume.

**The Workhorse Rule.** Type should disappear into the learning task. Do not introduce a decorative display face, eyebrow, or marketing-scale headline inside the product shell.

## Layout

The desktop shell uses a fixed `248px` rail and a main canvas with a `62px` utility bar. Main content is capped at `1080px`, centered, and padded by `30px`. The composer owns the upper canvas; the stream follows in one column with hairline separators instead of repeated card containers.

Tags are expanded by default and precede flags, decks, and review overview. The rail scrolls independently when its real data exceeds the viewport. Flags and decks remain collapsed until requested.

At `768px`, the rail becomes a drawer, Q&A fields stack, the composer footer becomes vertical, and search becomes an explicit compact control. At `480px`, mode controls share the full width, the save action expands, metadata stacks, and the edit dialog becomes a bottom sheet. Visible interactive targets on mobile are at least `44px` high.

Spacing follows a compact `4 / 8 / 12 / 20 / 30px` rhythm. Related controls remain close; distinct regions receive a hairline plus larger separation.

## Elevation & Depth

The system is flat by default. Hierarchy comes from paper tones, whitespace, and hairline dividers rather than shadows. The modal alone uses a restrained `0 8px 22px rgba(38, 48, 43, 0.12)` shadow because it must sit above a protected editing context; toasts use boundary contrast rather than decorative glow.

**The Flat Desk Rule.** Resting application surfaces do not cast shadows. Elevation appears only when interaction genuinely creates a new layer.

## Shapes

Primary surfaces, controls, inputs, tags, and stream rows use square corners (`0px`). Circular geometry is reserved for status dots, flag dots, review cells, and other indicators whose shape carries meaning. Borders are normally `1px` hairlines; do not combine a border and broad shadow on the same resting surface.

## Components

### Buttons

- **Primary:** Botanical Green with white text, square corners, `44px` minimum height, and `9px 20px` padding.
- **Hover / Active:** deepen to Deep Botanical Green; do not translate, bounce, spin, or glow.
- **Secondary:** Paper background, Soft Graphite text, and a Strong Hairline border.
- **Focus:** visible `3px` translucent green outline with `2px` offset.

### Mode Control

The two radio-backed labels form one square segmented control. The selected mode is fully filled Botanical Green with white text. A persistent consequence sentence sits below the control and updates with the selected mode.

### Tags

Tags use Botanical Wash, Deep Botanical Green text, and a quiet green-gray border. They remain compact (`24px` high) but are keyboard focusable and act as filters. Tag hierarchy controls and pin actions have independent semantic buttons.

### Cards / Containers

Notes are semantic articles, not visual cards. They have transparent backgrounds, square corners, vertical whitespace, and one bottom hairline. Editing remains a modal because it protects a focused multi-field task; ordinary filtering and capture do not use modals.

### Inputs / Fields

Inputs use Strong Paper, square corners, and a Hairline border. Focus changes the border to Botanical Green without glow. Textareas remain open and resizable; the composer field itself is visually integrated into the page rather than placed inside another card.

### Navigation

The rail uses Quiet Rail. Active navigation and tag rows use Botanical Green Soft with Deep Botanical Green text. Tags lead the information architecture, flags and decks disclose on demand, and review overview follows as a secondary section.

### Connection Status

The local Anki connection uses a small status dot plus plain-language text. Orange indicates checking, Botanical Green connected, and Danger Red disconnected. Sync keeps a stable label and reports busy/success/error through state, never a rotating icon.

## Do's and Don'ts

### Do:

- **Do** keep tags visible as the primary grouping and make decks secondary.
- **Do** state whether a note enters review directly beneath the mode control and on saved short notes.
- **Do** use hairlines and whitespace before adding a container.
- **Do** keep connection, loading, success, error, disabled, focus, and empty states explicit.
- **Do** preserve `768px` drawer and `480px` phone behavior when extending the app.
- **Do** reserve red, orange, and green flag colors for their Anki meanings.

### Don't:

- **Don't** introduce purple gradients, glassmorphism, nested cards, dashboard tiles, or decorative animation.
- **Don't** use emoji or Unicode characters as a substitute for the icon system.
- **Don't** organize the primary experience around decks.
- **Don't** hide note actions behind hover-only behavior.
- **Don't** add a decorative display font, eyebrow, or oversized marketing heading to the application shell.
- **Don't** add shadows to resting surfaces or animate the sync action with rotation.
