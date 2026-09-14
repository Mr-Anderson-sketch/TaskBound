# TimeBound — working agreement for agents

Read these before doing anything: `DESIGN.md` (visual law), `docs/PLAN.md` (what to build, in order), `docs/superpowers/specs/2026-09-14-focus-first-design.md` (the spec and every reviewed decision), `docs/DECISIONS.md` (why).

## What this product is
A desktop app (Electron, Windows 11 primary, macOS first-class) that keeps the current task visible in a ≤ 40 px strip at the screen edge. The strip is the product. Non-intrusive beats everything.

## Architecture rules
- `src/core/` is pure TypeScript: no Electron, no Node APIs, no `Date.now()`; every action carries `now` and any new `id`. Unit-tested with Vitest.
- The store lives in the main process (`src/main/store.ts`); renderers are views. IPC is `store:dispatch` in, `store:changed` snapshots out. Never add a second source of truth.
- The store never ticks. Timers are `runningSince` + one armed timeout in main; renderers derive display time locally.
- Every IPC payload is zod-validated in main. Preload exposes only the typed channel map in `src/shared/ipc.ts`. `sandbox: true`, `contextIsolation: true`.
- Persistence: temp → rename, daily backups in `backups/`, zod on load, never delete user files. Legacy `state.json` is imported and left in place.
- Dependencies need a line in `docs/DECISIONS.md`. No telemetry, no network calls.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.
Theme tokens: `src/renderer/theme/themes.json` → `node scripts/build-theme-css.mjs`; `node scripts/check-contrast.mjs` must pass.

## Commands
- `npm run dev` — main + preload watch, Vite renderer, Electron.
- `npm run build` — production bundles into `dist/`.
- `npm test` — Vitest (runs under two time zones).
- `npm run e2e` — Playwright against the built app (`ELECTRON_RUN_AS_NODE` is stripped by the launcher; do not run Electron directly from a shell that has it set).
- `npm run package` — Windows NSIS installer; `npm run package:mac` — DMG (macOS only).

## Process
- Work on `feat/focus-first`. Small atomic commits with clear messages. Never push unless asked. Never rewrite history.
- Tests first for `core/` and persistence (TDD). Playwright for every slice's acceptance criteria.
- Every commit builds and launches. Never leave the app broken.
- Update `CHANGELOG.md` with each slice. Record any non-obvious decision in `docs/DECISIONS.md` with a one-line rationale.
- Ask nothing that costs money or touches privacy without the owner; everything else, decide and document.
