# Release checklist

Automated gates first (`npm test`, `npm run e2e`, `npm run theme:check`, `npm run typecheck`, `scripts/soak.mjs`), then these manual checks. Record results with date, machine, and OS build in `docs/FOOTPRINT.md` and the release notes. A release does not ship with an unchecked row.

## Windows 11 — focus and strip behaviour (spec C11, E22)

Playwright cannot prove that a foreign app keeps keyboard focus, so this matrix is run by hand on a real desktop.

| # | Foreground app | Action | Expected | Result |
|---|---|---|---|---|
| W1 | VS Code with a file open | Click the strip title | Caret keeps blinking in VS Code; typing goes to VS Code; panel opens | |
| W2 | Chrome with the address bar focused | Hover the strip, click a panel row's Done | Address bar stays focused; task completes | |
| W3 | Windows Terminal | Press the complete hotkey | Command completes in TimeBound; Terminal still receives keystrokes | |
| W4 | File Explorer rename in progress | Drag the strip along the edge | Rename box stays open and focused | |
| W5 | An elevated app (e.g. Task Manager) | Press the capture hotkey | Hotkey does not fire (documented Windows limitation); nothing crashes | |
| W6 | Remote Desktop session window | Hover and click the strip | RDP session keeps focus | |
| W7 | Teams or Zoom screen share of the whole desktop | Enable "Hide from screen sharing" | Viewers do not see the strip; local user does | |
| W8 | Borderless-fullscreen video (YouTube F11) | With "Hide over fullscreen apps" on/off | On: strip hides within 2 s and returns after; off: strip shows over the video | automated partially by e2e/win32.spec.ts (stubs the watcher's detection and drives its state machine directly — never waits out a real 2 s poll, and never opens a real fullscreen app); manual check still required |
| W9 | Exclusive-fullscreen game | Alt-Tab in and out | Strip hidden in game (OS behaviour), returns on desktop | |
| W10 | Taskbar set to auto-hide | Dock bottom, move the mouse to the bottom edge | Taskbar still reveals; strip sits 2 px above the reveal zone | |
| W11 | Second monitor at a different scale (e.g. 125 %) | Drag the strip across | Strip re-docks at 32 DIP on the new display; position remembered per display | |
| W12 | Unplug the docked monitor | — | Strip re-docks on the primary display within 1 s | |
| W13 | Quick capture from any app | Type, Enter | Palette hides; focus returns to the previous app; task appears in the strip | |
| W14 | Sleep the laptop for 10 minutes with a timer running | Wake | Timer paused at the sleep instant; strip shows "paused while away" | |
| W15 | Change the system clock backwards 1 hour with a timer running | — | Elapsed does not go negative; timer continues | |
| W16 | Windows Text size set to 125 % | — | Strip unchanged (in-app text size setting controls it) | |
| W17 | "Reserve screen space" on, Chrome maximised | — | Chrome stops at the strip edge; off: Chrome extends under it | automated partially by e2e/win32.spec.ts (verifies the primary work area shrinks by the strip's height and the strip docks flush to the granted rect, and restores on disable — via the OS's own work-area bookkeeping, not a real maximised Chrome window); manual check still required |
| W18 | Start on login enabled, sign out and in | — | Strip appears without the planner; no focus taken from the desktop | |
| W19 | Installer | Run `TimeBound Setup x.y.z.exe` | SmartScreen warning (unsigned; expected until signing); installs per-user; launches; uninstall keeps `%APPDATA%\TimeBound` | |

## macOS — parity (spec Part 5)

Run on macOS 14 or newer, Apple silicon and Intel if available.

| # | Check | Expected | Result |
|---|---|---|---|
| M1 | Launch the DMG build | Gatekeeper "unidentified developer" until notarised (expected); right-click Open works | |
| M2 | Strip docked bottom | Sits above the Dock; Dock at left/right shifts the work area and the strip re-docks | |
| M3 | Strip docked top | Sits below the menu bar | |
| M4 | Full-screen Safari (green button) | Strip stays visible over the full-screen Space | |
| M5 | Switch Spaces with a three-finger swipe | Strip follows to every Space | |
| M6 | Click the strip while typing in Notes | Notes keeps focus; caret keeps blinking | |
| M7 | Menu bar mode on | Strip hidden; menu bar item shows the current task title (≤ 28 chars) and timer; clicking opens the panel popover | |
| M8 | Capture hotkey ⌃⌥Space from any app | Palette appears and takes focus; Enter adds; focus returns to the previous app | |
| M9 | Notifications | First timer expiry prompts for permission; later ones show as banners | |
| M10 | Login item enabled | Appears in System Settings → General → Login Items; app starts at login with the strip only | |
| M11 | Theme mode "system" | Follows Appearance changes live | |
| M12 | Traffic lights in the planner | Native buttons visible, nothing overlaps the 78 px gap | |
| M13 | Click-through on | Clicks pass through; hovering the dot re-enables interaction | |
| M14 | Data location | `~/Library/Application Support/TimeBound/data.json` with `backups/` | |
| M15 | After quick capture, focus returns to the previous app | Known gap in v1: user may need to click back; revisit in Slice 6 | |

## Every platform

| # | Check | Expected | Result |
|---|---|---|---|
| A1 | Fresh install, no data | Onboarding palette after the strip; first task on screen in under 30 s | |
| A2 | Upgrade from 1.0 (`state.json` present) | 26 tasks imported, all done; `legacy-state.json` copied; original untouched | |
| A3 | Corrupt `data.json` by hand | App starts from the newest backup; banner says so; corrupt file kept | |
| A4 | 500 tasks | Planner lists scroll smoothly; strip unchanged; no console errors | |
| A5 | Ten-minute soak (`scripts/soak.mjs`) | Zero console errors; RSS recorded | |
| A6 | Reduced motion on | No slides or pulses; completion shows as a colour change | |
| A7 | Screen reader (Narrator / VoiceOver) | Planner fully navigable; strip skipped; hotkey results announced | |
| A8 | Export JSON and Markdown, import both back | Counts match; hierarchy preserved | |

## Money and security questions still open for the owner

- Windows code signing certificate (Azure Trusted Signing or an EV/OV cert). Until then SmartScreen warns on every install.
- Apple Developer account for signing and notarising the DMG.
- Whether to enable the CI workflow file (GitHub Actions minutes on a private repo are metered).
