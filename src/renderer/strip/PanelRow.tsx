// renderer/strip/PanelRow — one 28 px task row in the hover panel (DESIGN.md "Hover
// panel": "Five task rows, 28 px: 14 px radio, title, mono due/timer, hover-only
// actions (done · skip · snooze)").
import type { Task } from '../../core/types';
import { fmtClock } from '../lib/format';
import { IconButton } from '../ui/IconButton';

export interface PanelRowProps {
  task: Task;
  current: boolean;
  onMakeCurrent: (id: string) => void;
  onComplete: (id: string) => void;
  onSkip: (id: string) => void;
  onSnooze: (id: string) => void;
}

function dueOrTimer(task: Task): string {
  if (task.timer?.plannedSeconds !== undefined) {
    const remaining = task.timer.plannedSeconds - task.timer.spentSeconds;
    return fmtClock(remaining);
  }
  if (task.due?.time) return task.due.time;
  return '';
}

export function PanelRow({ task, current, onMakeCurrent, onComplete, onSkip, onSnooze }: PanelRowProps) {
  return (
    <div className={current ? 'prow cur' : 'prow'}>
      <button type="button" className="cb" aria-label={`Make "${task.title}" current`} onClick={() => onMakeCurrent(task.id)} />
      <button type="button" className="t" onClick={() => onMakeCurrent(task.id)}>
        {task.title}
      </button>
      <span className="due">{dueOrTimer(task)}</span>
      <span className="acts">
        <IconButton label="Complete" onClick={() => onComplete(task.id)}>
          ✓
        </IconButton>
        <IconButton label="Skip" onClick={() => onSkip(task.id)}>
          ↷
        </IconButton>
        <IconButton label="Snooze until tomorrow" onClick={() => onSnooze(task.id)}>
          zz
        </IconButton>
      </span>
    </div>
  );
}
