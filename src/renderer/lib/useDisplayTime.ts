// renderer/lib/useDisplayTime — derives the strip/panel's display time locally from a
// task's `TaskTimer`. CLAUDE.md: "The store never ticks... renderers derive display
// time locally." Ticks with a 1 s interval ONLY while `runningSince` is set.
import { useEffect, useState } from 'react';
import type { TaskTimer } from '../../core/types';

export interface DisplayTime {
  seconds: number;
  mode: 'remaining' | 'elapsed' | 'none';
  overtime: boolean;
}

function compute(timer: TaskTimer | undefined, now: number): DisplayTime {
  if (!timer) return { seconds: 0, mode: 'none', overtime: false };

  const running = timer.runningSince !== undefined;
  const liveElapsed = running ? Math.max(0, now - timer.runningSince!) / 1000 : 0;
  const totalElapsed = timer.spentSeconds + liveElapsed;

  if (timer.plannedSeconds !== undefined) {
    const remaining = timer.plannedSeconds - totalElapsed;
    return { seconds: remaining, mode: 'remaining', overtime: remaining < 0 };
  }
  return { seconds: totalElapsed, mode: 'elapsed', overtime: false };
}

export function useDisplayTime(timer?: TaskTimer): DisplayTime {
  const [now, setNow] = useState(() => Date.now());
  const runningSince = timer?.runningSince;

  useEffect(() => {
    if (runningSince === undefined) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [runningSince]);

  return compute(timer, now);
}
