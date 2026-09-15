// main/dataLocation — a tiny pointer file, `data-location.json`, kept in the DEFAULT
// userData folder, recording where the user's real data currently lives (Task 5.3 fix
// round 2, item 2). This is deliberately separate from `Settings.dataDir` inside
// data.json: that field only ever gets written into whichever folder happens to be
// ACTIVE at the time, so after a folder switch it lives only in the NEW folder — the
// next launch, which always starts by looking at the default folder, never sees it.
// This pointer file, by contrast, always lives in the default folder, so it's always
// exactly where the next launch looks first, regardless of where data currently lives.
import * as fs from 'node:fs/promises';
import path from 'node:path';

const POINTER_FILE = 'data-location.json';

export function dataLocationPointerPath(userDataDir: string): string {
  return path.join(userDataDir, POINTER_FILE);
}

/**
 * Reads the pointer file in `userDataDir`. Returns the pointed-to `dataDir`, or
 * `undefined` if there is no pointer file, it isn't readable, isn't valid JSON, or
 * doesn't carry a non-empty string `dataDir` field. Never throws.
 */
export async function readDataLocationPointer(userDataDir: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(dataLocationPointerPath(userDataDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && 'dataDir' in parsed) {
      const dir = (parsed as { dataDir: unknown }).dataDir;
      if (typeof dir === 'string' && dir.length > 0) return dir;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Writes (creating `userDataDir` if needed) the pointer file recording `dataDir`. */
export async function writeDataLocationPointer(userDataDir: string, dataDir: string): Promise<void> {
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(dataLocationPointerPath(userDataDir), JSON.stringify({ dataDir }, null, 2), 'utf8');
}
