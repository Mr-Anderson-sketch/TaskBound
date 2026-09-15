// renderer/lib/useStore — the renderer's only connection to the main-process Store.
// `useSnapshot` fetches once and subscribes to `store:changed`; `dispatch` is a plain
// helper (not a hook — it needs no component state) that fills in `now`. See
// CLAUDE.md: "The store lives in the main process; renderers are views."
import { useEffect, useRef, useState } from 'react';
import type { Action } from '../../core/types';
import type { Snapshot } from '../../shared/ipc';

// `Omit<Action, 'now'>` applied per-union-member (not once over the whole union) so the
// result is still a discriminated union callers can narrow by `type`.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type ActionInput = DistributiveOmit<Action, 'now'>;

/** Fetches the current snapshot once (`store:get`) and subscribes to `store:changed`
 * for the rest of the window's life. Ignores any snapshot whose `rev` is lower than
 * the last one seen — a `store:get` response racing a `store:changed` push (both can
 * be in flight after mount) must never let a stale snapshot win. Returns `undefined`
 * until the first snapshot arrives; every route's `*App.tsx` renders nothing until then. */
export function useSnapshot(): Snapshot | undefined {
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined);
  const lastRev = useRef(-1);

  useEffect(() => {
    let disposed = false;
    const apply = (s: Snapshot): void => {
      if (s.rev < lastRev.current) return;
      lastRev.current = s.rev;
      if (!disposed) setSnapshot(s);
    };

    window.tb.invoke('store:get').then(apply).catch(() => {});
    const off = window.tb.on('store:changed', apply);

    return () => {
      disposed = true;
      off();
    };
  }, []);

  return snapshot;
}

/** Dispatches an action, filling in `now: Date.now()`. Ids for new tasks are generated
 * by the caller with `crypto.randomUUID()` — acceptable because main validates every
 * payload and the reducer is pure (see the brief's Part B). */
export function dispatch(action: ActionInput): void {
  void window.tb.invoke('store:dispatch', { ...action, now: Date.now() } as Action);
}
