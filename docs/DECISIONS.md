# Decisions

One line each, newest at the bottom. Rationale follows the dash.

- 2026-09-14 Stay on Electron, upgrade in place to the current major — only stack here that gives always-on-top, click-through, global hotkeys, tray, and per-monitor work areas without native modules.
- 2026-09-14 Retire the `pwa/` tree — a focus strip cannot exist in a browser; two codebases halve the effort on the one that matters. It remains in git history.
- 2026-09-14 Timer stays first-class; score becomes an opt-in setting (off by default); the three-minute nag popup is removed — the mission names non-intrusiveness as the key factor.
- 2026-09-14 Store moves to the main process; renderers are views — one source of truth for strip, main window, capture, and tray; fixes the two-tick-source drift in the old renderer store.
- 2026-09-14 Pure `src/core/` package with no Electron imports — makes parser, recurrence, undo, migration, and timer math unit-testable with Vitest.
- 2026-09-14 Schema v2 with an explicit `schemaVersion` and a migrator; legacy `state.json` is imported, copied to `backups/`, and never deleted — guardrail on user data.
- 2026-09-14 Work on branch `feat/focus-first`; no pushes to origin unless asked — the brief says branch and commit; pushing is outward-facing.
- 2026-09-14 Cloud sync proposal, not built: user-chosen sync folder (OneDrive/Dropbox/Syncthing) holding `data.json`, last-writer-wins with a conflict copy — free and privacy-safe; revisit after v1 ships.
- 2026-09-14 Installer ships unsigned — code signing needs a paid certificate; question deferred to the final report.
- 2026-09-14 Start-on-login is an opt-in toggle, default off, implemented with Electron's login-item API (a per-user registry Run entry) — mild, reversible, and standard for tray apps; not treated as a broad OS permission.
- 2026-09-14 macOS is a first-class target (owner direction), Windows 11 remains primary and the only platform verifiable on the build machine — strip uses an NSPanel-type window on macOS; a macOS "menu bar mode" ships; DMG packaging configured; a macOS release checklist replaces automated verification there.
- 2026-09-14 Hotkey defaults use only non-character keys (`Ctrl+Alt+Space`, `Ctrl+Alt+Shift+Space`, `Ctrl+Alt+Enter`, `Ctrl+Alt+Shift+Enter`, `Ctrl+Alt+Backspace`) — AltGr never maps those, so the same table works on every layout and on macOS as Control+Option.
- 2026-09-14 The gstack design mockup tool is not used — it calls the OpenAI image API, which needs a billed key. Strip and window variants are hand-written HTML at true pixel size instead.
- 2026-09-14 Implementation will be executed by Sonnet-model subagents from per-slice briefs in PLAN.md, with the lead reviewing each slice (owner direction).
- 2026-09-14 Store never ticks; timer expiry is a single armed timeout; renderers derive display time locally — removes the 1 Hz full-snapshot broadcast and the two-tick-source drift from the old code.
- 2026-09-14 Undo is a ring of 50 immutable previous states (immer structural sharing), not inverse actions — recurrence spawns and timer stops have no clean inverse.
- 2026-09-14 One optional FFI module (`koffi`) on Windows only, lazily loaded, every feature gated with fallback — AppBar space reservation and fullscreen detection have no first-party Electron API; the app is complete without it.
- 2026-09-14 Default dock edge is bottom — a top strip covers browser tab bars; bottom sits above the taskbar like a second taskbar.
- 2026-09-14 Strip construction: variant A "Label" (flat backplate flush to the edge, 6 px free corners, 2 px progress hairline) — B "Ruled" costs 2 px and its timer column reads as a table; C "Capsule" floats 8 px off the edge and never reads as part of the OS.
- 2026-09-14 Planner layout: variant A three columns (rail, list, detail) — the current task's timer and notes are visible without a click, which is the product's whole premise; B two-pane is kept as the layout under 900 px width.
- 2026-09-14 Typography: IBM Plex Sans (UI), IBM Plex Mono (timers, counts), Instrument Serif (view titles, onboarding) — bundled via @fontsource so the app never loads fonts from the network; Plex is built for small UI sizes and has tabular figures; Instrument Serif gives the stationery warmth without touching the strip.
- 2026-09-14 Themes: Ledger (default), Kraft, Phosphor, Slate, each light and dark, tokens in `src/renderer/theme/themes.json`, CSS generated, AA verified by `scripts/check-contrast.mjs` (text ≥ 7:1, secondary ≥ 4.5:1) — physical-object inspiration per the brief; no gradients, no glass.
- 2026-09-14 Dependencies added (setup): `zod` (one schema for IPC, file, settings validation), `immer` (pure reducers with structural sharing; undo ring stays cheap), `date-fns` (local calendar math incl. month-end clamping; no tz addon), `@tanstack/react-virtual` (500-task lists), `@fontsource/ibm-plex-sans|mono`, `@fontsource/instrument-serif` (bundled fonts, no network), `vitest` + `fast-check` (unit and property tests), `@playwright/test` (Electron e2e), `koffi` as optional (Windows AppBar/fullscreen, gated). Rejected: `chrono-node` (heavy, non-deterministic parsing), `electron-store` (sync writes, no rotation/recovery).
- 2026-09-14 `fs-extra` and `uuid` stay until Slice 1 deletes the old renderer and state manager that use them — removing them now would break the build the setup promises to keep green.
- 2026-09-14 Electron upgraded 28 → 44 in place; the old app builds and passes the smoke test on it. Note: npm did not run Electron's own binary download during install on this machine; `node node_modules/electron/install.js` fixes it and is documented in README.
