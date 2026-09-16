# Screenshot index — docs/screenshots/

All captured on this machine: Windows 11, 1366x768 display, 100% scale. Realistic seed
data throughout (no lorem ipsum) — task titles like "Draft Q3 roadmap", "Reply to Priya
about invoices", "Review PR #182".

## Strip: theme x mode x state grid (32 files)

`strip-<theme>-<mode>-<state>.png`, theme in `{ledger, kraft, phosphor, slate}`, mode in
`{light, dark}`, state in `{normal, running, collapsed, break}`. One task ("Draft the
release notes", 25 min planned) drives every shot: `normal` is idle with a progress
hairline, `running` has its timer going, `collapsed` is the same task as the 24 px pill,
`break` is a synthetic pomodoro break pushed via the `timer:break` IPC channel.

| file | shows |
| --- | --- |
| strip-ledger-light-normal.png … strip-slate-dark-break.png | see naming scheme above — 32 files total |

## Strip: other states

| file | shows |
| --- | --- |
| strip-empty.png | Strip with no tasks — capture hint text |
| strip-task.png | Strip with a single task, default (ledger/light) theme |
| strip-break.png | Pomodoro break via a real timer expiry (timer.spec.ts) |

## Palette

| file | shows |
| --- | --- |
| capture-chips.png | Capture palette mid-type, live-parsed into title/when/tag chips |
| plan-today.png | "Plan today" sheet — rolled-over tasks and an inbox candidate |
| close-day.png | "Close the day" sheet with a note filled in |
| onboarding-1.png | First-run onboarding, card 1/3 — add your first task |
| onboarding-2.png | Onboarding card 2/3 — pick a strip edge |
| onboarding-3.png | Onboarding card 3/3 — five keys to remember |

## Planner

| file | shows |
| --- | --- |
| planner-today.png | Today view, realistic seed data (roadmap doc with tag/due/running timer, a reply task, a PR review with a sub-task) |
| planner-detail.png | Detail pane — title, tags, due date, recurrence, planned time, sub-task |
| planner-commands.png | Command palette (Ctrl+K) inside the planner |
| planner-undo-toast.png | Undo toast after a delete |

## Settings

| file | shows |
| --- | --- |
| settings-strip.png | Strip section — dock edge, width, opacity, etc. |
| settings-theme.png | Theme section — 4 palette cards, appearance, text size |
| settings-timer.png | Timer & pomodoro section |
| settings-hotkeys.png | Hotkeys section |
| settings-data.png | Data section — location, export/import, backups |

## Footprint (docs/FOOTPRINT.md)

| file | shows |
| --- | --- |
| footprint-ledger.png | Strip at default size/edge, Ledger theme (light) |
| footprint-kraft.png | Strip at default size/edge, Kraft theme (light) |
| footprint-phosphor.png | Strip at default size/edge, Phosphor theme (light) |
| footprint-slate.png | Strip at default size/edge, Slate theme (light) |

These are real Playwright `page.screenshot()` captures of the strip window's own
content. A desktop-level capture (e.g. PowerShell's `CopyFromScreen`) was **not** used
anywhere in this task — in this environment it only returns the desktop wallpaper, not
real window contents, so including it would be misleading.

## Visual defects observed while capturing (not fixed — renderer code untouched)

1. **capture-chips.png** — the palette's footer hint text truncates mid-word with a bare
   `t...` ("Esc once to keep text literal, t..."), cutting off before "type again to
   restore parsing" (or similar). Should either wrap, shorten, or truncate with an
   ellipsis after a whole word.
2. **planner-detail.png** — the "Current" row's task title truncates ("Write the
   baselin…") even though the identical, longer title ("Write the baseline document")
   renders in full elsewhere on the same screen (the detail pane header, the toast).
   The row's available width looks wide enough for a couple more characters; worth a
   second look at the truncation threshold.
