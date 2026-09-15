// main/win32/index — the koffi loader (Task 7.1 addendum ruling 1). Loads `koffi`
// lazily and ONLY on `process.platform === 'win32'`, binds every Win32 function this
// app uses, and wires them into the pure `appbar.ts`/`fullscreen.ts` modules. Returns
// `undefined` on any failure (non-Windows, koffi missing since it's an optional
// dependency, or any binding throwing) so the app runs unchanged without it — see
// docs/DECISIONS.md's koffi line and CLAUDE.md.
import type { AppBarApi } from './appbar';
import { createAppBar } from './appbar';
import type { FullscreenApi } from './fullscreen';
import { createFullscreen } from './fullscreen';
import type { RectPx } from './geometry';

export interface Win32 {
  appBar: AppBarApi;
  fullscreen: FullscreenApi;
}

const MONITOR_DEFAULTTONEAREST = 2;

let loggedLoadFailure = false;

/** `load` is injectable so tests can exercise the failure path (a throwing loader)
 * and a fully-mocked success path WITHOUT importing the real `koffi` module or
 * calling a real Win32 function (addendum ruling 6) — it defaults to a real dynamic
 * `import('koffi')`, which only ever actually runs on a real win32 machine, since
 * this function returns before reaching it otherwise. */
export async function loadWin32(load: () => Promise<unknown> = () => import('koffi')): Promise<Win32 | undefined> {
  if (process.platform !== 'win32') return undefined;

  try {
    const mod = await load();
    // A CommonJS package (koffi) loaded via dynamic `import()` surfaces as
    // `{ default: <the real module exports> }` under Node's ESM/CJS interop (koffi
    // builds its exports object at runtime, so static named-export detection finds
    // nothing) — but a test's injected `load` may hand back the fake module object
    // directly, so accept either shape.
    const koffi = ((mod as { default?: unknown }).default ?? mod) as typeof import('koffi');

    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');

    // Every "pointer" (HWND/HMONITOR) below is declared as `uintptr_t` rather than
    // a real koffi pointer type — see geometry.ts's `hwndValue` doc comment for why:
    // these handles are opaque numeric identities this app only ever passes around
    // and compares, never dereferences, so representing them as plain pointer-width
    // integers is both simpler and ABI-correct (identical size/alignment to a real
    // pointer in a parameter slot or struct field).
    const RECT = koffi.struct('TbRect', {
      left: 'int32',
      top: 'int32',
      right: 'int32',
      bottom: 'int32'
    });
    const APPBARDATA = koffi.struct('TbAppBarData', {
      cbSize: 'uint32',
      hWnd: 'uintptr_t',
      uCallbackMessage: 'uint32',
      uEdge: 'uint32',
      rc: RECT,
      lParam: 'intptr_t'
    });
    const MONITORINFO = koffi.struct('TbMonitorInfo', {
      cbSize: 'uint32',
      rcMonitor: RECT,
      rcWork: RECT,
      dwFlags: 'uint32'
    });

    const shAppBarMessageFn = shell32.func(
      'intptr_t __stdcall SHAppBarMessage(uint32_t dwMessage, _Inout_ TbAppBarData *pData)'
    );
    const getForegroundWindowFn = user32.func('uintptr_t __stdcall GetForegroundWindow()');
    const getWindowRectFn = user32.func('bool __stdcall GetWindowRect(uintptr_t hWnd, _Out_ TbRect *lpRect)');
    const monitorFromWindowFn = user32.func('uintptr_t __stdcall MonitorFromWindow(uintptr_t hwnd, uint32_t dwFlags)');
    const getMonitorInfoFn = user32.func('bool __stdcall GetMonitorInfoW(uintptr_t hMonitor, _Inout_ TbMonitorInfo *lpmi)');
    const getClassNameFn = user32.func(
      'int __stdcall GetClassNameW(uintptr_t hWnd, _Out_ char16_t *lpClassName, int nMaxCount)'
    );
    // Bound (per addendum ruling 1) to prove it resolves in user32.dll, but not
    // called by v1's fullscreen heuristic — ruling 5's check does not need the
    // owning process id. Kept for parity/future use (e.g. excluding TimeBound's own
    // process by pid instead of by hwnd list).
    const getWindowThreadProcessIdFn = user32.func(
      'uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hWnd, _Out_ uint32_t *lpdwProcessId)'
    );
    const getShellWindowFn = user32.func('uintptr_t __stdcall GetShellWindow()');
    const getDesktopWindowFn = user32.func('uintptr_t __stdcall GetDesktopWindow()');

    const cbSizeAppBarData = koffi.sizeof(APPBARDATA);
    const cbSizeMonitorInfo = koffi.sizeof(MONITORINFO);

    const appBar = createAppBar({
      cbSize: cbSizeAppBarData,
      shAppBarMessage: (dwMessage, data) => Number(shAppBarMessageFn(dwMessage, data))
    });

    const fullscreen = createFullscreen({
      getForegroundWindow: () => BigInt(getForegroundWindowFn()),
      getWindowRect: (hwnd) => {
        const out: RectPx = { left: 0, top: 0, right: 0, bottom: 0 };
        const ok = getWindowRectFn(hwnd, out);
        return ok ? out : undefined;
      },
      monitorFromWindow: (hwnd) => BigInt(monitorFromWindowFn(hwnd, MONITOR_DEFAULTTONEAREST)),
      getMonitorRect: (hMonitor) => {
        const out = {
          cbSize: cbSizeMonitorInfo,
          rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 } as RectPx,
          rcWork: { left: 0, top: 0, right: 0, bottom: 0 } as RectPx,
          dwFlags: 0
        };
        const ok = getMonitorInfoFn(hMonitor, out);
        return ok ? out.rcMonitor : undefined;
      },
      getClassName: (hwnd) => {
        const out = ['\0'.repeat(256)];
        const len = getClassNameFn(hwnd, out, 256);
        return len ? out[0].slice(0, len) : '';
      },
      getShellWindow: () => BigInt(getShellWindowFn()),
      getDesktopWindow: () => BigInt(getDesktopWindowFn())
    });

    // Referenced only to keep the binding call from being an unused expression in
    // strict lint configs and to document it is intentionally load-checked only.
    void getWindowThreadProcessIdFn;

    return { appBar, fullscreen };
  } catch (err) {
    if (!loggedLoadFailure) {
      loggedLoadFailure = true;
      // eslint-disable-next-line no-console
      console.error('loadWin32: koffi unavailable or a Win32 binding failed; win32 capabilities disabled', err);
    }
    return undefined;
  }
}
