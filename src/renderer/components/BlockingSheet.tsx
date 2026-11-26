import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { BlockingPrefs, BlockWindow } from '../../shared/types';
import { DEFAULT_SITES, WEEK_ORDER, clockMinutes, describeWindow, formatClock, normalizeSite } from '../../shared/blocking';
import { isTauri, native, type BlockStatus, type BrowserAccess, type RunningApp } from '../native';
import { Sheet } from './Sheets';
import { IconClose } from './Icons';

const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const describeStatus = (status: BlockStatus): string => {
  if (!status.active) {
    return 'Off right now.';
  }
  if (status.reason === 'task') {
    return `On while “${status.taskTitle ?? 'this task'}” runs.`;
  }
  if (status.windowUntil) {
    const until = new Date(status.windowUntil);
    const hhmm = `${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`;
    return `On until ${formatClock(hhmm)}.`;
  }
  return 'On.';
};

const ACCESS_TEXT: Record<BrowserAccess['access'], string> = {
  granted: 'Can close tabs',
  denied: 'Not allowed',
  needsConsent: 'Needs your OK',
  notRunning: 'Open it to check',
  unsupported: 'Can’t read tabs yet',
  error: 'Couldn’t check'
};

const newId = () => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

interface BlockingSheetProps {
  blocking: BlockingPrefs;
  status: BlockStatus;
  onChange: (next: BlockingPrefs) => void;
  onClose: () => void;
}

export function BlockingSheet({ blocking, status, onChange, onClose }: BlockingSheetProps) {
  const [siteInput, setSiteInput] = useState('');
  const [siteError, setSiteError] = useState<string | null>(null);
  const [apps, setApps] = useState<RunningApp[] | null>(null);
  const [access, setAccess] = useState<BrowserAccess[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState<BlockWindow | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const refreshAccess = useCallback(async (ask: boolean) => {
    try {
      setAccess(await native.checkBrowserAccess(ask));
    } catch (error) {
      console.error('Browser access check failed', error);
      setAccess([]);
    }
  }, []);

  useEffect(() => {
    refreshAccess(false);
  }, [refreshAccess]);

  const update = (patch: Partial<BlockingPrefs>) => onChange({ ...blocking, ...patch });

  const addSite = (event: FormEvent) => {
    event.preventDefault();
    const site = normalizeSite(siteInput);
    if (!site) {
      setSiteError('That doesn’t look like a website. Try “reddit.com”.');
      return;
    }
    if (blocking.sites.includes(site)) {
      setSiteError(`${site} is already on the list.`);
      return;
    }
    update({ sites: [...blocking.sites, site] });
    setSiteInput('');
    setSiteError(null);
  };

  const isDefaultList = blocking.sites.length === DEFAULT_SITES.length && DEFAULT_SITES.every((site) => blocking.sites.includes(site));

  const loadApps = async () => {
    try {
      setApps(await native.listRunningApps());
    } catch (error) {
      console.error('Listing apps failed', error);
      setApps([]);
    }
  };

  const addableApps = (apps ?? []).filter((app) => !blocking.apps.some((blocked) => blocked.bundleId === app.bundleId));

  const saveDraft = () => {
    if (!draft) {
      return;
    }
    if (draft.days.length === 0) {
      setDraftError('Pick at least one day.');
      return;
    }
    if (!draft.start || !draft.end) {
      setDraftError('Set a start and an end time.');
      return;
    }
    update({ windows: [...blocking.windows, { ...draft, days: [...draft.days].sort() }] });
    setDraft(null);
    setDraftError(null);
  };

  const toggleDraftDay = (day: number) =>
    setDraft((current) =>
      current ? { ...current, days: current.days.includes(day) ? current.days.filter((d) => d !== day) : [...current.days, day] } : current
    );

  const askForAccess = async () => {
    setAsking(true);
    await refreshAccess(true);
    setAsking(false);
  };

  return (
    <Sheet title="Block distractions" subtitle={`${describeStatus(status)} TimeBound closes matching tabs and hides blocked apps. Your browsers stay open.`} onClose={onClose}>
      <label className="toggle-row">
        <input type="checkbox" checked={blocking.duringTasks} onChange={(event) => update({ duringTasks: event.target.checked })} />
        <span>
          <b>While a task’s timer runs</b>
          <small>Paused tasks don’t block.</small>
        </span>
      </label>

      <section className="block-section" aria-label="Blocked sites">
        <div className="section-head">
          <span>Sites · {blocking.sites.length}</span>
          {!isDefaultList ? (
            <button type="button" className="link-btn" onClick={() => update({ sites: [...DEFAULT_SITES] })}>
              Restore defaults
            </button>
          ) : null}
        </div>
        {blocking.sites.length > 0 ? (
          <ul className="tags">
            {blocking.sites.map((site) => (
              <li key={site}>
                <span className="mono">{site}</span>
                <button type="button" aria-label={`Stop blocking ${site}`} onClick={() => update({ sites: blocking.sites.filter((s) => s !== site) })}>
                  <IconClose size={11} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">No sites blocked.</p>
        )}
        <form className="inline-add" onSubmit={addSite}>
          <input
            aria-label="Add a site to block"
            value={siteInput}
            placeholder="reddit.com or youtube.com/shorts"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setSiteInput(event.target.value);
              setSiteError(null);
            }}
          />
          <button type="submit" className="btn" disabled={!siteInput.trim()}>
            Add
          </button>
        </form>
        {siteError ? <p className="error">{siteError}</p> : null}
      </section>

      <section className="block-section" aria-label="Blocked apps">
        <div className="section-head">
          <span>Apps · {blocking.apps.length}</span>
        </div>
        {blocking.apps.length > 0 ? (
          <ul className="tags">
            {blocking.apps.map((app) => (
              <li key={app.bundleId}>
                <span>{app.name}</span>
                <button
                  type="button"
                  aria-label={`Stop blocking ${app.name}`}
                  onClick={() => update({ apps: blocking.apps.filter((a) => a.bundleId !== app.bundleId) })}
                >
                  <IconClose size={11} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">Blocked apps are hidden, not quit, so nothing you were doing in them is lost.</p>
        )}
        {apps === null ? (
          <button type="button" className="btn" onClick={loadApps} disabled={!isTauri}>
            Add a running app…
          </button>
        ) : addableApps.length > 0 ? (
          <select
            className="select"
            aria-label="Pick an app to block"
            value=""
            onChange={(event) => {
              const app = addableApps.find((candidate) => candidate.bundleId === event.target.value);
              if (app) {
                update({ apps: [...blocking.apps, app] });
              }
            }}
          >
            <option value="" disabled>
              Pick an app…
            </option>
            {addableApps.map((app) => (
              <option key={app.bundleId} value={app.bundleId}>
                {app.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="note">Open the app you want to block, then try again.</p>
        )}
      </section>

      <section className="block-section" aria-label="Scheduled blocks">
        <div className="section-head">
          <span>Scheduled blocks</span>
        </div>
        <p className="note">Block on a schedule, with or without a task running.</p>
        {blocking.windows.length > 0 ? (
          <ul className="windows">
            {blocking.windows.map((window) => (
              <li key={window.id} className={window.enabled ? undefined : 'off'}>
                <label>
                  <input
                    type="checkbox"
                    checked={window.enabled}
                    aria-label={`${window.enabled ? 'Turn off' : 'Turn on'} ${describeWindow(window)}`}
                    onChange={(event) =>
                      update({ windows: blocking.windows.map((w) => (w.id === window.id ? { ...w, enabled: event.target.checked } : w)) })
                    }
                  />
                  <span>{describeWindow(window)}</span>
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Delete ${describeWindow(window)}`}
                  onClick={() => update({ windows: blocking.windows.filter((w) => w.id !== window.id) })}
                >
                  <IconClose size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {draft ? (
          <div className="window-draft">
            <div className="days" role="group" aria-label="Days">
              {WEEK_ORDER.map((day) => (
                <button key={day} type="button" aria-pressed={draft.days.includes(day)} aria-label={DAY_NAME[day]} onClick={() => toggleDraftDay(day)}>
                  {DAY_LETTER[day]}
                </button>
              ))}
            </div>
            <div className="split">
              <label className="field">
                From
                <input type="time" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
              </label>
              <label className="field">
                To
                <input type="time" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
              </label>
            </div>
            {draft.start && draft.end && clockMinutes(draft.end) <= clockMinutes(draft.start) ? (
              <p className="note">Ends the next day.</p>
            ) : null}
            {draftError ? <p className="error">{draftError}</p> : null}
            <div className="row-actions">
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={saveDraft}>
                Add schedule
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setDraft({ id: newId(), days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00', enabled: true })}>
            Add a schedule…
          </button>
        )}
      </section>

      <section className="block-section" aria-label="Browsers">
        <div className="section-head">
          <span>Browsers</span>
          {isTauri ? (
            <button type="button" className="link-btn" onClick={() => refreshAccess(false)}>
              Check again
            </button>
          ) : null}
        </div>
        {!isTauri ? (
          <p className="note">Browser access shows in the desktop app.</p>
        ) : access === null ? (
          <p className="note">Checking…</p>
        ) : access.length === 0 ? (
          <p className="note">No supported browser found.</p>
        ) : (
          <ul className="access">
            {access.map((browser) => (
              <li key={browser.bundleId} data-access={browser.access}>
                <span className="name">{browser.name}</span>
                <span className="state">{ACCESS_TEXT[browser.access]}</span>
              </li>
            ))}
          </ul>
        )}
        {access?.some((b) => b.access === 'needsConsent') ? (
          <button type="button" className="btn primary" onClick={askForAccess} disabled={asking}>
            {asking ? 'Waiting for macOS…' : 'Allow TimeBound to close tabs'}
          </button>
        ) : null}
        {access?.some((b) => b.access === 'denied') ? (
          <>
            <p className="note">
              macOS remembers a “Don’t Allow”. Turn TimeBound on for each browser under Privacy &amp; Security → Automation.
            </p>
            <button type="button" className="btn" onClick={() => native.openAutomationSettings()}>
              Open System Settings
            </button>
          </>
        ) : null}
        {access?.some((b) => b.access === 'unsupported') ? (
          <p className="note">Firefox and Arc don’t let apps read their tabs yet. Add them under Apps to hide them while you focus.</p>
        ) : null}
      </section>

      <footer>
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </Sheet>
  );
}
