// renderer/settings/sections/Data — Task 5.3 "Data" section: where the data folder is
// (with a picker via `data:chooseDir`), export/import, and the rolling daily-backups
// list with restore. All the real work already happens in main (`data:*` IPC, tested
// in e2e/data.spec.ts and src/main/persist.ts's own unit tests) — this section is a
// thin, stateful wrapper around those four calls plus the backups list, following the
// same row/confirm-inline patterns as Score.tsx and KeyRecorder.tsx.
import { useEffect, useState } from 'react';
import { longDayLabel } from '../../lib/dateLabels';
import { SettingRow } from '../SettingRow';
import { backupDateMs } from '../dataModel';

export interface DataSectionProps {
  dataDir?: string;
  /** Snapshot.dataLocationUnavailable — set once at boot when a redirected data folder
   * was missing or invalid and the app fell back to the default folder. */
  dataLocationUnavailable?: string;
}

// Backups rotate to 30 on disk (src/main/persist.ts MAX_BACKUPS); this just matches
// that cap defensively rather than trusting main to never over-return.
const MAX_SHOWN_BACKUPS = 30;
const SAVED_MESSAGE_MS = 5000;

function backupLabel(path: string): string {
  const ms = backupDateMs(path);
  return ms !== undefined ? longDayLabel(ms) : path;
}

export function DataSection({ dataDir, dataLocationUnavailable }: DataSectionProps) {
  const [folderError, setFolderError] = useState<string | undefined>(undefined);
  const [exportMessage, setExportMessage] = useState<string | undefined>(undefined);
  const [importMessage, setImportMessage] = useState<string | undefined>(undefined);
  const [backups, setBackups] = useState<string[]>([]);
  const [confirmingPath, setConfirmingPath] = useState<string | undefined>(undefined);
  const [restoreMessage, setRestoreMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    void window.tb.invoke('data:listBackups').then((list) => {
      if (!disposed) setBackups(list.slice(0, MAX_SHOWN_BACKUPS));
    });
    return () => {
      disposed = true;
    };
  }, []);

  // "Saved to <path>" clears itself after 5s (Task 5.3 acceptance) rather than lingering.
  useEffect(() => {
    if (!exportMessage) return;
    const timer = setTimeout(() => setExportMessage(undefined), SAVED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [exportMessage]);

  const chooseFolder = (): void => {
    setFolderError(undefined);
    void window.tb.invoke('data:chooseDir').then((result) => {
      if (result.error) setFolderError(result.error);
    });
  };

  const exportData = (format: 'json' | 'md'): void => {
    void window.tb.invoke('data:export', format).then((result) => {
      if (result.path) setExportMessage(`Saved to ${result.path}`);
    });
  };

  const importData = (): void => {
    setImportMessage(undefined);
    void window.tb.invoke('data:import').then((result) => {
      if (result.error) setImportMessage(result.error);
      else if (result.imported !== undefined) setImportMessage(`Imported ${result.imported} tasks`);
    });
  };

  const restoreBackup = (path: string): void => {
    void window.tb.invoke('data:restoreBackup', path).then((result) => {
      setConfirmingPath(undefined);
      if (result.ok) setRestoreMessage(`Restored the backup from ${backupLabel(path)}`);
      else setRestoreMessage(result.error ?? 'Could not restore that backup');
    });
  };

  return (
    <>
      <h1>Data</h1>
      <p className="pane-desc">Where your tasks live, and how to move or back them up.</p>

      {dataLocationUnavailable && (
        <p className="data-warning" role="status">
          {`Couldn't open your data folder at ${dataLocationUnavailable}. Showing data from the default location until it's available.`}
        </p>
      )}

      <SettingRow
        label="Where your data lives"
        hint="Pick any folder, including one synced by OneDrive, Dropbox or iCloud. If it already holds TimeBound data, that data is used and your current data is kept alongside as a copy."
      >
        {() => (
          <span className="data-control-col">
            <span className="data-inline-row">
              <span className="data-folder-path">{dataDir ?? 'Default location'}</span>
              <button type="button" className="btn" onClick={chooseFolder}>
                Change folder…
              </button>
            </span>
            {folderError && <span className="data-error">{folderError}</span>}
          </span>
        )}
      </SettingRow>

      <SettingRow label="Export" hint="Save a copy of your tasks to a file.">
        {() => (
          <span className="data-control-col">
            <span className="data-inline-row">
              <button type="button" className="btn" onClick={() => exportData('json')}>
                Export JSON
              </button>
              <button type="button" className="btn" onClick={() => exportData('md')}>
                Export Markdown
              </button>
            </span>
            {exportMessage && <span className="data-message">{exportMessage}</span>}
          </span>
        )}
      </SettingRow>

      <SettingRow label="Import" hint="Load tasks from a JSON or Markdown file.">
        {() => (
          <span className="data-control-col">
            <button type="button" className="btn" onClick={importData}>
              Import JSON or Markdown…
            </button>
            {importMessage && <span className="data-message">{importMessage}</span>}
          </span>
        )}
      </SettingRow>

      <p className="data-subhead">Backups</p>
      {backups.length === 0 ? (
        <p className="pane-desc">No backups yet</p>
      ) : (
        backups.map((path) => (
          <SettingRow key={path} label={backupLabel(path)}>
            {() =>
              confirmingPath === path ? (
                <span className="confirm-inline">
                  <span>Replace your current tasks with this backup?</span>
                  <button type="button" className="btn btn-danger" onClick={() => restoreBackup(path)}>
                    Restore
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmingPath(undefined)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" className="btn" onClick={() => setConfirmingPath(path)}>
                  Restore
                </button>
              )
            }
          </SettingRow>
        ))
      )}
      {restoreMessage && <p className="data-message">{restoreMessage}</p>}
    </>
  );
}
