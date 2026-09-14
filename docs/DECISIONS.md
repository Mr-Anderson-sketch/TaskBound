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
