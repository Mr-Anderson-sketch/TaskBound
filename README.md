# TimeBound

TimeBound keeps your current task in front of you: a 32 px strip at the edge of the screen shows what you're doing now, the timer if one is running, and nothing else. Behind it is a keyboard-first planner with lists, tags, recurring tasks, snooze, and a daily planning ritual. Local-first, no account, no network. Windows 11 and macOS.

**Status: rebuild in progress on branch `feat/focus-first`.** The app that builds today is the previous 1.0 sticky-note version; the focus-first version is specified and planned, not yet implemented. Start here:

- `docs/PLAN.md` — what to build, in order, as vertical slices.
- `DESIGN.md` — the visual system (four themes, type, spacing, the strip's pixel spec). Preview: `docs/design/preview.html`.
- `docs/superpowers/specs/2026-09-14-focus-first-design.md` — the spec and every reviewed decision.
- `docs/DECISIONS.md`, `docs/TODOS.md`, `docs/BASELINE.md`, `CHANGELOG.md`.

## Build

```
npm install
npm run build        # main, preload, renderer into dist/
npm run e2e:smoke    # launches the built app under Playwright
npm test             # Vitest, run under two time zones
npm run package      # Windows installer (unsigned) into release/
npm run package:mac  # DMG, run on macOS
```

If Electron starts as plain Node and prints `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`, your shell has `ELECTRON_RUN_AS_NODE=1` set. The e2e launcher and `npm run dev` clear it; for a manual launch, unset it first.

If `npm run e2e:smoke` fails with "Process failed to launch" and `node_modules/electron/dist` is missing, run `node node_modules/electron/install.js` once to download the Electron binary.

## Data

`%APPDATA%\TimeBound\` on Windows, `~/Library/Application Support/TimeBound/` on macOS. Override with `TIMEBOUND_DATA_DIR`. The previous version's `state.json` is imported on first run and never modified.
