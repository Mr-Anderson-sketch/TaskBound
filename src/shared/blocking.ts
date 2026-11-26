import type { BlockedApp, BlockingPrefs, BlockWindow } from './types';

// The Rust blocker (src-tauri/src/blocker.rs) re-normalizes and does the matching; this
// module owns the defaults and keeps what the settings UI stores tidy.

export const DEFAULT_SITES: readonly string[] = [
  'x.com',
  'twitter.com',
  'youtube.com',
  'youtu.be',
  'instagram.com',
  'tiktok.com',
  'facebook.com'
];

export const defaultBlocking = (): BlockingPrefs => ({
  duringTasks: true,
  sites: [...DEFAULT_SITES],
  apps: [],
  windows: []
});

/**
 * Turns what a person types or pastes into a block-list entry: lowercased host, no scheme,
 * no "www.", no port, query or fragment, optional path prefix without a trailing slash.
 * "https://www.YouTube.com/shorts/abc?x=1" -> "youtube.com/shorts/abc". Returns null for
 * anything that is not a plausible host.
 */
export const normalizeSite = (input: string): string | null => {
  let text = input.trim().toLowerCase();
  if (!text) {
    return null;
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  text = text.replace(/[?#].*$/, '');
  const slash = text.indexOf('/');
  let host = slash === -1 ? text : text.slice(0, slash);
  let path = slash === -1 ? '' : text.slice(slash);
  host = host.replace(/^.*@/, '').replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.split('.').some((label) => !label || label.startsWith('-') || label.endsWith('-'))) {
    return null;
  }
  path = path.replace(/\/+$/, '');
  return `${host}${path}`;
};

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isClock = (value: string): boolean => CLOCK.test(value);

export const clockMinutes = (value: string): number => {
  const match = value.match(CLOCK);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
};

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Monday-first display order.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const formatClock = (value: string): string => {
  const minutes = clockMinutes(value);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const describeDays = (days: number[]): string => {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  return WEEK_ORDER.filter((d) => set.has(d)).map((d) => DAY_SHORT[d]).join(', ');
};

/** "Weekdays · 9:00 AM – 12:00 PM", with "(next day)" when the window runs past midnight. */
export const describeWindow = (window: BlockWindow): string => {
  const overnight = clockMinutes(window.end) <= clockMinutes(window.start);
  return `${describeDays(window.days)} · ${formatClock(window.start)} – ${formatClock(window.end)}${overnight ? ' (next day)' : ''}`;
};

const isBlockWindow = (raw: unknown): raw is BlockWindow => {
  const w = raw as Partial<BlockWindow> | null;
  return (
    !!w &&
    typeof w.id === 'string' &&
    Array.isArray(w.days) &&
    typeof w.start === 'string' &&
    typeof w.end === 'string' &&
    isClock(w.start) &&
    isClock(w.end)
  );
};

const isBlockedApp = (raw: unknown): raw is BlockedApp => {
  const a = raw as Partial<BlockedApp> | null;
  return !!a && typeof a.bundleId === 'string' && a.bundleId.length > 0 && typeof a.name === 'string';
};

/** Tolerant reader for whatever is on disk: missing means defaults, bad entries are dropped. */
export const normalizeBlocking = (raw: unknown): BlockingPrefs => {
  if (!raw || typeof raw !== 'object') {
    return defaultBlocking();
  }
  const b = raw as Partial<Record<keyof BlockingPrefs, unknown>>;
  const sites = Array.isArray(b.sites)
    ? [...new Set(b.sites.filter((s): s is string => typeof s === 'string').map(normalizeSite).filter((s): s is string => !!s))]
    : [...DEFAULT_SITES];
  const apps = Array.isArray(b.apps) ? b.apps.filter(isBlockedApp) : [];
  const windows = Array.isArray(b.windows)
    ? b.windows.filter(isBlockWindow).map((w) => ({
        ...w,
        days: [...new Set(w.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
        enabled: w.enabled !== false
      }))
    : [];
  return {
    duringTasks: typeof b.duringTasks === 'boolean' ? b.duringTasks : true,
    sites,
    apps,
    windows
  };
};
