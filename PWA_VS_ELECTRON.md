# TimeBound: PWA vs Electron Comparison

This document outlines the differences between the PWA (Progressive Web App) and Electron versions of TimeBound.

## Directory Structure

- **Electron version**: `/timebound/src/` - Full desktop application with native window controls
- **PWA version**: `/timebound/pwa/` - Web-based version optimized for browsers

## Feature Comparison

### ✅ Features Available in Both Versions

- ✓ Task management (create, edit, complete, reorder)
- ✓ Time tracking and countdown timers
- ✓ Focus Spotlight overlay
- ✓ Task scoring system
- ✓ Statistics tracking (completed tasks, today's count)
- ✓ Add Time functionality
- ✓ Drag-and-drop task reordering
- ✓ Responsive UI with TimeBound theme
- ✓ Auto-save functionality
- ✓ Task history tracking

### 🖥️ Electron-Only Features

- ✗ **Custom Title Bar** - Window controls (minimize, maximize, close)
- ✗ **Always-on-Top (Pin)** - Keep window above all other windows
- ✗ **Focus Mode** - Automatically resize window to 340x240px and move to top-right corner
- ✗ **Window Management** - Full control over window size, position, and behavior
- ✗ **Close App Button** - In reminder popup
- ✗ **Native OS Integration** - System tray, notifications, etc.

### 🌐 PWA-Only Features

- ✓ **Offline Support** - Service worker caching for offline usage
- ✓ **Installable** - Can be installed as a standalone app on desktop/mobile
- ✓ **Cross-Platform** - Works on any device with a modern browser
- ✓ **No Installation Required** - Can be used directly in browser
- ✓ **Automatic Updates** - No manual download needed

## Technical Differences

### Data Storage

| Aspect | Electron | PWA |
|--------|----------|-----|
| **Storage Method** | File system (JSON files) | localStorage API |
| **Location** | User data directory | Browser storage |
| **Persistence** | Permanent (survives app uninstall) | Per-browser (cleared if browser data cleared) |
| **Size Limit** | Unlimited | ~5-10MB (browser dependent) |

### Timer Implementation

| Aspect | Electron | PWA |
|--------|----------|-----|
| **Timer Source** | IPC from main process | React interval hook |
| **Accuracy** | High (uses precision timestamps) | High (same precision timestamps) |
| **Background** | Continues when app minimized | Paused when tab inactive (browser throttling) |

### Build & Deployment

| Aspect | Electron | PWA |
|--------|----------|-----|
| **Build Command** | `npm run build && electron-builder` | `npm run build` |
| **Output** | `.exe` installer (Windows) | Static HTML/JS/CSS files |
| **Distribution** | Download and install executable | Host on web server |
| **Update Process** | Manual download/install | Automatic (service worker) |

## Usage Recommendations

### Use **Electron Version** If You Need:
- Always-on-top window pinning for distraction-free focus
- Precise window control and positioning
- Guaranteed timer accuracy even when app is minimized
- Native desktop app experience
- Offline usage without browser requirements

### Use **PWA Version** If You Need:
- Cross-device synchronization (by using same browser account)
- No installation required
- Access from any device with a browser
- Mobile device support
- Automatic updates

## File Structure Changes

### Files Modified for PWA:

1. **`pwa/src/App.tsx`**
   - Removed `TitleBar` component import and usage
   - Removed `electronApi` references
   - Removed `handleFocusMode` function
   - Removed `handleToggleAlwaysOnTop` function
   - Removed `isWindowMaximized` state
   - Simplified UI to remove Electron-specific controls

2. **`pwa/src/components/Popup.tsx`**
   - Removed `onCloseApp` prop and "Close App" button
   - PWA users can close browser tab directly

3. **`pwa/src/store/state.ts`**
   - Removed `ElectronApi` import
   - Replaced IPC-based state loading with `localStorage.getItem()`
   - Replaced IPC-based state saving with `localStorage.setItem()`
   - Removed `setAlwaysOnTop` action and function
   - Removed Electron timer tick subscription

4. **`pwa/src/index.html`**
   - Added PWA manifest link
   - Added service worker registration script
   - Added PWA meta tags

## Development

### Running Electron Version:
```bash
cd timebound
npm run dev
```

### Running PWA Version:
```bash
cd pwa
npm install
npm run dev
```

### Building for Production:

**Electron (creates .exe):**
```bash
cd timebound
npm run package
```

**PWA (creates static files):**
```bash
cd pwa
npm run build
# Output in pwa/dist/ - deploy to any static hosting
```

## Shared Codebase

The PWA and Electron versions share:
- Core business logic (`shared/types.ts`, `shared/stateHelpers.ts`)
- UI components (with minor modifications)
- Styling (Tailwind CSS configuration)
- Timer logic
- Task management reducer

This allows feature updates to be easily applied to both versions.
