// core/defaults — the single source of truth for out-of-box settings and empty data.
import type { Data, Settings } from './types';

export const INBOX_ID = 'inbox';

export function defaultSettings(): Settings {
  return {
    theme: { name: 'ledger', mode: 'system' },
    textSize: 'M',
    strip: {
      enabled: true,
      edge: 'bottom',
      width: 420,
      collapsed: false,
      autoHide: false,
      clickThrough: false,
      opacity: 1,
      reserveSpace: false,
      hideOverFullscreen: true,
      hideFromCapture: false,
      menuBarMode: false,
      positions: {}
    },
    hotkeys: {
      capture: 'Control+Alt+Space',
      toggleStrip: 'Control+Alt+Shift+Space',
      completeAdvance: 'Control+Alt+Enter',
      toggleTimer: 'Control+Alt+Shift+Enter',
      undo: 'Control+Alt+Backspace'
    },
    timer: {
      pomodoro: false,
      workMinutes: 25,
      breakMinutes: 5,
      idlePauseMinutes: 5,
      awayThresholdMinutes: 5,
      defaultPlannedMinutes: 25
    },
    score: { enabled: false, value: 0 },
    startOnLogin: false,
    notifications: true,
    reducedMotion: 'system',
    onboardingDone: false
  };
}

export function createEmptyData(now: number, appVersion: string): Data {
  return {
    schemaVersion: 2,
    tasks: [],
    lists: [{ id: INBOX_ID, name: 'Inbox', order: 1000, createdAt: now }],
    days: [],
    settings: defaultSettings(),
    meta: { createdAt: now, lastSavedAt: now, appVersion }
  };
}
