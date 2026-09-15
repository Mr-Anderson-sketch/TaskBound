// renderer/lib/useDisplayTime — derives the strip/panel's display time locally from a
// task's `TaskTimer`. CLAUDE.md: "The store never ticks... renderers derive display
// time locally." Ticks with a 1 s interval ONLY while `runningSince` is set.
import { useEffect, useState } from 'react';
import type { TaskTimer } from '../../core/types';
import { elapsedSeconds, remainingSeconds } from '../../core/timer';

export interface DisplayTime {
  seconds: number;
  mode: 'remaining' | 'elapsed' | 'none';
  overtime: boolean;
}

// Task 3.1: derives from core/timer's elapsedSeconds/remainingSeconds so the strip
// and main agree on the math — this hook only supplies `now` and re-renders it.
function compute(timer: TaskTimer | undefined, now: number): DisplayTime {
  if (!timer) return { seconds: 0, mode: 'none', overtime: false };

  const remaining = remainingSeconds(timer, now);
  if (remaining !== undefined) {
    return { seconds: remaining, mode: 'remaining', overtime: remaining < 0 };
  }
  return { seconds: elapsedSeconds(timer, now), mode: 'elapsed', overtime: false };
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
