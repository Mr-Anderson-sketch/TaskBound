# DESIGN.md — TimeBound

This file is law for every visual decision. Read it before touching any UI. Preview: `docs/design/preview.html` (open in a browser; use `?theme=kraft&mode=dark`). Renders: `docs/design/*.png`.

## Product context

- **What this is:** a desktop app that keeps the current task in front of you in a strip at the screen edge, with a planner behind it.
- **Who it's for:** keyboard-first knowledge workers on Windows 11 and macOS who already keep a task list and want it visible without it being in the way.
- **The memorable thing:** *the calmest thing on the screen.* It should look like a strip of good paper resting on the desk edge, not a dashboard. Every decision below serves that.
- **Project type:** desktop app with three surfaces: strip (always on), palette (keyboard sheets), planner (back office).

## Aesthetic direction

- **Direction:** Stationery / instrument. Paper, ink, hairlines. Classic software restraint (IBM, early Mac) rather than modern SaaS.
- **Decoration level:** intentional. Flat tinted backplates, 1 px hairlines, one accent per theme. No gradients, no glass, no blur, no drop-shadow stacks, no rounded-everything, no icon grids.
- **Mood:** quiet, exact, warm. The strip should feel like a label maker label; the planner like a well-set ledger page.
- **Never:** purple gradients, glassmorphism, neon glows, emoji as icons, uniform 12 px radii, centred hero layouts.

## Typography

Bundled with `@fontsource/*` (OFL). The app must never fetch fonts from the network.

| Role | Face | Size / line | Notes |
|---|---|---|---|
| Strip title | IBM Plex Sans 500 | 13 / 16 | The only text that must be legible at a glance. Never below 13 px. |
| Strip secondary | IBM Plex Sans 400 | 13 / 16 | `--strip-muted` colour. |
| Timer, counts, due times | IBM Plex Mono 500 | 12 / 20 | `font-variant-numeric: tabular-nums`. Chips are 20 px tall. |
| UI (rows, rail, settings) | IBM Plex Sans 400/500 | 13 / 16 and 14 / 20 | 500 for the current task and selected items only. |
| Body / notes | IBM Plex Sans 400 | 14 / 20 | |
| View titles, onboarding, plan/close day | Instrument Serif 400 | 24 / 28 and 28 / 32 | Never below 20 px; never in the strip. Italic allowed for the date. |
| Section labels | IBM Plex Sans 600 | 11 / 14, caps, +0.06 em | `--muted`. |
| Big timer (detail pane) | IBM Plex Mono 500 | 24 / 28 | |

Fallback stack: `"IBM Plex Sans", "Segoe UI", system-ui, sans-serif`; mono `"IBM Plex Mono", "Cascadia Mono", Consolas, monospace`; serif `"Instrument Serif", Georgia, serif`. Line-height is always explicit so Windows and macOS render the same box.

**Text size setting** (S/M/L = 12/13/14 px strip title) replaces OS text scaling, which Chromium ignores. Strip height is measured from content and capped at 44 DIP.

## Colour

Tokens live in `src/renderer/theme/themes.json` as OKLCH triples; `scripts/build-theme-css.mjs` generates `themes.css`; `scripts/check-contrast.mjs` must pass before any token change is committed.

**Roles** (every theme defines all of them, for light and dark):
`bg` window · `surface` rows, cards, inputs · `line` hairlines · `ink` text · `muted` secondary text · `accent` the one brand colour: current task, buttons, progress · `accentInk` text on accent · `ok` `warn` `danger` status · `stripBg` `stripInk` `stripMuted` the strip · derived `accent-tint` (14 %) and `accent-tint-strong` (28 %).

**Contrast floors** (enforced): ink on bg/surface ≥ 7:1; muted ≥ 4.5:1; accent as text ≥ 4.5:1; accentInk on accent ≥ 4.5:1; danger ≥ 4.5:1; ok/warn as non-text ≥ 3:1; strip ink ≥ 7:1 on strip bg.

**Themes**

| Theme | Inspiration | Light | Dark |
|---|---|---|---|
| Ledger (default) | Cream ledger paper, india ink, oxblood stamp | cream / oxblood | charcoal / brick |
| Kraft | Field Notes kraft cover, safety-orange ink | kraft tan / orange | dark kraft / amber-orange |
| Phosphor | Green-phosphor terminal; platinum 1980s plastic | platinum / dark green | near-black / phosphor green text, amber accent |
| Slate | Chalk on a green-grey slate; plaster wall | plaster / chalk blue | slate / chalk yellow |

Mode follows the OS by default (`system`), overridable. Dark modes redesign the surfaces (not inverted) and reduce chroma slightly.

**Opacity rule:** the strip's opacity setting applies to the backplate only; text is always 100 %; the backplate never goes below 70 % under the text run.

## Spacing and shape

- Base unit 4 px. Scale: 4 · 8 · 12 · 16 · 24 · 32 · 48.
- Density: compact in the strip and panel (28 px rows), comfortable in the planner (34 px rows), spacious in onboarding.
- Radius: 4 px chips and small controls · 6 px strip free corners, inputs, buttons · 8 px cards, palette, planner window · full for the collapsed pill.
- Hairlines are 1 px `--line`; the strip's docked edge carries a 2 px `--accent` progress hairline (done ÷ total for Today).
- Hit targets: nothing interactive under 24 × 24 CSS px (WCAG 2.2). The strip handle is 24 × 24; panel row actions are 24 × 24.

## The strip (pixel spec)

All values in DIPs at text size M.

```
|◂4▸[ 24×24 handle ][8][ title, 13/16, fades last 28 px ][8][ chip 20h ][10]|   height 32
        └ 8 px dot                                     └ mono 12, 7 px padding
 2 px progress hairline along the docked edge, width = done/total
```

- Width default 420, user-resizable 160–1200 by dragging the free end; the title gets whatever is left.
- Dot colours: running `accent` · paused `stripMuted` · overtime `warn` · done-for-today `ok` · unplanned (Today empty) hollow `stripMuted` ring · save failing `danger`.
- Chip variants: running `accent-tint` · paused outlined, muted, prefixed `‖` · overtime `warn` tint, `+MM:SS`, unclamped · plan-today outlined accent text · done-for-today shows focus total.
- Collapsed pill: 24 tall, title only, max 240 wide, timer replaces the tail when running.
- Auto-hide sliver: 4 px, `accent` at 60 %.
- Click-through: backplate at 72 %, dashed 1.5 px `stripMuted` outline inset 3 px; handle shows a lock glyph.
- Completion: 1.2 s strike-through in `stripMuted`, chip becomes "Undo", then the next title slides in over 160 ms (or swaps instantly under reduced motion).
- Corner radius 6 px on the free corners (Windows), 8 px on macOS.

## Hover panel

Same width as the strip; opens on the free side of the strip. Head row 28 px (`Today · 3 of 7 done` left, `Next: …` right). Optional undo row (accent-tint, 5 s). Five task rows, 28 px: 14 px radio, title, mono due/timer, hover-only actions (done · skip · snooze). Then the strip itself as the panel's last row so the layout never jumps. Mouse-only: the window never takes focus.

## Palette (keyboard sheets)

560 px wide, 8 px radius, `surface` background, one hairline, single shadow `0 24px 60px -20px ink@50%`. Modes: capture (input 48 px tall, 16 px text, live token chips beneath), plan today, close day, command palette. Title in Instrument Serif 22 px. Footer 12 px muted with key hints in mono.

## Planner

Title bar 40 px on `surface`: brand, capture field (max 460, hint key on the right), window controls (native traffic lights on macOS with 78 px reserved). Three columns ≥ 900 px: rail 200 · list · detail 300. Under 900 px: two panes, detail expands inline under the selected row. View title in Instrument Serif 28 px with the date and counts in 13 px muted beside it. Sections in caps labels. Rows 34 px with a 16 px radio; current task 500 weight with accent radio; done rows struck in muted. Buttons never wrap: `white-space: nowrap`.

## Settings

Two columns: 180 px nav, pane. Pane title in Instrument Serif 24 px with a one-line description. Each setting is a row: label + one-line explanation on the left, control on the right; rows separated by hairlines. Controls: segmented control, toggle, range, key recorder, theme cards (three-stripe swatch). No tabs inside tabs, no accordions.

## Motion

- Approach: minimal-functional. Motion only where it explains a state change.
- Durations: micro 120 ms (hover, toggle) · short 160 ms (panel open, chip swap, title slide) · medium 240 ms (auto-hide slide, palette open) · nothing above 240 ms.
- Easing: enter `cubic-bezier(.2,.7,.2,1)`, exit `cubic-bezier(.6,0,.8,.4)`, move ease-in-out.
- Reduced motion (`prefers-reduced-motion` or the in-app setting): auto-hide slide, panel expand, title slide-in and dot pulse become instant; completion feedback becomes a 1.2 s colour change without movement.
- Completion is the one "satisfying" moment: strike, chip → Undo, next title. It must feel done in under 200 ms of perceived latency; the 1.2 s hold is for reading, not animation.

## Component inventory

Strip · Pill · Sliver · Hover panel (head, undo row, task row) · Palette (input, token chip, plan row, footer) · Planner (title bar, capture field, rail item, section label, task row, sub-task row, detail pane, timer block) · Settings (nav, setting row, segmented control, toggle, range, key recorder, theme card) · Onboarding card · Toast (bottom of planner, 12 px, accent-tint, `role="status"`) · Empty state (serif line + one hint) · Tray/menu bar item.

## States every component must design

empty · loading (never visible: windows show after first snapshot) · error (dot = danger, banner in panel/planner) · overflow (titles fade, lists virtualise at 500) · long text (200-char titles) · offline (n/a) · reduced motion · text size S/M/L · light/dark for each of four themes.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-14 | Initial system | Created from the focus-first spec; variants rendered in `docs/design/preview.html` and picked in DECISIONS.md. |
