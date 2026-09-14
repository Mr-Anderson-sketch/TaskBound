# Changelog

All notable changes to TimeBound. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow SemVer.

## [Unreleased]

### Setup (2026-09-14)
- Captured the pre-rebuild app in `docs/BASELINE.md` with screenshots and a code audit.
- Wrote the focus-first spec, three independent reviews with every decision recorded, `DESIGN.md`, and `docs/PLAN.md`.
- Added four OKLCH themes (Ledger, Kraft, Phosphor, Slate) in light and dark, generated to CSS and verified for AA contrast by `scripts/check-contrast.mjs`.
- Upgraded Electron and electron-builder; added Vitest (two time zones), Playwright for Electron with an isolated-data launcher, zod, immer, date-fns, react-virtual, bundled fonts.
- Added the Sonnet implementer agent definition and `CLAUDE.md`.
- Retired the `pwa/` tree (a focus strip cannot exist in a browser).

## [1.0.0] — 2025-12
- Original timeboxing sticky-note app: countdown per task, score, reminder popup, bulk import, focus spotlight.
