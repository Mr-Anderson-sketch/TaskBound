import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as realFs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readDataLocationPointer, writeDataLocationPointer, dataLocationPointerPath } from '../../src/main/dataLocation';

let tmpDirs: string[] = [];

async function mkTmpDir(): Promise<string> {
  const dir = await realFs.mkdtemp(path.join(os.tmpdir(), 'tb-datalocation-'));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  tmpDirs = [];
});

afterEach(async () => {
  for (const dir of tmpDirs) {
    await realFs.rm(dir, { recursive: true, force: true });
  }
});

describe('readDataLocationPointer / writeDataLocationPointer', () => {
  it('round-trips: reading back what was written', async () => {
    const userDataDir = await mkTmpDir();
    const target = path.join(await mkTmpDir(), 'somewhere-else');

    await writeDataLocationPointer(userDataDir, target);
    const read = await readDataLocationPointer(userDataDir);

    expect(read).toBe(target);
  });

  it('writes valid JSON with a dataDir field at the expected path', async () => {
    const userDataDir = await mkTmpDir();
    await writeDataLocationPointer(userDataDir, '/some/dir');

    const raw = await realFs.readFile(dataLocationPointerPath(userDataDir), 'utf8');
    expect(JSON.parse(raw)).toEqual({ dataDir: '/some/dir' });
  });

  it('creates userDataDir if it does not exist yet', async () => {
    const parent = await mkTmpDir();
    const userDataDir = path.join(parent, 'not-created-yet');

    await expect(writeDataLocationPointer(userDataDir, '/x')).resolves.toBeUndefined();
    expect(await readDataLocationPointer(userDataDir)).toBe('/x');
  });

  it('returns undefined when there is no pointer file', async () => {
    const userDataDir = await mkTmpDir();
    expect(await readDataLocationPointer(userDataDir)).toBeUndefined();
  });

  it('returns undefined for malformed JSON', async () => {
    const userDataDir = await mkTmpDir();
    await realFs.writeFile(dataLocationPointerPath(userDataDir), '{ not json', 'utf8');
    expect(await readDataLocationPointer(userDataDir)).toBeUndefined();
  });

  it('returns undefined when dataDir is missing, non-string, or empty', async () => {
    const userDataDir = await mkTmpDir();

    await realFs.writeFile(dataLocationPointerPath(userDataDir), JSON.stringify({}), 'utf8');
    expect(await readDataLocationPointer(userDataDir)).toBeUndefined();

    await realFs.writeFile(dataLocationPointerPath(userDataDir), JSON.stringify({ dataDir: 42 }), 'utf8');
    expect(await readDataLocationPointer(userDataDir)).toBeUndefined();

    await realFs.writeFile(dataLocationPointerPath(userDataDir), JSON.stringify({ dataDir: '' }), 'utf8');
    expect(await readDataLocationPointer(userDataDir)).toBeUndefined();
  });

  it('overwrites a previous pointer on a second write', async () => {
    const userDataDir = await mkTmpDir();
    await writeDataLocationPointer(userDataDir, '/first');
    await writeDataLocationPointer(userDataDir, '/second');
    expect(await readDataLocationPointer(userDataDir)).toBe('/second');
  });
});
