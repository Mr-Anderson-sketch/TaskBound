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

/** Epoch ms of local midnight on the date named by `backupPath`'s filename, or
 * `undefined` if the filename doesn't match the `data-YYYY-MM-DD.json` backup shape. */
export function backupDateMs(backupPath: string): number | undefined {
  const segments = backupPath.split(/[\\/]/);
  const filename = segments[segments.length - 1] ?? '';
  const match = BACKUP_FILENAME_RE.exec(filename);
  if (!match) return undefined;
  return parseYmd(match[1]).getTime();
}
