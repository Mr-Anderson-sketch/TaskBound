# Frontend Changes Summary - Electron to Tauri

## Files That Need Changes

### 1. `/src/shared/ipc.ts`
**Status:** DELETE or make empty
**Reason:** Tauri doesn't need a typed IPC interface like Electron. Commands are invoked directly with `invoke()`.

### 2. `/src/renderer/types.d.ts`
**Change:** Remove `window.electronApi` declaration
**Before:**
```typescript
interface Window {
  electronApi: ElectronApi;
}
```
**After:**
```typescript
// Remove the entire Window interface extension
```

### 3. `/src/renderer/store/state.ts`
**Changes Needed:**

**Replace imports:**
```typescript
// Before
import type { ElectronApi } from '../../shared/ipc';

// After
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
```

**Replace loadState:**
```typescript
// Before
const loadedState = await window.electronApi.loadState();

// After
const loadedState = await invoke<AppState>('load_state');
```

**Replace saveState:**
```typescript
// Before
await window.electronApi.saveState(state);

// After
await invoke('save_state', { state });
```

**Replace timer tick listener:**
```typescript
// Before
const unsubscribe = window.electronApi.onTimerTick?.((timestamp) => {
  dispatch({ type: 'tick' });
});

// After
const unlisten = await listen('timer-tick', () => {
  dispatch({ type: 'tick' });
});
```

### 4. `/src/renderer/App.tsx`
**Changes Needed:**

**Replace imports:**
```typescript
// Add at top
import { appWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/tauri';
```

**Replace Focus Mode functions:**
```typescript
// Before
const handleFocusMode = () => {
  window.electronApi.enableFocusMode?.();
};

// After
const handleFocusMode = async () => {
  await invoke('enable_focus_mode');
};
```

**Replace Always On Top:**
```typescript
// Before
window.electronApi.setAlwaysOnTop(enabled);

// After
await invoke('set_always_on_top', { enabled });
```

### 5. `/src/renderer/components/TitleBar.tsx`
**Changes Needed:**

**Replace imports:**
```typescript
// Add at top
import { appWindow } from '@tauri-apps/api/window';
```

**Replace window controls:**
```typescript
// Before
const handleMinimize = () => window.electronApi.minimizeWindow?.();
const handleMaximize = () => window.electronApi.toggleMaximizeWindow?.();
const handleClose = () => window.electronApi.closeWindow?.();

// After
const handleMinimize = () => appWindow.minimize();
const handleMaximize = () => appWindow.toggleMaximize();
const handleClose = () => appWindow.close();
```

**Add drag region to draggable area:**
```tsx
// Add data-tauri-drag-region attribute
<div data-tauri-drag-region className="title-bar-drag-area">
  TimeBound
</div>
```

### 6. `/src/renderer/components/Popup.tsx`
**Changes (if needed):**

If "Close App" button exists:
```typescript
// Before
window.electronApi.quitApp();

// After
import { exit } from '@tauri-apps/api/process';
await exit(0);
```

## Summary of Tauri API Replacements

| Electron IPC | Tauri Equivalent |
|--------------|------------------|
| `window.electronApi.loadState()` | `invoke<AppState>('load_state')` |
| `window.electronApi.saveState(state)` | `invoke('save_state', { state })` |
| `window.electronApi.minimizeWindow()` | `appWindow.minimize()` |
| `window.electronApi.toggleMaximizeWindow()` | `appWindow.toggleMaximize()` |
| `window.electronApi.closeWindow()` | `appWindow.close()` |
| `window.electronApi.setAlwaysOnTop(flag)` | `invoke('set_always_on_top', { enabled: flag })` |
| `window.electronApi.onTimerTick(callback)` | `listen('timer-tick', callback)` |
| `window.electronApi.enableFocusMode()` | `invoke('enable_focus_mode')` |
| `window.electronApi.quitApp()` | `exit(0)` from '@tauri-apps/api/process' |

## Rust Backend Commands Needed

These commands must be implemented in `/src-tauri/src/main.rs`:

1. `load_state` - Load app state from disk
2. `save_state` - Save app state to disk
3. `set_always_on_top` - Toggle window always-on-top
4. `enable_focus_mode` - Enable focus mode (resize + position)
5. `disable_focus_mode` - Disable focus mode
6. Timer tick emission (1-second interval)

## Next Steps

1. Update all frontend files listed above
2. Implement Rust backend commands
3. Test that app launches and UI works
4. Verify state persistence
5. Test all window controls

