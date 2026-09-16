// Final-review fixes 3 and 5: boot-failure handling (error box naming the data folder,
// lock released, exit 1) and the start-on-login registration decision/sync.
import { describe, it, expect, vi } from 'vitest';
import { bootErrorMessage, handleBootFailure, shouldRegisterLoginItem, createLoginItemSync } from '../../src/main/boot';

describe('handleBootFailure', () => {
  function deps() {
    return {
      log: vi.fn(),
      showErrorBox: vi.fn(),
      releaseSingleInstanceLock: vi.fn(),
      exit: vi.fn()
    };
  }

  it('logs, shows an error box naming the data folder, releases the lock, and exits 1 — in that order', () => {
    const d = deps();
    const order: string[] = [];
    d.log.mockImplementation(() => order.push('log'));
    d.showErrorBox.mockImplementation(() => order.push('box'));
    d.releaseSingleInstanceLock.mockImplementation(() => order.push('release'));
    d.exit.mockImplementation(() => order.push('exit'));

    handleBootFailure(new Error('EACCES: permission denied'), 'C:\\Users\\me\\TimeBound', d);

    expect(order).toEqual(['log', 'box', 'release', 'exit']);
    expect(d.showErrorBox).toHaveBeenCalledWith('TimeBound could not start', expect.any(String));
    const content = d.showErrorBox.mock.calls[0][1] as string;
    expect(content).toContain('EACCES: permission denied');
    expect(content).toContain('C:\\Users\\me\\TimeBound');
    expect(content).toContain('Your data has not been changed.');
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it('still releases the lock and exits when showing the error box itself throws', () => {
    const d = deps();
    d.showErrorBox.mockImplementation(() => {
      throw new Error('no display');
    });
    handleBootFailure('boom', '/data', d);
    expect(d.releaseSingleInstanceLock).toHaveBeenCalled();
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it('bootErrorMessage handles non-Error values', () => {
    const msg = bootErrorMessage('plain string failure', '/data');
    expect(msg).toContain('plain string failure');
    expect(msg).toContain('/data');
  });
});

describe('shouldRegisterLoginItem', () => {
  it('registers only for a packaged build with no test/data-dir overrides', () => {
    expect(shouldRegisterLoginItem({ isPackaged: true, env: {} })).toBe(true);
    expect(shouldRegisterLoginItem({ isPackaged: false, env: {} })).toBe(false);
    expect(shouldRegisterLoginItem({ isPackaged: true, env: { TIMEBOUND_E2E: '1' } })).toBe(false);
    expect(shouldRegisterLoginItem({ isPackaged: true, env: { TIMEBOUND_DATA_DIR: 'D:\\x' } })).toBe(false);
    expect(shouldRegisterLoginItem({ isPackaged: true, env: { TIMEBOUND_USERDATA_DIR: 'D:\\y' } })).toBe(false);
  });

  it('treats an empty override as unset', () => {
    expect(shouldRegisterLoginItem({ isPackaged: true, env: { TIMEBOUND_DATA_DIR: '' } })).toBe(true);
  });
});

describe('createLoginItemSync', () => {
  it('applies the value once at startup and again only when it changes', () => {
    const set = vi.fn();
    const log = vi.fn();
    const sync = createLoginItemSync({ shouldRegister: true, setLoginItemSettings: set, log });
    sync(false);
    sync(false);
    sync(true);
    sync(true);
    sync(false);
    expect(set.mock.calls).toEqual([[false], [true], [false]]);
    expect(log).not.toHaveBeenCalled();
  });

  it('never registers when it should not, logging exactly one line', () => {
    const set = vi.fn();
    const log = vi.fn();
    const sync = createLoginItemSync({ shouldRegister: false, setLoginItemSettings: set, log });
    sync(true);
    sync(false);
    sync(true);
    expect(set).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('logs (and does not throw) when the OS call fails', () => {
    const log = vi.fn();
    const sync = createLoginItemSync({
      shouldRegister: true,
      setLoginItemSettings: () => {
        throw new Error('denied');
      },
      log
    });
    expect(() => sync(true)).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
