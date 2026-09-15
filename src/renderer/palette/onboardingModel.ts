// renderer/palette/onboardingModel — pure helpers for the onboarding sheet (Task 5.4).
// Kept separate from Onboarding.tsx so the "how many tasks did we import" rule is
// unit-tested without any DOM/React involved.
import type { Data } from '../../core/types';

/**
 * Card 1's "existing data" branch shows "Imported N tasks from your previous
 * TimeBound" instead of the capture prompt whenever this run's data came from a
 * legacy `state.json` import (`meta.legacyImportedAt` set — see core/migrate.ts).
 * N counts every task whose `createdAt` is at or before the import instant: in
 * practice that's every migrated task (migrate.ts always derives `createdAt` from
 * the legacy record's own timestamp, which precedes `now`), but a task added by the
 * user in the brief window between migration and this onboarding card rendering
 * would have a LATER `createdAt` and must not inflate the count.
 */
export function importedTaskCount(data: Data): number {
  const importedAt = data.meta.legacyImportedAt;
  if (importedAt === undefined) return 0;
  return data.tasks.filter((t) => t.createdAt <= importedAt).length;
}

/** Whether this run's data came from a legacy import (drives card 1's branch). */
export function hasLegacyImport(data: Data): boolean {
  return data.meta.legacyImportedAt !== undefined;
}
