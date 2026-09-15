// renderer/palette/PlanToday — the "Plan today" sheet (DESIGN.md "Palette (keyboard
// sheets)"; row/list markup ported from docs/design/preview.html's `.pl`/`.list`).
// Candidates come from the pure `planCandidates` selector (core/select.ts); this
// component only owns UI state (which rows are checked, which is keyboard-focused).
import { useEffect, useMemo, useState } from 'react';
import { planCandidates } from '../../core/select';
import type { PlanCandidate } from '../../core/select';
import type { Id } from '../../core/types';
import type { Snapshot } from '../../shared/ipc';
import { dispatch } from '../lib/useStore';
import { keyGlyphs } from '../../shared/platform';

interface PlanTodayProps {
  snapshot: Snapshot;
}

const REASON_LABEL: Record<PlanCandidate['reason'], string> = {
  'rolled-over': 'rolled over',
  due: 'due today',
  overdue: 'overdue',
  inbox: 'inbox'
};

/** "about 1h 30m planned" / "about 45m planned" / '' (0 seconds: the footer omits the
 * time part entirely, per the addendum). */
function formatPlanned(seconds: number): string {
  if (seconds <= 0) return '';
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const label = h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`;
  return `about ${label} planned`;
}

export function PlanToday({ snapshot }: PlanTodayProps) {
  // Captured once per mount (PaletteApp remounts this on every `palette:mode`, even a
  // re-show of 'plan'), so "today" stays stable for the life of one planning session.
  const [now] = useState(() => Date.now());
  const [focused, setFocused] = useState(0);

  const candidates = useMemo(() => planCandidates(snapshot.data, now), [snapshot.data, now]);

  const [selected, setSelected] = useState<Set<Id>>(
    () => new Set(candidates.filter((c) => c.reason !== 'inbox').map((c) => c.task.id))
  );

  const confirm = (): void => {
    const toEnable = candidates.filter((c) => selected.has(c.task.id)).map((c) => c.task.id);
    // Only ROLLED-OVER tasks are already `today: true` before this sheet runs — an
    // unchecked rolled-over task needs an explicit `today: false`. Unchecked due/
    // overdue/inbox candidates were never `today: true` to begin with, so leaving
    // them alone is correct (addendum ruling 7).
    const toDisable = candidates.filter((c) => c.reason === 'rolled-over' && !selected.has(c.task.id)).map((c) => c.task.id);
    if (toEnable.length > 0) dispatch({ type: 'task/setToday', ids: toEnable, today: true });
    if (toDisable.length > 0) dispatch({ type: 'task/setToday', ids: toDisable, today: false });
    void window.tb.invoke('palette:hide');
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void window.tb.invoke('palette:hide');
        return;
      }
      if (candidates.length === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setFocused((f) => Math.min(candidates.length - 1, f + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setFocused((f) => Math.max(0, f - 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        const id = candidates[focused]?.task.id;
        if (id === undefined) return;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- confirm() closes over selected/candidates each render
  }, [candidates, focused, selected]);

  if (candidates.length === 0) {
    const glyphs = keyGlyphs(snapshot.data.settings.hotkeys.capture, snapshot.platform).join(snapshot.platform === 'darwin' ? '' : '+');
    return (
      <>
        <div className="title">Plan today</div>
        <div className="empty">
          <div className="e1">Nothing to plan.</div>
          <p>
            Add a task with <kbd>{glyphs}</kbd>.
          </p>
        </div>
      </>
    );
  }

  const rolledOverCount = candidates.filter((c) => c.reason === 'rolled-over').length;
  const dueCount = candidates.filter((c) => c.reason === 'due' || c.reason === 'overdue').length;
  const summaryParts: string[] = [];
  if (rolledOverCount > 0) summaryParts.push(`${rolledOverCount} left from yesterday`);
  if (dueCount > 0) summaryParts.push(`${dueCount} due today`);
  const summary = summaryParts.length > 0 ? `${summaryParts.join(', ')}. ` : '';

  const selectedTasks = candidates.filter((c) => selected.has(c.task.id)).map((c) => c.task);
  const totalPlanned = selectedTasks.reduce((sum, t) => sum + (t.timer?.plannedSeconds ?? 0), 0);
  const plannedLabel = formatPlanned(totalPlanned);
  const footerText = `${selectedTasks.length} selected${plannedLabel ? ` · ${plannedLabel}` : ''}`;

  return (
    <>
      <div className="title">Plan today</div>
      <div className="summary">{summary}Space toggles, Enter confirms.</div>
      <div className="list">
        {candidates.map((c, i) => (
          <div
            key={c.task.id}
            className={`pl${i === focused ? ' sel' : ''}`}
            onClick={() => {
              setFocused(i);
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(c.task.id)) next.delete(c.task.id);
                else next.add(c.task.id);
                return next;
              });
            }}
          >
            <span className={`cb${selected.has(c.task.id) ? ' on' : ''}`} />
            <span className="t">{c.task.title}</span>
            <span className="why">{REASON_LABEL[c.reason]}</span>
          </div>
        ))}
      </div>
      <div className="foot">
        <span>{footerText}</span>
        <button type="button" className="btn" onClick={confirm}>
          Start the day
        </button>
      </div>
    </>
  );
}
