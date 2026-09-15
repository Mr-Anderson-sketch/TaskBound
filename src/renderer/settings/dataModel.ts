// renderer/settings/dataModel — pure helper behind the Settings "Data" section (Task
// 5.3): turns one `data:listBackups` path (`.../backups/data-YYYY-MM-DD.json`, see
// `backupPathFor` in src/main/persist.ts) into the epoch-ms LOCAL midnight it names, so
// the section can label it with `longDayLabel` (e.g. "Monday 14 September"). No DOM —
// unit-tested in the plain 'node' Vitest environment, same convention as
// settingsModel.ts. Deliberately splits the path on both `/` and `\` rather than using
// Node's `path` module, since this runs in the renderer against a path string that may
// have come from either a POSIX or a Windows main process.
import { parseYmd } from '../../core/dates';

const BACKUP_FILENAME_RE = /^data-(\d{4}-\d{2}-\d{2})\.json$/;
// Final-review fix 1: the copy main keeps of the current data right before a restore
// (`data.pre-restore-YYYYMMDD-HHmmss[-n].json`, see `snapshotBeforeRestore` in persist.ts).
const PRE_RESTORE_FILENAME_RE = /^data\.pre-restore-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?\.json$/;

function filenameOf(backupPath: string): string {
  const segments = backupPath.split(/[\\/]/);
  return segments[segments.length - 1] ?? '';
}

/** Epoch ms of local midnight on the date named by a daily backup's filename
 * (`data-YYYY-MM-DD.json`), or the exact local time a pre-restore snapshot was taken;
 * `undefined` for any other filename. */
export function backupDateMs(backupPath: string): number | undefined {
  const filename = filenameOf(backupPath);
  const match = BACKUP_FILENAME_RE.exec(filename);
  if (match) return parseYmd(match[1]).getTime();
  const pre = PRE_RESTORE_FILENAME_RE.exec(filename);
  if (!pre) return undefined;
  const [y, mo, d, h, mi, se] = pre.slice(1).map(Number);
  return new Date(y, mo - 1, d, h, mi, se).getTime();
}

/** Whether `backupPath` is a pre-restore snapshot rather than a daily backup. */
export function isPreRestoreBackup(backupPath: string): boolean {
  return PRE_RESTORE_FILENAME_RE.test(filenameOf(backupPath));
}
