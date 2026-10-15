import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/api/process';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/api/notification';
import { register, unregister } from '@tauri-apps/api/globalShortcut';
import type { AppState, Point, ThemeName } from '../shared/types';

// Everything that touches the OS goes through here. Outside Tauri (plain browser, used for
// UI testing) each call falls back to a local stand-in so the whole UI stays usable.
export const isTauri = typeof window !== 'undefined' && '__TAURI_IPC__' in window;

export const platform: 'mac' | 'windows' | 'other' = /Mac/i.test(navigator.userAgent)
  ? 'mac'
  : /Windows/i.test(navigator.userAgent)
  ? 'windows'
  : 'other';

export interface FocusLayout {
  width: number;
  height: number;
  x: number;
  y: number;
  notch: { width: number; height: number } | null;
  menuBarHeight: number;
  placement: 'menubar' | 'floating';
  expanded?: boolean;
}

export type TrayAction = 'show' | 'focus' | 'pause' | 'complete';

const PREVIEW_KEY = 'timebound-preview-state';

const previewLayout = (theme: ThemeName, expanded = false, extra = 0): FocusLayout => {
  const base = theme === 'dark' ? { width: 450, height: 37 } : { width: 300, height: 52 };
  return {
    ...base,
    height: base.height + (expanded ? extra : 0),
    x: 0,
    y: 0,
    notch: theme === 'dark' ? { width: 190, height: 37 } : null,
    menuBarHeight: 37,
    placement: theme === 'dark' ? 'menubar' : 'floating'
  };
};

let previewTheme: ThemeName = 'dark';

export const native = {
  async loadState(): Promise<Partial<AppState> | null> {
    if (isTauri) {
      return invoke<AppState>('load_state');
    }
    try {
      const raw = localStorage.getItem(PREVIEW_KEY);
      return raw ? (JSON.parse(raw) as AppState) : null;
    } catch {
      return null;
    }
  },

  async saveState(state: AppState): Promise<AppState> {
    if (isTauri) {
      return invoke<AppState>('save_state', { state });
    }
    const saved = { ...state, meta: { ...state.meta, lastSavedAt: new Date().toISOString() } };
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(saved));
    } catch {
      // Preview storage is best-effort.
    }
    return saved;
  },

  async setAlwaysOnTop(enabled: boolean): Promise<void> {
    if (isTauri) {
      await invoke('set_always_on_top', { enabled });
    }
  },

  async enterFocusMode(theme: ThemeName, position?: Point): Promise<FocusLayout> {
    previewTheme = theme;
    if (isTauri) {
      return invoke<FocusLayout>('enter_focus_mode', { theme, position: position ?? null });
    }
    return previewLayout(theme);
  },

  async setFocusExpanded(expanded: boolean, extraHeight: number): Promise<FocusLayout> {
    if (isTauri) {
      return invoke<FocusLayout>('set_focus_expanded', { expanded, extraHeight });
    }
    return previewLayout(previewTheme, expanded, extraHeight);
  },

  // Collapsed top-left of the focus widget, even if it is currently expanded upward.
  async getFocusPosition(): Promise<Point | null> {
    if (isTauri) {
      return invoke<Point | null>('get_focus_position');
    }
    return null;
  },

  async exitFocusMode(alwaysOnTop: boolean): Promise<void> {
    if (isTauri) {
      await invoke('exit_focus_mode', { alwaysOnTop });
    }
  },

  async setThemeEffects(theme: ThemeName, mode: 'main' | 'focus', radius: number): Promise<void> {
    if (isTauri) {
      await invoke('set_theme_effects', { theme, mode, radius });
    }
  },

  async updateTray(title: string | null, tooltip: string, hasTask: boolean, running: boolean): Promise<void> {
    if (isTauri) {
      await invoke('update_tray', { title, tooltip, hasTask, running });
    }
  },

  async onTimerTick(handler: (timestamp: number) => void): Promise<() => void> {
    if (isTauri) {
      return listen<number>('timer-tick', (event) => handler(event.payload));
    }
    const id = window.setInterval(() => handler(Date.now()), 1000);
    return () => window.clearInterval(id);
  },

  async onTrayAction(handler: (action: TrayAction) => void): Promise<() => void> {
    if (isTauri) {
      return listen<TrayAction>('tray-action', (event) => handler(event.payload));
    }
    return () => undefined;
  },

  async notify(title: string, body: string): Promise<void> {
    if (isTauri) {
      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === 'granted';
      }
      if (granted) {
        sendNotification({ title, body });
      }
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  },

  async registerHotkey(accelerator: string, handler: () => void): Promise<() => void> {
    if (!isTauri) {
      return () => undefined;
    }
    try {
      await unregister(accelerator).catch(() => undefined);
      await register(accelerator, handler);
      return () => {
        unregister(accelerator).catch(() => undefined);
      };
    } catch (error) {
      console.error('Global shortcut unavailable', error);
      return () => undefined;
    }
  },

  async onMoved(handler: () => void): Promise<() => void> {
    if (isTauri) {
      return appWindow.onMoved(() => handler());
    }
    return () => undefined;
  },

  async showWindow(): Promise<void> {
    if (isTauri) {
      await appWindow.show();
      await appWindow.unminimize();
      await appWindow.setFocus();
    }
  },

  async minimize(): Promise<void> {
    if (isTauri) {
      await appWindow.minimize();
    }
  },

  async quit(): Promise<void> {
    if (isTauri) {
      await exit(0);
    }
  }
};
