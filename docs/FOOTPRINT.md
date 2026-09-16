# Strip footprint — docs/FOOTPRINT.md

Measured on this machine: Windows 11, primary display 1366x768 DIP, work area 1366x720, scale factor 1.

Three numbers per row: the OS **window** bounds (>= 39 px tall on Windows — a
transparent-frameless-window minimum, per StripWindow's `reanchorAndClip` comment in
src/main/windows/strip.ts), the **clipped content shape** applied via `setShape`
(`tb.strip.lastShape`, the real visible/interactive rect — ~32 px at text size M), and
the **renderer's own `.strip`/`.pill` element** bounding rect (should match the shape
within a pixel).

| configuration | window WxH | content shape WxH | renderer element WxH |
| --- | --- | --- | --- |
| bottom / S | 420x39 | 420x32 | 420.0x32.0 |
| bottom / M | 420x39 | 420x32 | 420.0x32.0 |
| bottom / L | 420x39 | 420x32 | 420.0x32.0 |
| bottom / collapsed pill | 175x39 | 175x24 | 174.8x24.0 |
| top / S | 420x39 | 420x32 | 420.0x32.0 |
| top / M | 420x39 | 420x32 | 420.0x32.0 |
| top / L | 420x39 | 420x32 | 420.0x32.0 |
| top / collapsed pill | 175x39 | 175x24 | 174.8x24.0 |

Content height range across S/M/L text sizes: 32-32 px.
Collapsed pill height: 24 px.

## Screen footprint at common resolutions

Using the largest measured content height (32 px, text size L) and the
default strip width (420 px) at 100% scale. The window's DIP size does not
change with the OS's display-scaling setting — at 125%/150% scale the strip still
occupies the same *fraction* of the work area (Electron sizes everything in DIP), but
the physical-pixel numbers below assume 100% scale; at 125%/150% each DIP maps to more
physical pixels, so treat these as the 100%-scale case and the DIP fraction as the
scale-independent number.

| target resolution (100% scale) | % of screen area | % of screen height |
| --- | --- | --- |
| 1366x768 (this machine) | 1.281% | 4.167% |
| 1920x1080 | 0.648% | 2.963% |
| 2560x1440 | 0.365% | 2.222% |

## Screenshots

Per-theme strip screenshots (docs/screenshots/footprint-*.png) are captured with
Playwright's `page.screenshot()` directly on the strip window — this is the real
strip content. A desktop-level capture (e.g. PowerShell's `CopyFromScreen`) was NOT
used for anything in this task: in this environment it only returns the wallpaper, not
real window contents, so it would be misleading to include.
