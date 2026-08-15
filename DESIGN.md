---
name: Ankimo
description: An Apple-inspired premium monochrome reading system for capturing and revisiting notes in local Anki.
colors:
  background: "#f5f5f3"
  surface: "#ffffff"
  primary: "#1c1c1e"
  secondary: "#3a3a3c"
  muted: "#6e6e73"
  faint: "#9a9a9a"
  border: "#e5e5e2"
  border-strong: "#d1d1d6"
  action: "#1c1c1e"
  action-strong: "#000000"
  success: "#248a3d"
  danger: "#a63d3d"
  flag-red: "#c44444"
  flag-orange: "#bd741d"
  flag-green: "#388254"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  reading:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.8
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
  metadata:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  card: "14px"
  control: "10px"
  sheet: "20px"
  chip: "999px"
  indicator: "50%"
interaction:
  touchTarget: "44px"
  focus: "visible"
  reducedMotion: "respected"
  safeArea: "respected"
---

# Design System: Ink

## North star

**Ink is a premium monochrome reading system:** quiet, warm, and precise. It
borrows Apple's restraint—system typography, clear hierarchy, deliberate
spacing, obvious focus, and scoped modality—without pretending to be a native
UIKit or SwiftUI client.

The home screen is reading-first. Recent notes and saved content carry the
visual weight; capture, tags, flags, and review statistics remain available
without becoming a dashboard of competing tiles. The interface is a tool for
long-term use, not a marketing surface.

## Color contract

The base is monochrome and warm:

- **Background:** grouped warm light `#f5f5f3`.
- **Surface:** opaque white `#ffffff` for reading surfaces, fields, and scoped
  controls.
- **Primary ink:** near-black `#1c1c1e` for text and the primary action.
- **Secondary ink:** `#3a3a3c` for meaningful secondary content.
- **Muted ink:** `#6e6e73` for labels and supporting copy.
- **Faint ink:** `#9a9a9a` for low-emphasis metadata and placeholders.
- **Borders:** soft `#e5e5e2`; stronger `#d1d1d6` where separation needs to be
  explicit.

Charcoal/black is the only ordinary action and selection voice. Green is not a
brand accent in Ink: the distinct success green is reserved for the local Anki
connection state. Danger remains red. Anki's red, orange, and green flag colors
remain unchanged because they carry study-queue meaning rather than branding.

The token file keeps the old `--green` alias for unmigrated global CSS, but it
resolves to the monochrome action role. Connection work should use the separate
success role; ordinary buttons, selected modes, active navigation, and selected
filters must not use success green.

## Typography

Use the platform system sans stack led by SF Pro Text and the Chinese system
fonts. Use the monospace stack only for timestamps, counts, and compact
measurements. Hierarchy comes from size, weight, line height, and whitespace;
there is no decorative display face or marketing-scale headline.

- **Body:** `14px / 1.55`, regular.
- **Reading:** `15px / 1.8`, regular, for sustained note content.
- **Label:** `12px / 1.4`, semibold, for controls and concise state.
- **Metadata:** `10px / 1.4`, regular monospace, used sparingly.

## Information architecture

### Reading-first home

The home view prioritizes the note stream and readable content. Tags are the
primary organization and return path. Flags, decks, sync, and statistics are
secondary tools that remain discoverable but do not displace the reading flow.

### One entry, two capture options

Short Note and Q&A are options inside one shared entry experience, not two
unrelated products or two competing home routes. Short Note is the default and
stays low friction. Q&A makes its front/back fields, deck, and template
consequences explicit.

New-note is a scoped sheet/dialog. It protects the reading context while the
user captures or edits a multi-field item. It is not a full-page route and must
not become a generic dashboard panel. On small screens it may become a bottom
sheet; on larger screens it remains a centered, bounded dialog or sheet.

### Review Overview and heatmap

Review Overview is secondary to reading and capture. Its heatmap is a compact
neutral-intensity signal—not a green activity chart—and should not compete with
the note stream. The heatmap remains within Review Overview rather than becoming
the primary home navigation or a decorative hero.

## Layout and responsive behavior

Design mobile-first and adapt upward to desktop. The smallest acceptance target
is a 320px-wide browser; common mobile acceptance is 375–430px. Desktop may
use the existing fixed rail and centered content column when space allows, but
desktop density must not dictate the mobile composition.

- Keep visible interactive targets at least `44px` high or wide where they are
  touch controls.
- Keep safe-area insets around the shell and bottom actions for installed Web
  Apps.
- Let content breathe through grouping, whitespace, and hairlines rather than
  stacking containers.
- Collapse navigation into the existing drawer behavior at the mobile
  breakpoint; let Q&A fields and sheet actions stack naturally.
- Preserve keyboard access and visible focus at every viewport.

## Surfaces, depth, and shape

Reading cards are opaque white surfaces. They use the `14px` card radius and
soft borders or spacing for separation; they have **no resting shadow**. A card
should look like a stable page surface, not a floating tile.

Controls use the `10px` control radius. Sheets and dialogs use the `20px` sheet
radius and may use restrained elevation only because they create a new layer
above protected reading context. Chips use the `999px` chip radius. Indicators
may remain circular when their shape conveys status or flag meaning.

Borders are normally one pixel. Do not combine a broad shadow with a resting
surface. Avoid gradients, glassmorphism, decorative glow, nested cards, and
ornamental animation.

## Interaction states

- **Primary action:** near-black background with white text; hover and pressed
  states deepen toward black without translation or glow.
- **Selection:** charcoal/black emphasis or a neutral action wash; never green
  merely because an item is active.
- **Connection:** the only ordinary use of success green, paired with plain
  language and a status indicator. Checking, disconnected, busy, and error
  states remain explicit.
- **Danger:** use the danger role for destructive or disconnected emphasis.
- **Flags:** preserve Anki's red, orange, and green flag meanings exactly.
- **Focus:** every keyboard-focusable control has a visible high-contrast
  `:focus-visible` ring with an offset.
- **Motion:** respect `prefers-reduced-motion: reduce`; no required state may
  depend on animation.

## Component rules

- Prefer native HTML controls and CSS Modules for migrated components.
- Keep feature selectors out of `src/styles/base.css` and
  `src/styles/app-shell.css`; those files contain only true base or shell
  rules.
- Use semantic tokens rather than raw palette values in new styles.
- Migrate one component at a time and delete its old global selectors in the
  same change.
- Keep dialogs/sheets scoped to the entry or edit task; do not introduce a
  generalized overlay system before a second real consumer requires it.
- Do not add dark-mode implementation, new dependencies, a UI kit, or tokens
  without a concrete approved use.

## Product and data boundaries

Ink changes presentation and composition only. Anki remains the source of truth.
The current AnkiConnect client, API contracts, query syntax, write semantics,
note/card data, form behavior, routing, local service topology, and business
rules remain unchanged. A visual migration must not introduce a second client
store or change whether Short Note pauses or Q&A participates in Anki review.

## Acceptance

The foundation is accepted when:

1. The home reads as a note-reading surface before it reads as a dashboard.
2. Short Note and Q&A are visibly one entry with two options.
3. New-note is a scoped dialog/sheet, including bottom-sheet behavior on small
   screens.
4. Reading cards are opaque, rounded, border/space-separated, and shadowless at
   rest.
5. Review Overview and its neutral heatmap remain secondary.
6. Mobile use preserves safe areas, visible focus, reduced motion, and 44px
   touch targets, with responsive desktop adaptation.
7. Ordinary actions and selections are monochrome; success green appears only
   for connection state; Anki flag colors and danger semantics remain intact.
8. Anki/API/business behavior is unchanged.
